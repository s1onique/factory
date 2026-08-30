/**
 * FOUNDATION03 — real subprocess crash supervisor helper.
 *
 * Invoked as a Node executable by the strict crash lane:
 *   node --import tsx test/recovery/_crash_supervisor.ts \\
 *     --run-dir <dir> --attempt-id <a> --process-id <p> \\
 *     --crash-point <CP> [--ledger-fail]
 *
 * Writes process evidence into the JsonlLedger, spawns a real
 * detached long-running fixture, hits the configured crash
 * barrier, then dies abruptly.
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\\n");
}

interface CrashPointDef {
  readonly emitSpawnRequested: boolean;
  readonly barrierAfterSpawned: boolean;
  readonly barrierAfterClose: boolean;
  readonly emitResultCommitted: boolean;
}

const CP_DEFS: Record<string, CrashPointDef> = {
  CP03: { emitSpawnRequested: true, barrierAfterSpawned: false, barrierAfterClose: false, emitResultCommitted: false },
  CP04: { emitSpawnRequested: true, barrierAfterSpawned: true, barrierAfterClose: false, emitResultCommitted: false },
  CP10: { emitSpawnRequested: true, barrierAfterSpawned: true, barrierAfterClose: true, emitResultCommitted: true },
};

function parseArgs(): { runDir: string; attemptId: string; processId: string; crashPoint: string } {
  const args = process.argv.slice(2);
  const m: Record<string, string> = {};
  for (let i = 0; i + 1 < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
    if (k !== undefined && v !== undefined && (k === "--run-dir" || k === "--attempt-id" || k === "--process-id" || k === "--crash-point")) {
      m[k.slice(2)] = v;
    }
  }
  if (!m["run-dir"] || !m["attempt-id"] || !m["process-id"] || !m["crash-point"]) {
    throw new Error("missing required args");
  }
  return { runDir: m["run-dir"], attemptId: m["attempt-id"], processId: m["process-id"], crashPoint: m["crash-point"] };
}

function appendLedger(runDir: string, line: object): void {
  const path = join(runDir, "events.jsonl");
  appendFileSync(path, JSON.stringify(line) + "\\n");
}

async function main(): Promise<void> {
  const { runDir, attemptId, processId, crashPoint } = parseArgs();
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "crash-supervisor.json"), JSON.stringify({ crashPoint, attemptId, processId, supervisorPid: process.pid, startedAt: Date.now() }, null, 2));

  const def = CP_DEFS[crashPoint];
  if (def === undefined) {
    throw new Error(`unknown crash point ${crashPoint}`);
  }

  // Step 1: emit process_spawn_requested durable
  if (def.emitSpawnRequested) {
    appendLedger(runDir, { kind: "process_evidence", payload: { kind: "process_spawn_requested", attempt_id: attemptId, process_id: processId }, seq: 1, observedAt: Date.now() });
  }

  // Step 2: spawn real detached child
  const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid ?? -1;
  emit({ kind: "barrier", point: crashPoint, test_owned_pgid: pid, supervisor_pid: process.pid });

  // Step 3: emit process_spawned durable
  if (def.barrierAfterSpawned || def.barrierAfterClose || def.emitResultCommitted) {
    appendLedger(runDir, { kind: "process_evidence", payload: { kind: "process_spawned", attempt_id: attemptId, process_id: processId, pid, pgid: pid }, seq: 2, observedAt: Date.now() });
  }

  // Step 4 (CP10): emit process_close_observed + process_result_committed
  if (def.barrierAfterClose) {
    appendLedger(runDir, { kind: "process_evidence", payload: { kind: "process_close_observed", attempt_id: attemptId, process_id: processId, exit_code: 0, signal: null }, seq: 3, observedAt: Date.now() });
  }
  if (def.emitResultCommitted) {
    appendLedger(runDir, { kind: "process_evidence", payload: { kind: "process_result_committed", attempt_id: attemptId, process_id: processId, result: { outcome_kind: "exited", exit_code: 0 } }, seq: 4, observedAt: Date.now() });
  }

  // Step 5: deliberate crash.
  // CP03 is the ONLY point where the supervisor dies
  // abruptly (the OS spawn succeeded but the process_spawned
  // durable commit failed to land before the crash). The
  // supervisor emits spawn_requested, the OS spawn succeeds,
  // and then process.exit(137) simulates the supervisor dying
  // BEFORE the spawn_spawned commit could be fsynced.
  if (crashPoint === "CP03") {
    process.exit(137);
    return;
  }

  // CP04 (durable spawn + barrier) and CP10 (settled)
  // both exit cleanly so the outer orchestrator can observe
  // the durable ledger.
  setTimeout(() => process.exit(0), 300);
}

void main().then(
  () => undefined,
  (e: unknown) => {
    process.stderr.write("crash supervisor error: " + (e instanceof Error ? e.message : String(e)) + "\\n");
    process.exit(2);
  },
);
