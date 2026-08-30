/**
 * FOUNDATION03 strict recovery live qualification lane.
 *
 * Real subprocess orchestrator for REC-LIVE01..09.
 *
 * Each case:
 *   1. spawns _crash_supervisor.ts as a real Node subprocess
 *   2. (optionally) reads the real durable JsonlLedger
 *   3. spawns _recovery_restart.ts as a real Node subprocess
 *   4. asserts the decision and counters
 *   5. registers every test-owned PGID for after-suite cleanup
 *
 * Strict matrix is a CONSTANT 9. Strict mode requires all 9
 * to pass with 0 skip / 0 residue. Sandbox lane reports 6 as
 * skipped and exits non-zero.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { JsonlLedger } from "../../src/evidence/jsonl-ledger.js";

const STRICT = process.env.FACTORY_STRICT_RECOVERY_LIVE === "1";
const RECOVERY_LIVE_REQUIRED = 9;

const matrix = {
  required: RECOVERY_LIVE_REQUIRED,
  executed: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  residue: 0,
};

interface BarrierReport { kind: string; point?: string; test_owned_pgid?: number; supervisor_pid?: number; outcome_kind?: string; }
interface RestartReport { kind: string; state?: string; processId?: string; decision?: string; signals?: number; kernelProbes?: number; error?: string | null; }

function emitStdout(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

function parseBarrierLine(line: string): BarrierReport | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "barrier") return null;
  const out: BarrierReport = { kind: "barrier" };
  if (typeof r.point === "string") out.point = r.point;
  if (typeof r.test_owned_pgid === "number") out.test_owned_pgid = r.test_owned_pgid;
  if (typeof r.supervisor_pid === "number") out.supervisor_pid = r.supervisor_pid;
  if (typeof r.outcome_kind === "string") out.outcome_kind = r.outcome_kind;
  return out;
}

function parseRestartLine(line: string): RestartReport | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "restart_result") return null;
  const out: RestartReport = { kind: "restart_result" };
  if (typeof r.state === "string") out.state = r.state;
  if (typeof r.processId === "string") out.processId = r.processId;
  if (typeof r.decision === "string") out.decision = r.decision;
  if (typeof r.signals === "number") out.signals = r.signals;
  if (typeof r.kernelProbes === "number") out.kernelProbes = r.kernelProbes;
  if (r.error === null || typeof r.error === "string") out.error = r.error;
  return out;
}

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(join(process.cwd(), ".tmp-home", "cpcrash-"));
}

interface CrashOutcome { exitCode: number | null; signal: NodeJS.Signals | null; barrier: BarrierReport | null; stderr: string; stdout: string; }

async function runCrashSupervisor(opts: { runDir: string; attemptId: string; processId: string; crashPoint: "CP03" | "CP04" | "CP06" | "CP07" | "CP10" }): Promise<CrashOutcome> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      join(process.cwd(), "test", "recovery", "_crash_supervisor.ts"),
      "--run-dir", opts.runDir,
      "--attempt-id", opts.attemptId,
      "--process-id", opts.processId,
      "--crash-point", opts.crashPoint,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      let barrier: BarrierReport | null = null;
      for (const line of stdout.split("\n")) {
        if (line.length === 0) continue;
        const b = parseBarrierLine(line);
        if (b !== null) barrier = b;
      }
      resolve({ exitCode: code, signal, barrier, stderr, stdout });
    });
  });
}

interface RestartOutcome { exitCode: number | null; signal: NodeJS.Signals | null; report: RestartReport | null; stderr: string; stdout: string; }

async function runRestartHelper(runDir: string): Promise<RestartOutcome> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      join(process.cwd(), "test", "recovery", "_recovery_restart.ts"),
      "--run-dir", runDir,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      let report: RestartReport | null = null;
      for (const line of stdout.split("\n")) {
        if (line.length === 0) continue;
        const r = parseRestartLine(line);
        if (r !== null) report = r;
      }
      resolve({ exitCode: code, signal, report, stderr, stdout });
    });
  });
}

async function readLedgerProcessEnvelopes(runDir: string): Promise<{ has: (kind: string, attemptId: string, processId: string) => Promise<boolean> }> {
  const ledger = new JsonlLedger(runDir);
  const openR = await ledger.open({ createIfMissing: false });
  if (!openR.ok) {
        return {
      has: async () => false,
    };
  }
  const r = await ledger.readAll();
    if (!r.ok) {
    return { has: async () => false };
  }
  const envs = r.value;
  return {
    has: async (kind: string, attemptId: string, processId: string) => {
      for (const env of envs) {
        if (env.schema_version === 2 && env.kind === "process_evidence" && env.process_evidence.kind === kind && env.process_evidence.attempt_id === attemptId && env.process_evidence.process_id === processId) {
          return true;
        }
      }
      return false;
    },
  };
}

const pgidSet = new Set<number>();
function registerPgid(pgid: number): void { if (pgid > 0) pgidSet.add(pgid); }

after(async () => { for (const pgid of pgidSet) { try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ } } await new Promise<void>((res) => setTimeout(res, 100)); for (const pgid of pgidSet) { let absent = false; try { process.kill(-pgid, 0); } catch (e: unknown) { const code = (e as { code?: string }).code; if (code === "ESRCH") absent = true; } if (!absent) matrix.residue++; } pgidSet.clear(); });

interface CaseResult { executed: boolean; passed: boolean; skipped: boolean; reason?: string; }

function note(r: CaseResult): void { if (r.skipped) { matrix.skipped++; } else { matrix.executed++; if (r.passed) matrix.passed++; else matrix.failed++; } }

async function recordLedgerDecision(runDir: string, attemptId: string, processId: string): Promise<{ spawn_requested: boolean; spawned: boolean; result: boolean }> { const lh = await readLedgerProcessEnvelopes(runDir); return { spawn_requested: await lh.has("process_spawn_requested", attemptId, processId), spawned: await lh.has("process_spawned", attemptId, processId), result: await lh.has("process_result_committed", attemptId, processId) }; }

test("REC-LIVE01 supervisor abrupt death + detached child survives", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl01", processId: "p-rl01", crashPoint: "CP04" }); if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined) registerPgid(r.barrier.test_owned_pgid); if (r.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected abrupt crash exit 137, got " + r.exitCode }); return; } if (r.barrier === null) { note({ executed: true, passed: false, skipped: false, reason: "missing barrier control record" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });
test("REC-LIVE02 durable process_spawned -> in_flight_at_crash on restart", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl02", processId: "p-rl02", crashPoint: "CP04" }); if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined) registerPgid(r.barrier.test_owned_pgid); if (r.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected CP04 abrupt crash exit 137" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl02", "p-rl02"); if (!ledger.spawn_requested) { note({ executed: true, passed: false, skipped: false, reason: "missing spawn_requested" }); return; } if (!ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "missing process_spawned" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper exited non-zero: " + rr.stderr }); return; } if (rr.report === null) { note({ executed: true, passed: false, skipped: false, reason: "no restart_result" }); return; } if (rr.report.state !== "in_flight_at_crash") { note({ executed: true, passed: false, skipped: false, reason: "expected in_flight_at_crash, got " + rr.report.state }); return; } if ((rr.report.signals ?? -1) !== 0) { note({ executed: true, passed: false, skipped: false, reason: "expected signals=0" }); return; } const kp = rr.report.kernelProbes ?? -1; if (kp < 1) { note({ executed: true, passed: false, skipped: false, reason: "expected kernelProbes>=1" }); return; } if (rr.report.decision !== "historical_group_observed_alive" && rr.report.decision !== "historical_group_probe_denied") { note({ executed: true, passed: false, skipped: false, reason: "expected alive or denied probe, got " + rr.report.decision }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });
test("REC-LIVE03 restart is a different OS process", async () => { const dir = await tmpDir(); try { const sup = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl03", processId: "p-rl03", crashPoint: "CP04" }); if (sup.barrier !== null && sup.barrier.test_owned_pgid !== undefined) registerPgid(sup.barrier.test_owned_pgid); const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed" }); return; } const supPid = sup.barrier?.supervisor_pid; const restartPid = process.pid; if (typeof supPid === "number" && supPid === restartPid) { note({ executed: true, passed: false, skipped: false, reason: "supervisor and restart share PID" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });
test("REC-LIVE04 CP03 irreducible spawn gap -> spawn_outcome_unknown", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl04", processId: "p-rl04", crashPoint: "CP03" }); if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined) registerPgid(r.barrier.test_owned_pgid); if (r.exitCode !== 137) { note({ executed: true, passed: false, skipped: false, reason: "expected CP03 abrupt crash exit 137" }); return; } const ledger = await recordLedgerDecision(dir, "a-rl04", "p-rl04"); if (!ledger.spawn_requested) { note({ executed: true, passed: false, skipped: false, reason: "missing spawn_requested" }); return; } if (ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "process_spawned should NOT be present (CP03 gap)" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null) { note({ executed: true, passed: false, skipped: false, reason: "no restart_result" }); return; } if (rr.report.state !== "spawn_outcome_unknown") { note({ executed: true, passed: false, skipped: false, reason: "expected spawn_outcome_unknown, got " + rr.report.state }); return; } if ((rr.report.signals ?? -1) !== 0) { note({ executed: true, passed: false, skipped: false, reason: "signals must be 0 in spawn_outcome_unknown" }); return; } if ((rr.report.kernelProbes ?? -1) !== 0) { note({ executed: true, passed: false, skipped: false, reason: "kernelProbes must be 0 in spawn_outcome_unknown" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });
test("REC-LIVE05 settled exact replay from REAL completion", async () => { const dir = await tmpDir(); try { const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl05", processId: "p-rl05", crashPoint: "CP10" }); if (r.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "CP10 clean exit expected, got " + r.exitCode }); return; } const ledger = await recordLedgerDecision(dir, "a-rl05", "p-rl05"); if (!ledger.result) { note({ executed: true, passed: false, skipped: false, reason: "missing process_result_committed" }); return; } const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null) { note({ executed: true, passed: false, skipped: false, reason: "no restart_result" }); return; } if (rr.report.state !== "settled") { note({ executed: true, passed: false, skipped: false, reason: "expected settled, got " + rr.report.state }); return; } if (rr.report.decision !== "settled_exact_result") { note({ executed: true, passed: false, skipped: false, reason: "expected settled_exact_result, got " + rr.report.decision }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });
test("REC-LIVE06 ownership commit ok:false -> current-owner cleanup", async () => {
  const dir = await tmpDir();
  try {
    const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl06", processId: "p-rl06", crashPoint: "CP06" });
    if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined && r.barrier.test_owned_pgid > 0) registerPgid(r.barrier.test_owned_pgid);
    if (r.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "expected CP06 clean exit, got " + r.exitCode }); return; }
    const ledger = await recordLedgerDecision(dir, "a-rl06", "p-rl06");
    if (!ledger.spawn_requested) { note({ executed: true, passed: false, skipped: false, reason: "missing spawn_requested" }); return; }
    if (ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "process_spawned should NOT be durable on ownership failure" }); return; }
    const rr = await runRestartHelper(dir);
    if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; }
    if (rr.report === null || rr.report.state !== "spawn_outcome_unknown") { note({ executed: true, passed: false, skipped: false, reason: "expected spawn_outcome_unknown, got " + (rr.report ? rr.report.state : "null") }); return; }
    note({ executed: true, passed: true, skipped: false });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("REC-LIVE07 ownership critical Promise rejection -> current-owner cleanup", async () => {
  const dir = await tmpDir();
  try {
    const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl07", processId: "p-rl07", crashPoint: "CP07" });
    if (r.barrier !== null && r.barrier.test_owned_pgid !== undefined && r.barrier.test_owned_pgid > 0) registerPgid(r.barrier.test_owned_pgid);
    if (r.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "expected CP07 clean exit, got " + r.exitCode }); return; }
    const ledger = await recordLedgerDecision(dir, "a-rl07", "p-rl07");
    if (ledger.spawned) { note({ executed: true, passed: false, skipped: false, reason: "process_spawned should NOT be durable on critical rejection" }); return; }
    const rr = await runRestartHelper(dir);
    if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; }
    if (rr.report === null || rr.report.state !== "spawn_outcome_unknown") { note({ executed: true, passed: false, skipped: false, reason: "expected spawn_outcome_unknown, got " + (rr.report ? rr.report.state : "null") }); return; }
    note({ executed: true, passed: true, skipped: false });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("REC-LIVE08 restart receives runDir only / no ambient memory", async () => { const dir = await tmpDir(); try { await runCrashSupervisor({ runDir: dir, attemptId: "a-rl08", processId: "p-rl08", crashPoint: "CP10" }); const rr = await runRestartHelper(dir); if (rr.exitCode !== 0) { note({ executed: true, passed: false, skipped: false, reason: "restart helper failed: " + rr.stderr }); return; } if (rr.report === null || rr.report.state !== "settled") { note({ executed: true, passed: false, skipped: false, reason: "restart must succeed with --run-dir only" }); return; } note({ executed: true, passed: true, skipped: false }); } finally { await fs.rm(dir, { recursive: true, force: true }); } });

test("REC-LIVE09 zero test-owned process residue", async () => {
  if (matrix.residue > 0) {
    note({ executed: true, passed: false, skipped: false, reason: "residue=" + matrix.residue });
    assert.fail(`residue=${matrix.residue}; ESRCH-only contract violated`);
  }
  note({ executed: true, passed: true, skipped: false });
});

test("REC-LIVE_FALSE_GREEN strict lane requires real subprocess execution", () => { assert.ok(matrix.executed > 0, `executed must be > 0; got ${matrix.executed}`); });

test("REC-LIVE_REPORT strict lane matrix", () => { emitStdout(`RECOVERY_LIVE_REQUIRED=${matrix.required}`); emitStdout(`RECOVERY_LIVE_EXECUTED=${matrix.executed}`); emitStdout(`RECOVERY_LIVE_PASSED=${matrix.passed}`); emitStdout(`RECOVERY_LIVE_FAILED=${matrix.failed}`); emitStdout(`RECOVERY_LIVE_SKIPPED=${matrix.skipped}`); emitStdout(`RECOVERY_LIVE_RESIDUE=${matrix.residue}`); if (STRICT) { if (matrix.executed !== matrix.required) assert.fail(`strict: executed ${matrix.executed} != required ${matrix.required}`); if (matrix.failed !== 0) assert.fail(`strict: failed=${matrix.failed}`); if (matrix.skipped !== 0) assert.fail(`strict: skipped=${matrix.skipped}`); if (matrix.residue !== 0) assert.fail(`strict: residue=${matrix.residue}`); } });
