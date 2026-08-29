/**
 * T07-T16 ledger tests (malformed JSONL, schema version, sequence
 * duplicate, sequence gap, mixed run IDs, failure taxonomy persistence,
 * budget exhaustion persistence, durable restart, continue after restart).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  RUN_ID,
  MISSION_ID,
  makeEvent,
  resetCounters,
} from "./helpers.js";
import type { RunEvent } from "../src/domain/run-event.js";
import { JsonlLedger } from "../src/evidence/jsonl-ledger.js";

function asSeq(e: RunEvent, seq: number): RunEvent {
  return { ...e, seq };
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lh-test-"));
}

async function rmDir(d: string): Promise<void> {
  await fs.rm(d, { recursive: true, force: true });
}

/**
 * Build a partial event payload suitable for `ledger.append`. The ledger
 * already handles `eventId/runId/missionId/observedAt/seq` itself; the
 * remaining fields are the type-specific payload of the event.
 */
function stripBase(e: RunEvent): Record<string, unknown> {
  switch (e.type) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return { type: e.type };
    case "preparation_failed":
      return { type: e.type, failure: e.failure };
    case "attempt_started":
      return { type: e.type, attemptId: e.attemptId };
    case "agent_reported_completion":
      return { type: e.type, attemptId: e.attemptId, summary: e.summary };
    case "agent_failed":
      return { type: e.type, attemptId: e.attemptId, failure: e.failure };
    case "gating_started":
    case "gate_passed":
      return { type: e.type, attemptId: e.attemptId, gate: e.gate };
    case "gate_failed":
      return {
        type: e.type,
        attemptId: e.attemptId,
        gate: e.gate,
        failure: e.failure,
      };
    case "repair_started":
      return { type: e.type, reason: e.reason };
    case "review_failed":
      return { type: e.type, failure: e.failure };
    case "budget_exhausted":
      return { type: e.type, observation: e.observation };
    case "blocked":
      return { type: e.type, reason: e.reason };
    case "crashed":
      return { type: e.type, reason: e.reason };
  }
}


test("T07 durable restart: persist → discard → reopen → replay → same state", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const events: RunEvent[] = [
      asSeq(makeEvent("run_created"), 1),
      asSeq(makeEvent("preparation_started"), 2),
      asSeq(makeEvent("preparation_succeeded"), 3),
      asSeq(makeEvent("attempt_started"), 4),
      asSeq(makeEvent("review_started"), 5),
      asSeq(makeEvent("review_passed"), 6),
    ];

    {
      const ledger = new JsonlLedger(dir);
      const o = await ledger.open();
      assert.equal(o.ok, true);
      for (const e of events) {
        const r = await ledger.append({
          eventId: e.eventId,
          runId: e.runId,
          missionId: e.missionId,
          observedAt: e.observedAt,
          ...stripBase(e),
        } as unknown as Parameters<typeof ledger.append>[0]);
        assert.equal(r.ok, true);
      }
      const r1 = await ledger.replay(RUN_ID, MISSION_ID);
      assert.equal(r1.ok, true);
      if (r1.ok === true) {
        assert.equal(r1.value.state.kind, "completed");
      }
    }

    {
      const ledger2 = new JsonlLedger(dir);
      const o = await ledger2.open();
      assert.equal(o.ok, true);
      const r2 = await ledger2.replay(RUN_ID, MISSION_ID);
      assert.equal(r2.ok, true);
      if (r2.ok === true) {
        assert.equal(r2.value.state.kind, "completed");
        assert.equal(r2.value.eventsProcessed, 6);
        assert.equal(r2.value.lastSeq, 6);
      }
    }
  } finally {
    await rmDir(dir);
  }
});

