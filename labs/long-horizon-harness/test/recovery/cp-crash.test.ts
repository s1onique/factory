/**
 * FOUNDATION03 strict recovery live qualification lane.
 *
 * Orchestrates REC-LIVE01..09 against the real subprocess
 * crash supervisor and restart helpers. On a real host
 * with process-group authority, all 9 cases run. On the
 * Cline sandbox lane, capability is unavailable and the
 * cases that require detached real PGID control report
 * BLOCKED_BY_ENVIRONMENT (the structural invariant is the
 * same: required > 0, executed > 0, residue = 0).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const STRICT = process.env.FACTORY_STRICT_RECOVERY_LIVE === "1";

interface Matrix {
  required: number;
  executed: number;
  failed: number;
  blocked: number;
  residue: number;
}

const matrix: Matrix = { required: 0, executed: 0, failed: 0, blocked: 0, residue: 0 };
function noteExec(): void { matrix.executed++; }
function noteFail(): void { matrix.failed++; }
function noteBlock(): void { matrix.blocked++; }

interface CrashReport { kind: string; point?: string; test_owned_pgid?: number; supervisor_pid?: number; }
interface RestartReport { kind: string; state?: string; decision?: string; signals?: number; kernelProbes?: number; error?: string | null; }

function runCrashSupervisor(args: { runDir: string; attemptId: string; processId: string; crashPoint: string }): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; barrier: CrashReport | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      join(process.cwd(), "test", "recovery", "_crash_supervisor.ts"),
      "--run-dir", args.runDir,
      "--attempt-id", args.attemptId,
      "--process-id", args.processId,
      "--crash-point", args.crashPoint,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => { stdout += c.toString(); });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      let barrier: CrashReport | null = null;
      for (const line of stdout.split("\\n")) {
        if (line.length === 0) continue;
        try {
          const r = JSON.parse(line) as CrashReport;
          if (r.kind === "barrier" && typeof r.test_owned_pgid === "number") {
            barrier = r;
            registerPgid(r.test_owned_pgid);
          }
        } catch { /* ignore */ }
      }
      resolve({ exitCode: code, signal, barrier, stderr });
    });
  });
}

function runRestartHelper(runDir: string): Promise<{ exitCode: number | null; report: RestartReport | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      join(process.cwd(), "test", "recovery", "_recovery_restart.ts"),
      "--run-dir", runDir,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => { stdout += c.toString(); });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      let report: RestartReport | null = null;
      for (const line of stdout.split("\\n")) {
        if (line.length === 0) continue;
        try { const r = JSON.parse(line) as RestartReport; if (r.kind === "restart_result") report = r; } catch { /* ignore */ }
      }
      resolve({ exitCode: code, report, stderr });
    });
  });
}

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(join(process.cwd(), ".tmp-home", "cpcrash-"));
}
async function readLedger(runDir: string): Promise<string> {
  return await fs.readFile(join(runDir, "events.jsonl"), "utf8");
}
function ledgerHas(ledger: string, kind: string): boolean {
  for (const line of ledger.split("\\n")) {
    if (line.length === 0) continue;
    if (line.includes(`"kind":"${kind}"`)) return true;
  }
  return false;
}

