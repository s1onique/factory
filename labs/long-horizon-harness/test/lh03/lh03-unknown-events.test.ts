/**
 * LH-03 §11 — Unknown / malformed native events fail visibly.
 *
 * Required tests:
 *   - unknown event kind -> UNKNOWN_NATIVE_EVENT
 *   - unknown event payload shape -> MALFORMED_NATIVE_EVENT
 *   - known event extra closed-world field -> reject per adapter
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodePiEvent, PI_KNOWN_EVENT_KINDS } from "../../src/adapters/pi/pi-adapter.js";
import {
  decodeClineEvent,
  CLINE_KNOWN_EVENT_KINDS,
} from "../../src/adapters/cline/cline-adapter.js";

test("LH03-UE01: Pi unknown event kind produces no event (HNEG01)", () => {
  const out = decodePiEvent("a1", JSON.stringify({ type: "exotic_new_event", payload: {} }));
  assert.equal(out.event, null);
  assert.equal(out.kind, "UNKNOWN");
});

test("LH03-UE02: Pi malformed JSON produces MALFORMED_NATIVE_EVENT (HNEG02)", () => {
  const out = decodePiEvent("a1", "{ this is not json");
  assert.equal(out.event, null);
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
});

test("LH03-UE03: Pi known event with bad shape produces MALFORMED_NATIVE_EVENT", () => {
  const out = decodePiEvent(
    "a1",
    JSON.stringify({ type: "tool_start" /* missing tool, call_id */ }),
  );
  assert.equal(out.event, null);
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
});

test("LH03-UE04: Pi tool_end without required fields is rejected", () => {
  const out = decodePiEvent(
    "a1",
    JSON.stringify({ type: "tool_end" }),
  );
  assert.equal(out.event, null);
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
});

test("LH03-UE05: Pi known kind 'message' with non-string content is rejected", () => {
  const out = decodePiEvent(
    "a1",
    JSON.stringify({ type: "message", content: { complex: true } }),
  );
  assert.equal(out.event, null);
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
});

test("LH03-UE06: Pi session envelope parses as kind 'session'", () => {
  const out = decodePiEvent(
    "a1",
    JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "t", cwd: "/tmp" }),
  );
  assert.equal(out.kind, "session");
});

test("LH03-UE07: Pi KNOWN_EVENT_KINDS is closed-world", () => {
  // The list MUST NOT grow silently; the conformance suite
  // pins the size at 6.
  assert.equal(PI_KNOWN_EVENT_KINDS.size, 6);
  for (const k of ["session", "message", "tool_start", "tool_end", "agent_end", "error"]) {
    assert.equal(PI_KNOWN_EVENT_KINDS.has(k), true, `missing known kind ${k}`);
  }
});

test("LH03-UE08: Cline unknown event kind produces no event (HNEG01)", () => {
  const out = decodeClineEvent("a1", JSON.stringify({ type: "future_thing" }));
  assert.equal(out.event, null);
  assert.equal(out.kind, "UNKNOWN");
});

test("LH03-UE09: Cline malformed JSON produces MALFORMED_NATIVE_EVENT (HNEG02)", () => {
  const out = decodeClineEvent("a1", "{ broken");
  assert.equal(out.event, null);
  assert.equal(out.kind, "MALFORMED_NATIVE_EVENT");
});

test("LH03-UE10: Cline 'done' event maps to candidate_reported_completion (H7)", () => {
  const out = decodeClineEvent(
    "a1",
    JSON.stringify({ type: "done" }),
  );
  assert.notEqual(out.event, null);
  if (out.event !== null) {
    assert.equal(out.event.type, "candidate_reported_completion");
    assert.equal(out.event.attemptId, "a1");
  }
});

test("LH03-UE11: Cline KNOWN_EVENT_KINDS is closed-world", () => {
  assert.equal(CLINE_KNOWN_EVENT_KINDS.size, 7);
  for (const k of [
    "session_start",
    "session_end",
    "message",
    "tool_started",
    "tool_completed",
    "done",
    "error",
  ]) {
    assert.equal(CLINE_KNOWN_EVENT_KINDS.has(k), true, `missing known kind ${k}`);
  }
});
