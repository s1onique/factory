/**
 * FOUNDATION03 — real subprocess crash supervisor helper.
 *
 * Invoked as a Node executable:
 *   node --import tsx test/recovery/_crash_supervisor.ts \
 *     --run-dir <dir> --attempt-id <a> --process-id <p> \
 *     --crash-point <CP> [--exec <cmd>]
 *
 * Crash points:
 *   CP03  real JsonlLedger spawn_requested only + abrupt exit 137
 *   CP04  real buildSupervisor + barrier-after-process_spawned-commit
 *         + abrupt exit 137 (detached child survives)
 *   CP10  real buildSupervisor + short-lived child + clean exit
 *
 * All durable evidence goes through JsonlLedger and
 * LedgerBackedProcessEvidenceSink. No hand-written JSON lines.
 */

import { promises as fs } from "node:fs";
import { JsonlLedger } from "../../src/evidence/jsonl-ledger.js";
import { LedgerBackedProcessEvidenceSink } from "../../src/process/process-evidence-sink.js";
import { buildSupervisor } from "../../src/process/supervisor-builder.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import { makeAttemptId, makeEventId, makeRunId, makeMissionId } from "../../src/domain/ids.js";
import { makeProcessId } from "../../src/process/process-types.js";
import type { ProcessEvidenceIdentity } from "../../src/process/process-evidence-bridge.js";

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

interface Args {
  readonly runDir: string;
  readonly attemptId: string;
  readonly processId: string;
  readonly crashPoint: "CP03" | "CP04" | "CP10" | "CP06" | "CP07";
  readonly exec: string;
  readonly execArgs: ReadonlyArray<string>;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const m: Record<string, string> = {};
  for (let i = 0; i + 1 < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === undefined || v === undefined) continue;
    if (k === "--run-dir" || k === "--attempt-id" || k === "--process-id" || k === "--crash-point" || k === "--exec") {
      m[k.slice(2)] = v;
    }
  }
  const cp = m["crash-point"];
  if (cp !== "CP03" && cp !== "CP04" && cp !== "CP10" && cp !== "CP06" && cp !== "CP07") {
    throw new Error("--crash-point must be CP03 | CP04 | CP10");
  }
  if (m["run-dir"] === undefined || m["attempt-id"] === undefined || m["process-id"] === undefined) {
    throw new Error("--run-dir, --attempt-id, --process-id required");
  }
  const exec = m["exec"] ?? "true";
  const execArgs = exec === "true" ? [] : exec.split(" ");
  return {
    runDir: m["run-dir"],
    attemptId: m["attempt-id"],
    processId: m["process-id"],
    crashPoint: cp,
    exec: execArgs.length === 0 ? "true" : execArgs[0] ?? "true",
    execArgs: execArgs.length === 0 ? [] : execArgs.slice(1),
  };
}

function makeIdentity(a: Args): ProcessEvidenceIdentity {
  return {
    runId: makeRunId("r-" + a.processId),
    missionId: makeMissionId("m-" + a.processId),
    attemptId: makeAttemptId(a.attemptId),
    eventIdFactory: () => makeEventId("e-" + a.processId + "-" + Date.now().toString(36)),
  };
}

async function cp03(args: Args, ledger: JsonlLedger): Promise<void> {
  // CORRECTION06 §2/§4/§6: CP03 must crash INSIDE the actual
  // OS-spawn → process_spawned-commit gap. The crash helper
  // drives the real production supervisor + evidence sink; the
  // SpawnOwnershipObserver seam fires AFTER OS spawn succeeds
  // but BEFORE process_spawned critical commit settles. The
  // observer emits the barrier with the real pid+pgid and exits
  // the supervisor process with code 137 BEFORE any compensation
  // (TERM/KILL/cleanup) can run.
  const identity = makeIdentity(args);
  const exec = args.exec === "true" ? "/bin/sh" : args.exec;
  const execArgs = args.exec === "true" ? ["-c", "sleep 300"] : args.execArgs;
  const spec = {
    executable: exec,
    args: execArgs,
    env: {},
    cwd: process.cwd(),
    termGraceMs: 1500,
    killGraceMs: 1500,
    deadlineMs: 600000,
    stdoutLimitBytes: 0,
    stderrLimitBytes: 0,
  };
  const supervisor = buildSupervisor({
    spec,
    clock: realClock(),
    signals: nodeSignalPort(),
    spawner: nodeSpawnPort(),
    sink: () => {},
    evidenceSink: new LedgerBackedProcessEvidenceSink(ledger),
    evidenceIdentity: identity,
    idFactory: () => makeProcessId(args.processId),
    spawnOwnershipObserver: {
      afterOsSpawnBeforeOwnershipCommit(observation): Promise<void> {
        // Emit barrier with REAL pid+pgid (never -1).
        emit({
          kind: "barrier",
          point: "CP03",
          test_owned_pgid: observation.pgid,
          supervisor_pid: process.pid,
          spawn_event_pid: observation.pid,
        });
        // CORRECTION06 §4: crash BEFORE process_spawned critical
        // commit / compensation. The supervisor's in-flight
        // process_spawn_started ledger write drains asynchronously;
        // we wait a bounded 200ms so the write fsyncs, THEN we
        // exit. The supervisor code path is still blocked on this
        // observer (the await in runSpawnOwnershipObserver) so NO
        // compensation runs before exit.
        return new Promise<void>((res) => {
          setTimeout(() => {
            process.exit(137);
            res();
          }, 200);
        });
      },
    },
  });
  // Drive the supervisor lifecycle. The observer fires BEFORE
  // this returns; the helper exits via process.exit(137).
  // If the observer somehow never fires (a regression), the
  // outer await still lets the test detect the failure cleanly.
  await supervisor.awaitOuter();
  // Should never reach here — observer exits the process.
  process.exit(0);
}

