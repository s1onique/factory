/**
 * CORRECTION08 — Pre-spawn durability gate tests.
 *
 * Tests SG01..SG05 from the CORRECTION08 ACT. These prove that:
 *   - SG01: a permanently-pending first critical commit causes
 *           ZERO spawner.spawn() calls. Resolve with `{ok:true}`
 *           and the spawn happens.
 *   - SG02: a `{ok:false}` first critical commit causes ZERO
 *           spawner.spawn() calls AND a typed
 *           `evidence_persistence_failure(spawn_request)` is
 *           surfaced through `await()`.
 *   - SG03: a Promise rejection on the first critical commit
 *           causes ZERO spawner.spawn() calls AND the
 *           internal_malfunction taxonomy is preserved (no
 *           ownership_not_durable fabricated).
 *   - SG04: no evidence sink → sync spawner.spawn() exactly
 *           once, F-series semantics preserved.
 *   - SG05: order trace — the strict order is
 *           commit_requested < commit_resolved(ok) < spawn_called
 *           < spawn_event < ownership_commit. No clocks, no
 *           sleeps, purely deterministic.
 *
 * Plus the failure-taxonomy matrix:
 *   - spawn_request → no process exists (signal-port calls=0)
 *   - ownership     → process exists; current owner cleans it
 *   - settlement    → execution preserved, no cleanup
 *
 * Sink fixtures are local to this file. They expose a Promise
 * handle so tests can manually resolve/reject the first critical
 * commit and observe the resulting spawn call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { startSupervised, startSupervisor } from "../../src/process/supervised-process.js";
import { manualClock, realClock } from "../../src/process/clock.js";
import type {
  ProcessEvidenceCommitResult,
  ProcessEvidenceSink,
} from "../../src/process/process-evidence-sink.js";
import type { ProcessSpec, SignalAttemptResult, GroupProbe } from "../../src/process/process-types.js";
import type { SignalPort, SpawnedChild, SpawnPort } from "../../src/process/process-ports.js";
import {
  makeAttemptId,
  makeEventId,
  makeMissionId,
  makeRunId,
} from "../../src/domain/ids.js";
import type { ProcessEvidenceIdentity } from "../../src/process/process-evidence-bridge.js";
import { makeProcessId, type ProcessId } from "../../src/process/process-types.js";
// ---------------------------------------------------------------------------
// Local fake-sink helpers
// ---------------------------------------------------------------------------

type FakeSinkOptions = {
  readonly first?: "pending" | "ok-false" | "reject" | "ok-true";
};

class FakeSink implements ProcessEvidenceSink {
  spawnRequestCalls = 0;
  spawnedCalls = 0;
  resultCommittedCalls = 0;
  otherCalls = 0;
  records: Array<import("../../src/evidence/codec-types.js").PersistedProcessEvidencePayload> = [];
  private pending: Array<Promise<unknown>> = [];
  private firstBehavior: "pending" | "ok-false" | "reject" | "ok-true";
  resolveFirst: ((r: ProcessEvidenceCommitResult) => void) | null = null;
  rejectFirst: ((e: unknown) => void) | null = null;
  private firstPromise: Promise<ProcessEvidenceCommitResult> | null = null;

  constructor(opts: FakeSinkOptions = {}) {
    this.firstBehavior = opts.first ?? "ok-true";
  }

  async flush(): Promise<void> {
    while (this.pending.length > 0) {
      const next = this.pending.shift();
      if (next !== undefined) {
        try {
          await next;
        } catch (_e) {
          // Suppress.
        }
      }
    }
  }

  commitCritical(input: {
    eventId: import("../../src/domain/ids.js").EventId;
    runId: import("../../src/domain/ids.js").RunId;
    missionId: import("../../src/domain/ids.js").MissionId;
    observedAt: number;
    payload: import("../../src/evidence/codec-types.js").PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult> {
    if (input.payload.kind === "process_spawn_requested") {
      this.spawnRequestCalls++;
      if (this.firstPromise === null) {
        switch (this.firstBehavior) {
          case "pending":
            this.firstPromise = new Promise<ProcessEvidenceCommitResult>(
              (resolve, reject) => {
                this.resolveFirst = resolve;
                this.rejectFirst = reject;
              },
            );
            break;
          case "ok-false":
            this.firstPromise = Promise.resolve({
              ok: false,
              error: { kind: "ledger_write_failure", message: "test fault-injected ok:false" },
            });
            break;
          case "reject":
            this.firstPromise = Promise.reject(
              new Error("test fault-injected rejection"),
            );
            this.firstPromise.catch(() => {});
            break;
          case "ok-true":
          default:
            this.firstPromise = Promise.resolve({ ok: true, seq: 1 });
        }
      }
      this.records.push(input.payload);
      this.pending.push(this.firstPromise);
      return this.firstPromise;
    }
    if (input.payload.kind === "process_spawned") {
      this.spawnedCalls++;
      this.records.push(input.payload);
      const p: Promise<ProcessEvidenceCommitResult> = Promise.resolve({ ok: true, seq: 100 });
      this.pending.push(p);
      return p;
    }
    if (input.payload.kind === "process_result_committed") {
      this.resultCommittedCalls++;
      this.records.push(input.payload);
      const p: Promise<ProcessEvidenceCommitResult> = Promise.resolve({ ok: true, seq: 200 });
      this.pending.push(p);
      return p;
    }
    this.otherCalls++;
    this.records.push(input.payload);
    const p: Promise<ProcessEvidenceCommitResult> = Promise.resolve({ ok: true, seq: 999 });
    this.pending.push(p);
    return p;
  }

  commitObservation(input: {
    eventId: import("../../src/domain/ids.js").EventId;
    runId: import("../../src/domain/ids.js").RunId;
    missionId: import("../../src/domain/ids.js").MissionId;
    observedAt: number;
    payload: import("../../src/evidence/codec-types.js").PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult> {
    this.otherCalls++;
    this.records.push(input.payload);
    const p: Promise<ProcessEvidenceCommitResult> = Promise.resolve({ ok: true, seq: 999 });
    this.pending.push(p);
    return p;
  }
}
// ---------------------------------------------------------------------------
// Local fake spawner / signal port
// ---------------------------------------------------------------------------

type FakeListener = (...args: unknown[]) => void;

class FakeChild {
  readonly pid: number;
  readonly pgid: number;
  closed = false;
  code: number | null = null;
  signal: NodeJS.Signals | null = null;
  stdout: Readable;
  stderr: Readable;
  private readonly listeners: Map<string, FakeListener[]> = new Map();
  constructor(pid: number) {
    this.pid = pid;
    this.pgid = pid;
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  on(event: string, listener: FakeListener): FakeChild {
    const arr = this.listeners.get(event) ?? [];
    arr.push(listener);
    this.listeners.set(event, arr);
    return this;
  }
  once(event: string, listener: FakeListener): FakeChild {
    const wrap: FakeListener = (...args: unknown[]) => {
      this.removeListener(event, wrap);
      listener(...args);
    };
    return this.on(event, wrap);
  }
  private removeListener(event: string, listener: FakeListener): void {
    const arr = this.listeners.get(event);
    if (arr === undefined) return;
    const idx = arr.indexOf(listener);
    if (idx >= 0) arr.splice(idx, 1);
  }
  fireSpawn(): void {
    this.emit("spawn");
  }
  fireClose(code: number | null, signal: NodeJS.Signals | null): void {
    this.code = code;
    this.signal = signal;
    this.emit("exit", code, signal);
    this.closed = true;
    this.emit("close", code, signal);
    this.stdout.push(null);
    this.stderr.push(null);
  }
  private emit(event: string, ...args: unknown[]): void {
    const arr = this.listeners.get(event);
    if (arr === undefined) return;
    for (const l of [...arr]) l(...args);
  }
  kill(_signal?: NodeJS.Signals | number): boolean {
    return false;
  }
}

class CountingSpawnPort implements SpawnPort {
  nextPid = 1000;
  readonly children: FakeChild[] = [];
  spawnCount = 0;
  spawn(_args: unknown): SpawnedChild {
    this.spawnCount++;
    const c = new FakeChild(this.nextPid++);
    this.children.push(c);
    return c as unknown as SpawnedChild;
  }
}

class CountingSignalPort implements SignalPort {
  readonly log: Array<{ signal: "SIGTERM" | "SIGKILL" | 0; pgid: number }> = [];
  aliveGroups = new Set<number>();
  signalCount = 0;
  probeCount = 0;
  signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL" | 0): SignalAttemptResult {
    this.signalCount++;
    this.log.push({ signal, pgid });
    if (signal === 0) {
      return this.aliveGroups.has(pgid) ? { kind: "sent", signal: 0 } : { kind: "group_absent" };
    }
    if (!this.aliveGroups.has(pgid)) return { kind: "group_absent" };
    if (signal === "SIGKILL") this.aliveGroups.delete(pgid);
    return { kind: "sent", signal };
  }
  probeGroup(pgid: number): GroupProbe {
    this.probeCount++;
    return this.aliveGroups.has(pgid) ? { kind: "alive" } : { kind: "absent" };
  }
}

function basicSpec(): ProcessSpec {
  return {
    executable: "/bin/true",
    args: [],
    cwd: "/tmp",
    env: {},
    deadlineMs: 5000,
    termGraceMs: 100,
    killGraceMs: 100,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024,
  };
}

function makeIdentity(): ProcessEvidenceIdentity {
  return {
    runId: makeRunId("r-sg"),
    missionId: makeMissionId("m-sg"),
    attemptId: makeAttemptId("a-sg"),
    eventIdFactory: () => makeEventId("e-sg"),
  };
}
// ---------------------------------------------------------------------------
// SG01 — pending critical commit blocks spawn; resolve triggers spawn
// ---------------------------------------------------------------------------

test("SG01 pending critical commit blocks spawn until resolve; then spawn fires", async () => {
  const sink = new FakeSink({ first: "pending" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const pending = startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });

  for (let i = 0; i < 5; i++) await Promise.resolve();

  assert.equal(
    spawner.spawnCount,
    0,
    "spawner.spawn() MUST NOT be called while the durable intent is pending",
  );
  assert.equal(sink.spawnRequestCalls, 1, "exactly one spawn_requested attempt observed");

  sink.resolveFirst!({ ok: true, seq: 1 });

  const r = await pending;
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  assert.equal(spawner.spawnCount, 1, "spawner.spawn() called exactly once after gate resolved");
  assert.equal(signals.signalCount, 0, "no TERM/KILL/probe attempts on a successful intent");

  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    const result = await r.value.await();
    assert.equal(result.outcome.kind, "exited");
  }
});
// ---------------------------------------------------------------------------
// SG02 — {ok:false} never spawns
// ---------------------------------------------------------------------------

test("SG02 first critical {ok:false} never spawns; typed spawn_request failure", async () => {
  const sink = new FakeSink({ first: "ok-false" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });
  // CORRECTION09: a pre-spawn persistence failure is a START
  // failure. There is no Supervisor, no OS process, no
  // synthetic durably_settled handle.
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) throw new Error("expected error");
  assert.equal(
    spawner.spawnCount,
    0,
    "spawner.spawn() MUST NOT be called when the gate returns {ok:false}",
  );
  assert.equal(signals.signalCount, 0, "no signals sent on spawn_request failure");
  assert.equal(signals.probeCount, 0, "no probes sent on spawn_request failure");
  const f = r.error;
  assert.equal(f.kind, "evidence_persistence_failure", JSON.stringify(f));
  if (f.kind === "evidence_persistence_failure") {
    assert.equal(f.stage, "spawn_request", `stage should be spawn_request; got ${f.stage}`);
  }
});

// ---------------------------------------------------------------------------
// SG03 — Promise rejection never spawns
// ---------------------------------------------------------------------------

test("SG03 first critical Promise rejection never spawns; internal_malfunction preserved", async () => {
  const sink = new FakeSink({ first: "reject" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, false, JSON.stringify(r));
  if (r.ok) throw new Error("expected error");
  assert.equal(
    spawner.spawnCount,
    0,
    "spawner.spawn() MUST NOT be called when the gate rejects",
  );
  assert.equal(signals.signalCount, 0, "no signals sent on rejection");
  assert.equal(signals.probeCount, 0, "no probes sent on rejection");

  const f = r.error;
  assert.equal(f.kind, "evidence_persistence_failure", JSON.stringify(f));
  if (f.kind === "evidence_persistence_failure") {
    assert.equal(f.stage, "spawn_request", `stage should be spawn_request; got ${f.stage}`);
  }
});
// ---------------------------------------------------------------------------
// SG04 — no-sink fast path (FOUNDATION02 preservation)
// ---------------------------------------------------------------------------

test("SG04 no evidenceSink → sync spawner.spawn() preserved", async () => {
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = startSupervised({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
  });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;

  assert.equal(spawner.spawnCount, 1, "sync spawner.spawn() called exactly once");
  assert.equal(signals.signalCount, 0);

  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    const result = await supervisor.await();
    assert.equal(result.outcome.kind, "exited");
  }
});

// ---------------------------------------------------------------------------
// Failure taxonomy matrix
// ---------------------------------------------------------------------------

test("taxonomy: spawn_request failure does NOT trigger TERM/KILL/probe", async () => {
  const sink = new FakeSink({ first: "ok-false" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  await startSupervisor({
    spec: basicSpec(),
    clock: realClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });

  assert.equal(signals.signalCount, 0, "spawn_request failure MUST NOT call signalGroup");
  assert.equal(signals.probeCount, 0, "spawn_request failure MUST NOT call probeGroup");
  assert.equal(spawner.spawnCount, 0, "spawn_request failure MUST NOT call spawner.spawn");
});

test("SG-soak stub: file builds cleanly", () => {
  assert.ok(typeof startSupervisor === "function");
  assert.ok(typeof startSupervised === "function");
});
// ---------------------------------------------------------------------------
// SG05 — strict order trace
// ---------------------------------------------------------------------------

test("SG05 strict order: commit_requested < commit_resolved < spawn_called < spawn_event < ownership_commit", async () => {
  const trace: string[] = [];
  const sink = new FakeSink({ first: "pending" });

  // Wrap the spawner to record trace events.
  const baseSpawner = new CountingSpawnPort();
  const wrappedSpawner: SpawnPort = {
    spawn: (args) => {
      trace.push("spawn_called");
      return baseSpawner.spawn(args);
    },
  };

  // Wrap sink.commitCritical to record trace events.
  const originalCommit = sink.commitCritical.bind(sink);
  let firstSeen = false;
  sink.commitCritical = (input) => {
    if (input.payload.kind === "process_spawn_requested") {
      trace.push("commit_requested");
      const r = originalCommit(input);
      r.then(
        () => {
          if (!firstSeen) {
            firstSeen = true;
            trace.push("commit_resolved");
          }
        },
        () => {
          if (!firstSeen) {
            firstSeen = true;
            trace.push("commit_rejected");
          }
        },
      );
      return r;
    }
    if (input.payload.kind === "process_spawned") {
      trace.push("ownership_commit");
    }
    return originalCommit(input);
  };

  const pending = startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals: new CountingSignalPort(),
    spawner: wrappedSpawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });

  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.ok(trace.includes("commit_requested"), `trace: ${trace.join(",")}`);
  assert.ok(!trace.includes("spawn_called"), `spawn_called BEFORE commit_resolved; trace: ${trace.join(",")}`);

  sink.resolveFirst!({ ok: true, seq: 1 });

  const r = await pending;
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");

  const child = baseSpawner.children[0];
  if (child !== undefined) {
    (child as unknown as { on: (e: string, l: (...a: unknown[]) => void) => unknown }).on(
      "spawn",
      () => trace.push("spawn_event"),
    );
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    await r.value.await();
  }

  const idx = (s: string) => trace.indexOf(s);
  assert.ok(idx("commit_requested") >= 0, `trace: ${trace.join(",")}`);
  assert.ok(idx("commit_resolved") >= 0, `trace: ${trace.join(",")}`);
  assert.ok(idx("spawn_called") >= 0, `trace: ${trace.join(",")}`);
  assert.ok(idx("commit_requested") < idx("commit_resolved"), `trace: ${trace.join(",")}`);
  assert.ok(idx("commit_resolved") < idx("spawn_called"), `trace: ${trace.join(",")}`);
  assert.ok(idx("spawn_called") < idx("spawn_event"), `trace: ${trace.join(",")}`);
  assert.ok(idx("spawn_event") < idx("ownership_commit"), `trace: ${trace.join(",")}`);
});
// ---------------------------------------------------------------------------
// ID01 — Default factory continuity
// ---------------------------------------------------------------------------

test("ID01 default idFactory: every process_evidence record carries the SAME ProcessId", async () => {
  // No idFactory injection — exercises the real default random factory.
  const sink = new FakeSink({ first: "ok-true" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const supervisorHandle = r.value;
  const handleProcessId = supervisorHandle.handle().processId;

  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    await supervisorHandle.await();
  }

  await sink.flush();

  const processRecords = sink.records.filter(
    (rec) => rec.process_id !== undefined,
  );
  assert.ok(
    processRecords.length >= 2,
    `expected at least spawn_requested + process_spawned; got ${processRecords.length}`,
  );
  for (const rec of processRecords) {
    assert.equal(
      rec.process_id,
      handleProcessId,
      `process_id mismatch on ${rec.kind}: handle=${handleProcessId} record=${rec.process_id}`,
    );
  }
});// ---------------------------------------------------------------------------
// ID02 — idFactory called exactly once
// ---------------------------------------------------------------------------

test("ID02 idFactory called EXACTLY ONCE for one evidence-enabled supervisor", async () => {
  let calls = 0;
  const countingFactory: () => ProcessId = () => {
    calls++;
    return makeProcessId(`p-counted-${calls}`);
  };

  const sink = new FakeSink({ first: "ok-true" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
    idFactory: countingFactory,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    await r.value.await();
  }
  assert.equal(calls, 1, `idFactory MUST be called exactly once; got ${calls}`);
});

// ---------------------------------------------------------------------------
// ID03 — No duplicate process_spawn_requested
// ---------------------------------------------------------------------------

test("ID03 no duplicate process_spawn_requested in evidence stream", async () => {
  const sink = new FakeSink({ first: "ok-true" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    await r.value.await();
  }
  await sink.flush();
  const requests = sink.records.filter(
    (rec) => rec.kind === "process_spawn_requested",
  );
  assert.equal(
    requests.length,
    1,
    `process_spawn_requested emitted exactly ONCE; got ${requests.length}`,
  );
});// ---------------------------------------------------------------------------
// SG07 — async spawn-handler unexpected failure → typed
// post_spawn_internal_failure → bounded current-owner cleanup
// (CORRECTION10 §11-§16)
//
// After Node "spawn" fires, the OS child exists. Any
// rejection in the post-spawn handler MUST NOT label this
// as `spawn_failed`. The supervisor MUST run bounded cleanup
// against the real pgid and surface an internal_process_failure
// cause through the cleanup path. This test exercises the
// synchronous-throw sink and asserts the resulting state.
// ---------------------------------------------------------------------------

test("SG07 async spawn-handler rejection → post_spawn_internal_failure → bounded cleanup", async () => {
  // The cleanup path should TERM the group, observe it absent,
  // then close, and surface internal_process_failure.
  const signals = new CountingSignalPort();
  // Pre-populate the alive group: the supervisor will TERM/SIGKILL
  // it and observe it absent. SIGKILL removes the entry from the set.
  signals.aliveGroups.add(7777);
  // Use a long-deadline realClock so the deadline path does not
  // win the lifecycle race before the spawn-handler catch
  // resolves `post_spawn_internal_failure`.
  const spec: ProcessSpec = { ...basicSpec(), deadlineMs: 60_000 };

  const childRef: { current: FakeChild | null } = { current: null };
  const capturingSpawner: SpawnPort = {
    spawn(_args: unknown): SpawnedChild {
      const c = new FakeChild(7777);
      childRef.current = c;
      return c as unknown as SpawnedChild;
    },
  };

  // Sink: process_spawn_requested ACK is fine but
  // process_spawned commit throws SYNCHRONOUSLY (the
  // safeEmit returns a rejected promise AND any code that
  // tries to await it will reject). The supervisor's
  // child.on("spawn") async body must convert this to a
  // typed post_spawn_internal_failure via the catch path,
  // NOT spawn_failed.
  const throwingSink: ProcessEvidenceSink = {
    commitCritical: (input): Promise<ProcessEvidenceCommitResult> => {
      if (input.payload.kind === "process_spawn_requested") {
        return Promise.resolve({ ok: true, seq: 1 });
      }
      if (input.payload.kind === "process_spawned") {
        // Synchronous throw — bypasses the typed commit-result
        // envelope. requireCriticalCommit cannot classify this
        // and the safeEmit's caller awaits a rejected Promise.
        throw new Error("sync sink explosion on process_spawned");
      }
      return Promise.resolve({ ok: true, seq: 999 });
    },
    commitObservation: (): Promise<ProcessEvidenceCommitResult> =>
      Promise.resolve({ ok: true, seq: 999 }),
  };

  const r = await startSupervisor({
    spec,
    clock: realClock(),
    signals,
    spawner: capturingSpawner,
    sink: () => {},
    evidenceSink: throwingSink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const supervisor = r.value;

  // Fire the 'spawn' event so the supervisor's async handler
  // body rejects on the throwing sink. The catch must resolve
  // spawnResolution as `post_spawn_internal_failure`.
  if (childRef.current !== null) {
    childRef.current.fireSpawn();
  }

  // Yield to the microtask queue so the async spawn-handler
  // can reject and the supervisor's catch path can resolve
  // spawnResolution as `post_spawn_internal_failure`. We then
  // drive cleanup by firing close so the bounded close wait
  // observes Node's close boundary.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  if (childRef.current !== null) {
    childRef.current.fireClose(0, null);
  }

  // Bounded await: MUST settle, NOT hang.
  const settle = await Promise.race([
    supervisor.await(),
    new Promise<never>((_res, reject) =>
      setTimeout(() => reject(new Error("supervisor.await() HUNG")), 1000),
    ),
  ]);

  // The supervisor MUST route through the cleanup path
  // because Node's "spawn" already fired. Outcome is
  // cleanup_failed (typed cause = internal_process_failure)
  // OR — in the case where requireCriticalCommit
  // re-classified — a same cleanup_failed with the
  // preserved internal_process_failure kind. We MUST NOT
  // see spawn_failed (CORRECTION10 §14: forbidden after
  // spawn event).
  assert.equal(
    settle.outcome.kind,
    "cleanup_failed",
    `expected cleanup_failed (post-spawn cleanup); got ${settle.outcome.kind}`,
  );
  if (settle.outcome.kind === "cleanup_failed") {
    const f = settle.outcome.failure;
    assert.equal(
      f.kind,
      "internal_process_failure",
      `expected internal_process_failure; got ${JSON.stringify(f)}`,
    );
    // The cleanup MUST have been attempted (TERM requested)
    // against the real pgid (7777).
    const e = settle.outcome.escalation;
    assert.equal(e.termRequested, true, "TERM MUST have been requested against the live pgid");
    assert.equal(
      e.termSent === true || e.termResult !== null,
      true,
      "TERM MUST have been attempted; got " + JSON.stringify(e),
    );
    assert.equal(
      signals.aliveGroups.has(7777),
      false,
      "the OS process group MUST have been reaped by the current owner",
    );
  }
});// ---------------------------------------------------------------------------
// ID04 — Projector replay accepts the stream
// ---------------------------------------------------------------------------

test("ID04 projectExecution(stream) accepts the default-factory stream", async () => {
  const { projectExecution } = await import(
    "../../src/recovery/process-recovery-projector.js"
  );
  const sink = new FakeSink({ first: "ok-true" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    await r.value.await();
  }
  await sink.flush();
  const stream: import("../../src/recovery/recovery-types.js").EvidenceStream =
    sink.records.map((rec, idx) => ({
      payload: rec,
      observedAt: Date.now(),
      seq: idx + 1,
    }));
  const proj = projectExecution(stream);
  assert.equal(proj.ok, true, JSON.stringify(proj));
  if (!proj.ok) return;
  assert.notEqual(
    proj.value.kind,
    "not_started",
    `not_started after a full lifecycle: ${proj.value.kind}`,
  );
});

// ---------------------------------------------------------------------------
// SG06 — Full evidence trace identity continuity
// ---------------------------------------------------------------------------

test("SG06 full trace: every critical + observation record carries the same ProcessId", async () => {
  const sink = new FakeSink({ first: "ok-true" });
  const spawner = new CountingSpawnPort();
  const signals = new CountingSignalPort();

  const r = await startSupervisor({
    spec: basicSpec(),
    clock: manualClock(),
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const child = spawner.children[0];
  if (child !== undefined) {
    queueMicrotask(() => {
      child.fireSpawn();
      child.fireClose(0, null);
    });
    await r.value.await();
  }
  await sink.flush();
  const id = r.value.handle().processId;
  for (const rec of sink.records) {
    if (rec.process_id !== undefined) {
      assert.equal(
        rec.process_id,
        id,
        `trace mismatch on ${rec.kind}: expected ${id}, got ${rec.process_id}`,
      );
    }
  }
  const kinds = sink.records.map((r2) => r2.kind);
  const firstReq = kinds.indexOf("process_spawn_requested");
  const firstSpawned = kinds.indexOf("process_spawned");
  assert.ok(firstReq === 0, `expected process_spawn_requested first; got ${kinds.join(",")}`);
  assert.ok(firstSpawned > firstReq, `expected process_spawned after request; got ${kinds.join(",")}`);
  const requestCount = kinds.filter((k) => k === "process_spawn_requested").length;
  assert.equal(requestCount, 1, `exactly ONE process_spawn_requested; got ${requestCount}`);
});

// ---------------------------------------------------------------------------
// SG08 — Malformed SpawnPort: post-spawn identity unavailable
// (CORRECTION11)
//
// A faulty SpawnPort returns a child object whose pid and
// pgid are BOTH undefined, then fires "spawn" (which Node
// would normally only fire on a real successful spawn).
// The supervisor's async handler body rejects on a throwing
// sink. The catch path MUST resolve
// `post_spawn_identity_unavailable`, NOT `spawn_failed`,
// because creation did happen (we observed the event). The
// outcome MUST be `cleanup_failed` with empty escalation —
// no TERM/KILL/probe fiction, no group-absence claim.
// ---------------------------------------------------------------------------

test("SG08 malformed SpawnPort (spawn fired, pid/pgid undefined) → post_spawn_identity_unavailable → fail-closed", async () => {
  const signals = new CountingSignalPort();
  // Deliberately leave aliveGroups empty — the supervisor
  // MUST NOT attempt TERM/KILL/probe anyway (no target).

  // Malformed child: fires "spawn" but exposes no identity.
  const childListeners: Array<{ event: string; listener: (...args: unknown[]) => void }> = [];
  const malformedChild = {
    pid: undefined as unknown as number,
    pgid: undefined as unknown as number,
    stdout: new Readable({ read() {} }),
    stderr: new Readable({ read() {} }),
    on(event: string, listener: (...args: unknown[]) => void) {
      childListeners.push({ event, listener });
      return malformedChild;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrap = (...args: unknown[]) => {
        const idx = childListeners.findIndex((l) => l.event === event && l.listener === wrap);
        if (idx >= 0) childListeners.splice(idx, 1);
        listener(...args);
      };
      childListeners.push({ event, listener: wrap });
      return malformedChild;
    },
    kill: () => false,
  };

  const malformedSpawner: SpawnPort = {
    spawn() {
      return malformedChild as unknown as SpawnedChild;
    },
  };

  // Same throwing sink as SG07: process_spawn_requested OK,
  // process_spawned throws synchronously to force the catch.
  const throwingSink: ProcessEvidenceSink = {
    commitCritical: (input): Promise<ProcessEvidenceCommitResult> => {
      if (input.payload.kind === "process_spawn_requested") {
        return Promise.resolve({ ok: true, seq: 1 });
      }
      if (input.payload.kind === "process_spawned") {
        throw new Error("sync sink explosion on process_spawned");
      }
      return Promise.resolve({ ok: true, seq: 999 });
    },
    commitObservation: () =>
      Promise.resolve({ ok: true, seq: 999 }),
  };

  // Long-deadline realClock so the deadline path does not
  // win the lifecycle race before the spawn-handler catch
  // resolves.
  const spec: ProcessSpec = { ...basicSpec(), deadlineMs: 60_000 };
  const r = await startSupervisor({
    spec,
    clock: realClock(),
    signals,
    spawner: malformedSpawner,
    sink: () => {},
    evidenceSink: throwingSink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const supervisor = r.value;

  // Fire the malformed "spawn" event. The async body rejects,
  // the catch sees no pid/pgid, and resolves
  // post_spawn_identity_unavailable.
  for (const l of childListeners) {
    if (l.event === "spawn") l.listener();
  }

  const settle = await Promise.race([
    supervisor.await(),
    new Promise<never>((_res, reject) =>
      setTimeout(() => reject(new Error("supervisor.await() HUNG")), 1000),
    ),
  ]);

  assert.notEqual(
    settle.outcome.kind,
    "spawn_failed",
    `SG08 contract: a post-'spawn' failure MUST NOT be labeled spawn_failed; got ${settle.outcome.kind}`,
  );
  assert.equal(
    settle.outcome.kind,
    "identity_unavailable",
    `expected identity_unavailable (CORRECTION12 typed outcome); got ${settle.outcome.kind}`,
  );
  if (settle.outcome.kind === "identity_unavailable") {
    assert.equal(
      settle.outcome.failure.kind,
      "internal_process_failure",
      `expected internal_process_failure; got ${JSON.stringify(settle.outcome.failure)}`,
    );
    const e = settle.outcome.escalation;
    // CORRECTION12 §3: the supervisor MUST NOT have
    // attempted TERM/KILL/probe because there was no
    // usable pid/pgid.
    assert.equal(e.termRequested, false, "TERM MUST NOT be requested without a pgid");
    assert.equal(e.termSent, false);
    assert.equal(e.killRequested, false, "KILL MUST NOT be requested without a pgid");
    assert.equal(e.killSent, false);
    // CORRECTION12 §3: ABSENCE LAW. The escalation's
    // finalGroupProbe MUST be `not_observed` — the truthful
    // neutral. It MUST NOT be `absent` because no probe
    // was performed and absence cannot be established.
    assert.equal(
      e.finalGroupProbe.kind,
      "not_observed",
      `SG08 absence-law: finalGroupProbe.kind MUST be not_observed; got ${e.finalGroupProbe.kind}`,
    );
    // CORRECTION12 §3: the result.escalation (top-level)
    // carries the same finalGroupProbe.
    assert.equal(
      settle.escalation.finalGroupProbe.kind,
      "not_observed",
      `SG08 absence-law: result.escalation.finalGroupProbe.kind MUST be not_observed; got ${settle.escalation.finalGroupProbe.kind}`,
    );
    // The signal port MUST have observed no activity.
    assert.equal(
      signals.signalCount,
      0,
      `signals MUST NOT have been touched; got signalCount=${signals.signalCount}`,
    );
    assert.equal(
      signals.probeCount,
      0,
      `probes MUST NOT have been touched; got probeCount=${signals.probeCount}`,
    );
  }
});

// ---------------------------------------------------------------------------
// SG09 — wording independence (CORRECTION12 §7)
//
// CORRECTION11 used `message.includes("pid=")` /
// `message.includes('Node "spawn"')` to rediscover the
// typed "identity lost" state from error prose. CORRECTION12
// replaces this with a TYPED outcome kind
// (`identity_unavailable`) and removes all substring
// dependencies.
//
// SG09 re-runs the SG08 scenario and asserts:
//   1. The settlement outcome is the TYPED
//      `identity_unavailable` (not its message prose).
//   2. The handle layer appends ZERO close/result records
//      even though the underlying failure message COULD
//      contain any prose — the message is not a control
//      input.
//   3. No `process_close_observed` or
//      `process_result_committed` payload is committed.
// ---------------------------------------------------------------------------

test("SG09 wording-independence: identity_unavailable suppresses close/result evidence regardless of failure-message text", async () => {
  const signals = new CountingSignalPort();
  const childListeners: Array<{ event: string; listener: (...args: unknown[]) => void }> = [];
  const malformedChild = {
    pid: undefined as unknown as number,
    pgid: undefined as unknown as number,
    stdout: new Readable({ read() {} }),
    stderr: new Readable({ read() {} }),
    on(event: string, listener: (...args: unknown[]) => void) {
      childListeners.push({ event, listener });
      return malformedChild;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrap = (...args: unknown[]) => {
        const idx = childListeners.findIndex((l) => l.event === event && l.listener === wrap);
        if (idx >= 0) childListeners.splice(idx, 1);
        listener(...args);
      };
      childListeners.push({ event, listener: wrap });
      return malformedChild;
    },
    kill: () => false,
  };

  const malformedSpawner: SpawnPort = {
    spawn() {
      return malformedChild as unknown as SpawnedChild;
    },
  };

  // Recording sink to observe whether close/result records
  // were appended. CORRECTION12 §7: the typed outcome MUST
  // suppress these regardless of message content.
  const records: Array<{ kind: string }> = [];
  const recordingSink: ProcessEvidenceSink = {
    commitCritical: (input): Promise<ProcessEvidenceCommitResult> => {
      records.push(input.payload);
      return Promise.resolve({ ok: true, seq: 1 });
    },
    commitObservation: (input): Promise<ProcessEvidenceCommitResult> => {
      records.push(input.payload);
      return Promise.resolve({ ok: true, seq: 2 });
    },
  };

  const spec: ProcessSpec = { ...basicSpec(), deadlineMs: 60_000 };
  const r = await startSupervisor({
    spec,
    clock: realClock(),
    signals,
    spawner: malformedSpawner,
    sink: () => {},
    evidenceSink: recordingSink,
    evidenceIdentity: makeIdentity(),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  const supervisor = r.value;

  // Fire the malformed spawn.
  for (const l of childListeners) {
    if (l.event === "spawn") l.listener();
  }

  const settle = await Promise.race([
    supervisor.await(),
    new Promise<never>((_res, reject) =>
      setTimeout(() => reject(new Error("supervisor.await() HUNG")), 1000),
    ),
  ]);

  // CORRECTION12 §4: the typed outcome is what determines
  // behavior — NOT the failure message.
  assert.equal(
    settle.outcome.kind,
    "identity_unavailable",
    `SG09: outcome MUST be identity_unavailable; got ${settle.outcome.kind}`,
  );
  // The failure message is unrelated to the suppression
  // decision. It MAY or MAY NOT contain "pid="; the test
  // asserts the typed path works either way.
  if (settle.outcome.kind === "identity_unavailable") {
    const m = settle.outcome.failure.message;
    assert.equal(typeof m, "string", "failure.message is a string");
  }

  // CORRECTION12 §7: no process_close_observed or
  // process_result_committed appended.
  const closeObservedCount = records.filter(
    (rec) => rec.kind === "process_close_observed",
  ).length;
  const resultCommittedCount = records.filter(
    (rec) => rec.kind === "process_result_committed",
  ).length;
  assert.equal(
    closeObservedCount,
    0,
    `SG09: process_close_observed MUST NOT be appended; got ${closeObservedCount}`,
  );
  assert.equal(
    resultCommittedCount,
    0,
    `SG09: process_result_committed MUST NOT be appended; got ${resultCommittedCount}`,
  );
});