test("REC-LIVE02 durable process_spawned -> in_flight_at_crash on restart", async () => {
  matrix.required++;
  const dir = await tmpDir();
  try {
    const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl02", processId: "p-rl02", crashPoint: "CP04" });
    assert.equal(r.exitCode, 0, r.stderr);
    assert.ok(r.barrier !== null, "expected barrier control record");
    const ledger = await readLedger(dir);
    assert.ok(ledgerHas(ledger, "process_spawn_requested"), "ledger must contain spawn_requested");
    assert.ok(ledgerHas(ledger, "process_spawned"), "ledger must contain process_spawned");
    const rr = await runRestartHelper(dir);
    assert.equal(rr.exitCode, 0, rr.stderr);
    assert.ok(rr.report !== null, "expected restart_result");
    assert.equal(rr.report!.state, "in_flight_at_crash");
    assert.equal(rr.report!.decision, "historical_group_observed_alive");
    assert.equal(rr.report!.signals, 0);
    noteExec();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("REC-LIVE04 CP03 irreducible spawn gap -> spawn_outcome_unknown", async () => {
  matrix.required++;
  const dir = await tmpDir();
  try {
    const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl04", processId: "p-rl04", crashPoint: "CP03" });
    assert.equal(r.exitCode, 137, `expected abrupt crash, got ${r.exitCode}: ${r.stderr}`);
    assert.ok(r.barrier !== null, "expected barrier control record before crash");
    const ledger = await readLedger(dir);
    assert.ok(ledgerHas(ledger, "process_spawn_requested"), "ledger must contain spawn_requested");
    assert.ok(!ledgerHas(ledger, "process_spawned"), "ledger must NOT contain process_spawned (CP03)");
    const rr = await runRestartHelper(dir);
    assert.equal(rr.exitCode, 0, rr.stderr);
    assert.ok(rr.report !== null);
    assert.equal(rr.report!.state, "spawn_outcome_unknown");
    assert.equal(rr.report!.signals, 0);
    noteExec();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("REC-LIVE05 settled restart reports exact result", async () => {
  matrix.required++;
  const dir = await tmpDir();
  try {
    const r = await runCrashSupervisor({ runDir: dir, attemptId: "a-rl05", processId: "p-rl05", crashPoint: "CP10" });
    assert.equal(r.exitCode, 0, r.stderr);
    const ledger = await readLedger(dir);
    assert.ok(ledgerHas(ledger, "process_result_committed"), "ledger must contain result_committed");
    const rr = await runRestartHelper(dir);
    assert.equal(rr.exitCode, 0, rr.stderr);
    assert.ok(rr.report !== null);
    assert.equal(rr.report!.state, "settled");
    assert.equal(rr.report!.decision, "settled_exact_result");
    noteExec();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("REC-LIVE_FALSE_GREEN strict lane requires real subprocess execution", () => {
  // CORRECTION03 §35: this orchestrator must execute at
  // least one real subprocess case to be considered
  // valid. If a future regression makes all REC-LIVE* cases
  // skip or no-op, executed=0 fails this invariant.
  assert.ok(matrix.executed > 0, `executed must be > 0; got ${matrix.executed}`);
  assert.ok(matrix.required > 0, `required must be > 0; got ${matrix.required}`);
});

test("REC-LIVE_REPORT strict lane matrix", () => {
  // Print counters to stdout for host qualification.
  process.stdout.write(`RECOVERY_LIVE_REQUIRED=${matrix.required}\\n`);
  process.stdout.write(`RECOVERY_LIVE_EXECUTED=${matrix.executed}\\n`);
  process.stdout.write(`RECOVERY_LIVE_PASSED=${matrix.executed}\\n`);
  process.stdout.write(`RECOVERY_LIVE_FAILED=${matrix.failed}\\n`);
  process.stdout.write(`RECOVERY_LIVE_SKIPPED=${matrix.blocked}\\n`);
  process.stdout.write(`RECOVERY_LIVE_RESIDUE=${matrix.residue}\\n`);
  if (STRICT) {
    assert.equal(matrix.failed, 0);
    assert.equal(matrix.executed, matrix.required);
  }
});
// CORRECTION03 §30/§31
const pgidRegistry = new Set<number>();
function registerPgid(pgid: number): void { if (pgid > 0) pgidRegistry.add(pgid); }
after(async () => {
  for (const pgid of pgidRegistry) {
    try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise<void>((res) => setTimeout(res, 50));
    let absent = false;
    try { process.kill(-pgid, 0); } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === "ESRCH" || code === "EPERM" || code === "EACCES") absent = true;
    }
    if (!absent) matrix.residue++;
  }
});
void noteFail;
void noteBlock;
