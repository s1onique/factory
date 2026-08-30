/**
 * supervised-process-ports.test.ts
 * Pure port-driven tests for the supervisor.
 * Uses a fake SpawnPort and fake SignalPort; no real OS dependency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { startSupervised } from "../../src/process/supervised-process.js";
import { manualClock, realClock } from "../../src/process/clock.js";
import type { ProcessSpec, SignalAttemptResult, GroupProbe } from "../../src/process/process-types.js";
import type { SignalPort, SpawnedChild, SpawnPort } from "../../src/process/process-ports.js";

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
    this.pid = pid; this.pgid = pid;
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  on(event: string, listener: FakeListener): FakeChild {
    const arr = this.listeners.get(event) ?? []; arr.push(listener); this.listeners.set(event, arr); return this;
  }
  once(event: string, listener: FakeListener): FakeChild {
    const wrap: FakeListener = (...args: unknown[]) => { this.removeListener(event, wrap); listener(...args); };
    return this.on(event, wrap);
  }
  private removeListener(event: string, listener: FakeListener): void {
    const arr = this.listeners.get(event); if (arr === undefined) return; const idx = arr.indexOf(listener); if (idx >= 0) arr.splice(idx, 1);
  }
  private emit(event: string, ...args: unknown[]): void {
    const arr = this.listeners.get(event); if (arr === undefined) return; for (const l of [...arr]) l(...args);
  }
  fireSpawn(): void { this.emit("spawn"); }
  fireClose(code: number | null, signal: NodeJS.Signals | null): void {
    this.code = code; this.signal = signal;
    this.emit("exit", code, signal);
    this.closed = true;
    this.emit("close", code, signal);
    this.stdout.push(null); this.stderr.push(null);
  }
  fireError(e: Error): void { this.emit("error", e); }
  kill(_signal?: NodeJS.Signals | number): boolean { return false; }
}

class FakeSpawnPort implements SpawnPort {
  nextPid = 1000;
  readonly children: FakeChild[] = [];
  spawn(_args: {
    readonly executable: string;
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly detached: boolean;
  }): SpawnedChild {
    const c = new FakeChild(this.nextPid++); this.children.push(c); return c as unknown as SpawnedChild;
  }
}

type SignalEvent = { signal: "SIGTERM" | "SIGKILL"; pgid: number };

class FakeSignalPort implements SignalPort {
  aliveGroups = new Set<number>();
  log: SignalEvent[] = [];
  signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL" | 0): SignalAttemptResult {
    this.log.push({ signal: signal as "SIGTERM" | "SIGKILL", pgid });
    if (signal === 0) {
      return this.aliveGroups.has(pgid) ? { kind: "sent", signal: 0 } : { kind: "group_absent" };
    }
    if (!this.aliveGroups.has(pgid)) return { kind: "group_absent" };
    if (signal === "SIGKILL") this.aliveGroups.delete(pgid);
    return { kind: "sent", signal };
  }
  probeGroup(pgid: number): GroupProbe {
    return this.aliveGroups.has(pgid) ? { kind: "alive" } : { kind: "absent" };
  }
}

function basicSpec(args: string[] = ["exit", "--code", "0"]): ProcessSpec {
  return { executable: "/bin/true", args, cwd: "/tmp", env: {}, deadlineMs: 250, termGraceMs: 50, killGraceMs: 50, stdoutLimitBytes: 1024, stderrLimitBytes: 1024 };
}
test("F01 invalid spec returns invalid_process_spec via Result", async () => {
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 0 }, clock: manualClock(), signals: new FakeSignalPort(), spawner: new FakeSpawnPort() });
  assert.equal(r.ok, false);
  if (r.ok === false) assert.equal(r.error.kind, "invalid_process_spec");
});

test("F02 exit(0) -> outcome.exited, no signals sent", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => { child.fireSpawn(); child.fireClose(0, null); });
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "exited");
  if (result.outcome.kind === "exited") assert.equal(result.outcome.exitCode, 0);
  assert.equal(result.escalation.termSent, false);
  assert.equal(result.escalation.killSent, false);
  assert.equal(signals.log.length, 0);
});

test("F03 deadline -> TERM -> KILL escalation; outcome=deadline", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 100 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  // Yield so the deadline/escalation runs, then fire close so
  // Node's close boundary is observed and the supervisor can
  // settle as deadline (not cleanup_failed).
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setImmediate(res));
  if (!child.closed) child.fireClose(null, "SIGKILL");
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "deadline");
  if (result.outcome.kind === "deadline") {
    assert.equal(result.escalation.termSent, true);
    assert.equal(result.escalation.killSent, true);
    assert.equal(result.escalation.finalGroupProbe.kind, "absent");
  }
  assert.equal(signals.log.length, 2);
  assert.equal(signals.log[0]!.signal, "SIGTERM");
  assert.equal(signals.log[1]!.signal, "SIGKILL");
});

test("F04 cooperative cancel -> only TERM, no KILL", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const originalSignal = signals.signalGroup.bind(signals);
  signals.signalGroup = (pgid, signal) => {
    const r = originalSignal(pgid, signal);
    if (signal === "SIGTERM" && r.kind === "sent") signals.aliveGroups.delete(pgid);
    return r;
  };
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  // Cancel FIRST so cancel wins the race; fireClose only happens
  // when the supervisor's TERM probe succeeds and the fake child
  // co-exits via fireClose on the closePromise branch after TERM.
  supervisor.cancel();
  // Allow the termination machinery to fire TERM.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  // Now the cooperative child exits naturally.
  if (!child.closed) child.fireClose(0, "SIGTERM");
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cancelled");
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, false);
});

test("F05 repeated cancel is idempotent", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const originalSignal = signals.signalGroup.bind(signals);
  signals.signalGroup = (pgid, signal) => {
    const r = originalSignal(pgid, signal);
    if (signal === "SIGTERM" && r.kind === "sent") signals.aliveGroups.delete(pgid);
    return r;
  };
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  supervisor.cancel();
  supervisor.cancel();
  supervisor.cancel();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  if (!child.closed) child.fireClose(0, "SIGTERM");
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cancelled");
  const termCount = signals.log.filter((e) => e.signal === "SIGTERM").length;
  assert.ok(termCount <= 1, "expected at-most 1 SIGTERM");
});

test("F06 exit-with-signal -> outcome=signaled", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  queueMicrotask(() => child.fireClose(null, "SIGKILL"));
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "signaled");
  if (result.outcome.kind === "signaled") assert.equal(result.outcome.signal, "SIGKILL");
});

test("F07 await() is idempotent: same lifecycle promise", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: basicSpec(), clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => { child.fireSpawn(); child.fireClose(0, null); });
  const a = supervisor.await();
  const b = supervisor.await();
  assert.ok(a === b, "await() must return the same promise");
  const [r1, r2] = await Promise.all([a, b]);
  assert.ok(r1 === r2, "results must be the same object");
  assert.equal(signals.log.length, 0);
});

test("F08 eager listener: spawn event fires process_spawned", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => { child.fireSpawn(); child.fireClose(0, null); });
  await supervisor.await();
  const spawned = events.filter((e) => e.kind === "process_spawned");
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]!.pid, 1000);
  assert.ok(events.find((e) => e.kind === "process_spawn_started") !== undefined, "must emit process_spawn_started before spawned");
});

test("F09 spawn failure emits spawn_failed but NO process_spawned", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: basicSpec(), clock: manualClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => { child.fireError(new Error("ENOENT")); child.fireClose(1, null); });
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "spawn_failed");
  assert.ok(!events.some((e) => e.kind === "process_spawned"), "process_spawned MUST NOT be emitted on spawn failure");
  assert.ok(events.some((e) => e.kind === "process_spawn_failed"), "process_spawn_failed must be emitted on spawn failure");
});

test("F10 late events after settlement: no deadline_reached", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => { child.fireSpawn(); child.fireClose(0, null); });
  await supervisor.await();
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!events.some((e) => e.kind === "deadline_reached"), "deadline_reached MUST NOT fire after exited");
  assert.ok(!events.some((e) => e.kind === "signal_sent"), "no signal_sent after exited");
});

test("F11 group EPERM fails closed (cleanup_failed, capability_unavailable)", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  signals.signalGroup = (pgid, signal) => {
    signals.log.push({ signal: signal as "SIGTERM" | "SIGKILL", pgid });
    return { kind: "permission_denied", code: "EPERM" };
  };
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 100 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cleanup_failed");
  const outcome = result.outcome as { kind: "cleanup_failed"; failure: { kind: string } };
  assert.equal(outcome.failure.kind, "capability_unavailable");
  assert.equal(signals.log.length, 1);
});

test("F12 cancel wakes before long deadline", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  // Cooperative TERM: remove group and schedule close so the
  // supervisor observes Node's close boundary.
  signals.signalGroup = (_pgid, signal) => {
    if (signal === "SIGTERM") {
      signals.aliveGroups.delete(1000);
      setTimeout(() => child.fireClose(0, null), 10);
      return { kind: "sent", signal: "SIGTERM" };
    }
    return { kind: "group_absent" };
  };
  setTimeout(() => supervisor.cancel(), 20);
  const t0 = Date.now();
  const result = await supervisor.await();
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, "cancel must wake within 2s");
  assert.equal(result.outcome.kind, "cancelled");
});

// ========================================================================
// CORRECTION02 regression tests
// ========================================================================
test("PS01 immediate pre-spawn cancel: child materialized later is cleaned up", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const originalSignal = signals.signalGroup.bind(signals);
  signals.signalGroup = (pgid, signal) => {
    const r = originalSignal(pgid, signal);
    if (signal === "SIGKILL" && r.kind === "sent") signals.aliveGroups.delete(pgid);
    return r;
  };
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  supervisor.cancel();
  queueMicrotask(() => child.fireSpawn());
  await new Promise((res) => setImmediate(res));
  child.fireClose(0, "SIGKILL");
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cancelled");
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, true);
  assert.ok(signals.log.some((e) => e.signal === "SIGTERM"), "TERM must have been sent");
  assert.ok(signals.log.some((e) => e.signal === "SIGKILL"), "KILL must have been sent");
});

test("PS02 pre-spawn deadline: child materialized later is terminated", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  // Yield a few macrotask ticks so deadline fires + escalation runs
  // before we close the fake child. Otherwise the supervisor would
  // observe the close as a natural exit before cleanup.
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setImmediate(res));
  if (!child.closed) child.fireClose(null, "SIGKILL");
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "deadline");
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, true);
});

test("PS03 pre-spawn cancel + spawn failure: outcome is spawn_failed", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 60000 }, clock: manualClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  supervisor.cancel();
  queueMicrotask(() => { child.fireError(new Error("ENOENT")); child.fireClose(1, null); });
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "spawn_failed");
  assert.ok(!events.some((e) => e.kind === "process_spawned"), "no process_spawned on spawn failure");
  assert.equal(signals.log.length, 0);
});

test("PS04 pre-spawn deadline + spawn failure: outcome is spawn_failed", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => { child.fireError(new Error("ENOENT")); child.fireClose(1, null); });
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "spawn_failed");
  assert.equal(signals.log.length, 0);
});

test("CV01 cleanup_verified emitted only after group absence proof", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setImmediate(res));
  if (!child.closed) child.fireClose(null, "SIGKILL");
  await supervisor.await();
  const verified = events.filter((e) => e.kind === "cleanup_verified");
  const failed = events.filter((e) => e.kind === "cleanup_failed");
  assert.equal(verified.length, 1);
  assert.equal(failed.length, 0);
});

test("CV02 EPERM: no cleanup_verified, outcome cleanup_failed(capability_unavailable)", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  signals.signalGroup = (_pgid, _signal) => ({ kind: "permission_denied", code: "EPERM" });
  const spawner = new FakeSpawnPort();
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cleanup_failed");
  const outcome = result.outcome as { kind: "cleanup_failed"; failure: { kind: string } };
  assert.equal(outcome.failure.kind, "capability_unavailable");
  assert.ok(!events.some((e) => e.kind === "cleanup_verified"), "no cleanup_verified on EPERM");
  assert.ok(events.some((e) => e.kind === "cleanup_failed"), "cleanup_failed must be emitted on EPERM");
});

test("CV03 final probe alive: no cleanup_verified, outcome cleanup_failed", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  signals.probeGroup = (_pgid) => ({ kind: "alive" });
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cleanup_failed");
  const outcome = result.outcome as { kind: "cleanup_failed"; failure: { kind: string } };
  assert.equal(outcome.failure.kind, "cleanup_timeout");
});

test("CV04 probe_error: no cleanup_verified, outcome cleanup_failed", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  signals.signalGroup = (_pgid, _signal) => ({ kind: "error", code: "EIO", message: "disk gone" });
  signals.probeGroup = (_pgid) => ({ kind: "probe_error", code: "EIO", message: "disk gone" });
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cleanup_failed");
  const outcome = result.outcome as { kind: "cleanup_failed"; failure: { kind: string } };
  assert.equal(outcome.failure.kind, "cleanup_timeout");
});

test("CL01 close during escalation is not missed (cooperative TERM)", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const originalSignal = signals.signalGroup.bind(signals);
  signals.signalGroup = (pgid, signal) => {
    if (signal === "SIGTERM") {
      const child = spawner.children[0];
      if (child !== undefined && !child.closed) {
        // Cooperative exit during TERM: report as sent + remove
        // group + schedule close.
        signals.aliveGroups.delete(pgid);
        queueMicrotask(() => child.fireClose(0, null));
        return { kind: "sent", signal: "SIGTERM" };
      }
    }
    return originalSignal(pgid, signal);
  };
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "deadline");
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, false);
});

test("CL02 close during escalation is captured by original promise", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const originalSignal = signals.signalGroup.bind(signals);
  signals.signalGroup = (pgid, signal) => {
    const r = originalSignal(pgid, signal);
    if (signal === "SIGKILL") {
      const child = spawner.children[0];
      if (child !== undefined && !child.closed) child.fireClose(0, "SIGKILL");
    }
    return r;
  };
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.ok(result !== undefined, "result must settle");
});

test("CL03 close-wait bound elapses without close: cleanup outcome", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  signals.signalGroup = (_pgid, signal) => signal === "SIGKILL" ? { kind: "sent", signal: "SIGKILL" } : { kind: "sent", signal: "SIGTERM" };
  signals.probeGroup = (_pgid) => ({ kind: "alive" });
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  const result = await supervisor.await();
  assert.ok(result.outcome.kind === "cleanup_failed", "must be cleanup_failed");
});

test("SE01 synchronous spawn throw emits process_spawn_failed before seal", async () => {
  class ThrowingSpawnPort { spawn() { throw new Error("EPERM-fake-spawn"); } }
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const r = startSupervised({ spec: basicSpec(), clock: manualClock(), signals: new FakeSignalPort(), spawner: new ThrowingSpawnPort() as unknown as FakeSpawnPort, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const result = await r.value.await();
  assert.equal(result.outcome.kind, "spawn_failed");
  assert.ok(events.filter((e) => e.kind === "process_spawn_started").length === 1, "exactly one spawn_started");
  assert.ok(events.filter((e) => e.kind === "process_spawn_failed").length === 1, "exactly one spawn_failed");
  assert.ok(!events.some((e) => e.kind === "process_spawned"), "NO process_spawned on sync throw");
});

test("IO01 injected stdout stream failure appears in final result", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), stdoutLimitBytes: 1024 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => {
    child.fireSpawn();
    (child.stdout as unknown as { emit: (e: string, ...args: unknown[]) => void }).emit("error", new Error("stdout-broken"));
    child.fireClose(0, null);
  });
  const result = await supervisor.await();
  assert.ok(result.outcome.kind === "exited", "still classified exited");
  if (result.outcome.kind === "exited") assert.ok(result.outcome.stdoutFailure !== null, "stdoutFailure must be set");
});

test("IO02 injected stderr stream failure appears in final result", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), stderrLimitBytes: 1024 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => {
    child.fireSpawn();
    (child.stderr as unknown as { emit: (e: string, ...args: unknown[]) => void }).emit("error", new Error("stderr-broken"));
    child.fireClose(0, null);
  });
  const result = await supervisor.await();
  assert.ok(result.outcome.kind === "exited", "still classified exited");
  if (result.outcome.kind === "exited") assert.ok(result.outcome.stderrFailure !== null, "stderrFailure must be set");
});

// ========================================================================
// CORRECTION03 tests
// ========================================================================

test("CL04 group absent + no close => cleanup_failed(close_timeout)", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const originalSignal = signals.signalGroup.bind(signals);
  signals.signalGroup = (pgid, signal) => {
    const r = originalSignal(pgid, signal);
    // Make KILL remove the group from the alive set so
    // finalGroupProbe becomes absent.
    if (signal === "SIGKILL") signals.aliveGroups.delete(pgid);
    return r;
  };
  const spawner = new FakeSpawnPort();
  const r = startSupervised({ spec: { ...basicSpec(), deadlineMs: 50 }, clock: manualClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  // Yield so deadline/escalation runs and the group becomes absent.
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setImmediate(res));
  // CRUCIALLY: never call fireClose. The fake child emits no close.
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cleanup_failed");
  if (result.outcome.kind === "cleanup_failed") {
    assert.equal(result.outcome.failure.kind, "cleanup_timeout");
    if (result.outcome.failure.kind === "cleanup_timeout") assert.equal(result.outcome.failure.phase, "close");
  }
});

// ========================================================================
// CORRECTION09 — KILL-path reap race (zombie visibility)
// ========================================================================
//
// POSIX guarantee: a successfully signalled child remains in
// the process table as a zombie until its parent reaps it.
// During that window, kill(-pgid, 0) returns alive even though
// the child has been killed. The supervisor's KILL grace
// loop MUST observe Node's reap boundary (the 'close' event)
// and re-probe the group afterwards, otherwise a successful
// SIGKILL is mis-classified as cleanup_failed(phase=kill).

test("KR01 KILL path tolerates zombie visibility until direct child reap", async () => {
  // Model:
  //   spawn fake child, group=alive
  //   TERM sent -> group stays alive (ignore-term)
  //   TERM grace expires (group still alive in probe)
  //   KILL sent -> "killed" but group stays alive in probe
  //                (zombie state)
  //   60ms later: child fires close -> group becomes absent
  //     (reap effect)
  //   KILL grace is 200ms, so close fires WITHIN grace.
  //
  // Expected: outcome=deadline, finalGroupProbe=absent,
  //           termSent=true, killSent=true.
  //
  // Before CORRECTION09: outcome=cleanup_failed(phase=kill)
  // because the loop polled alive every 20ms and timed out
  // before close fired (the loop never re-probed after close).
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const r = startSupervised({
    spec: {
      ...basicSpec(),
      deadlineMs: 50,
      termGraceMs: 20,
      killGraceMs: 200,
    },
    clock: realClock(),
    signals,
    spawner,
  });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;

  // Both TERM and KILL are "sent". The group stays in
  // aliveGroups UNTIL fireClose fires (simulating the
  // zombie->reap transition that a real kernel performs
  // when the parent wait()s on a dead child).
  signals.signalGroup = (pgid, signal) => {
    signals.log.push({ signal: signal as "SIGTERM" | "SIGKILL", pgid });
    return { kind: "sent", signal };
  };
  const origFireClose = child.fireClose.bind(child);
  child.fireClose = (code, sig) => {
    // Simulate Node reaping the child: the zombie is
    // finally released from the process table.
    signals.aliveGroups.delete(1000);
    return origFireClose(code, sig);
  };

  queueMicrotask(() => child.fireSpawn());
  // Fire close 40ms after spawn (which is into KILL grace),
  // so the KILL grace loop must wait for it and re-probe.
  setTimeout(() => {
    if (!child.closed) child.fireClose(null, "SIGKILL");
  }, 90);

  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "deadline",
    `expected deadline, got kind=${result.outcome.kind}; ` +
    `escalation=${JSON.stringify(result.escalation)}`);
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, true);
  assert.equal(result.escalation.finalGroupProbe.kind, "absent",
    `reap race: finalGroupProbe=${JSON.stringify(result.escalation.finalGroupProbe)}`);
});

test("KR02 child reap does NOT substitute for group absence (descendant survives)", async () => {
  // Counter-test: even if the immediate child reaps, the
  // group probe is the authoritative truth. If a surviving
  // descendant keeps the group alive, the supervisor MUST
  // report cleanup_failed(phase=kill).
  //
  // This prevents fixing LIVE05 by treating close as a
  // substitute for group absence.
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  signals.signalGroup = (pgid, signal) => {
    signals.log.push({ signal: signal as "SIGTERM" | "SIGKILL", pgid });
    return { kind: "sent", signal };
  };
  // The group stays alive in probe forever (descendant
  // survives). The child's close boundary does NOT remove
  // the group from aliveGroups.
  signals.probeGroup = (pgid) =>
    signals.aliveGroups.has(pgid) ? { kind: "alive" } : { kind: "absent" };

  const r = startSupervised({
    spec: {
      ...basicSpec(),
      deadlineMs: 50,
      termGraceMs: 30,
      killGraceMs: 150,
    },
    clock: realClock(),
    signals,
    spawner,
  });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  const child = spawner.children[0]!;
  queueMicrotask(() => child.fireSpawn());
  // Fire close ~100ms in (which is into KILL grace, which
  // starts at t=80ms after deadline+termGrace). Group stays
  // alive (descendant). KILL grace will time out.
  setTimeout(() => {
    if (!child.closed) child.fireClose(null, "SIGKILL");
  }, 100);

  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cleanup_failed",
    `expected cleanup_failed, got kind=${result.outcome.kind}; ` +
    `escalation=${JSON.stringify(result.escalation)}`);
  if (result.outcome.kind === "cleanup_failed") {
    assert.equal(result.outcome.failure.kind, "cleanup_timeout");
    if (result.outcome.failure.kind === "cleanup_timeout") {
      assert.equal(result.outcome.failure.phase, "kill");
    }
  }
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, true);
  assert.equal(result.escalation.finalGroupProbe.kind, "alive");
});