async function waitForSpawnedInLedger(ledger: JsonlLedger, attemptId: string, processId: string, timeoutMs: number): Promise<boolean> {
  // Poll the real ledger for process_spawned.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await ledger.readAll();
    if (r.ok) {
      for (const env of r.value) {
        const e = env as { kind?: string; process_evidence?: { kind?: string; attempt_id?: string; process_id?: string } };
        if (e.kind === "process_evidence" && e.process_evidence !== undefined) {
          if (e.process_evidence.kind === "process_spawned" && e.process_evidence.attempt_id === attemptId && e.process_evidence.process_id === processId) {
            return true;
          }
        }
      }
    }
    await new Promise<void>((r) => setTimeout(r, 20));
  }
  return false;
}

async function cp04(args: Args, ledger: JsonlLedger): Promise<void> {
  // Override executable to a long-lived detached child unless explicitly overridden.
  if (args.exec === "true") {
    // Build a CP04-specific spec: long-lived detached child.
    (args as { exec: string }).exec = "/bin/sh";
    (args as { execArgs: ReadonlyArray<string> }).execArgs = ["-c", "sleep 300"];
  }

  // CORRECTION04 §10: CP04 must crash AFTER process_spawned has
  // been durably committed but BEFORE the supervisor runs cleanup.
  // We use the real buildSupervisor + real ledger-backed sink.
  // The supervisor runs a long-lived detached child; we observe
  // the durable ledger for process_spawned, then exit 137.
  const identity = makeIdentity(args);
  const sink = new LedgerBackedProcessEvidenceSink(ledger);
  const spec = {
    executable: args.exec,
    args: args.execArgs,
    env: {},
    cwd: process.cwd(),
    termGraceMs: 5000,
    killGraceMs: 5000,
    deadlineMs: 600000,
    stdoutLimitBytes: 0,
    stderrLimitBytes: 0,
  };
  const supervisor = buildSupervisor({
    spec,
    clock: realClock(),
    signals: nodeSignalPort(),
    spawner: nodeSpawnPort(),
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: identity,
    idFactory: () => makeProcessId(args.processId),
  });
  // The supervisor runs internally; await() will block.
  // We do not call await() — instead we poll the ledger and exit 137.
  void supervisor.await();
  const landed = await waitForSpawnedInLedger(ledger, args.attemptId, args.processId, 5000);
  if (!landed) {
    process.stderr.write("cp04: process_spawned did not land in ledger within 5s\n");
    process.exit(3);
    return;
  }
  // Find the historical PGID by scanning the latest spawn_spawned record.
  const rr = await ledger.readAll();
  let pgid: number | null = null;
  if (rr.ok) {
    for (const env of rr.value) {
      const e = env as { kind?: string; process_evidence?: { kind?: string; pid?: number; pgid?: number } };
      if (e.kind === "process_evidence" && e.process_evidence !== undefined && e.process_evidence.kind === "process_spawned") {
        if (e.process_evidence.pgid !== undefined) pgid = e.process_evidence.pgid;
        else if (e.process_evidence.pid !== undefined) pgid = e.process_evidence.pid;
      }
    }
  }
  if (pgid === null) {
    process.stderr.write("cp04: could not find pgid in ledger\n");
    process.exit(4);
    return;
  }
  emit({ kind: "barrier", point: "CP04", test_owned_pgid: pgid, supervisor_pid: process.pid });
  process.exit(137);
}

async function cp06(args: Args, ledger: JsonlLedger): Promise<void> {
  // REC-LIVE06: real long-lived fixture + fault the FIRST
  // commitCritical (process_spawned) to return ok:false. The
  // supervisor's ownership_persistence_failed branch fires;
  // current supervisor runs TERM/KILL cleanup. Child is gone.
  // Restart sees spawn_outcome_unknown.
  ledger.armFaultHook({
    kind: "beforeAppendWrite",
    payload: { kind: "process_spawned", attempt_id: makeAttemptId(args.attemptId), process_id: makeProcessId(args.processId), pid: 1, pgid: 1 },
    respond: (candidate, _r) => {
      if ("kind" in candidate && candidate.kind === "process_spawned") {
        return { ok: false, error: { kind: "internal_failure", message: "cp06 fault-injected ok:false" } };
      }
      return { ok: true, value: undefined };
    },
  });
  await runRealSupervisorWith(args, ledger, "CP06");
}