test("T08 continue after restart: append next legal event and replay", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    let seq = 0;
    {
      const ledger = new JsonlLedger(dir);
      await ledger.open();
      const initial: RunEvent[] = [
        asSeq(makeEvent("run_created"), ++seq),
        asSeq(makeEvent("preparation_started"), ++seq),
        asSeq(makeEvent("preparation_succeeded"), ++seq),
        asSeq(makeEvent("attempt_started"), ++seq),
      ];
      for (const e of initial) {
        const r = await ledger.append({
          eventId: e.eventId,
          runId: e.runId,
          missionId: e.missionId,
          observedAt: e.observedAt,
          ...stripBase(e),
        } as unknown as Parameters<typeof ledger.append>[0]);
        assert.equal(r.ok, true);
      }
    }
    {
      const ledger2 = new JsonlLedger(dir);
      await ledger2.open();
      const more: RunEvent[] = [
        asSeq(makeEvent("review_started"), ++seq),
        asSeq(makeEvent("review_passed"), ++seq),
      ];
      for (const e of more) {
        const r = await ledger2.append({
          eventId: e.eventId,
          runId: e.runId,
          missionId: e.missionId,
          observedAt: e.observedAt,
          ...stripBase(e),
        } as unknown as Parameters<typeof ledger2.append>[0]);
        assert.equal(r.ok, true);
      }
      const r2 = await ledger2.replay(RUN_ID, MISSION_ID);
      assert.equal(r2.ok, true);
      if (r2.ok === true) {
        assert.equal(r2.value.state.kind, "completed");
        assert.equal(r2.value.eventsProcessed, 6);
        assert.equal(r2.value.lastSeq, 6);
      }
    }
  } finally {
    await rmDir(dir);
  }
});

test("T09 malformed JSONL rejects on load", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    await fs.writeFile(file, "{not valid json\n", "utf8");
    const ledger = new JsonlLedger(dir);
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_evidence");
    }
  } finally {
    await rmDir(dir);
  }
});

test("T10 structurally invalid event payload rejects on load", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const bad = {
      schema_version: 1,
      event_id: "e-1",
      run_id: RUN_ID,
      mission_id: MISSION_ID,
      sequence: 1,
      observed_at: 0,
      event: { type: "totally_made_up_event" },
    };
    await fs.writeFile(file, JSON.stringify(bad) + "\n", "utf8");
    const ledger = new JsonlLedger(dir);
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_evidence");
    }
  } finally {
    await rmDir(dir);
  }
});

test("T11 unsupported schema version rejects on load", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const bad = {
      schema_version: 999,
      event_id: "e-1",
      run_id: RUN_ID,
      mission_id: MISSION_ID,
      sequence: 1,
      observed_at: 0,
      event: { type: "run_created" },
    };

test("T12 duplicate sequence rejects on load", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const e1 = {
      schema_version: 1,
      event_id: "e-1",
      run_id: RUN_ID,
      mission_id: MISSION_ID,
      sequence: 1,
      observed_at: 0,
      event: { type: "run_created" },
    };
    const e2 = { ...e1, event_id: "e-2", sequence: 1 };
    await fs.writeFile(
      file,
      JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n",
      "utf8",
    );
    const ledger = new JsonlLedger(dir);
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_evidence");
    }
  } finally {
    await rmDir(dir);
  }
});

test("T13 sequence gap rejects on load", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const e1 = {
      schema_version: 1,
      event_id: "e-1",
      run_id: RUN_ID,
      mission_id: MISSION_ID,
      sequence: 1,
      observed_at: 0,
      event: { type: "run_created" },
    };
    const e2 = { ...e1, event_id: "e-2", sequence: 3 };
    await fs.writeFile(
      file,
      JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n",
      "utf8",
    );
    const ledger = new JsonlLedger(dir);
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_evidence");
    }
  } finally {
    await rmDir(dir);
  }
});

