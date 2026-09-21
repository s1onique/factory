/**
 * LH-06 deterministic long-duration soak laboratory —
 * canonical epoch runner.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * A canonical epoch (ACT §4) consists of:
 *
 *   12 LH-05 lifecycle scenarios
 *   17 LH-04 fault experiments
 *   1 canary at start (LC01)
 *   1 canary at end   (LC01)
 *   1 integrity checkpoint
 *   1 cleanup checkpoint
 *
 * Order is determined by `scheduleForEpoch(epochIndex)`.
 *
 * The worker acquires a fresh workspace per epoch, runs the
 * cases in the scheduled order, releases the workspace, and
 * emits a heartbeat. The epoch never reuses mutable
 * workspace from another epoch (ACT §8).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { allocateEpochWorkspace, closeEpochWorkspace } from "./cleanup.js";
import { cadenceHit } from "./telemetry.js";
import { LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS } from "./contract.js";
import { scheduleForEpoch } from "./schedule.js";
import {
  applyInjectionAtEpochStart,
  captureResourceSample,
  cleanupCheckpoint,
  emitDiagnosticLine,
  emitFailure,
  emitHeartbeat,
  integrityCheckpoint,
} from "./epoch-helpers.js";
import type { SoakWorkerState } from "./worker-state.js";
import {
  runCanaryAfter,
  runCanaryBefore,
  runLh04Case,
  runLh05Case,
} from "./case-runner.js";
import type { LH06FailureKind } from "./types.js";

/**
 * Snapshot of the LEAK06 target fixture before mutation.
 * Used to restore the original file after the worker
 * exits so subsequent test runs / qualifications start
 * from a clean state.
 *
 * Captured via `prepareLeak06` (called from the worker
 * entry point) so the snapshot reflects the pristine
 * pre-soak state, not whatever state a prior (untidy)
 * run left the fixture in.
 *
 * NOTE on concurrency: LEAK06 mutates the on-disk
 * fixture. Tests that exercise LEAK06 and tests that
 * exercise the live frozen tree MUST run sequentially
 * (via `--test-concurrency=1`); running them in parallel
 * causes one test's child process to read the fixture
 * mid-mutation. This is documented in the LEAK06
 * end-to-end test and is a test-harness constraint, not
 * a soak-contract constraint.
 */
let leak06Snapshot: { target: string; original: Buffer } | null = null;

/**
 * Capture the pristine LEAK06 target fixture. Called
 * once at worker construction, BEFORE any mutation.
 */
export function prepareLeak06(repoRoot: string, fixture_rel_path: string): void {
  const target = resolve(repoRoot, fixture_rel_path);
  if (!existsSync(target)) return;
  try {
    leak06Snapshot = { target, original: readFileSync(target) };
  } catch {
    leak06Snapshot = null;
  }
}

function applyLeak06(state: SoakWorkerState): void {
  if (state.injection.kind !== "LEAK06_MUTATE_FROZEN_FIXTURE") return;
  const target = resolve(state.repoRoot, state.injection.fixture_rel_path);
  if (!existsSync(target)) return;
  try {
    const original = readFileSync(target);
    // The pre-run snapshot already captured the pristine
    // bytes. If it is missing (e.g. prepareLeak06 was not
    // called), capture it here as a last resort.
    if (
      leak06Snapshot === null ||
      leak06Snapshot.target !== target
    ) {
      leak06Snapshot = { target, original };
    }
    writeFileSync(target, original.toString("utf8") + "\nLEAK06");
  } catch {
    // ignore
  }
}

/**
 * Restore the LEAK06 target to its pre-mutation state.
 * Best-effort; called from the worker module on graceful
 * shutdown so subsequent runs / tests see the original
 * fixture.
 */
export function restoreLeak06(): void {
  if (leak06Snapshot === null) return;
  try {
    writeFileSync(leak06Snapshot.target, leak06Snapshot.original);
  } catch {
    // ignore
  } finally {
    leak06Snapshot = null;
  }
}

/**
 * Run a single canonical epoch.
 */
