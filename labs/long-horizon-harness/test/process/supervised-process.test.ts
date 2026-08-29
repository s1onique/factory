/**
 * supervised-process.test.ts
 * Real OS processes via production supervisor + production ports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";

import { startSupervised } from "../../src/process/supervised-process.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import type { ProcessSpec } from "../../src/process/process-types.js";
import {
  FIXTURE_JS,
  NODE_RUNTIME,
  HARNESS_CAN_SIGNAL,
  makeEnv,
} from "./helpers.js";

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
    deadlineMs: 60000,
    termGraceMs: 100,
    killGraceMs: 100,
    stdoutLimitBytes: 1024 * 1024,
    stderrLimitBytes: 1024 * 1024,
    ...overrides,
  };
}

async function run(
  spec: ProcessSpec,
  events?: (e: import("../../src/process/process-types.js").RuntimeEvent) => void,
): Promise<import("../../src/process/process-types.js").ProcessResult> {
  const r = startSupervised({
    spec,
    clock: realClock(),
    signals,
    spawner,
    ...(events !== undefined ? { sink: events } : {}),
  });
  if (r.ok === false) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value.await();
}

function skipIfBlocked(t: { skip: (msg: string) => void }): boolean {
  if (HARNESS_CAN_SIGNAL) return true;
  t.skip("harness denies process.kill(2); skipping live OS test");
  return false;
}

test("P01 exit 0", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["exit", "--code", "0"]));
  assert.equal(r.outcome.kind, "exited");
  if (r.outcome.kind === "exited") assert.equal(r.outcome.exitCode, 0);
  assert.equal(r.escalation.termSent, false);
  assert.equal(r.escalation.killSent, false);
});

test("P02 exit nonzero is classified as exited", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["exit", "--code", "42"]));
  assert.equal(r.outcome.kind, "exited");
  if (r.outcome.kind === "exited") assert.equal(r.outcome.exitCode, 42);
});

test("P03 spawn nonexistent executable yields spawn_failed", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec([], { executable: "/this/path/definitely/does/not/exist/node" }));
  assert.equal(r.outcome.kind, "spawn_failed");
});

test("P04 invalid cwd is a typed config failure", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["exit", "--code", "0"], { cwd: "/this/cwd/is/not/real" }));
  assert.equal(r.outcome.kind, "spawn_failed");
});

test("P05 cooperative TERM via explicit cancel", async (t) => {
  if (!skipIfBlocked(t)) return;
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  const r = startSupervised({ spec, clock: realClock(), signals, spawner, sink: (e) => events.push(e) });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  await new Promise((res) => setTimeout(res, 50));
  supervisor.cancel();
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cancelled");
  assert.equal(result.escalation.termSent, true);
  assert.equal(result.escalation.killSent, false);
  assert.equal(result.escalation.finalGroupProbe.kind, "absent");
  assert.ok(events.some((e) => e.kind === "signal_sent" && e.signal === "SIGTERM"), "must record SIGTERM signal_sent");
});

test("P06 ignore-TERM fixture escalates to SIGKILL on deadline", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["ignore-term"], { deadlineMs: 250 }));
  assert.equal(r.outcome.kind, "deadline");
  if (r.outcome.kind === "deadline") {
    assert.equal(r.escalation.termSent, true);
    assert.equal(r.escalation.killSent, true);
    assert.equal(r.escalation.finalGroupProbe.kind, "absent");
  }
});

test("P07 deadline classification when sleep exceeds deadline", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["sleep", "--ms", "30000"], { deadlineMs: 200 }));
  assert.equal(r.outcome.kind, "deadline");
});

test("P08 descendant tree cleanup (parent -> child -> grandchild)", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["spawn-grandchild", "--sleep", "30000"], { deadlineMs: 200, stdoutLimitBytes: 64, stderrLimitBytes: 64 }));
  assert.equal(r.outcome.kind, "deadline");
  assert.equal(r.escalation.finalGroupProbe.kind, "absent");
});

test("P09 no process-group orphans after supervisor completion", async (t) => {
  if (!skipIfBlocked(t)) return;
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  await new Promise((res) => setTimeout(res, 50));
  supervisor.cancel();
  await supervisor.await();
  const handle = supervisor.handle();
  const pgid = handle.processGroupId;
  if (pgid !== null) {
    const probe = signals.probeGroup(pgid);
    assert.ok(probe.kind === "absent", "group must be absent after cleanup");
  }
});

test("P10 explicit cancellation API", async (t) => {
  if (!skipIfBlocked(t)) return;
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  await new Promise((res) => setTimeout(res, 50));
  supervisor.cancel();
  const result = await supervisor.await();
  assert.equal(result.outcome.kind, "cancelled");
});

test("P11 repeated cancellation is idempotent", async (t) => {
  if (!skipIfBlocked(t)) return;
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  let termCount = 0;
  const r = startSupervised({ spec, clock: realClock(), signals, spawner, sink: (e) => { if (e.kind === "signal_sent" && e.signal === "SIGTERM") termCount++; } });
  if (r.ok === false) throw new Error("expected ok");
  const supervisor = r.value;
  await new Promise((res) => setTimeout(res, 50));
  supervisor.cancel();
  supervisor.cancel();
  supervisor.cancel();
  await supervisor.await();
  assert.ok(termCount <= 1, "at most 1 SIGTERM");
});

test("P12 exit vs deadline race: deterministic by ordering", async (t) => {
  if (!skipIfBlocked(t)) return;
  const rA = await run(basicSpec(["sleep", "--ms", "120"], { deadlineMs: 5000 }));
  assert.equal(rA.outcome.kind, "exited");
  const rB = await run(basicSpec(["sleep", "--ms", "30000"], { deadlineMs: 200 }));
  assert.equal(rB.outcome.kind, "deadline");
});

test("P13 cancel vs deadline: first trigger wins", async (t) => {
  if (!skipIfBlocked(t)) return;
  const specA = basicSpec(["sleep", "--ms", "30000"]);
  const rA = startSupervised({ spec: { ...specA, deadlineMs: 60000 }, clock: realClock(), signals, spawner });
  if (rA.ok === false) throw new Error("expected ok");
  const supA = rA.value;
  setTimeout(() => supA.cancel(), 30);
  const rAResult = await supA.await();
  assert.equal(rAResult.outcome.kind, "cancelled");
  const specB = basicSpec(["sleep", "--ms", "30000"], { deadlineMs: 150 });
  const rB = startSupervised({ spec: specB, clock: realClock(), signals, spawner });
  if (rB.ok === false) throw new Error("expected ok");
  const supB = rB.value;
  setTimeout(() => supB.cancel(), 5000);
  const rBResult = await supB.await();
  assert.equal(rBResult.outcome.kind, "deadline");
});

test("P14 stdout bounded capture (flood)", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["flood-stdout", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stdout.bytesSeen, 20000);
  assert.equal(r.stdout.bytesRetained, 1024);
  assert.equal(r.stdout.truncated, true);
  assert.equal(r.stdout.buffer.length, 1024);
});

test("P15 stderr bounded capture (flood)", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["flood-stderr", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stderr.bytesSeen, 20000);
  assert.equal(r.stderr.bytesRetained, 1024);
  assert.equal(r.stderr.truncated, true);
});

test("P16 simultaneous stdout/stderr flood does not deadlock", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["mixed-output", "--bytes", "20000"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.ok(r.stdout.bytesSeen >= 1024);
  assert.ok(r.stderr.bytesSeen >= 1024);
  assert.equal(r.stdout.bytesRetained, 1024);
  assert.equal(r.stderr.bytesRetained, 1024);
});

test("P17 invalid UTF-8 capture does not break runtime", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["invalid-utf8"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stdout.bytesSeen, 4);
  assert.equal(r.stdout.bytesRetained, 4);
  assert.equal(r.stdout.truncated, false);
  const decoded = r.stdout.buffer.toString("utf8");
  assert.equal(typeof decoded, "string");
});

test("P18 process self-signal/crash is classified as signaled", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = await run(basicSpec(["crash"]));
  assert.equal(r.outcome.kind, "signaled");
});

test("P19 bad PGID rejected before signalling", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = signals.signalGroup(-1, "SIGTERM");
  assert.equal(r.kind, "error");
  if (r.kind === "error") assert.equal(r.code, "EINVAL");
});

test("P20 eager spawn event: process_spawned only after Node spawn", async (t) => {
  if (!skipIfBlocked(t)) return;
  const events: import("../../src/process/process-types.js").RuntimeEvent[] = [];
  await run(basicSpec(["echo-pid"], { stdoutLimitBytes: 1024 }), (e) => events.push(e));
  assert.ok(events.some((e) => e.kind === "process_spawn_started"), "must emit spawn_started");
  assert.ok(events.some((e) => e.kind === "process_spawned"), "must emit process_spawned after Node spawn");
  assert.ok(!events.some((e) => e.kind === "process_spawn_failed"), "must NOT emit spawn_failed on success");
});

test("P21 invalid spec returns Result error, NOT a fake cleanup_failed", async (t) => {
  if (!skipIfBlocked(t)) return;
  const r = startSupervised({ spec: { ...basicSpec(["exit", "--code", "0"]), deadlineMs: 0 }, clock: realClock(), signals, spawner });
  assert.ok(r.ok === false, "expected Result.error");
  if (r.ok === false) assert.equal(r.error.kind, "invalid_process_spec");
});
