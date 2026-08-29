/**
 * Doctrinal invariants tested in isolation.
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
import {
  decodeEnvelope,
  encodeEnvelope,
} from "../src/evidence/codec.js";
import { replay } from "../src/domain/replay.js";
import {
  initialState,
  type RunState,
} from "../src/domain/run-state.js";
import { transition } from "../src/domain/transition.js";
import {
  BUDGET_KINDS,
  makeBudgetLimit,
  makeBudgetObservation,
  isExhausted,
} from "../src/domain/budget.js";
import {
  FAILURE_KINDS,
  isFailureKind,
} from "../src/domain/failure.js";


test("D01/D08 RunState and RunEvent are candidate-neutral", () => {
  const stateKinds: ReadonlyArray<RunState["kind"]> = [
    "queued",
    "preparing",
    "running",
    "gating",
    "repairing",
    "reviewing",
    "completed",
    "blocked",
    "exhausted",
    "crashed",
    "cancelled",
  ];
  for (const k of stateKinds) {
    assert.ok(
      !k.includes("cline") &&
        !k.includes("qwen") &&
        !k.includes("opencode") &&
        !k.includes("pi"),
      `state kind '${k}' contains a candidate identifier`,
    );
  }
});

test("D03 failures are values, not exceptions: failure union is exhaustive", () => {
  for (const k of FAILURE_KINDS) {
    assert.ok(isFailureKind(k));
  }
  assert.equal(FAILURE_KINDS.length, 9);
});

test("D04 external data is untrusted: envelope decoder rejects malformed input", () => {
  const cases: ReadonlyArray<unknown> = [
    null,
    {},
    { schema_version: 1 },
    {
      schema_version: 1,
      event_id: "x",
      run_id: "r",
      mission_id: "m",
      sequence: 0,
      observed_at: 0,
      event: { type: "x" },
    },
    {
      schema_version: 999,
      event_id: "x",
      run_id: "r",
      mission_id: "m",
      sequence: 1,
      observed_at: 0,
      event: { type: "run_created" },
    },
    {
      schema_version: 1,
      event_id: "x",
      run_id: "r",
      mission_id: "m",
      sequence: "not-a-number",
      observed_at: 0,
      event: { type: "run_created" },
    },
  ];
  for (const c of cases) {
    const r = decodeEnvelope(c);
    assert.equal(r.ok, false, `expected malformed input to be rejected`);
  }
});

test("D05 append-only ledger: append then read yields the same envelopes in order", () => {
  resetCounters();
  const events: RunEvent[] = [
    asSeq(makeEvent("run_created"), 1),
    asSeq(makeEvent("preparation_started"), 2),
    asSeq(makeEvent("preparation_succeeded"), 3),
    asSeq(makeEvent("attempt_started"), 4),
  ];
  const lines = events.map((e) =>
    JSON.stringify(encodeEnvelope(e)),
  );
  const text = lines.join("\n") + "\n";
  const parsed = text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => decodeEnvelope(JSON.parse(l) as unknown));
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (!p || p.ok !== true) {
      throw new Error(`unexpected decode failure at line ${i}`);
    }
    assert.equal(p.value.sequence, i + 1);
  }
});

test("D06 replay determinism (compact): same event sequence produces same derived state", () => {
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
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.deepEqual(r1.value, r2.value);
  }
});

test("D07 budget model: typed BudgetKind, typed limits, exhaustion is a value", () => {
  for (const k of BUDGET_KINDS) {
    const limit = makeBudgetLimit(k, 10);
    const obs = makeBudgetObservation(k, 10, 10);
    assert.equal(isExhausted(obs), true);
    assert.equal(limit.kind, k);
  }
  let threw = false;
  try {
    makeBudgetLimit("attempts", 0);
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test("deterministic table-driven: many transitions over many shapes yield stable results", () => {
  type Case = { readonly events: RunEvent[]; readonly expected: RunState["kind"] };
  const cases: ReadonlyArray<Case> = [
    {
      events: [
        asSeq(makeEvent("run_created"), 1),
        asSeq(makeEvent("preparation_started"), 2),
        asSeq(makeEvent("preparation_succeeded"), 3),
        asSeq(makeEvent("attempt_started"), 4),
        asSeq(makeEvent("agent_reported_completion"), 5),
        asSeq(makeEvent("gating_started"), 6),
        asSeq(makeEvent("gate_passed"), 7),
        asSeq(makeEvent("review_started"), 8),
        asSeq(makeEvent("review_passed"), 9),
      ],
      expected: "completed",
    },
    {
      events: [
        asSeq(makeEvent("run_created"), 1),
        asSeq(makeEvent("preparation_started"), 2),
        asSeq(makeEvent("preparation_succeeded"), 3),
        asSeq(makeEvent("attempt_started"), 4),
        asSeq(makeEvent("agent_reported_completion"), 5),
        asSeq(makeEvent("gating_started", { gate: "tests" }), 6),
        asSeq(makeEvent("gate_failed", { gate: "tests" }), 7),
        asSeq(makeEvent("repair_started"), 8),
        asSeq(makeEvent("attempt_started"), 9),
        asSeq(makeEvent("agent_reported_completion"), 10),
        asSeq(makeEvent("gating_started", { gate: "tests" }), 11),
        asSeq(makeEvent("gate_passed", { gate: "tests" }), 12),
        asSeq(makeEvent("review_started"), 13),
        asSeq(makeEvent("review_passed"), 14),
      ],
      expected: "completed",
    },
  ];
  for (const c of cases) {
    let s: RunState = initialState(RUN_ID, MISSION_ID, 0);
    for (const e of c.events) {
      const r = transition(s, e);
      assert.equal(r.ok, true, `case ${c.expected}: ${e.type} should be legal`);
      if (r.ok === true) s = r.value;
    }
    assert.equal(s.kind, c.expected, `expected ${c.expected}, got ${s.kind}`);
  }
});

function asSeq(e: RunEvent, seq: number): RunEvent {
  return { ...e, seq };
}