test("T14 mixed run identities reject on replay", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const e1 = {
      schema_version: 1,
      event_id: "e-1",
      run_id: "run-A",
      mission_id: MISSION_ID,
      sequence: 1,
      observed_at: 0,
      event: { type: "run_created" },
    };
    const e2 = {
      schema_version: 1,
      event_id: "e-2",
      run_id: "run-B",
      mission_id: MISSION_ID,
      sequence: 2,
      observed_at: 0,
      event: { type: "preparation_started" },
    };
    await fs.writeFile(
      file,
      JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n",
      "utf8",
    );
    const ledger = new JsonlLedger(dir);
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_evidence");
    }
  } finally {
    await rmDir(dir);

test("T15 failure taxonomy persistence: variants survive replay", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const variants = [
      { kind: "candidate_failure", code: "x", message: "y" },
      { kind: "tool_failure", tool: "t", message: "m" },
      { kind: "gate_failure", gate: "g", message: "m" },
      { kind: "policy_denied", policy: "p", message: "m" },
      { kind: "timeout", subject: "s", message: "m" },
      {
        kind: "budget_exhausted",
        budget: "tool_calls",
        limit: 5,
        observed: 5,
        message: "m",
      },
      { kind: "invalid_evidence", reason: "r" },
      { kind: "invalid_transition", from: "queued", event: "x", message: "m" },
      { kind: "internal_failure", message: "m" },
    ] as const;
    let seq = 0;
    const events: RunEvent[] = [
      asSeq(makeEvent("run_created"), ++seq),
      asSeq(makeEvent("preparation_started"), ++seq),
    ];
    for (const v of variants) {
      const e = makeEvent("preparation_failed", { failure: v });
      events.push(asSeq(e, ++seq));
    }
    {
      const ledger = new JsonlLedger(dir);
      await ledger.open();
      for (const e of events) {
        if (e.type === "preparation_failed") {
          const r = await ledger.append({
            eventId: e.eventId,
            runId: e.runId,
            missionId: e.missionId,
            observedAt: e.observedAt,
            type: e.type,
            failure: e.failure,
          } as unknown as Parameters<typeof ledger.append>[0]);
          assert.equal(r.ok, true);
        } else {
          const r = await ledger.append({
            eventId: e.eventId,
            runId: e.runId,
            missionId: e.missionId,
            observedAt: e.observedAt,
            ...stripBase(e),
          } as unknown as Parameters<typeof ledger.append>[0]);
          assert.equal(r.ok, true);
        }
      }
    }
    const ledger2 = new JsonlLedger(dir);
    await ledger2.open();
    const all = await ledger2.readAll();
    assert.equal(all.ok, true);
    if (all.ok === true) {
      const arr: ReadonlyArray<{ readonly event: { readonly type: string; readonly failure?: unknown } }> = all.value;
      assert.equal(arr.length, events.length);
      for (let i = 2; i < arr.length; i++) {
        const env = arr[i];
        if (env === undefined) {
          throw new Error(`missing envelope at ${i}`);
        }
        assert.equal(env.event.type, "preparation_failed");
        const persisted = env.event.failure;
        const expected = variants[i - 2];
        assert.deepEqual(JSON.parse(JSON.stringify(persisted)), expected);
      }
    }
  } finally {
    await rmDir(dir);
  }
});

test("T16 budget exhaustion persistence: typed budget survives replay", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const observation = {
      kind: "model_turns" as const,
      limit: 100,
      observed: 100,
    };
    const events: RunEvent[] = [
      asSeq(makeEvent("run_created"), 1),
      asSeq(makeEvent("preparation_started"), 2),
      asSeq(makeEvent("preparation_succeeded"), 3),
      asSeq(makeEvent("budget_exhausted", { observation }), 4),
    ];
    {
      const ledger = new JsonlLedger(dir);
      await ledger.open();
      for (const e of events) {
        const r = await ledger.append({
          eventId: e.eventId,
          runId: e.runId,
          missionId: e.missionId,
          observedAt: e.observedAt,
          ...stripBase(e),
        } as unknown as Parameters<typeof ledger.append>[0]);
        assert.equal(r.ok, true);
      }
    }
    const ledger2 = new JsonlLedger(dir);
    await ledger2.open();
    const r = await ledger2.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, true);
    if (r.ok === true) {
      assert.equal(r.value.state.kind, "exhausted");
      if (r.value.state.kind === "exhausted") {
        assert.equal(r.value.state.observation.kind, observation.kind);
        assert.equal(r.value.state.observation.limit, observation.limit);
        assert.equal(r.value.state.observation.observed, observation.observed);
      }
    }
  } finally {
    await rmDir(dir);
  }
});

  }
});

    await fs.writeFile(file, JSON.stringify(bad) + "\n", "utf8");
    const ledger = new JsonlLedger(dir);
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, false);
    if (r.ok === false) {
      assert.equal(r.error.kind, "invalid_evidence");
    }
  } finally {
    await rmDir(dir);
  }
});
