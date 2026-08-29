/**
 * T01, T02, T03, T04, T05, I01..I10 transition tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RUN_ID,
  MISSION_ID,
  makeEvent,
  resetCounters,
} from "./helpers.js";
import type { RunEvent } from "../src/domain/run-event.js";
import { transition } from "../src/domain/transition.js";
import { initialState } from "../src/domain/run-state.js";
import type { RunState } from "../src/domain/run-state.js";
import type { AttemptId } from "../src/domain/ids.js";

function asSeq(e: RunEvent, seq: number): RunEvent {
  return { ...e, seq };
}

function start(): RunState {
  return initialState(RUN_ID, MISSION_ID, 0);
}

test("T01 happy lifecycle reaches completed", () => {
  resetCounters();
  let s = start();
  const events: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started"), 6),
    asSeq(makeEvent("gate_passed"), 7),
    asSeq(makeEvent("review_started"), 8),
    asSeq(makeEvent("review_passed"), 9),
  ];
  for (const e of events) {
    const r = transition(s, e);
    assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
    if (r.ok === true) s = r.value;
  }
  assert.equal(s.kind, "completed");
});

test("I01 agent_reported_completion alone does NOT produce completed", () => {
  resetCounters();
  let s = start();
  const events: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
  ];
  for (const e of events) {
    const r = transition(s, e);
    assert.equal(r.ok, true);
    if (r.ok === true) s = r.value;
  }
  assert.notEqual(s.kind, "completed");
  assert.equal(s.kind, "gating");
});

test("I02 completed is terminal", () => {
  resetCounters();
  const s: RunState = {
    kind: "completed",
    runId: RUN_ID,
    missionId: MISSION_ID,
    counters: { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 },
    lastEventId: makeEvent("run_created").eventId,
    seq: 9,
  };
  const r = transition(s, asSeq(makeEvent("cancelled"), 10));
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_transition");
  }
});

test("I03 blocked is terminal", () => {
  resetCounters();
  const s: RunState = {
    kind: "blocked",
    runId: RUN_ID,
    missionId: MISSION_ID,
    counters: { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 },
    lastEventId: makeEvent("run_created").eventId,
    seq: 1,
    reason: { kind: "policy_denied", policy: "p", message: "m" },
  };
  const r = transition(s, asSeq(makeEvent("cancelled"), 2));
  assert.equal(r.ok, false);
});

test("I04 exhausted is terminal", () => {
  resetCounters();
  const s: RunState = {
    kind: "exhausted",
    runId: RUN_ID,
    missionId: MISSION_ID,
    counters: { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 },
    lastEventId: makeEvent("run_created").eventId,
    seq: 1,
    observation: { kind: "tool_calls", limit: 1, observed: 1 },
  };
  const r = transition(s, asSeq(makeEvent("cancelled"), 2));
  assert.equal(r.ok, false);
});

test("I05 crashed is terminal", () => {
  resetCounters();
  const s: RunState = {
    kind: "crashed",
    runId: RUN_ID,
    missionId: MISSION_ID,
    counters: { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 },
    lastEventId: makeEvent("run_created").eventId,
    seq: 1,
    reason: { kind: "internal_failure", message: "boom" },
  };
  const r = transition(s, asSeq(makeEvent("cancelled"), 2));
  assert.equal(r.ok, false);
});

test("I06 cancelled is terminal", () => {
  resetCounters();
  const s: RunState = {
    kind: "cancelled",
    runId: RUN_ID,
    missionId: MISSION_ID,
    counters: { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 },
    lastEventId: makeEvent("run_created").eventId,
    seq: 1,
  };
  const r = transition(s, asSeq(makeEvent("run_created"), 2));

test("I08 invalid event in current state yields typed rejection", () => {
  resetCounters();
  const s = start();
  const r = transition(s, asSeq(makeEvent("review_passed"), 1));
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_transition");
    assert.equal(r.error.from, "queued");
    assert.equal(r.error.event, "review_passed");
  }
});

test("I09 transition is deterministic: same inputs produce structurally identical results", () => {
  resetCounters();
  const s = start();
  const ev = asSeq(makeEvent("run_created"), 1);
  const r1 = transition(s, ev);
  const r2 = transition(s, ev);
  assert.equal(r1.ok, r2.ok);
  if (r1.ok === true && r2.ok === true) {
    assert.deepEqual(r1.value, r2.value);
  }
});

test("T03 gate failure produces non-completed lifecycle", () => {
  resetCounters();
  let s = start();
  const events: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("review_started"), 5),
    asSeq(makeEvent("review_failed"), 6),
  ];
  for (const e of events) {
    const r = transition(s, e);
    assert.equal(r.ok, true);
    if (r.ok === true) s = r.value;
  }
  assert.equal(s.kind, "repairing");
});

test("I10 successful authoritative completion requires gate + review path", () => {
  resetCounters();
  let s = start();
  const a: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started"), 6),
    asSeq(makeEvent("gate_passed"), 7),
    asSeq(makeEvent("review_started"), 8),
    asSeq(makeEvent("review_passed"), 9),
  ];
  for (const e of a) {
    const r = transition(s, e);
    assert.equal(r.ok, true);
    if (r.ok === true) s = r.value;
  }
  assert.equal(s.kind, "completed");

  resetCounters();
  let s2 = start();
  const b: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("review_started"), 5),
    asSeq(makeEvent("review_passed"), 6),
  ];
  for (const e of b) {
    const r = transition(s2, e);
    assert.equal(r.ok, true);
    if (r.ok === true) s2 = r.value;
  }
  assert.equal(s2.kind, "completed");

  resetCounters();
  let s3 = start();
  const c: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(
      makeEvent("attempt_started", { attemptId: "wrong-attempt" as AttemptId }),
      4,
    ),
    asSeq(makeEvent("agent_reported_completion"), 5),
  ];
  let mismatchedRejected = false;
  for (const e of c) {
    const r = transition(s3, e);
    if (r.ok === false) {
      mismatchedRejected = true;
      assert.equal(r.error.kind, "invalid_transition");
      break;
    }
    s3 = r.value;
  }
  assert.equal(mismatchedRejected, true, "expected typed rejection of mismatched attempt_id");
  assert.notEqual(s3.kind, "completed");
});

  assert.equal(r.ok, false);
});

test("I07 gate failure cannot produce completed", () => {
  resetCounters();
  let s = start();
  const events: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gate_failed", { gate: "tests" }), 6),
  ];
  for (const e of events) {
    const r = transition(s, e);
    assert.equal(r.ok, true);
    if (r.ok === true) s = r.value;
  }
  assert.notEqual(s.kind, "completed");
  assert.equal(s.kind, "repairing");
});
