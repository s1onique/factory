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
  setTimeout(() => supervisor.cancel(), 20);
  const t0 = Date.now();
  const result = await supervisor.await();
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2000, "cancel must wake within 2s");
  assert.ok(result.outcome.kind === "cancelled", "outcome must be cancelled");
});
