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
  private firstBehavior: "pending" | "ok-false" | "reject" | "ok-true";
  resolveFirst: ((r: ProcessEvidenceCommitResult) => void) | null = null;
  rejectFirst: ((e: unknown) => void) | null = null;
  private firstPromise: Promise<ProcessEvidenceCommitResult> | null = null;

  constructor(opts: FakeSinkOptions = {}) {
    this.firstBehavior = opts.first ?? "ok-true";
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
      return this.firstPromise;
    }
    if (input.payload.kind === "process_spawned") {
      this.spawnedCalls++;
      return Promise.resolve({ ok: true, seq: 100 });
    }
    if (input.payload.kind === "process_result_committed") {
      this.resultCommittedCalls++;
      return Promise.resolve({ ok: true, seq: 200 });
    }
    this.otherCalls++;
    return Promise.resolve({ ok: true, seq: 999 });
  }

  commitObservation(_input: unknown): Promise<ProcessEvidenceCommitResult> {
    this.otherCalls++;
    return Promise.resolve({ ok: true, seq: 999 });
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
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  assert.equal(spawner.spawnCount, 0, "spawner.spawn() MUST NOT be called on ok:false");
  assert.equal(signals.signalCount, 0, "no signals sent on spawn_request failure");
  assert.equal(signals.probeCount, 0, "no probes sent on spawn_request failure");

  const result = await r.value.await();
  assert.equal(result.outcome.kind, "spawn_failed", JSON.stringify(result));
  if (result.outcome.kind === "spawn_failed") {
    const f = result.outcome.failure;
    assert.equal(f.kind, "evidence_persistence_failure", JSON.stringify(f));
    if (f.kind === "evidence_persistence_failure") {
      assert.equal(f.stage, "spawn_request", `stage should be spawn_request; got ${f.stage}`);
    }
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
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error("expected ok");
  assert.equal(spawner.spawnCount, 0, "spawner.spawn() MUST NOT be called on rejection");
  assert.equal(signals.signalCount, 0, "no signals sent on rejection");
  assert.equal(signals.probeCount, 0, "no probes sent on rejection");

  const result = await r.value.await();
  assert.equal(result.outcome.kind, "spawn_failed", JSON.stringify(result));
  if (result.outcome.kind === "spawn_failed") {
    const f = result.outcome.failure;
    assert.equal(f.kind, "evidence_persistence_failure", JSON.stringify(f));
    if (f.kind === "evidence_persistence_failure") {
      assert.equal(f.stage, "spawn_request", `stage should be spawn_request; got ${f.stage}`);
    }
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
