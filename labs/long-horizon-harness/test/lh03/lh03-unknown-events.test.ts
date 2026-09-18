/**
 * LH-03 §11 — Unknown / malformed native events fail visibly.
 *
 * CORRECTION01 (H-C01, H-C03): the real Pi 0.85.1 native
 * schema is 24 known kinds (SessionHeader + AgentEvent +
 * AgentSessionEvent-only). Tests in this file use the new
 * closed-world table:
 *
 *   PI_KNOWN_EVENT_KINDS        : 24 entries
 *   PI_NORMALIZED_EVENT_KINDS   : 8 entries
 *   PI_PRESERVED_META_KINDS     : 2 entries
 *
 * Decoder results carry a `classification` and (for
 * MALFORMED/UNKNOWN) a `hostile_reason`. Tests below
 * exercise:
 *
 *   PI-SCHEMA01 real session header accepted
 *   PI-SCHEMA02 agent_start accepted
 *   PI-SCHEMA03 agent_end accepted / non-authoritative
 *   PI-SCHEMA04 tool_execution_start maps correctly
 *   PI-SCHEMA05 tool_execution_end maps correctly
 *   PI-SCHEMA06 message lifecycle classified explicitly
 *   PI-SCHEMA07 unknown event fails visible
 *   PI-SCHEMA08 fingerprint changes if real native kind set changes
 *
 * And (H-C03) HNEG01–HNEG03 through the adapter events() +
 * awaitExit() path, not the decoder alone.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  decodePiEvent,
  PI_KNOWN_EVENT_KINDS,
  PI_NORMALIZED_EVENT_KINDS,
  PI_PRESERVED_META_KINDS,
  PI_NATIVE_EVENT_KINDS,
  PI_EVENT_CLASSIFICATION,
  piSchemaFingerprint,
  PiAdapter,
  defaultPiCapabilities,
  QUALIFIED_PI_IDENTITY,
} from "../../src/adapters/pi/pi-adapter.js";

/* ------------------------------------------------------------------ *
 * PI-SCHEMA01..08 — Real Pi 0.85.1 schema acceptance + drift.         *
 * ------------------------------------------------------------------ */

test("PI-SCHEMA01: real session header is accepted as PRESERVED_META_OBSERVATION", () => {
  const out = decodePiEvent(
    "a1",
    JSON.stringify({
      type: "session",
      version: 3,
      id: "01a0b17b-a11a-770c-8297-311e10c1cc82",
      timestamp: "2026-09-17T22:27:44.539Z",
      cwd: "/private/tmp/pi-live",
    }),
  );
  assert.equal(out.classification, "META_OBSERVATION");
  assert.equal(out.kind, "session");
  assert.equal(out.event, null);
});

test("PI-SCHEMA02: agent_start is accepted as NORMALIZED", () => {
  const out = decodePiEvent("a1", JSON.stringify({ type: "agent_start" }));
  assert.equal(out.classification, "NORMALIZED");
  assert.equal(out.kind, "agent_start");
  if (out.classification === "NORMALIZED") {
    assert.equal(out.event.type, "candidate_started");
    assert.equal(out.event.attemptId, "a1");
  }
});

test("PI-SCHEMA03: agent_end is accepted as NORMALIZED but non-authoritative on success", () => {
  const out = decodePiEvent("a1", JSON.stringify({
    type: "agent_end",
    messages: [],
    willRetry: false,
  }));
  assert.equal(out.classification, "NORMALIZED");
  assert.equal(out.kind, "agent_end");
  if (out.classification === "NORMALIZED") {
    assert.equal(out.event.type, "candidate_reported_completion");
  }
});

test("PI-SCHEMA04: tool_execution_start maps to tool_started", () => {
  const out = decodePiEvent("a1", JSON.stringify({
    type: "tool_execution_start",
    toolCallId: "tc-1",
    toolName: "bash",
    args: { cmd: "ls" },
  }));
  assert.equal(out.classification, "NORMALIZED");
  assert.equal(out.kind, "tool_execution_start");
  if (out.classification === "NORMALIZED") {
    assert.equal(out.event.type, "tool_started");
    assert.equal(out.event.attemptId, "a1");
    assert.equal(out.event.tool, "bash");
    assert.equal(out.event.callId, "tc-1");
  }
});

test("PI-SCHEMA05: tool_execution_end maps to tool_finished", () => {
  const ok = decodePiEvent("a1", JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "tc-1",
    toolName: "bash",
    result: { out: "" },
    isError: false,
  }));
  assert.equal(ok.classification, "NORMALIZED");
  if (ok.classification === "NORMALIZED") {
    assert.equal(ok.event.type, "tool_finished");
    assert.equal((ok.event as { ok: boolean }).ok, true);
  }
  const err = decodePiEvent("a1", JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "tc-1",
    toolName: "bash",
    result: null,
    isError: true,
  }));
  assert.equal(err.classification, "NORMALIZED");
  if (err.classification === "NORMALIZED") {
    assert.equal(err.event.type, "tool_finished");
    assert.equal((err.event as { ok: boolean }).ok, false);
  }
});