async function cp07(args: Args, ledger: JsonlLedger): Promise<void> {
  // REC-LIVE07: same as CP06 but the fault responds with a
  // Promise rejection (raw internal_malfunction taxonomy).
  ledger.armFaultHook({
    kind: "beforeAppendWrite",
    payload: { kind: "process_spawned", attempt_id: makeAttemptId(args.attemptId), process_id: makeProcessId(args.processId), pid: 1, pgid: 1 },
    respond: (candidate, _r) => {
      if ("kind" in candidate && candidate.kind === "process_spawned") {
        throw new Error("cp07 fault-injected rejection");
      }
      return { ok: true, value: undefined };
    },
  });
  await runRealSupervisorWith(args, ledger, "CP07");
}

async function runRealSupervisorWith(args: Args, ledger: JsonlLedger, point: "CP06" | "CP07"): Promise<void> {
  const identity = makeIdentity(args);
  const sink = new LedgerBackedProcessEvidenceSink(ledger);
  // CORRECTION05 §13: long-lived fixture so the child does NOT
  // terminate naturally before current-owner cleanup completes.
  const exec = args.exec === "true" ? "/bin/sh" : args.exec;
  const execArgs = args.exec === "true" ? ["-c", "sleep 300"] : args.execArgs;
  const spec = {
    executable: exec,
    args: execArgs,
    env: {},
    cwd: process.cwd(),
    termGraceMs: 1500,
    killGraceMs: 1500,
    deadlineMs: 600000,
    stdoutLimitBytes: 0,
    stderrLimitBytes: 0,
  };
  const supervisor = buildSupervisor({
    spec,
    clock: realClock(),
    signals: nodeSignalPort(),
    spawner: nodeSpawnPort(),
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: identity,
    idFactory: () => makeProcessId(args.processId),
  });
  // Use awaitOuter to surface the actual PGID/PID for cleanup
  // registration.
  const outer = await supervisor.awaitOuter();
  const pgid = outer.observedPgid;
  const pid = outer.observedPid;
  if (point === "CP06" || point === "CP07") {
    // CORRECTION05 §14/§17: surface the real PGID. NEVER -1 for
    // live ownership cases. Real PGID is required for the test
    // orchestrator to register and probe cleanup.
    emit({
      kind: "ownership_failure_observed",
      point,
      observedPgid: pgid,
      observedPid: pid,
      outerKind: outer.kind,
      supervisorPid: process.pid,
    });
  } else {
    emit({ kind: "barrier", point, test_owned_pgid: pgid ?? -1, supervisor_pid: process.pid });
  }
}

async function cp10(args: Args, ledger: JsonlLedger): Promise<void> {
  // CORRECTION04 §14/§15: use a real short-lived child, wait for
  // actual Node close, persist through the real supervisor.
  const identity = makeIdentity(args);
  const sink = new LedgerBackedProcessEvidenceSink(ledger);
  // Default short-lived executable: /bin/sh -c "sleep 0.05"
  const exec = args.exec === "true" ? "/bin/sh" : args.exec;
  const execArgs = args.exec === "true" ? ["-c", "sleep 0.05"] : args.execArgs;
  const spec = {
    executable: exec,
    args: execArgs,
    env: {},
    cwd: process.cwd(),
    termGraceMs: 1000,
    killGraceMs: 1000,
    deadlineMs: 60000,
    stdoutLimitBytes: 0,
    stderrLimitBytes: 0,
  };
  const supervisor = buildSupervisor({
    spec,
    clock: realClock(),
    signals: nodeSignalPort(),
    spawner: nodeSpawnPort(),
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: identity,
    idFactory: () => makeProcessId(args.processId),
  });
  const r = await supervisor.await();
  emit({ kind: "barrier", point: "CP10", outcome_kind: r.outcome.kind });
}

async function main(): Promise<void> {
  const args = parseArgs();
  await fs.mkdir(args.runDir, { recursive: true });
  const ledger = new JsonlLedger(args.runDir);
  const open = await ledger.open({ createIfMissing: true });
  if (!open.ok) throw new Error("ledger open failed: " + JSON.stringify(open.error));
  if (args.crashPoint === "CP03") await cp03(args, ledger);
  else if (args.crashPoint === "CP04") await cp04(args, ledger);
  else if (args.crashPoint === "CP10") await cp10(args, ledger);
  else if (args.crashPoint === "CP06") await cp06(args, ledger);
  else await cp07(args, ledger);
}

void main().then(
  () => {
    // CORRECTION05: supervisor process must exit after work is
    // done; stdio handles to the detached child would otherwise
    // keep the Node event loop alive indefinitely.
    process.exit(0);
  },
  (e: unknown) => {
    process.stderr.write("crash supervisor error: " + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(2);
  },
);