export async function runEpoch(args: {
  readonly state: SoakWorkerState;
  readonly epochIndex: number;
}): Promise<{ readonly ok: boolean; readonly failure?: LH06FailureKind }> {
  const state = args.state;
  state.epochs_completed += 1;
  const epochStart = Date.now();

  const ws = allocateEpochWorkspace({
    runId: state.runId,
    epochIndex: args.epochIndex,
  });
  state.ledger.acquireWorkspace(`epoch-${args.epochIndex}`, ws.path);
  let predecessor: string | null = null;

  try {
    applyInjectionAtEpochStart(state, args.epochIndex);
    if (args.epochIndex === 0) applyLeak06(state);
    await runCanaryBefore(state, args.epochIndex);
    predecessor = "CANARY_LC01";

    const sched = scheduleForEpoch(args.epochIndex);
    for (const c of sched) {
      if (c.case_id === "INTEGRITY_CHECKPOINT") {
        if (!integrityCheckpoint(state)) {
          emitFailure(state, "FROZEN_MUTATION", {
            epoch: args.epochIndex,
            case: "INTEGRITY_CHECKPOINT",
          });
          return { ok: false, failure: "FROZEN_MUTATION" };
        }
        continue;
      }
      if (c.case_id === "CLEANUP_CHECKPOINT") {
        // The CLEANUP_CHECKPOINT is intentionally a NO-OP
        // during the schedule walk — it fires AFTER the
        // workspace release, see the post-loop section below.
        continue;
      }
      if (c.case_id === "CANARY_LC01") {
        await runCanaryAfter(state, args.epochIndex);
        if (
          state.injection.kind === "LEAK04_SEMANTIC_DRIFT_AT_EPOCH" &&
          state.injection.at_epoch === args.epochIndex
        ) {
          state.semanticLedger.recordObservation({
            case_id: "CANARY_LC01",
            source: "CANARY",
            epoch_index: args.epochIndex,
            predecessor: "INJECTED_DRIFT",
            digest: "deadbeef".repeat(8),
          });
        }
        predecessor = "CANARY_LC01";
        continue;
      }
      if (c.source === "LH05") {
        await runLh05Case(state, c.case_id, args.epochIndex, predecessor);
        if (
          state.injection.kind === "LEAK04_SEMANTIC_DRIFT_AT_EPOCH" &&
          state.injection.at_epoch === args.epochIndex
        ) {
          state.semanticLedger.recordObservation({
            case_id: c.case_id,
            source: "LH05",
            epoch_index: args.epochIndex,
            predecessor: c.case_id,
            digest: "deadbeef".repeat(8),
          });
        }
      } else if (c.source === "LH04") {
        await runLh04Case(state, c.case_id, args.epochIndex, predecessor);
      }
      predecessor = c.case_id;
      if (state.leak05PerEpochMs > 0) {
        // L06-CORRECTION03 L06-C19: LEAK05 is a
        // PER-EPOCH latency drift. To produce a visible
        // drift, multiply by the epoch index so the
        // sleep grows over the run. Without this, the
        // per-case sleep is dwarfed by the natural
        // case-execution latency and the drift ratio
        // never exceeds the threshold.
        const sleepMs = state.leak05PerEpochMs * (args.epochIndex + 1);
        await new Promise<void>((r) => setTimeout(r, sleepMs));
      }
    }

    if (cadenceHit({
      epoch_index: args.epochIndex,
      cadence_n: LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS,
    })) {
      captureResourceSample(state);
    }

    if (
      state.injection.kind === "LEAK07_STOP_HEARTBEATS_AFTER" &&
      args.epochIndex >= state.injection.after_epoch
    ) {
      state.leak07StoppedHeartbeats = true;
    }

    // Run cleanup checkpoint BEFORE closing the workspace,
    // so a workspace-leak can be observed by the checkpoint.
    // The checkpoint verifies the production balance is
    // zero. Note: this includes the epoch's workspace, so
    // the worker MUST release the workspace BEFORE the
    // checkpoint passes. We do this by closing the workspace
    // first, then running the checkpoint, then releasing
    // the ledger entry.
    closeEpochWorkspace(ws);
    state.ledger.releaseWorkspace(`epoch-${args.epochIndex}`);

    if (!cleanupCheckpoint(state)) {
      emitFailure(state, "RESOURCE_LEAK", {
        epoch: args.epochIndex,
        case: "CLEANUP_CHECKPOINT",
      });
      return { ok: false, failure: "RESOURCE_LEAK" };
    }

    const duration = Date.now() - epochStart;
    state.epochLatenciesMs.push(duration);
    emitHeartbeat(state);
    return { ok: true };
  } catch (err) {
    try {
      closeEpochWorkspace(ws);
      state.ledger.releaseWorkspace(`epoch-${args.epochIndex}`);
    } catch {
      // ignore
    }
    emitFailure(state, "WORKER_CRASH", {
      epoch: args.epochIndex,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, failure: "WORKER_CRASH" };
  } finally {
    emitDiagnosticLine(state, args.epochIndex);
  }
}