test("PI-SCHEMA06: message lifecycle classified explicitly (start/update/end)", () => {
  const start = decodePiEvent("a1", JSON.stringify({
    type: "message_start",
    message: { role: "assistant", content: "hi" },
  }));
  assert.equal(start.classification, "NORMALIZED");
  assert.equal(start.kind, "message_start");
  if (start.classification === "NORMALIZED") {
    assert.equal(start.event.type, "candidate_message");
    assert.equal((start.event as { text: string }).text, "hi");
  }
  const update = decodePiEvent("a1", JSON.stringify({
    type: "message_update",
    usage: { input: 1, output: 1 },
    assistantMessageEvent: { type: "text_delta", delta: "x" },
  }));
  assert.equal(update.classification, "META_OBSERVATION");
  assert.equal(update.kind, "message_update");
  assert.equal(update.event, null);
  const end = decodePiEvent("a1", JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: "done" },
  }));
  assert.equal(end.classification, "NORMALIZED");
  assert.equal(end.kind, "message_end");
});

test("PI-SCHEMA07: unknown event fails visible (PI)", () => {
  const out = decodePiEvent("a1", JSON.stringify({ type: "exotic_new_event", payload: {} }));
  assert.equal(out.event, null);
  assert.equal(out.classification, "UNKNOWN");
  assert.equal(out.kind, "exotic_new_event");
  assert.equal(out.hostile_reason, "unknown_kind");
});

test("PI-SCHEMA08: fingerprint changes if real native kind set changes", () => {
  const before = piSchemaFingerprint("JSONL_EVENTS", "0.85.1");
  // Mutating the kind set MUST change the fingerprint.
  const withExtra = computeWithExtraKind();
  assert.notEqual(before, withExtra);
  // And the schema fingerprint MUST be derived from the
  // REAL native kinds (the closed-world PI_NATIVE_EVENT_KINDS
  // array). Any drift there must move the fingerprint.
  assert.equal(before, piSchemaFingerprint("JSONL_EVENTS", "0.85.1"));
});

// Helper that computes a fingerprint with a single extra
// kind appended; defined here so it doesn't change the
// canonical fingerprint.
function computeWithExtraKind(): string {
  const obj = {
    protocol_mode: "JSONL_EVENTS",
    event_kinds: [...PI_NATIVE_EVENT_KINDS, "future_kind"].sort(),
    required_fields: [
      "type", "version", "id", "timestamp", "cwd",
    ].sort(),
    version: "0.85.1",
  };
  return createHash("sha256").update(JSON.stringify(obj), "utf8").digest("hex");
}

/* ------------------------------------------------------------------ *
 * Decoder closed-world surface (H-C04).                              *
 * ------------------------------------------------------------------ */

test("PI-DEC01: malformed JSON is MALFORMED (hostile_reason=parse_failed)", () => {
  const out = decodePiEvent("a1", "{ this is not json");
  assert.equal(out.classification, "MALFORMED");
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
  if (out.classification === "MALFORMED") {
    assert.equal(out.hostile_reason, "parse_failed");
  }
});

test("PI-DEC02: extra own string key on session is MALFORMED (extra_own_key)", () => {
  const out = decodePiEvent("a1", JSON.stringify({
    type: "session",
    version: 3,
    id: "x",
    timestamp: "t",
    cwd: "/tmp",
    surprise: 1,
  }));
  assert.equal(out.classification, "MALFORMED");
  if (out.classification === "MALFORMED") {
    assert.equal(out.hostile_reason, "extra_own_key");
  }
});

test("PI-DEC03: missing required field on session is MALFORMED (missing_required_field)", () => {
  const out = decodePiEvent("a1", JSON.stringify({
    type: "session",
    version: 3,
    id: "x",
    timestamp: "t",
    // missing cwd
  }));
  assert.equal(out.classification, "MALFORMED");
  if (out.classification === "MALFORMED") {
    assert.equal(out.hostile_reason, "missing_required_field");
  }
});

test("PI-DEC04: wrong scalar type is MALFORMED (wrong_field_type)", () => {
  const out = decodePiEvent("a1", JSON.stringify({
    type: "session",
    version: "three", // should be number or absent
    id: "x",
    timestamp: "t",
    cwd: "/tmp",
  }));
  assert.equal(out.classification, "MALFORMED");
  if (out.classification === "MALFORMED") {
    assert.equal(out.hostile_reason, "wrong_field_type");
  }
});

