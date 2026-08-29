/**
 * T01..T05, I01..I10, C01..C07 transition tests.
 *
 * CORRECTION01 enforces the canonical completion path. The only way
 * to reach `completed` is
 *   queued -> preparing -> running -> gating(awaiting_start)
 *   -> gating(running) -> gating(passed) -> reviewing -> completed
 * Every shortcut (`running -> review_started`, `running ->
 * gating_started`, `gating.awaiting_start -> review_started` without
 * gate proof, etc.) is rejected as a typed InvalidTransition.
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

type SeqResult =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false };

function runSeq(events: ReadonlyArray<RunEvent>): SeqResult {
  let s = start();
  for (const e of events) {
    const r = transition(s, e);
    if (r.ok === false) return { ok: false };
    s = r.value;
  }
  return { ok: true, state: s };
}

const CANONICAL = (): RunEvent[] => [
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

test("T01 canonical full path reaches completed", () => {
  resetCounters();
  const r = runSeq(CANONICAL());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.state.kind, "completed");
  }
});

test("I01 agent_reported_completion alone does NOT produce completed", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.notEqual(r.state.kind, "completed");
    assert.equal(r.state.kind, "gating");
  }
});

test("I02..I06 terminal states reject ordinary events", () => {
  resetCounters();
  const baseCounters = { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 };
  const eid = makeEvent("run_created").eventId;

  for (const s of [
    { kind: "completed" as const, lastEventId: eid, seq: 9 },
    {
      kind: "blocked" as const,
      lastEventId: eid,
      seq: 1,
      reason: { kind: "policy_denied" as const, policy: "p", message: "m" },
    },
    {
      kind: "exhausted" as const,
      lastEventId: eid,
      seq: 1,
      observation: { kind: "tool_calls" as const, limit: 1, observed: 1 },
    },
    {
      kind: "crashed" as const,
      lastEventId: eid,
      seq: 1,
      reason: { kind: "internal_failure" as const, message: "boom" },
    },
    { kind: "cancelled" as const, lastEventId: eid, seq: 1 },
  ]) {
    const state: RunState = {
      ...s,
      runId: RUN_ID,
      missionId: MISSION_ID,
      counters: baseCounters,
    };
    const r = transition(state, asSeq(makeEvent("cancelled"), 100));
    assert.equal(r.ok, false, `${s.kind} should reject`);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_transition");
    }
  }
});

test("I07 gate failure cannot produce completed", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started", { gate: "tests" }), 6),
    asSeq(makeEvent("gate_failed", { gate: "tests" }), 7),
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.notEqual(r.state.kind, "completed");
    assert.equal(r.state.kind, "repairing");
  }
});
test("I08 invalid event in current state yields typed rejection", () => {
  resetCounters();
  const r = transition(start(), asSeq(makeEvent("review_passed"), 1));
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_transition");
    assert.equal(r.error.from, "queued");
    assert.equal(r.error.event, "review_passed");
  }
});

test("I09 transition is deterministic", () => {
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
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started"), 6),
    asSeq(makeEvent("gate_failed"), 7),
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.state.kind, "repairing");
});
test("I10 successful authoritative completion requires candidate completion + gate + review", () => {
  resetCounters();
  const ok = runSeq(CANONICAL());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.state.kind, "completed");

  resetCounters();
  const a = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("review_started"), 5),
  ]);
  assert.equal(a.ok, false);

  resetCounters();
  const b = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("gating_started"), 5),
  ]);
  assert.equal(b.ok, false);

  resetCounters();
  const c = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("review_started"), 6),
  ]);
  assert.equal(c.ok, false);

  resetCounters();
  const d = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gate_passed"), 6),
  ]);
  assert.equal(d.ok, false);

  resetCounters();
  const e = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started", { attemptId: "a-1" as AttemptId }), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started", { attemptId: "a-2" as AttemptId }), 6),
  ]);
  assert.equal(e.ok, false);

  resetCounters();
  const f = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started"), 6),
    asSeq(makeEvent("gate_passed", { gate: "wrong-gate" }), 7),
  ]);
  assert.equal(f.ok, false);
});