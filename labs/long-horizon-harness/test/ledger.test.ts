/**
 * Ledger tests:
 *   T07-T16 (durable restart, error cases, persistence, mixed identities)
 *   C12-C13 (concurrency, post-failure usability)
 *   TT01/TT02/TT16/TT17 (torn-tail recovery)
 *
 * CORRECTION01 uses the new append API: payload + identity metadata;
 * the ledger allocates sequence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  RUN_ID,
  MISSION_ID,
  makeEvent,
  resetCounters,
} from "./helpers.js";
import type { RunEvent } from "../src/domain/run-event.js";
import { JsonlLedger } from "../src/evidence/jsonl-ledger.js";
import type { EventEnvelope } from "../src/evidence/codec-types.js";
import { makeEventId } from "../src/domain/ids.js";
import type { EventId } from "../src/domain/ids.js";

function asSeq(e: RunEvent, seq: number): RunEvent {
  return { ...e, seq };
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "lh-test-"));
}

async function rmDir(d: string): Promise<void> {
  await fs.rm(d, { recursive: true, force: true });
}

async function appendPayload(
  ledger: JsonlLedger,
  seq: number,
  payload: RunEvent,
  idGen: () => EventId = () => makeEventId(`e-${seq}`),
): Promise<void> {
  const r = await ledger.append({
    eventId: idGen(),
    runId: RUN_ID,
    missionId: MISSION_ID,
    observedAt: seq,
    event: payload,
  });
  assert.equal(r.ok, true, `append at seq=${seq} should succeed`);
}
test("T07 durable restart", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const seq1 = asSeq(makeEvent("run_created"), 1);
    const seq2 = asSeq(makeEvent("preparation_started"), 2);
    const seq3 = asSeq(makeEvent("preparation_succeeded"), 3);
    const seq4 = asSeq(makeEvent("attempt_started"), 4);
    const seq5 = asSeq(makeEvent("agent_reported_completion"), 5);
    const seq6 = asSeq(makeEvent("gating_started", { gate: "g1" }), 6);
    const seq7 = asSeq(makeEvent("gate_passed", { gate: "g1" }), 7);
    const seq8 = asSeq(makeEvent("review_started"), 8);
    const seq9 = asSeq(makeEvent("review_passed"), 9);

    {
      const ledger = new JsonlLedger(dir);
      const o = await ledger.open();
      assert.equal(o.ok, true);
      for (const e of [seq1, seq2, seq3, seq4, seq5, seq6, seq7, seq8, seq9]) {
        await appendPayload(ledger, e.seq, e);
      }
      const r1 = await ledger.replay(RUN_ID, MISSION_ID);
      assert.equal(r1.ok, true);
      if (r1.ok) {
        assert.equal(r1.value.state.kind, "completed");
      }
    }

    {
      const ledger2 = new JsonlLedger(dir);
      const o = await ledger2.open();
      assert.equal(o.ok, true);
      const r2 = await ledger2.replay(RUN_ID, MISSION_ID);
      assert.equal(r2.ok, true);
      if (r2.ok) {
        assert.equal(r2.value.state.kind, "completed");
        assert.equal(r2.value.eventsProcessed, 9);
        assert.equal(r2.value.lastSeq, 9);
      }
    }
  } finally {
    await rmDir(dir);
  }
});

test("T08 continue after restart", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const initial: RunEvent[] = [
      asSeq(makeEvent("run_created"), 1),
      asSeq(makeEvent("preparation_started"), 2),
      asSeq(makeEvent("preparation_succeeded"), 3),
      asSeq(makeEvent("attempt_started"), 4),
    ];
    {
      const ledger = new JsonlLedger(dir);
      await ledger.open();
      for (const e of initial) {
        await appendPayload(ledger, e.seq, e);
      }
    }
    {
      const ledger2 = new JsonlLedger(dir);
      await ledger2.open();
      const more: RunEvent[] = [
        asSeq(makeEvent("agent_reported_completion"), 5),
        asSeq(makeEvent("gating_started", { gate: "g1" }), 6),
        asSeq(makeEvent("gate_passed", { gate: "g1" }), 7),
        asSeq(makeEvent("review_started"), 8),
        asSeq(makeEvent("review_passed"), 9),
      ];
      for (const e of more) {
        await appendPayload(ledger2, e.seq, e);
      }
      const r2 = await ledger2.replay(RUN_ID, MISSION_ID);
      assert.equal(r2.ok, true);
      if (r2.ok) {
        assert.equal(r2.value.state.kind, "completed");
        assert.equal(r2.value.eventsProcessed, 9);
        assert.equal(r2.value.lastSeq, 9);
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
  }
});
test("T15 failure taxonomy persistence", async () => {
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
    {
      const ledger = new JsonlLedger(dir);
      await ledger.open();
      await appendPayload(ledger, 1, asSeq(makeEvent("run_created"), 1));
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v) continue;
        await appendPayload(
          ledger,
          i + 2,
          asSeq(makeEvent("preparation_failed", { failure: v }), i + 2),
        );
      }
    }
    const ledger2 = new JsonlLedger(dir);
    await ledger2.open();
    const all = await ledger2.readAll();
    assert.equal(all.ok, true);
    if (all.ok === true) {
      const arr: ReadonlyArray<EventEnvelope> = all.value;
      assert.equal(arr.length, 1 + variants.length);
      for (let i = 0; i < arr.length; i++) {
        const env = arr[i];
        if (env === undefined) {
          throw new Error(`missing envelope at ${i}`);
        }
        if (!("event" in env)) {
          throw new Error(`expected lifecycle envelope at ${i}; got process_evidence.`);
        }
        if (i === 0) {
          assert.equal(env.event.type, "run_created");
        } else {
          assert.equal(env.event.type, "preparation_failed");
          const expected = variants[i - 1];
          assert.deepEqual(
            JSON.parse(JSON.stringify(env.event.failure)),
            expected,
          );
        }
      }
    }
  } finally {
    await rmDir(dir);
  }
});

test("T16 budget exhaustion persistence", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const observation = {
      kind: "model_turns" as const,
      limit: 100,
      observed: 100,
    };
    {
      const ledger = new JsonlLedger(dir);
      await ledger.open();
      await appendPayload(ledger, 1, asSeq(makeEvent("run_created"), 1));
      await appendPayload(
        ledger,
        2,
        asSeq(makeEvent("preparation_started"), 2),
      );
      await appendPayload(
        ledger,
        3,
        asSeq(makeEvent("preparation_succeeded"), 3),
      );
      await appendPayload(
        ledger,
        4,
        asSeq(makeEvent("budget_exhausted", { observation }), 4),
      );
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
        assert.equal(
          r.value.state.observation.observed,
          observation.observed,
        );
      }
    }
  } finally {
    await rmDir(dir);
  }
});
test("C12 concurrent sequence allocation: sequences unique and contiguous", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const ledger = new JsonlLedger(dir);
    const o = await ledger.open();
    assert.equal(o.ok, true);
    await appendPayload(ledger, 1, asSeq(makeEvent("run_created"), 1));
    await appendPayload(
      ledger,
      2,
      asSeq(makeEvent("preparation_started"), 2),
    );
    await appendPayload(
      ledger,
      3,
      asSeq(makeEvent("preparation_succeeded"), 3),
    );
    await appendPayload(ledger, 4, asSeq(makeEvent("attempt_started"), 4));
    // Repeated attempt_started events keep the lifecycle legally in
    // "running" but the resulting record stream is not a full
    // canonical lifecycle. This test exercises ONLY the storage
    // allocation / serialization concern. Replay is verified
    // separately in C12-L against a legal lifecycle.
    const attemptId = "a1";
    const N = 32;
    const promises: Array<Promise<{ ok: boolean; seq?: number }>> = [];
    for (let i = 0; i < N; i++) {
      const seq = i + 5;
      const payload = asSeq(
        makeEvent("attempt_started", { attemptId }),
        seq,
      );
      promises.push(
        ledger.append({
          eventId: makeEventId(`e-${seq}`),
          runId: RUN_ID,
          missionId: MISSION_ID,
          observedAt: seq,
          event: payload,
        }) as unknown as Promise<{ ok: boolean; seq?: number }>,
      );
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.ok, true);
    }
    const all = await ledger.readAll();
    assert.equal(all.ok, true);
    if (all.ok === true) {
      assert.equal(all.value.length, 4 + N);
      const seqs = all.value.map((e) => e.sequence);
      const expected = Array.from({ length: 4 + N }, (_, i) => i + 1);
      assert.deepEqual(seqs, expected);
    }
  } finally {
    await rmDir(dir);
  }
});

test("C12-R fresh ledger instance reopens the persisted bytes", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    {
      const w = new JsonlLedger(dir);
      const o = await w.open();
      assert.equal(o.ok, true);
      await appendPayload(w, 1, asSeq(makeEvent("run_created"), 1));
      await appendPayload(
        w,
        2,
        asSeq(makeEvent("preparation_started"), 2),
      );
    }
    {
      // Discard the original writer; construct a fresh object over
      // the same directory.
      const r = new JsonlLedger(dir);
      const o = await r.open();
      assert.equal(o.ok, true);
      const all = await r.readAll();
      assert.equal(all.ok, true);
      if (all.ok === true) {
        assert.equal(all.value.length, 2);
        assert.deepEqual(
          all.value.map((e) => e.sequence),
          [1, 2],
        );
      }
    }
  } finally {
    await rmDir(dir);
  }
});

test("C12-P persisted bytes hash identically after reopen", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    let snapshot: Buffer | null = null;
    {
      const w = new JsonlLedger(dir);
      const o = await w.open();
      assert.equal(o.ok, true);
      await appendPayload(w, 1, asSeq(makeEvent("run_created"), 1));
      await appendPayload(
        w,
        2,
        asSeq(makeEvent("preparation_started"), 2),
      );
      await appendPayload(
        w,
        3,
        asSeq(makeEvent("preparation_succeeded"), 3),
      );
      const fsPromises = await import("node:fs");
      snapshot = await fsPromises.promises.readFile(new JsonlLedger(dir).path());
    }
    {
      const r = new JsonlLedger(dir);
      const o = await r.open();
      assert.equal(o.ok, true);
      const fsPromises = await import("node:fs");
      const reopened = await fsPromises.promises.readFile(r.path());
      assert.equal(reopened.length, snapshot.length);
      assert.deepEqual(reopened, snapshot);
    }
  } finally {
    await rmDir(dir);
  }
});

test("C12-L legal concurrent lifecycle replays after reopen", async () => {
  // Commit a single canonical completion path through a fresh
  // ledger, concurrently submitting the events so that serialization
  // is exercised. The committed stream is replay-valid (a single
  // canonical lifecycle), and a fresh-ledger replay must produce
  // the same derived state.
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const ledger = new JsonlLedger(dir);
    const o = await ledger.open();
    assert.equal(o.ok, true);

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
    const results = await Promise.all(
      events.map((e) =>
        ledger.append({
          eventId: makeEventId(`e-${e.seq}`),
          runId: RUN_ID,
          missionId: MISSION_ID,
          observedAt: e.seq,
          event: e,
        }) as unknown as Promise<{ ok: boolean; seq?: number }>,
      ),
    );
    for (const r of results) {
      assert.equal(r.ok, true);
    }

    const reopened = new JsonlLedger(dir);
    const ro = await reopened.open();
    assert.equal(ro.ok, true);
    const r1 = await reopened.replay(RUN_ID, MISSION_ID);
    assert.equal(r1.ok, true);
    if (r1.ok === true) {
      assert.equal(r1.value.state.kind, "completed");
      assert.equal(r1.value.eventsProcessed, 9);
      assert.equal(r1.value.lastSeq, 9);
    }
  } finally {
    await rmDir(dir);
  }
});

test("C13 append remains usable after a real pre-write failure", async () => {
  const dir = await makeTmpDir();
  try {
    resetCounters();
    const ledger = new JsonlLedger(dir);
    const o = await ledger.open();
    assert.equal(o.ok, true);

    const r0 = await ledger.append({
      eventId: makeEventId("e-1"),
      runId: RUN_ID,
      missionId: MISSION_ID,
      observedAt: 1,
      event: makeEvent("run_created"),
    });
    assert.equal(r0.ok, true);
    if (r0.ok === true) assert.equal(r0.value.seq, 1);

    ledger.armFaultHook({
      kind: "beforeAppendWrite",
      respond: () => ({
        ok: false,
        error: {
          kind: "internal_failure",
          message: "injected failure for C13",
        },
      }),
    });

    const r1 = await ledger.append({
      eventId: makeEventId("e-2"),
      runId: RUN_ID,
      missionId: MISSION_ID,
      observedAt: 2,
      event: makeEvent("preparation_started"),
    });
    assert.equal(r1.ok, false);
    if (r1.ok === false) {
      assert.equal(r1.error.kind, "internal_failure");
      assert.equal(
        (r1.error as { message: string }).message,
        "injected failure for C13",
      );
    }

    const r2 = await ledger.append({
      eventId: makeEventId("e-3"),
      runId: RUN_ID,
      missionId: MISSION_ID,
      observedAt: 3,
      event: makeEvent("preparation_started"),
    });
    assert.equal(r2.ok, true);
    if (r2.ok === true) {
      // The failed append did NOT consume a sequence. The next
      // successful append uses the same next sequence (2), which
      // proves the mutex released and the sequence allocator did
      // not advance for the failed call.
      assert.equal(r2.value.seq, 2);
    }

    const all = await ledger.readAll();
    assert.equal(all.ok, true);
    if (all.ok === true) {
      assert.equal(all.value.length, 2);
      assert.deepEqual(
        all.value.map((e) => e.sequence),
        [1, 2],
      );
    }
  } finally {
    await rmDir(dir);
  }
});

test("TT01 partial JSON final suffix is quarantined", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const committed =
      JSON.stringify({
        schema_version: 1,
        event_id: "e-1",
        run_id: RUN_ID,
        mission_id: MISSION_ID,
        sequence: 1,
        observed_at: 0,
        event: { type: "run_created" },
      }) + "\n";
    const torn = '{"schema_version":1,"event_';
    await fs.writeFile(file, committed + torn, "utf8");

    const ledger = new JsonlLedger(dir);
    const o = await ledger.open();
    assert.equal(o.ok, true);
    if (o.ok === true) {
      assert.notEqual(o.value.recovery, null);
      if (o.value.recovery !== null) {
        assert.equal(o.value.recovery.quarantinedBytes, torn.length);
        assert.match(o.value.recovery.sha256, /^[0-9a-f]{64}$/);
      }
    }
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, true);
    if (r.ok === true) {
      assert.equal(r.value.eventsProcessed, 1);
      assert.equal(r.value.lastSeq, 1);
    }
    const quarantineFiles = await fs.readdir(dir);
    const quarantines = quarantineFiles.filter((f) =>
      f.startsWith("events.jsonl.torn-tail."),
    );
    assert.equal(quarantines.length, 1);
  } finally {
    await rmDir(dir);
  }
});

test("TT02 syntactically valid JSON without newline is uncommitted", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const committed = JSON.stringify({
      schema_version: 1,
      event_id: "e-1",
      run_id: RUN_ID,
      mission_id: MISSION_ID,
      sequence: 1,
      observed_at: 0,
      event: { type: "run_created" },
    }) + "\n";
    const torn = JSON.stringify({
      schema_version: 1,
      event_id: "e-2",
      run_id: RUN_ID,
      mission_id: MISSION_ID,
      sequence: 2,
      observed_at: 0,
      event: { type: "preparation_started" },
    });
    await fs.writeFile(file, committed + torn, "utf8");

    const ledger = new JsonlLedger(dir);
    const o = await ledger.open();
    assert.equal(o.ok, true);
    if (o.ok === true) {
      assert.notEqual(o.value.recovery, null);
    }
    const r = await ledger.replay(RUN_ID, MISSION_ID);
    assert.equal(r.ok, true);
    if (r.ok === true) {
      assert.equal(r.value.eventsProcessed, 1);
    }
  } finally {
    await rmDir(dir);
  }
});

test("TT16 malformed newline-terminated line fails closed", async () => {
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
    const files = await fs.readdir(dir);
    assert.equal(
      files.filter((f) => f.startsWith("events.jsonl.torn-tail.")).length,
      0,
    );
  } finally {
    await rmDir(dir);
  }
});

test("TT17 committed prefix unchanged byte-for-byte after tail recovery", async () => {
  const dir = await makeTmpDir();
  try {
    const file = path.join(dir, "events.jsonl");
    const committed =
      JSON.stringify({
        schema_version: 1,
        event_id: "e-1",
        run_id: RUN_ID,
        mission_id: MISSION_ID,
        sequence: 1,
        observed_at: 0,
        event: { type: "run_created" },
      }) + "\n";
    const torn = "broken tail bytes";
    const originalBytes = Buffer.from(committed, "utf8");
    await fs.writeFile(file, committed + torn, "utf8");

    const ledger = new JsonlLedger(dir);
    await ledger.open();

    const repairedBytes = await fs.readFile(file);
    assert.equal(repairedBytes.length, originalBytes.length);
    assert.deepEqual(repairedBytes, originalBytes);

    const files = await fs.readdir(dir);
    const quarantines = files.filter((f) =>
      f.startsWith("events.jsonl.torn-tail."),
    );
    assert.equal(quarantines.length, 1);
    if (quarantines[0]) {
      const qBytes = await fs.readFile(path.join(dir, quarantines[0]));
      const expectedHash = createHash("sha256")
        .update(Buffer.from(torn, "utf8"))
        .digest("hex");
      assert.equal(
        createHash("sha256").update(qBytes).digest("hex"),
        expectedHash,
      );
    }
  } finally {
    await rmDir(dir);
  }
});
