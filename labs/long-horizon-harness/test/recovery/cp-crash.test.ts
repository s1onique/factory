/**
 * FOUNDATION03 strict recovery live qualification lane (CORRECTION05).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlLedger } from "../../src/evidence/jsonl-ledger.js";

const STRICT = process.env.FACTORY_STRICT_RECOVERY_LIVE === "1";
// CORRECTION06 §35: record the qualification subject commit.
emitStdout({ kind: "QUALIFICATION_SUBJECT_COMMIT", value: process.env.QUALIFICATION_SUBJECT_COMMIT ?? "<unset>" });
const RECOVERY_LIVE_REQUIRED = 9;

interface MatrixState { required: number; executed: number; passed: number; failed: number; skipped: number; residue: number; }
const matrix: MatrixState = { required: RECOVERY_LIVE_REQUIRED, executed: 0, passed: 0, failed: 0, skipped: 0, residue: 0 };

function emitStdout(rec: unknown) { process.stdout.write(JSON.stringify(rec) + "\n"); }
function isIntegerGt1(v: unknown) { return typeof v === "number" && Number.isInteger(v) && v > 1; }
type BarrierRecord = { kind: "barrier"; point: string; test_owned_pgid?: number; supervisor_pid?: number; outcome_kind?: string };
type OwnershipFailureRecord = { kind: "ownership_failure_observed"; point: string; observedPgid: number; observedPid: number; outerKind: string; supervisorPid: number };
type RestartRecord = { kind: "restart_result"; state: string; processId?: string; decision?: string; signals?: number; kernelProbes?: number; error?: string | null; restart_pid: number };


function parseBarrierLine(line: string): BarrierRecord | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!("kind" in r)) return null;
  if (r.kind !== "barrier") return null;
  // CORRECTION05 §23: malformed control evidence fails the test.
  // If a JSON object has kind=barrier but required field types are
  // wrong, the helper is broken — must not be silently ignored.
  if (typeof r.point !== "string") throw new Error("malformed barrier: point must be string");
  const out: BarrierRecord = { kind: "barrier", point: r.point };
  if ("supervisor_pid" in r && r.supervisor_pid !== undefined && typeof r.supervisor_pid !== "number") throw new Error("malformed barrier: supervisor_pid must be number when present");
  if (typeof r.supervisor_pid === "number") out.supervisor_pid = r.supervisor_pid;
  if (typeof r.test_owned_pgid === "number") out.test_owned_pgid = r.test_owned_pgid;
  if (typeof r.outcome_kind === "string") out.outcome_kind = r.outcome_kind;
  return out;
}

function parseOwnershipFailureLine(line: string): OwnershipFailureRecord | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "ownership_failure_observed") return null;
  if (typeof r.point !== "string" || typeof r.observedPgid !== "number" || typeof r.observedPid !== "number" || typeof r.outerKind !== "string" || typeof r.supervisorPid !== "number") throw new Error("malformed ownership_failure_observed");
  const out: OwnershipFailureRecord = { kind: "ownership_failure_observed", point: r.point, observedPgid: r.observedPgid, observedPid: r.observedPid, outerKind: r.outerKind, supervisorPid: r.supervisorPid };
  return out;
}

function parseRestartLine(line: string): RestartRecord | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "restart_result") return null;
  if (typeof r.state !== "string" || typeof r.restart_pid !== "number") throw new Error("malformed restart_result");
  const out: RestartRecord = { kind: "restart_result", state: r.state, restart_pid: r.restart_pid };
  if (typeof r.processId === "string") out.processId = r.processId;
  if (typeof r.decision === "string") out.decision = r.decision;
  if (typeof r.signals === "number") out.signals = r.signals;
  if (typeof r.kernelProbes === "number") out.kernelProbes = r.kernelProbes;
  if (r.error === null || typeof r.error === "string") out.error = r.error;
  return out;
}

// Fixture-precondition law (CORRECTION10):
//   A test must construct every filesystem precondition
//   it requires; existence created by another test, a
//   previous command, or a developer workspace is NOT a
//   valid fixture. .tmp-home is owned by THIS test
//   process; we create it recursively before mkdtemp
//   because mkdtemp does not create missing parents.
//
// The helper accepts an optional `base` parameter so
// the fixture-precondition oracle (REC-TMP01) can use
// a hermetic parent that definitely does not exist
// before the call, without affecting the run-dir base
// the rest of the matrix relies on.
const TMP_HOME_BASE = join(process.cwd(), ".tmp-home", "cpcrash");
async function tmpDir(base: string = TMP_HOME_BASE): Promise<string> {
  await fs.mkdir(base, { recursive: true });
  return await fs.mkdtemp(join(base, "run-"));
}

interface CrashOutcome { exitCode: number | null; signal: NodeJS.Signals | null; barrier: BarrierRecord | null; ownership: OwnershipFailureRecord | null; stderr: string; stdout: string; }
async function runCrashSupervisor(opts: { runDir: string; attemptId: string; processId: string; crashPoint: "CP03" | "CP04" | "CP06" | "CP07" | "CP10" }): Promise<CrashOutcome> {
  return await new Promise<CrashOutcome>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      join(process.cwd(), "test", "recovery", "_crash_supervisor.ts"),
      "--run-dir", opts.runDir,
      "--attempt-id", opts.attemptId,
      "--process-id", opts.processId,
      "--crash-point", opts.crashPoint,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      let barrier: BarrierRecord | null = null, ownership: OwnershipFailureRecord | null = null;
      for (const line of stdout.split("\n")) {
        if (line.length === 0) continue;
        const b = parseBarrierLine(line);
        if (b !== null) barrier = b;
        const o = parseOwnershipFailureLine(line);
        if (o !== null) ownership = o;
      }
      resolve({ exitCode: code, signal, barrier, ownership, stderr, stdout });
    });
  });
}

interface RestartOutcome { exitCode: number | null; signal: NodeJS.Signals | null; report: RestartRecord | null; stderr: string; stdout: string; }
async function runRestartHelper(runDir: string): Promise<RestartOutcome> {
  return await new Promise<RestartOutcome>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      join(process.cwd(), "test", "recovery", "_recovery_restart.ts"),
      "--run-dir", runDir,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      let report: RestartRecord | null = null;
      for (const line of stdout.split("\n")) {
        if (line.length === 0) continue;
        const r = parseRestartLine(line);
        if (r !== null) report = r;
      }
      resolve({ exitCode: code, signal, report, stderr, stdout });
    });
  });
}

type LedgerDecision = { spawn_requested: boolean; spawned: boolean; result: boolean };
type LedgerInspectResult = { ok: true; decision: LedgerDecision } | { ok: false; error: string };
async function inspectLedger(runDir: string, attemptId: string, processId: string): Promise<LedgerInspectResult> {
  // CORRECTION06 §14/§15: ledger I/O failures must fail closed.
  // An unreadable ledger is NOT a valid CP03/CP04 state.
  const ledger = new JsonlLedger(runDir);
  const openR = await ledger.open({ createIfMissing: false });
  if (!openR.ok) return { ok: false, error: "ledger_open_failed:" + JSON.stringify(openR.error) };
  const r = await ledger.readAll();
  if (!r.ok) return { ok: false, error: "ledger_read_failed:" + JSON.stringify(r.error) };
  const envs = r.value;
  let spawn_requested = false, spawned = false, result = false;
  for (const env of envs) {
    if (env.schema_version === 2 && env.kind === "process_evidence" && env.process_evidence.attempt_id === attemptId && env.process_evidence.process_id === processId) {
      const k = env.process_evidence.kind;
      if (k === "process_spawn_requested") spawn_requested = true;
      if (k === "process_spawned") spawned = true;
      if (k === "process_result_committed") result = true;
    }
  }
  return { ok: true, decision: { spawn_requested, spawned, result } };
}

interface PgidRegistry { register: (pgid: number) => void; cleanup: () => Promise<{ residue: number; details: ReadonlyArray<{ pgid: number; state: string; code: string | null }> }>; }

function newRegistry(): PgidRegistry {
  const pgids = new Set<number>();
  return {
    register: (pgid) => { if (pgid > 1) pgids.add(pgid); },
    cleanup: async () => {
      const details: Array<{ pgid: number; state: string; code: string | null }> = [];
      for (const pgid of pgids) {
        try { process.kill(-pgid, 0); details.push({ pgid, state: "alive", code: null }); }
        catch (e: unknown) {
          const code = (e as { code?: unknown }).code ? String((e as { code?: unknown }).code) : null;
          if (code === "ESRCH") { details.push({ pgid, state: "absent", code }); pgids.delete(pgid); }
          else { details.push({ pgid, state: (code === "EPERM" || code === "EACCES") ? "denied" : "error", code }); }
        }
      }
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && pgids.size > 0) {
        for (const pgid of pgids) { try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ } }
        await new Promise<void>((res) => setTimeout(res, 50));
        for (const pgid of pgids) {
          try { process.kill(-pgid, 0); } catch (e: unknown) { const code = (e as { code?: unknown }).code ? String((e as { code?: unknown }).code) : null; if (code === "ESRCH") pgids.delete(pgid); }
        }
      }
      return { residue: pgids.size, details };
    },
  };
}

const registry = newRegistry();

after(async () => {
  const { residue } = await registry.cleanup();
  if (residue > 0 && matrix.residue === 0) matrix.residue = residue;
});

let noteCallCount = 0;
function note(r: { executed: boolean; passed: boolean; skipped: boolean; reason?: string }) {
  noteCallCount++;
  if (r.skipped) { matrix.skipped++; }
  else { matrix.executed++; if (r.passed) matrix.passed++; else matrix.failed++; }
  process.stdout.write(JSON.stringify({ noteCallCount: noteCallCount, executed: matrix.executed, passed: matrix.passed, failed: matrix.failed, skipped: matrix.skipped, residue: matrix.residue, lastPassed: r.passed, lastSkipped: r.skipped, lastReason: r.reason || null }) + "\n");
}

async function recordLedgerDecision(runDir: string, attemptId: string, processId: string): Promise<LedgerDecision | { error: string }> {
  const r = await inspectLedger(runDir, attemptId, processId);
  if (!r.ok) return { error: r.error };
  return r.decision;
}

// REC-TMP01..03 (CORRECTION10):
//   Fixture-precondition oracles. The fresh-worktree
//   failure (.tmp-home missing) was masked by ambient
//   state on developer workspaces. These oracles
//   MEASURE the precondition law mechanically:
//
//     REC-TMP01: with .tmp-home/cpcrash absent,
//                tmpDir() succeeds (it owns the parent).
//     REC-TMP02: tmpDir() always returns a unique path
//                across N invocations.
//     REC-TMP03: cleaning each returned dir leaves
//                .tmp-home/cpcrash present (the parent
//                survives children — proves the helper
//                does not accidentally rmdir the parent).
test("REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent", async () => {
  // Hermetic parent seam (CORRECTION10 refinement): use a
  // base directory that this test process knows does not
  // exist (a fresh tmpdir-anchored path), so the assertion
  // "parent was absent before tmpDir()" can be proved
  // mechanically instead of inferring from test order.
  //
  // We do NOT touch the shared TMP_HOME_BASE; an isolated
  // base cannot interfere with concurrent REC-LIVE tests
  // and supports reproducibility from a clean worktree.
  //
  // CORRECTION12: the seam's *root* must be created under
  // a parent that is GUARANTEED to exist on every host —
  // os.tmpdir() per Node's documented examples
  // (https://nodejs.org/api/fs.html#fsmkdtempprefix-options-callback).
  // process.cwd()/.tmp-home may not exist on a clean
  // worktree, and fs.mkdtemp does not recursively create
  // missing parents; calling mkdtemp with a missing
  // grandparent therefore throws ENOENT and the test
  // fails for fixture-construction reasons rather than
  // qualifying the helper. os.tmpdir() is the only Node-
  // documented seam that is always present.
  const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));
  const absentBase = join(tmpRoot, "absent-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));
  // Mechanical absence proof (no `void pre;`): the lstat
  // MUST throw ENOENT before the helper call.
  await assert.rejects(
    async () => { await fs.lstat(absentBase); },
    (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT",
    "REC-TMP01[pre]: the hermetic parent path MUST be absent before tmpDir()",
  );
  // Now exercise the helper. If it throws ENOENT, the
  // fixture-precondition law is broken.
  const d = await tmpDir(absentBase);
  try {
    const parentStat = await fs.lstat(absentBase);
    assert.equal(parentStat.isDirectory(), true,
      `REC-TMP01: ${absentBase} must be a directory after tmpDir(base)`);
    const childStat = await fs.lstat(d);
    assert.equal(childStat.isDirectory(), true,
      `REC-TMP01: ${d} must be the freshly created run dir`);
    assert.ok(d.startsWith(absentBase + "/") || d.startsWith(absentBase + "\\"),
      `REC-TMP01: ${d} must be located under ${absentBase}`);
  } finally {
    // Clean up the entire hermetic root (parent + child).
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test("REC-TMP02: tmpDir() returns a unique dir per call", async () => {
  const N = 5;
  const seen = new Set<string>();
  const all: string[] = [];
  for (let i = 0; i < N; i += 1) {
    const d = await tmpDir();
    assert.equal(seen.has(d), false,
      `REC-TMP02: duplicate dir returned: ${d}`);
    seen.add(d);
    all.push(d);
  }
  // Verify each exists and is a directory.
  for (const d of all) {
    const s = await fs.lstat(d);
    assert.equal(s.isDirectory(), true,
      `REC-TMP02: ${d} must exist as a directory`);
  }
  for (const d of all) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

test("REC-TMP03: removing a tmpDir() child leaves the parent intact", async () => {
  const parent = join(process.cwd(), ".tmp-home", "cpcrash");
  const d = await tmpDir();
  assert.equal((await fs.lstat(d)).isDirectory(), true,
    "REC-TMP03: precondition — child dir must exist before removal");
  await fs.rm(d, { recursive: true, force: true });
  const still = await fs.lstat(parent);
  assert.equal(still.isDirectory(), true,
    `REC-TMP03: parent ${parent} must still be a directory after child removal ` +
    `(tmpDir helper must not accidentally remove the parent)`);
});

function probePid(pid: number): { state: "absent" | "alive" | "denied" | "error"; code: string | null } {
  try { process.kill(pid, 0); return { state: "alive", code: null }; }
  catch (e: unknown) { const code = (e as { code?: unknown }).code ? String((e as { code?: unknown }).code) : null; if (code === "ESRCH") return { state: "absent", code }; if (code === "EPERM" || code === "EACCES") return { state: "denied", code }; return { state: "error", code }; }
}

function probePgid(pgid: number): { state: "absent" | "alive" | "denied" | "error"; code: string | null } {
  try { process.kill(-pgid, 0); return { state: "alive", code: null }; }
  catch (e: unknown) { const code = (e as { code?: unknown }).code ? String((e as { code?: unknown }).code) : null; if (code === "ESRCH") return { state: "absent", code }; if (code === "EPERM" || code === "EACCES") return { state: "denied", code }; return { state: "error", code }; }
}

test("REC-LIVE01 supervisor abrupt death + detached child survives", async () => {
  const dir = await tmpDir();
  try {
    const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl01", processId: "p-rl01", crashPoint: "CP04" });
    if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined) registry.register(r.barrier.test_owned_pgid);
    if (r.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected abrupt crash exit 137, got " + r.exitCode }); return; }
    if (r.barrier === null || r.barrier.supervisor_pid === undefined) { note({ executed: true, passed: false, skipped: false, reason: "missing barrier or supervisor_pid" }); return; }
    const oldPid = r.barrier.supervisor_pid;
    const pgid = r.barrier.test_owned_pgid;
    if (pgid === undefined) { note({ executed: true, passed: false, skipped: false, reason: "missing test_owned_pgid" }); return; }
    await new Promise<void>((res) => setTimeout(res, 50));
    const pidProbe = probePid(oldPid);
    if (pidProbe.state !== "absent") { note({ executed: true, passed: false, skipped: false, reason: "old supervisor still present: " + JSON.stringify(pidProbe) }); return; }
    const pgidProbe = probePgid(pgid);
    // CORRECTION06 §7: alive = survived; denied = BLOCKED_BY_ENVIRONMENT (NOT survival proof).
    if (pgidProbe.state === "denied") {
      matrix.skipped++;
      process.stdout.write("[note-skipped-blocked-by-env] REC-LIVE01 sandbox cannot probe -pgid\n");
      return;
    }
    if (pgidProbe.state !== "alive") { note({ executed: true, passed: false, skipped: false, reason: "detached group NOT alive: " + JSON.stringify(pgidProbe) }); return; }
    note({ executed: true, passed: true, skipped: false });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("REC-LIVE02 durable process_spawned -> in_flight_at_crash on restart", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl02", processId: "p-rl02", crashPoint: "CP04" }); if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined) registry.register(r.barrier.test_owned_pgid); if (r.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected CP04 abrupt crash exit 137" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl02", "p-rl02"); if ("error" in ledger) { note({ executed: true, passed: false, skipped: false, reason: ledger.error }); return; } if (!ledger.spawn_requested) { note({ executed: true, passed: false, skipped: false, reason: "missing spawn_requested" }); return; } if (!ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "missing process_spawned" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper exited non-zero: " + rr.stderr }); return; } if (rr.report === null) { note({ executed: true, passed: false, skipped: false, reason: "no restart_result" }); return; } if (rr.report.state !== "in_flight_at_crash") { note({ executed: true, passed: false, skipped: false, reason: "expected in_flight_at_crash, got " + rr.report.state }); return; } if ((rr.report.signals ?? -1) !== 0) { note({ executed: true, passed: false, skipped: false, reason: "expected signals=0" }); return; } const kp = rr.report.kernelProbes ?? -1; if (kp < 1) { note({ executed: true, passed: false, skipped: false, reason: "expected kernelProbes>=1" }); return; } if (rr.report.decision === "historical_group_probe_denied") { matrix.skipped++; process.stdout.write("[note-skipped-blocked-by-env] REC-LIVE02 historical probe denied\n"); return; } if (rr.report.decision !== "historical_group_observed_alive") { note({ executed: true, passed: false, skipped: false, reason: "expected historical_group_observed_alive, got " + rr.report.decision }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE03 restart is a different OS process", async () => { const dir = await tmpDir(); try { const sup = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl03", processId: "p-rl03", crashPoint: "CP04" }); if (sup.barrier !== null && sup.barrier.test_owned_pgid !== undefined) registry.register(sup.barrier.test_owned_pgid); if (sup.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected CP04 abrupt crash exit 137" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null) { note({ executed: true, passed: false, skipped: false, reason: "no restart_result" }); return; } if (!isIntegerGt1(rr.report.restart_pid)) { note({ executed: true, passed: false, skipped: false, reason: "restart_pid missing or invalid" }); return; } const supPid = sup.barrier ? sup.barrier.supervisor_pid : undefined; const restartPid = rr.report.restart_pid; const outerPid = process.pid; if (typeof supPid === "number" && supPid === restartPid) { note({ executed: true, passed: false, skipped: false, reason: "supervisor and restart share PID" }); return; } if (restartPid === outerPid) { note({ executed: true, passed: false, skipped: false, reason: "restart_pid equals outer orchestrator PID" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE04 CP03 irreducible spawn gap -> spawn_outcome_unknown", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl04", processId: "p-rl04", crashPoint: "CP03" }); if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined) registry.register(r.barrier.test_owned_pgid); if (r.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected CP03 abrupt crash exit 137" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl04", "p-rl04"); if ("error" in ledger) { note({ executed: true, passed: false, skipped: false, reason: ledger.error }); return; } if (!ledger.spawn_requested) { note({ executed: true, passed: false, skipped: false, reason: "missing spawn_requested" }); return; } if (ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "process_spawned should NOT be present" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null || rr.report.state !== "spawn_outcome_unknown") { note({ executed: true, passed: false, skipped: false, reason: "expected spawn_outcome_unknown" }); return; } if ((rr.report.signals ?? -1) !== 0) { note({ executed: true, passed: false, skipped: false, reason: "signals must be 0" }); return; } if ((rr.report.kernelProbes ?? -1) !== 0) { note({ executed: true, passed: false, skipped: false, reason: "kernelProbes must be 0" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE05 settled exact replay from REAL completion", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl05", processId: "p-rl05", crashPoint: "CP10" }); if (r.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "CP10 clean exit expected" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl05", "p-rl05"); if ("error" in ledger) { note({ executed: true, passed: false, skipped: false, reason: ledger.error }); return; } if (!ledger.result) { note({ executed: true, passed: false, skipped: false, reason: "missing process_result_committed" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null) { note({ executed: true, passed: false, skipped: false, reason: "no restart_result" }); return; } if (rr.report.state !== "settled") { note({ executed: true, passed: false, skipped: false, reason: "expected settled, got " + rr.report.state }); return; } if (rr.report.decision !== "settled_exact_result") { note({ executed: true, passed: false, skipped: false, reason: "expected settled_exact_result" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE06 ownership commit ok:false -> current-owner cleanup", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl06", processId: "p-rl06", crashPoint: "CP06" }); if (r.ownership !== null && r.ownership.observedPgid !== undefined && r.ownership.observedPgid > 1) registry.register(r.ownership.observedPgid); if (r.ownership === null) { note({ executed: true, passed: false, skipped: false, reason: "missing ownership_failure_observed control record" }); return; } if (typeof r.ownership.observedPgid !== "number" || r.ownership.observedPgid <= 1) { note({ executed: true, passed: false, skipped: false, reason: "ownership_failure_observed has no real PGID" }); return; } if (r.ownership.outerKind !== "ownership_not_durable") { note({ executed: true, passed: false, skipped: false, reason: "expected outerKind=ownership_not_durable" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl06", "p-rl06"); if ("error" in ledger) { note({ executed: true, passed: false, skipped: false, reason: ledger.error }); return; } if (!ledger.spawn_requested) { note({ executed: true, passed: false, skipped: false, reason: "missing spawn_requested" }); return; } if (ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "process_spawned should NOT be durable" }); return; } const pgidProbe = probePgid(r.ownership.observedPgid); if (pgidProbe.state === "denied") { matrix.skipped++; process.stdout.write("[note-skipped-blocked-by-env] REC-LIVE06 sandbox cannot probe -pgid\n"); return; } if (pgidProbe.state !== "absent") { note({ executed: true, passed: false, skipped: false, reason: "supervisor cleanup did NOT produce ESRCH: " + JSON.stringify(pgidProbe) }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null || rr.report.state !== "spawn_outcome_unknown") { note({ executed: true, passed: false, skipped: false, reason: "expected spawn_outcome_unknown" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE07 ownership critical Promise rejection -> current-owner cleanup", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl07", processId: "p-rl07", crashPoint: "CP07" }); if (r.ownership !== null && r.ownership.observedPgid !== undefined && r.ownership.observedPgid > 1) registry.register(r.ownership.observedPgid); if (r.ownership === null) { note({ executed: true, passed: false, skipped: false, reason: "missing ownership_failure_observed" }); return; } if (typeof r.ownership.observedPgid !== "number" || r.ownership.observedPgid <= 1) { note({ executed: true, passed: false, skipped: false, reason: "no real PGID" }); return; } if (r.ownership.outerKind !== "ownership_not_durable") { note({ executed: true, passed: false, skipped: false, reason: "expected outerKind=ownership_not_durable" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl07", "p-rl07"); if ("error" in ledger) { note({ executed: true, passed: false, skipped: false, reason: ledger.error }); return; } if (ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "process_spawned should NOT be durable" }); return; } const pgidProbe7 = probePgid(r.ownership.observedPgid); if (pgidProbe7.state === "denied") { matrix.skipped++; process.stdout.write("[note-skipped-blocked-by-env] REC-LIVE07 sandbox cannot probe -pgid\n"); return; } if (pgidProbe7.state !== "absent") { note({ executed: true, passed: false, skipped: false, reason: "supervisor cleanup did NOT produce ESRCH: " + JSON.stringify(pgidProbe7) }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null || rr.report.state !== "spawn_outcome_unknown") { note({ executed: true, passed: false, skipped: false, reason: "expected spawn_outcome_unknown" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE08 restart receives runDir only / no ambient memory", async () => { const dir = await tmpDir(); try { await runCrashSupervisor({ runDir: dir, attemptId: "a-rl08", processId: "p-rl08", crashPoint: "CP10" }); const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null || rr.report.state !== "settled") { note({ executed: true, passed: false, skipped: false, reason: "restart must succeed with --run-dir only" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE09 authoritative cleanup + zero residue", async () => { const { residue } = await registry.cleanup(); matrix.residue = residue; if (residue > 0 && STRICT) { assert.fail("residue=" + residue + "; strict lane fails on residue"); } note({ executed: true, passed: true, skipped: false }); });

test("REC-LIVE_FALSE_GREEN strict lane requires real subprocess execution", () => { assert.ok(matrix.executed > 0, "executed must be > 0; got " + matrix.executed); });

test("REC-LIVE_REPORT strict lane matrix", () => { emitStdout("RECOVERY_LIVE_REQUIRED=" + matrix.required); emitStdout("RECOVERY_LIVE_EXECUTED=" + matrix.executed); emitStdout("RECOVERY_LIVE_PASSED=" + matrix.passed); emitStdout("RECOVERY_LIVE_FAILED=" + matrix.failed); emitStdout("RECOVERY_LIVE_SKIPPED=" + matrix.skipped); emitStdout("RECOVERY_LIVE_RESIDUE=" + matrix.residue); if (STRICT) { if (matrix.executed !== matrix.required) assert.fail("strict: executed " + matrix.executed + " != required " + matrix.required); if (matrix.failed !== 0) assert.fail("strict: failed=" + matrix.failed); if (matrix.skipped !== 0) assert.fail("strict: skipped=" + matrix.skipped); if (matrix.residue !== 0) assert.fail("strict: residue=" + matrix.residue); } });
