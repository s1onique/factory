/**
 * supervised-process-ports.test.ts
 * Pure port-driven tests for the supervisor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createSupervisor } from "../../src/process/supervised-process.js";
import { manualClock } from "../../src/process/clock.js";
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
  signalGroup(
    pgid: number,
    signal: "SIGTERM" | "SIGKILL" | 0,
    _immediateChildPid?: number,
): SignalAttemptResult {
    this.log.push({ signal: signal as "SIGTERM" | "SIGKILL", pgid });
    if (signal === 0) {
      return this.aliveGroups.has(pgid)
        ? { kind: "sent", signal: 0 }
        : { kind: "group_absent" };
    }
    if (!this.aliveGroups.has(pgid)) return { kind: "group_absent" };
    if (signal === "SIGKILL") {
      // KILL always removes the group.
      this.aliveGroups.delete(pgid);
    }
    return { kind: "sent", signal };
  }
  probeGroup(pgid: number): GroupProbe {
    return this.aliveGroups.has(pgid)
      ? { kind: "alive" }
      : { kind: "absent" };
  }
}

function basicSpec(args: string[] = ["exit", "--code", "0"]): ProcessSpec {
  return { executable: "/bin/true", args, cwd: "/tmp", env: {}, deadlineMs: 250, termGraceMs: 50, killGraceMs: 50, stdoutLimitBytes: 1024, stderrLimitBytes: 1024 };
}
test("F01 invalid spec yields typed failure without throwing", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const supervisor = createSupervisor({ spec: { ...basicSpec(), deadlineMs: 0 }, clock: manualClock(), signals, spawner });
  const r = await supervisor.await();
  assert.equal(r.outcome.kind, "cleanup_failed");
  if (r.outcome.kind === "cleanup_failed") {
    const f = (r.outcome as { failure: { kind: string } }).failure;
    assert.equal(f.kind, "invalid_process_spec");
  }
});

test("F02 spec validation accepts valid input", async () => {
  const { validateProcessSpec } = await import("../../src/process/process-types.js");
  const r = validateProcessSpec(basicSpec());
  assert.equal(r.ok, true);
});

test("F03 exit(0) -> outcome.exited, no signals sent", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const clock = manualClock();
  const supervisor = createSupervisor({
    spec: { ...basicSpec(), deadlineMs: 60000 },
    clock,
    signals,
    spawner,
  });
  const child = spawner.children[0]!;
  child.fireSpawn();
  // Fire close synchronously (next microtask). Since the
  // supervisor's deadline path uses clock.sleep which returns
  // synchronously under manualClock, we must close the child
  // BEFORE awaiting.
  queueMicrotask(() => child.fireClose(0, null));
  const r = await supervisor.await();
  assert.equal(r.outcome.kind, "exited");
  if (r.outcome.kind === "exited") assert.equal(r.outcome.exitCode, 0);
  assert.equal(r.escalation.termSent, false);
  assert.equal(r.escalation.killSent, false);
  assert.equal(signals.log.length, 0);
});

test("F04 deadline -> TERM -> KILL escalation; outcome=deadline", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const clock = manualClock();
  const supervisor = createSupervisor({
    spec: { ...basicSpec(), deadlineMs: 100 },
    clock,
    signals,
    spawner,
  });
  const child = spawner.children[0]!;
  child.fireSpawn();
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

test("F05 cooperative TERM -> only TERM, no KILL", async () => {
  const signals = new FakeSignalPort();
  // Cooperative child semantics: TERM removes the group from the
  // alive set AND the supervisor must NOT need to send KILL.
  signals.signalGroup = (
    pgid: number,
    signal: "SIGTERM" | "SIGKILL" | 0,
    _immediateChildPid?: number,
  ): SignalAttemptResult => {
    if (signal === 0) {
      return signals.aliveGroups.has(pgid)
        ? { kind: "sent", signal: 0 }
        : { kind: "group_absent" };
    }
    if (!signals.aliveGroups.has(pgid)) return { kind: "group_absent" };
    signals.log.push({ signal: signal as "SIGTERM" | "SIGKILL", pgid });
    signals.aliveGroups.delete(pgid);
    return { kind: "sent", signal };
  };
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const clock = manualClock();
  const supervisor = createSupervisor({
    spec: { ...basicSpec(), deadlineMs: 60000 },
    clock,
    signals,
    spawner,
  });
  const child = spawner.children[0]!;
  child.fireSpawn();
  supervisor.cancel();
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cancelled");
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, false);
});

test("F06 cancel() before deadline -> outcome=cancelled", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const clock = manualClock();
  const supervisor = createSupervisor({ spec: { ...basicSpec(), deadlineMs: 10000 }, clock, signals, spawner });
  const child = spawner.children[0]!;
  child.fireSpawn();
  supervisor.cancel();
  const r = await supervisor.await();
  assert.equal(r.outcome.kind, "cancelled");
});

test("F07 repeated cancel is idempotent", async () => {
  const signals = new FakeSignalPort();
  signals.aliveGroups.add(1000);
  const spawner = new FakeSpawnPort();
  const clock = manualClock();
  const supervisor = createSupervisor({ spec: { ...basicSpec(), deadlineMs: 10000 }, clock, signals, spawner });
  const child = spawner.children[0]!;
  child.fireSpawn();
  supervisor.cancel();
  supervisor.cancel();
  supervisor.cancel();
  const r = await supervisor.await();
  assert.equal(r.outcome.kind, "cancelled");
  const termCount = signals.log.filter((e) => e.signal === "SIGTERM").length;
  assert.ok(termCount <= 1, "\"\\\"");
});

test("F08 exit-with-signal -> outcome=signaled", async () => {
  const signals = new FakeSignalPort();
  const spawner = new FakeSpawnPort();
  const clock = manualClock();
  const supervisor = createSupervisor({
    spec: { ...basicSpec(), deadlineMs: 60000 },
    clock,
    signals,
    spawner,
  });
  const child = spawner.children[0]!;
  child.fireSpawn();
  queueMicrotask(() => child.fireClose(null, "SIGKILL"));
  const r = await supervisor.await();
  assert.equal(r.outcome.kind, "signaled");
  if (r.outcome.kind === "signaled") assert.equal(r.outcome.signal, "SIGKILL");
});

