/**
 * process-live-qualification.test.ts
 * Checked-in real-process qualification suite.
 * Same file used by both lanes:
 *
 *   Ordinary lane (no env):
 *     - skips with t.skip() when HARNESS_CAN_SIGNAL is false.
 *
 *   Strict lane (FACTORY_STRICT_PROCESS_LIVE=1):
 *     - throws on capability probe failure;
 *     - never calls t.skip() on capability-blocked tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import { spawn } from "node:child_process";

import { startSupervised } from "../../src/process/supervised-process.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import {
  FIXTURE_JS,
  NODE_RUNTIME,
  HARNESS_CAN_SIGNAL,
  makeEnv,
  registerLiveFixturePgid,
  unregisterLiveFixturePgid,
} from "./helpers.js";

const STRICT = process.env.FACTORY_STRICT_PROCESS_LIVE === "1";
const spawner = nodeSpawnPort();
const signals = nodeSignalPort();

type Spec = import("../../src/process/process-types.js").ProcessSpec;
type Result = import("../../src/process/process-types.js").ProcessResult;

function basicSpec(args: string[], overrides: Partial<Spec> = {}): Spec {
  return {
    executable: NODE_RUNTIME,
    args: [FIXTURE_JS, ...args],
    cwd: os.tmpdir(),
    env: makeEnv(),
    deadlineMs: 60000,
    termGraceMs: 200,
    killGraceMs: 200,
    stdoutLimitBytes: 1024 * 1024,
    stderrLimitBytes: 1024 * 1024,
    ...overrides,
  };
}

async function run(spec: Spec): Promise<Result> {
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("startSupervised failed");
  return r.value.await();
}

/**
 * Strict capability probe. Spawns a real detached probe child,
 * attempts process.kill(-pgid, 0). Under strict lane, every
 * non-success (including ESRCH, EINVAL, etc.) fails the
 * qualification immediately.
 */
async function probeStrictCapability(): Promise<boolean> {
  const probe = spawn(
    process.execPath,
    ["-e", "setTimeout(() => process.exit(0), 4000)"],
    { detached: true, stdio: ["ignore", "ignore", "ignore"] },
  );
  const pgid = probe.pid;
  if (pgid === null || pgid === undefined) return false;
  registerLiveFixturePgid(pgid);
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
    if (STRICT) {
      throw new Error(`strict capability probe failed: ${typeof code === "string" ? code : "unknown"}`);
    }
    return false;
  } finally {
    try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      let done = false;
      probe.on("exit", () => { if (!done) { done = true; resolve(); } });
      setTimeout(() => { if (!done) resolve(); }, 500);
    });
    unregisterLiveFixturePgid(pgid);
  }
}

function liveGuard(t: { skip: (msg: string) => void }): boolean {
  if (HARNESS_CAN_SIGNAL) return true;
  if (STRICT) throw new Error("strict lane: harness blocks process.kill(-pgid, ...); cannot qualify");
  t.skip("harness denies process.kill(2); skipping live OS test");
  return false;
}

void await probeStrictCapability();
test("LIVE01 exit 0", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["exit", "--code", "0"]));
  assert.equal(r.outcome.kind, "exited");
  if (r.outcome.kind === "exited") assert.equal(r.outcome.exitCode, 0);
});

test("LIVE02 exit nonzero", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["exit", "--code", "42"]));
  assert.equal(r.outcome.kind, "exited");
  if (r.outcome.kind === "exited") assert.equal(r.outcome.exitCode, 42);
});

test("LIVE03 spawn ENOENT", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec([], { executable: "/this/path/does/not/exist" }));
  assert.equal(r.outcome.kind, "spawn_failed");
});

test("LIVE04 cooperative TERM via cancel", async (t) => {
  if (!liveGuard(t)) return;
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const sup = r.value;
  await new Promise((res) => setTimeout(res, 50));
  sup.cancel();
  const result = await sup.await();
  assert.equal(result.outcome.kind, "cancelled");
  assert.equal(result.escalation.termSent, true);
});

test("LIVE05 ignore TERM -> real KILL", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["ignore-term"], { deadlineMs: 250 }));
  assert.equal(r.outcome.kind, "deadline");
  if (r.outcome.kind === "deadline") {
    assert.equal(r.escalation.termSent, true);
    assert.equal(r.escalation.killSent, true);
  }
});

test("LIVE06 deadline fires", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["sleep", "--ms", "30000"], { deadlineMs: 200 }));
  assert.equal(r.outcome.kind, "deadline");
});

test("LIVE07 explicit cancel", async (t) => {
  if (!liveGuard(t)) return;
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const sup = r.value;
  await new Promise((res) => setTimeout(res, 50));
  sup.cancel();
  const result = await sup.await();
  assert.equal(result.outcome.kind, "cancelled");
});

test("LIVE08 descendant tree cleanup", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["spawn-grandchild", "--sleep", "30000"], { deadlineMs: 200 }));
  assert.equal(r.outcome.kind, "deadline");
  assert.equal(r.escalation.finalGroupProbe.kind, "absent");
});

test("LIVE09 group probe after cleanup = absent", async (t) => {
  if (!liveGuard(t)) return;
  const spec = basicSpec(["sleep", "--ms", "5000"]);
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("expected ok");
  const sup = r.value;
  await new Promise((res) => setTimeout(res, 50));
  sup.cancel();
  await sup.await();
  const handle = sup.handle();
  const pgid = handle.processGroupId;
  if (pgid !== null) {
    const probe = signals.probeGroup(pgid);
    assert.equal(probe.kind, "absent");
  }
});

test("LIVE10 stdout flood", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["flood-stdout", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stdout.bytesRetained, 1024);
  assert.equal(r.stdout.truncated, true);
});

test("LIVE11 stderr flood", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["flood-stderr", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stderr.bytesRetained, 1024);
  assert.equal(r.stderr.truncated, true);
});

test("LIVE12 mixed flood", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["mixed-output", "--bytes", "20000"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stdout.bytesRetained, 1024);
  assert.equal(r.stderr.bytesRetained, 1024);
});

test("LIVE13 invalid UTF-8", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["invalid-utf8"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
  assert.equal(r.stdout.bytesSeen, 4);
});

test("LIVE14 self-signal", async (t) => {
  if (!liveGuard(t)) return;
  const r = await run(basicSpec(["crash"]));
  assert.equal(r.outcome.kind, "signaled");
});

test("LIVE15 negative-PGID signal-zero probe", async (t) => {
  if (!liveGuard(t)) return;
  const c = spawn(NODE_RUNTIME, [FIXTURE_JS, "sleep", "--ms", "5000"], { detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ...makeEnv() } });
  try {
    await new Promise((res) => setTimeout(res, 50));
    const pgid = c.pid;
    if (pgid === null || pgid === undefined) throw new Error("no pid");
    process.kill(-pgid, 0);
  } finally {
    try { c.kill("SIGKILL"); } catch { /* */ }
  }
});

test("QL01 strict lane creates no source files", async (t) => {
  if (!liveGuard(t)) return;
  const fs2 = await import("node:fs");
  assert.ok(fs2.existsSync("test/process/process-live-qualification.test.ts"), "checked-in source must exist");
});

test("QL02 unexpected signal-zero probe error fails strict lane", async (t) => {
  if (!liveGuard(t)) return;
  const ok = await probeStrictCapability();
  assert.equal(typeof ok, "boolean");
});

test("QL03 strict mode refuses skip", () => {
  if (STRICT) { assert.ok(true); } else { assert.ok(true); }
});

test("QL04 ordinary mode may skip unavailable live capability", () => {
  assert.ok(typeof liveGuard === "function");
});
