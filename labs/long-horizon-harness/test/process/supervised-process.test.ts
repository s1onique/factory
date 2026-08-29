/**
 * supervised-process.test.ts
 * Adversarial subprocess supervision suite (P01..P20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { createSupervisor } from "../../src/process/supervised-process.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import type { ProcessSpec } from "../../src/process/process-types.js";
import type { ProcessResult } from "../../src/process/process-types.js";
import type { RuntimeEvent } from "../../src/process/process-ports.js";
import { FIXTURE_JS, NODE_RUNTIME, FAST_BUDGET, catastrophicWatchdog, makeEnv, requireSignalCapability } from "./helpers.js";

const spawner = nodeSpawnPort();
const signals = nodeSignalPort();

function basicSpec(
  args: string[],
  overrides: Partial<ProcessSpec> = {},
): ProcessSpec {
  return {
    executable: NODE_RUNTIME,
    args: [FIXTURE_JS, ...args],
    cwd: os.tmpdir(),
    env: makeEnv(),
    deadlineMs: FAST_BUDGET.deadlineMs,
    termGraceMs: FAST_BUDGET.termGraceMs,
    killGraceMs: FAST_BUDGET.killGraceMs,
    stdoutLimitBytes: 1024 * 1024,
    stderrLimitBytes: 1024 * 1024,
    ...overrides,
  };
}

async function run(
  spec: ProcessSpec,
  events?: (e: RuntimeEvent) => void,
): Promise<ProcessResult> {
  const supervisor =
    events === undefined
      ? createSupervisor({ spec, clock: realClock(), signals, spawner })
      : createSupervisor({
          spec,
          clock: realClock(),
          signals,
          spawner,
          sink: events,
        });
  return supervisor.await();
}

test("P01 exit 0", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  try {
    const result = await run(basicSpec(["exit", "--code", "0"]));
    assert.equal(result.outcome.kind, "exited");
    if (result.outcome.kind === "exited") assert.equal(result.outcome.exitCode, 0);
    assert.equal(result.escalation.termSent, false);
    assert.equal(result.escalation.killSent, false);
  } finally { wd.cancel(); }
});

test("P02 exit nonzero is classified as exited (not spawn_failed)", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  try {
    const result = await run(basicSpec(["exit", "--code", "42"]));
    assert.equal(result.outcome.kind, "exited");
    if (result.outcome.kind === "exited") assert.equal(result.outcome.exitCode, 42);
    assert.equal(result.escalation.termSent, false);
  } finally { wd.cancel(); }
});

test("P03 spawn nonexistent executable", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  try {
    const result = await run(basicSpec([], { executable: "/this/path/definitely/does/not/exist/node" }));
    assert.equal(result.outcome.kind, "spawn_failed");
  } finally { wd.cancel(); }
});

test("P04 invalid cwd is a typed config failure", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  try {
    const result = await run(basicSpec(["exit", "--code", "0"], { cwd: "/this/cwd/is/not/real" }));
    assert.equal(result.outcome.kind, "spawn_failed");
  } finally { wd.cancel(); }
});

test("P05 cooperative SIGTERM via explicit cancel", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const spec = basicSpec(["sleep", "--ms", "5000"], { deadlineMs: 10000 });
  const events: RuntimeEvent[] = [];
  const supervisor = createSupervisor({ spec, clock: realClock(), signals, spawner, sink: (e) => events.push(e) });
  try {
    await new Promise((r) => setTimeout(r, 50));
    supervisor.cancel();
    const result = await supervisor.await();
    assert.equal(result.outcome.kind, "cancelled");
    assert.equal(result.escalation.termSent, true);
    assert.equal(result.escalation.killSent, false);
    assert.equal(result.escalation.finalGroupProbe.kind, "absent");
    assert.ok(events.some((e) => e.kind === "signal_sent" && e.signal === "SIGTERM"), "\"must record SIGTERM signal_sent event\"");
  } finally { wd.cancel(); }
});

test("P06 ignore-TERM fixture escalates to SIGKILL on deadline", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["ignore-term"], { deadlineMs: 250, termGraceMs: 100, killGraceMs: 100, stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(result.outcome.kind, "deadline");
  if (result.outcome.kind === "deadline") {
    assert.equal(result.escalation.termSent, true);
    assert.equal(result.escalation.killSent, true);
    assert.equal(result.escalation.finalGroupProbe.kind, "absent");
  }
  wd.cancel();
});

test("P07 deadline classification when sleep exceeds deadline", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["sleep", "--ms", "30000"], { deadlineMs: 200, termGraceMs: 50, killGraceMs: 50 }));
  assert.equal(result.outcome.kind, "deadline");
  wd.cancel();
});

test("P08 descendant tree cleanup (parent child grandchild)", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["spawn-grandchild", "--sleep", "30000"], { deadlineMs: 200, termGraceMs: 100, killGraceMs: 100, stdoutLimitBytes: 64, stderrLimitBytes: 64 }));
  assert.equal(result.outcome.kind, "deadline");
  assert.equal(result.escalation.finalGroupProbe.kind, "absent");
  wd.cancel();
});

test("P09 no process-group orphans after supervisor completion", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const spec = basicSpec(["sleep", "--ms", "5000"], { deadlineMs: 10000 });
  const supervisor = createSupervisor({ spec, clock: realClock(), signals, spawner });
  await new Promise((r) => setTimeout(r, 50));
  supervisor.cancel();
  await supervisor.await();
  const handle = supervisor.handle();
  const pgid = handle.processGroupId;
  if (pgid !== null) {
    const probe = signals.probeGroup(pgid);
    assert.equal(probe.kind, "absent");
  }
  wd.cancel();
});

test("P10 explicit cancellation API (separate from deadline)", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const spec = basicSpec(["sleep", "--ms", "5000"], { deadlineMs: 10000 });
  const supervisor = createSupervisor({ spec, clock: realClock(), signals, spawner });
  try {
    await new Promise((r) => setTimeout(r, 50));
    supervisor.cancel();
    const result = await supervisor.await();
    assert.equal(result.outcome.kind, "cancelled");
  } finally { wd.cancel(); }
});

test("P11 repeated cancellation is idempotent (no kill storm)", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const spec = basicSpec(["sleep", "--ms", "5000"], { deadlineMs: 10000 });
  let termCount = 0;
  const supervisor = createSupervisor({ spec, clock: realClock(), signals, spawner, sink: (e) => { if (e.kind === "signal_sent" && e.signal === "SIGTERM") termCount++; } });
  try {
    await new Promise((r) => setTimeout(r, 50));
    supervisor.cancel();
    supervisor.cancel();
    supervisor.cancel();
    await supervisor.await();
    assert.ok(termCount <= 1, "\"\\\"");
  } finally { wd.cancel(); }
});

test("P12 cancel vs deadline race: first terminal trigger wins", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const spec = basicSpec(["sleep", "--ms", "5000"], { deadlineMs: 100, termGraceMs: 50, killGraceMs: 50 });
  const supervisor = createSupervisor({ spec, clock: realClock(), signals, spawner });
  setTimeout(() => supervisor.cancel(), 20);
  const result = await supervisor.await();
  assert.ok(result.outcome.kind === "cancelled" || result.outcome.kind === "deadline");
  wd.cancel();
});

test("P13 exit vs deadline race: exactly one authoritative outcome", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["sleep", "--ms", "120"], { deadlineMs: 200, termGraceMs: 100, killGraceMs: 100 }));
  assert.ok(result.outcome.kind === "exited" || result.outcome.kind === "deadline");
  wd.cancel();
});

test("P14 stdout bounded capture (flood)", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["flood-stdout", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024, deadlineMs: 5000, termGraceMs: 100, killGraceMs: 100 }));
  assert.equal(result.stdout.bytesSeen, 20000);
  assert.equal(result.stdout.bytesRetained, 1024);
  assert.equal(result.stdout.truncated, true);
  assert.equal(result.stdout.buffer.length, 1024);
  wd.cancel();
});

test("P15 stderr bounded capture (flood)", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["flood-stderr", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024, deadlineMs: 5000 }));
  assert.equal(result.stderr.bytesSeen, 20000);
  assert.equal(result.stderr.bytesRetained, 1024);
  assert.equal(result.stderr.truncated, true);
  wd.cancel();
});

test("P16 simultaneous stdout/stderr flood does not deadlock", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["mixed-output", "--bytes", "20000"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024, deadlineMs: 5000 }));
  assert.ok(result.stdout.bytesSeen >= 1024);
  assert.ok(result.stderr.bytesSeen >= 1024);
  assert.equal(result.stdout.bytesRetained, 1024);
  assert.equal(result.stderr.bytesRetained, 1024);
  wd.cancel();
});

test("P17 invalid UTF-8 capture does not break runtime", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["invalid-utf8"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024, deadlineMs: 5000 }));
  assert.equal(result.stdout.bytesSeen, 4);
  assert.equal(result.stdout.bytesRetained, 4);
  assert.equal(result.stdout.truncated, false);
  const decoded = result.stdout.buffer.toString("utf8");
  assert.equal(typeof decoded, "string");
  wd.cancel();
});

test("P18 process self-signal/crash is classified as signaled", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const result = await run(basicSpec(["crash"], { deadlineMs: 5000 }));
  assert.equal(result.outcome.kind, "signaled");
  wd.cancel();
});

test("P19 bad PGID rejected before signalling (negative PGID safety)", () => {
  const result = signals.signalGroup(-1, "SIGTERM");
  assert.equal(result.kind, "error");
  if (result.kind === "error") assert.equal(result.code, "EINVAL");
});

test("P20 signal-zero group probe on live detached fixture", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const { spawn } = await import("node:child_process");
  const child = spawn(NODE_RUNTIME, [FIXTURE_JS, "sleep", "--ms", "5000"], { detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ... makeEnv() } });
  try {
    await new Promise((r) => setTimeout(r, 50));
    const pgid = child.pid ?? null;
    if (pgid === null) throw new Error("no pid");
    const probe = signals.probeGroup(pgid);
    assert.ok(probe.kind === "alive" || probe.kind === "permission_denied", "\"\\\"");
    signals.signalGroup(pgid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    wd.cancel();
  }
});
