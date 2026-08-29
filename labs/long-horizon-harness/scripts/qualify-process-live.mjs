// scripts/qualify-process-live.mjs
// Strict live-process qualification lane. Refuses to run unless
// the harness can deliver real OS signals to its spawned
// children. Runs the LIVE01..LIVE15 matrix without skips and
// fails on any skip or failure.

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function log(msg) { process.stdout.write(msg + "\n"); }
function fail(msg) { process.stderr.write("qualify:process-live: FAIL: " + msg + "\n"); process.exit(1); }

// POSIX required.
if (process.platform === "win32") fail("platform win32 not supported by this lane");

log("[1/4] probing real-signal capability on this host");
const probe = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 4000)"], { detached: true, stdio: ["ignore", "ignore", "ignore"] });
const probePgid = probe.pid;
if (probePgid === null || probePgid === undefined) fail("probe child has no PID");

try {
  process.kill(-probePgid, 0);
} catch (e) {
  const code = e && typeof e === "object" && "code" in e ? e.code : "unknown";
  if (code === "EPERM") fail("harness denies process.kill(-pgid, ...): code=" + code);
}
try { process.kill(-probePgid, "SIGKILL"); } catch {}

log("[2/4] generating strict live test source");

const strictSource = String.raw`
import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";

import { startSupervised } from "../../src/process/supervised-process.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import { FIXTURE_JS, NODE_RUNTIME, HARNESS_CAN_SIGNAL, makeEnv } from "./helpers.js";

if (!HARNESS_CAN_SIGNAL) { console.error("STRICT-LIVE FAIL: harness blocked"); process.exit(2); }

const spawner = nodeSpawnPort();
const signals = nodeSignalPort();

function basicSpec(args, overrides) {
  if (overrides === undefined) overrides = {};
  return { executable: NODE_RUNTIME, args: [FIXTURE_JS, ...args], cwd: os.tmpdir(), env: makeEnv(), deadlineMs: 60000, termGraceMs: 200, killGraceMs: 200, stdoutLimitBytes: 1024*1024, stderrLimitBytes: 1024*1024, ...overrides };
}

async function run(spec) {
  const r = startSupervised({ spec, clock: realClock(), signals, spawner });
  if (r.ok === false) throw new Error("startSupervised failed");
  return r.value.await();
}

function strictGuard(t) {
  if (!HARNESS_CAN_SIGNAL) {
    t.skip("STRICT-LIVE: harness blocked");
    return false;
  }
  return true;
}

test("LIVE01 exit 0", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["exit", "--code", "0"])); assert.equal(r.outcome.kind, "exited"); });
test("LIVE02 exit nonzero", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["exit", "--code", "42"])); assert.equal(r.outcome.kind, "exited"); if (r.outcome.kind === "exited") assert.equal(r.outcome.exitCode, 42); });
test("LIVE03 spawn ENOENT", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec([], { executable: "/this/path/does/not/exist" })); assert.equal(r.outcome.kind, "spawn_failed"); });
test("LIVE04 cooperative TERM", async (t) => { if (!strictGuard(t)) return; const spec = basicSpec(["sleep", "--ms", "5000"]); const r = startSupervised({ spec, clock: realClock(), signals, spawner }); if (r.ok === false) throw new Error("expected ok"); const sup = r.value; await new Promise((res) => setTimeout(res, 50)); sup.cancel(); const result = await sup.await(); assert.equal(result.outcome.kind, "cancelled"); assert.equal(result.escalation.termSent, true); });
test("LIVE05 ignore TERM -> KILL", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["ignore-term"], { deadlineMs: 250, termGraceMs: 100, killGraceMs: 100, stdoutLimitBytes: 64, stderrLimitBytes: 64 })); assert.equal(r.outcome.kind, "deadline"); if (r.outcome.kind === "deadline") { assert.equal(r.escalation.termSent, true); assert.equal(r.escalation.killSent, true); } });
test("LIVE06 deadline fires", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["sleep", "--ms", "30000"], { deadlineMs: 200 })); assert.equal(r.outcome.kind, "deadline"); });
test("LIVE07 explicit cancel", async (t) => { if (!strictGuard(t)) return; const spec = basicSpec(["sleep", "--ms", "5000"]); const r = startSupervised({ spec, clock: realClock(), signals, spawner }); if (r.ok === false) throw new Error("expected ok"); const sup = r.value; await new Promise((res) => setTimeout(res, 50)); sup.cancel(); const result = await sup.await(); assert.equal(result.outcome.kind, "cancelled"); });
test("LIVE08 descendant tree cleanup", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["spawn-grandchild", "--sleep", "30000"], { deadlineMs: 200, stdoutLimitBytes: 64, stderrLimitBytes: 64 })); assert.equal(r.outcome.kind, "deadline"); assert.equal(r.escalation.finalGroupProbe.kind, "absent"); });
test("LIVE09 group probe after cleanup = absent", async (t) => { if (!strictGuard(t)) return; const spec = basicSpec(["sleep", "--ms", "5000"]); const r = startSupervised({ spec, clock: realClock(), signals, spawner }); if (r.ok === false) throw new Error("expected ok"); const sup = r.value; await new Promise((res) => setTimeout(res, 50)); sup.cancel(); await sup.await(); const handle = sup.handle(); const pgid = handle.processGroupId; if (pgid !== null) { const probe = signals.probeGroup(pgid); assert.equal(probe.kind, "absent"); } });
test("LIVE10 stdout flood", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["flood-stdout", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 })); assert.equal(r.stdout.bytesRetained, 1024); assert.equal(r.stdout.truncated, true); });
test("LIVE11 stderr flood", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["flood-stderr", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 })); assert.equal(r.stderr.bytesRetained, 1024); assert.equal(r.stderr.truncated, true); });
test("LIVE12 mixed flood", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["mixed-output", "--bytes", "20000"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 })); assert.equal(r.stdout.bytesRetained, 1024); assert.equal(r.stderr.bytesRetained, 1024); });
test("LIVE13 invalid UTF-8", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["invalid-utf8"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 })); assert.equal(r.stdout.bytesSeen, 4); });
test("LIVE14 self-signal", async (t) => { if (!strictGuard(t)) return; const r = await run(basicSpec(["crash"])); assert.equal(r.outcome.kind, "signaled"); });
test("LIVE15 negative-PGID signal-zero probe", async (t) => { if (!strictGuard(t)) return; const c = spawn(NODE_RUNTIME, [FIXTURE_JS, "sleep", "--ms", "5000"], { detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ...makeEnv() } }); try { await new Promise((res) => setTimeout(res, 50)); const pgid = c.pid; if (pgid === null || pgid === undefined) throw new Error("no pid"); process.kill(-pgid, 0); } finally { try { c.kill("SIGKILL"); } catch {} } });
`;

mkdirSync(path.join(root, "test", "process"), { recursive: true });
writeFileSync(path.join(root, "test", "process", "_qualify-live.ts"), strictSource);

log("[3/4] running strict typecheck");
const build = spawnSync(path.join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json", "--noEmit"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) fail("tsc strict typecheck failed");

log("[4/4] running strict live tests via tsx");
const test = spawnSync(path.join(root, "node_modules", ".bin", "tsx"), ["--test", "--test-reporter=spec", "--test-timeout=30000", path.join(root, "test", "process", "_qualify-live.ts")], { cwd: root, stdio: "inherit" });
if (test.status !== 0) fail("strict live qualification failed");

log("qualify:process-live: PASS");
process.exit(0);
