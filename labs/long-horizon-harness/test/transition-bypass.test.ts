/**
 * C01..C07 explicit shortcut-rejection tests.
 *
 * Kept in a sibling file to `transition.test.ts` so the test runner
 * has fewer top-level tests per file and avoids a Node 26 test runner
 * stack-overflow regression that triggers when a single file declares
 * many sibling tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeEvent,
  resetCounters,
} from "./helpers.js";
import type { RunEvent } from "../src/domain/run-event.js";
import type { AttemptId } from "../src/domain/ids.js";
import { RUN_ID, MISSION_ID } from "./helpers.js";
import { initialState } from "../src/domain/run-state.js";
import type { RunState } from "../src/domain/run-state.js";
import { transition } from "../src/domain/transition.js";

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

test("C01 running -> review_started rejected", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("review_started"), 5),
  ]);
  assert.equal(r.ok, false);
});

test("C02 running -> gating_started rejected", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("gating_started"), 5),
  ]);
  assert.equal(r.ok, false);
});

test("C03 gating.awaiting_start -> review_started rejected", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("review_started"), 6),
  ]);
  assert.equal(r.ok, false);
});

test("C04 gate_passed before gating_started rejected", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gate_passed"), 6),
  ]);
  assert.equal(r.ok, false);
});

test("C05 gate name mismatch rejected", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started", { gate: "tests" }), 6),
    asSeq(makeEvent("gate_passed", { gate: "lint" }), 7),
  ]);
  assert.equal(r.ok, false);
});

test("C06 attempt mismatch in gating rejected", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started", { attemptId: "wrong" as AttemptId }), 6),
  ]);
  assert.equal(r.ok, false);
});

test("C07 valid canonical completion succeeds", () => {
  resetCounters();
  const r = runSeq([
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
    asSeq(makeEvent("agent_reported_completion"), 5),
    asSeq(makeEvent("gating_started"), 6),
    asSeq(makeEvent("gate_passed"), 7),
    asSeq(makeEvent("review_started"), 8),
    asSeq(makeEvent("review_passed"), 9),
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.state.kind, "completed");
  }
});