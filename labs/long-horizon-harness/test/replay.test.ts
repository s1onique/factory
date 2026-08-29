/**
 * T06 (deterministic replay) replay tests.
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
import { replay } from "../src/domain/replay.js";
import { encodeEnvelope, decodeEnvelope } from "../src/evidence/codec.js";

function asSeq(e: RunEvent, seq: number): RunEvent {
  return { ...e, seq };
}

test("T06 deterministic replay: same sequence yields same derived state", () => {
  resetCounters();
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

  const r1 = replay(RUN_ID, MISSION_ID, events);
  const r2 = replay(RUN_ID, MISSION_ID, events);
  const r3 = replay(RUN_ID, MISSION_ID, events);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, true);
  if (r1.ok && r2.ok && r3.ok) {
    assert.deepEqual(r1.value.state, r2.value.state);
    assert.deepEqual(r2.value.state, r3.value.state);
    assert.equal(r1.value.state.kind, "completed");
    assert.equal(r1.value.eventsProcessed, 9);
    assert.equal(r1.value.lastSeq, 9);
  }
});

test("replay rejects duplicate sequences", () => {
  resetCounters();
  const e1 = asSeq(makeEvent("run_created"), 1);
  const e2 = asSeq(makeEvent("preparation_started"), 1); // duplicate seq
  const r = replay(RUN_ID, MISSION_ID, [e1, e2]);
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_evidence");
  }
});

test("replay rejects sequence gaps", () => {
  resetCounters();
  const e1 = asSeq(makeEvent("run_created"), 1);
  const e3 = asSeq(makeEvent("preparation_started"), 3); // gap
  const r = replay(RUN_ID, MISSION_ID, [e1, e3]);
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_evidence");
  }
});

test("replay rejects mixed run identities", () => {
  resetCounters();
  // Manually craft an event with a foreign run_id.
  const event = {
    ...makeEvent("run_created"),
    seq: 1,
    runId: "foreign" as unknown as typeof RUN_ID,
  } as RunEvent;
  const r = replay(RUN_ID, MISSION_ID, [event]);
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_evidence");
  }
});

test("replay propagates InvalidTransition from transition", () => {
  resetCounters();
  // Apply an invalid event sequence: review_passed before run_created
  // is allowed by transition only if the state allows it; from queued it
  // is not. So this will fail.
  const bad: RunEvent[] = [asSeq(makeEvent("review_passed"), 1)];
  const r = replay(RUN_ID, MISSION_ID, bad);
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "invalid_transition");
  }
});

test("replay of an empty sequence yields initial queued state with no events processed", () => {
  resetCounters();
  const r = replay(RUN_ID, MISSION_ID, []);
  assert.equal(r.ok, true);
  if (r.ok === true) {
    assert.equal(r.value.state.kind, "queued");
    assert.equal(r.value.eventsProcessed, 0);
    assert.equal(r.value.lastSeq, 0);
  }
});

test("replay round-trip via JSON preserves state", async () => {
  resetCounters();
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
  const r1 = replay(RUN_ID, MISSION_ID, events);
  assert.equal(r1.ok, true);
  if (r1.ok !== true) return;

  // Round-trip through JSON: encode each event, decode, then replay.
  const { envelopeToRunEvent } = await import("../src/evidence/codec.js");
  const decoded: RunEvent[] = [];
  for (const e of events) {
    const env = encodeEnvelope(e);
    const text = JSON.stringify(env);
    const dEnv = decodeEnvelope(JSON.parse(text) as unknown);
    assert.equal(dEnv.ok, true);
    if (dEnv.ok !== true) return;
    const lifted = envelopeToRunEvent(dEnv.value);
    decoded.push(lifted);
  }
  const r2 = replay(RUN_ID, MISSION_ID, decoded);
  assert.equal(r2.ok, true);
  if (r2.ok === true) {
    assert.deepEqual(r2.value.state, r1.value.state);
  }
});
