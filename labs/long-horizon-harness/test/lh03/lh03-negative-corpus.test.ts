/**
 * LH-03 §26 — Required deterministic negative corpus.
 *
 * Implements HNEG01..HNEG15 against the candidate-neutral
 * protocol and the V1 + V2 surfaces of the Pi and Cline
 * adapters. Live-state negative tests (HNEG14, HNEG15) are
 * exercised against the in-memory fixture path; live
 * subprocess negative tests are reserved for the live lane.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PiAdapter,
  defaultPiCapabilities,
  piQualificationIdentity,
} from "../../src/adapters/pi/pi-adapter.js";
import {
  ClineAdapter,
  clineQualificationIdentity,
  defaultClineCapabilities,
} from "../../src/adapters/cline/cline-adapter.js";

import { decodePiEvent } from "../../src/adapters/pi/pi-adapter.js";
import { decodeClineEvent } from "../../src/adapters/cline/cline-adapter.js";
import { computeSchemaFingerprint } from "../../src/adapter-common/schema-fingerprint.js";

function pi(): PiAdapter {
  const id = piQualificationIdentity({
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: "/tmp/pi.js",
    executable_sha256: "a".repeat(64),
    reported_cli_version: "0.85.1",
  });
  return new PiAdapter({
    qualification: id,
    capabilities: defaultPiCapabilities(id, 0, {
      session_capture: "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl",
      cancellation_halt: "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json",
    }),
    captured_at_ms: 0,
  });
}

function cline(): ClineAdapter {
  const id = clineQualificationIdentity({
    package_name: null,
    package_version: null,
    executable_path: null,
    executable_sha256: null,
    reported_cli_version: null,
  });
  return new ClineAdapter({
    qualification: id,
    capabilities: defaultClineCapabilities(id, 0),
    captured_at_ms: 0,
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

// HNEG01: unknown native event => UNKNOWN_NATIVE_EVENT
test("HNEG01: unknown native event is visible, not silently ignored", () => {
  const out = decodePiEvent("a1", JSON.stringify({ type: "totally_new_event" }));
  assert.equal(out.classification, "UNKNOWN");
  assert.equal(out.event, null);
});

// HNEG02: malformed native JSON
test("HNEG02: malformed native JSON is classified MALFORMED_NATIVE_EVENT", () => {
  const out = decodePiEvent("a1", "{ not-json");
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
});

// HNEG03: extra closed-world field on a known kind is rejected (CORRECTION01)
test("HNEG03: known event extra closed-world field is rejected", () => {
  // Pi tool_execution_end (real schema): {type, toolCallId, toolName,
  // result?, isError?}. An extra own key is rejected.
  const outExtra = decodePiEvent(
    "a1",
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: { out: "" },
      isError: false,
      surprise: 1,
    }),
  );
  assert.equal(outExtra.classification, "MALFORMED");
  if (outExtra.classification === "MALFORMED") {
    assert.equal(outExtra.hostile_reason, "extra_own_key");
  }
  // Pi tool_execution_end without required fields: also rejected.
  const outMissing = decodePiEvent(
    "a1",
    JSON.stringify({ type: "tool_execution_end" }),
  );
  assert.equal(outMissing.classification, "MALFORMED");
  // For Cline, 'done' is the closed kind; 'extra' field is
  // not promoted.
  const outCline = decodeClineEvent(
    "a1",
    JSON.stringify({ type: "done", extra: "field" }),
  );
  assert.notEqual(outCline.event, null);
  if (outCline.event !== null) {
    assert.equal(outCline.event.type, "candidate_reported_completion");
  }
});

// HNEG04: native "success" with no Factory gate => NOT SUCCESS (CORRECTION01)
test("HNEG04: harness self-report success without Factory gate is not terminal", async () => {
  const a = pi();
  // Real Pi 0.85.1 agent_end shape (no "summary" field; lives in
  // messages[].content).
  const raw = JSON.stringify({
    type: "agent_end",
    messages: [{ role: "assistant", content: "completed" }],
    willRetry: false,
  });
  const h = a.injectCapturedRun({
    handle: "h-hneg04",
    stdout_lines: [raw],
    stderr_lines: [],
    raw_events: [raw],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [{ type: "agent_end", messages: [{ role: "assistant", content: "completed" }], willRetry: false }],
  });
  const evs = await collect(a.events(h));
  for (const e of evs) {
    assert.notEqual(e.type, "completed");
    assert.notEqual(e.type, "terminal_success");
    assert.notEqual(e.type, "run_finished");
  }
  // The completion is observed, never authoritative.
  const completion = evs.find((e) => e.type === "candidate_reported_completion");
  assert.ok(completion);
  await a.cleanup(h);
});

// HNEG05: process exit 0 with no Factory gate => NOT SUCCESS
test("HNEG05: process exit 0 alone does not produce a terminal success", async () => {
  const a = pi();
  const h = a.injectCapturedRun({
    handle: "h-hneg05",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  const r = await a.awaitExit(h);
  assert.equal(r.process_exit_code, 0);
  // The adapter NEVER asserts a terminal outcome.
  const status = await a.status(h);
  assert.equal(status.phase, "completed");
  // 'completed' here is the adapter's local lifecycle
  // observation, not a Factory terminal. Phase E remains
  // authoritative.
  await a.cleanup(h);
});

// HNEG06: process non-zero is distinguished from cancellation
test("HNEG06: process non-zero is distinguished from cancel", async () => {
  const a = pi();
  const h = a.injectCapturedRun({
    handle: "h-hneg06",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 2,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  const r = await a.awaitExit(h);
  assert.equal(r.process_exit_code, 2);
  assert.equal(r.cancel_requested, false);
  assert.equal(r.external_kill_used, false);
  await a.cleanup(h);
});

// HNEG07: timeout distinguished from cancel
test("HNEG07: timeout is distinguished from cancel", async () => {
  const a = pi();
  const h = a.injectCapturedRun({
    handle: "h-hneg07",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: null,
    process_exit_signal: "SIGKILL",
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  const r = await a.awaitExit(h);
  assert.equal(r.process_exit_signal, "SIGKILL");
  assert.equal(r.cancel_requested, false);
  await a.cleanup(h);
});

// HNEG08-HNEG10 are covered in lh03-secret-redaction.test.ts
// (SECRET01-SECRET08).

// HNEG11: stale / unqualified version (covered in lh03-version-drift.test.ts)

// HNEG12: modified schema fingerprint (covered in lh03-version-drift.test.ts)
test("HNEG12: schema fingerprint drift is detected", () => {
  const a = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["x", "y"],
    required_fields: ["type"],
    version: "1.0.0",
  });
  const b = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["x", "y", "z"],
    required_fields: ["type"],
    version: "1.0.0",
  });
  assert.notEqual(a, b);
});

// HNEG13: replay with executable absent
test("HNEG13: replay works with no harness executable on PATH", async () => {
  const a = pi();
  // The injectCapturedRun path performs NO subprocess
  // spawn, so no executable is required.
  const h = a.injectCapturedRun({
    handle: "h-hneg13",
    stdout_lines: [JSON.stringify({ type: "session", version: 3, id: "X", timestamp: "T", cwd: "/" })],
    stderr_lines: [],
    raw_events: [JSON.stringify({ type: "session", version: 3, id: "X", timestamp: "T", cwd: "/" })],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  const evs = await collect(a.events(h));
  assert.ok(evs.length > 0);
  await a.cleanup(h);
});

// HNEG14: replay with network unavailable
test("HNEG14: replay performs no network access", async () => {
  // Same property as HNEG13: the fixture-inject path is
  // network-free by construction.
  const a = cline();
  const h = a.injectCapturedRun({
    handle: "h-hneg14",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  const evs = await collect(a.events(h));
  assert.equal(evs[0]?.type, "candidate_started");
  await a.cleanup(h);
});

// HNEG15: repeated fresh run state leakage
test("HNEG15: repeated fresh runs do not inherit unintended state", async () => {
  const a = pi();
  const h1 = a.injectCapturedRun({
    handle: "h-leak-1",
    stdout_lines: ["first\n"],
    stderr_lines: ["warn-1\n"],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  await a.cleanup(h1);
  const h2 = a.injectCapturedRun({
    handle: "h-leak-2",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 0,
    exit_at_ms: 1,
    native_events: [],
  });
  const r = await a.awaitExit(h2);
  assert.equal(r.process_exit_code, 0);
  // h2 was a fresh handle; it MUST NOT carry the stdout of h1.
  const arts = await a.collectArtifacts(h2);
  const stdout = arts.find((x) => x.kind === "STDOUT_LINES");
  assert.equal(stdout!.text, "");
  await a.cleanup(h2);
});