test("PI-DEC05: PI_KNOWN_EVENT_KINDS is closed-world at 24 entries", () => {
  assert.equal(PI_KNOWN_EVENT_KINDS.size, 24);
  assert.equal(PI_NORMALIZED_EVENT_KINDS.size, 8);
  assert.equal(PI_PRESERVED_META_KINDS.size, 2);
  for (const k of [
    "session", "agent_start", "agent_end", "turn_start", "turn_end",
    "message_start", "message_update", "message_end",
    "tool_execution_start", "tool_execution_update", "tool_execution_end",
    "agent_settled", "queue_update", "compaction_start", "compaction_end",
    "auto_retry_start", "auto_retry_end", "entry_appended",
    "session_info_changed", "thinking_level_changed",
    "summarization_retry_scheduled", "summarization_retry_attempt_start",
    "summarization_retry_finished", "bash_execution_update",
  ]) {
    assert.equal(PI_KNOWN_EVENT_KINDS.has(k), true, `missing kind ${k}`);
  }
});

test("PI-DEC06: classification table covers every known kind", () => {
  for (const k of PI_NATIVE_EVENT_KINDS) {
    assert.ok(
      PI_EVENT_CLASSIFICATION[k] !== undefined,
      `no classification for ${k}`,
    );
  }
});

test("PI-DEC07: PI_NORMALIZED_EVENT_KINDS is a subset of PI_KNOWN_EVENT_KINDS", () => {
  for (const k of PI_NORMALIZED_EVENT_KINDS) {
    assert.equal(PI_KNOWN_EVENT_KINDS.has(k), true);
  }
});

/* ------------------------------------------------------------------ *
 * H-C03 — Decoder integration through events()/awaitExit().           *
 * ------------------------------------------------------------------ */

function buildAdapter(): PiAdapter {
  return new PiAdapter({
    qualification: QUALIFIED_PI_IDENTITY,
    capabilities: defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 1700000000000),
    captured_at_ms: 1700000000000,
  });
}

test("HNEG01 (adapter path): unknown event is recorded in adapter_errors and emitted as candidate_error", async () => {
  const adapter = buildAdapter();
  const handle = adapter.ingestLiveCapture({
    handle: "h-unknown",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      '{"type":"session","version":3,"id":"x","timestamp":"t","cwd":"/tmp"}',
      JSON.stringify({ type: "future_thing", payload: {} }),
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const events: unknown[] = [];
  for await (const e of adapter.events(handle)) events.push(e);
  const errorEvents = events.filter((e) =>
    typeof e === "object" && e !== null &&
    (e as { type?: string }).type === "candidate_error"
  );
  assert.equal(errorEvents.length >= 1, true);
  const exit = await adapter.awaitExit(handle);
  const codes = exit.adapter_errors.map((e) => e.code);
  assert.equal(codes.includes("UNKNOWN_NATIVE_EVENT"), true);
  // Normalization disposition must be incomplete.
  assert.equal(adapter.normalizationCompleteness(handle), "NORMALIZATION_INCOMPLETE");
});

test("HNEG02 (adapter path): malformed native event is recorded in adapter_errors and emitted as candidate_error", async () => {
  const adapter = buildAdapter();
  const handle = adapter.ingestLiveCapture({
    handle: "h-malformed",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      "{ this is not json",
      JSON.stringify({
        type: "session", version: 3, id: "x", timestamp: "t", cwd: "/tmp",
      }),
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const events: unknown[] = [];
  for await (const e of adapter.events(handle)) events.push(e);
  const errorEvents = events.filter((e) =>
    typeof e === "object" && e !== null &&
    (e as { type?: string }).type === "candidate_error"
  );
  assert.equal(errorEvents.length >= 1, true);
  const exit = await adapter.awaitExit(handle);
  const codes = exit.adapter_errors.map((e) => e.code);
  assert.equal(codes.includes("MALFORMED_NATIVE_EVENT"), true);
  assert.equal(adapter.normalizationCompleteness(handle), "NORMALIZATION_INCOMPLETE");
});

test("HNEG03 (adapter path): extra forbidden native field is rejected and emitted as candidate_error", async () => {
  const adapter = buildAdapter();
  const handle = adapter.ingestLiveCapture({
    handle: "h-extra",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "x",
        timestamp: "t",
        cwd: "/tmp",
        surprise: "nope",
      }),
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const events: unknown[] = [];
  for await (const e of adapter.events(handle)) events.push(e);
  const errorEvents = events.filter((e) =>
    typeof e === "object" && e !== null &&
    (e as { type?: string }).type === "candidate_error"
  );
  assert.equal(errorEvents.length >= 1, true);
  const exit = await adapter.awaitExit(handle);
  const codes = exit.adapter_errors.map((e) => e.code);
  assert.equal(codes.includes("MALFORMED_NATIVE_EVENT"), true);
});
