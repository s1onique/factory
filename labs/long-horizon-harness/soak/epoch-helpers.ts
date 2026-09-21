/**
 * LH-06 deterministic long-duration soak laboratory — epoch
 * helpers (heartbeat, failure emission, sample capture,
 * injection start-of-epoch effects).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from epoch.ts for source-size discipline.
 */
import { cadenceHit, type TelemetryLine } from "./telemetry.js";
import { computeFrozenTreeDigest } from "./substrate-binding.js";
import type { SoakWorkerState } from "./worker-state.js";
import {
  LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS,
  LH06_FULL_DIAGNOSTIC_EVERY_N_EPOCHS,
  LH06_PROFILES,
} from "./contract.js";
import { verifyPerEpochReset } from "./cleanup.js";
import type { LH06FailureKind } from "./types.js";

/**
 * Heartbeat publisher. Writes one structured line per epoch
 * to stdout for the supervisor. LEAK07 disables heartbeats.
 */
export function emitHeartbeat(state: SoakWorkerState): void {
  if (state.leak07StoppedHeartbeats) return;
  const line: TelemetryLine = {
    kind: "HEARTBEAT",
    ts_ms: Date.now(),
    payload: {
      type: "LH06_HEARTBEAT",
      epoch: state.epochs_completed,
      completed_runs: state.cases_completed,
      run_id: state.runId,
    },
  };
  state.telemetry.push(line);
  try {
    process.stdout.write(JSON.stringify(line.payload) + "\n");
  } catch {
    // ignore
  }
}

export function emitFailure(
  state: SoakWorkerState,
  kind: LH06FailureKind,
  payload: unknown,
): void {
  const line: TelemetryLine = {
    kind: "FAILURE",
    ts_ms: Date.now(),
    payload: { type: "LH06_FAILURE", kind, ...(payload as object) },
  };
  state.telemetry.push(line);
  try {
    process.stdout.write(JSON.stringify(line.payload) + "\n");
  } catch {
    // ignore
  }
}

export function captureResourceSample(state: SoakWorkerState): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc;
  if (typeof g === "function") {
    try { g(); } catch { /* ignore */ }
  }
  const m = process.memoryUsage();
  state.heapSamples.push(m.heapUsed);
  state.rssSamples.push(m.rss);
}

export function applyInjectionAtEpochStart(
  state: SoakWorkerState,
  epochIndex: number,
): void {
  const inj = state.injection;
  switch (inj.kind) {
    case "LEAK01_RETAIN_BYTES_PER_EPOCH": {
      const buf = Buffer.alloc(inj.bytes);
      state.leak01RetainedBuffer.push(buf);
      state.ledger.trackInjectionRetainedBytes(inj.bytes);
      break;
    }
    case "LEAK02_LEAVE_WORKSPACE_OPEN": {
      if (epochIndex === 0) {
        state.leak02RetainedWorkspacePath =
          `/tmp/factory-lh06/${state.runId}/LEAK02-retained`;
        state.ledger.trackInjectionRetainedWorkspace(
          "leak02",
          state.leak02RetainedWorkspacePath,
        );
      }
      break;
    }
    case "LEAK03_RETAIN_OWNED_STREAM": {
      state.leak03RetainedStreamId = `leak03-${epochIndex}`;
      state.ledger.trackInjectionRetainedStream(state.leak03RetainedStreamId);
      break;
    }
    case "LEAK05_LATENCY_DRIFT_PER_EPOCH": {
      state.leak05PerEpochMs = inj.per_epoch_ms;
      break;
    }
    default:
      break;
  }
}

/**
 * Frozen-tree integrity checkpoint. Called once per epoch.
 *
 * L06-CORRECTION03 L06-C16: the digest result is a typed
 * `FrozenTreeDigestResult`. If the post-run digest is
 * `{ok:false}` (missing / unreadable / duplicate /
 * invalid), the integrity check MUST return false so the
 * worker surfaces FROZEN_MUTATION. The previous
 * `string | null` shape allowed a missing/unreadable
 * digest to silently PASS.
 */
export function integrityCheckpoint(state: SoakWorkerState): boolean {
  const after = computeFrozenTreeDigest(state.repoRoot);
  if (state.beforeFrozenSha === null) return true;
  // L06-C16: any non-OK digest is a FROZEN_MUTATION.
  if (!after.ok) return false;
  return after.digest === state.beforeFrozenSha;
}

export function cleanupCheckpoint(state: SoakWorkerState): boolean {
  // L06-CORRECTION02 C02-04: the per-epoch cleanup oracle
  // excludes `active_soak_runs` because that's a run-level
  // counter (it stays at 1 for the entire duration of a
  // soak). The full state-reset oracle
  // (verifyStateReset) is reserved for run-end checks.
  //
  // We check that every counter EXCEPT `active_soak_runs`
  // is zero, AND the per-epoch reset digest matches.
  const balance = state.ledger.productionBalance();
  const epochLevelNonZero = balance.nonzero.filter(
    (e) => e.counter !== "active_soak_runs",
  );
  const reset = verifyPerEpochReset(state.ledger);
  return reset.is_reset && epochLevelNonZero.length === 0;
}

export { LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS, LH06_FULL_DIAGNOSTIC_EVERY_N_EPOCHS };

/**
 * Determine whether the soak has satisfied its qualification
 * contract (BOTH duration and epoch count).
 */
export function qualificationMet(args: {
  readonly profile: "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";
  readonly duration_ms: number;
  readonly epochs_completed: number;
}): boolean {
  const pc = LH06_PROFILES[args.profile];
  return (
    args.duration_ms >= pc.minimum_wall_clock_ms &&
    args.epochs_completed >= pc.minimum_epochs
  );
}

export function emitDiagnosticLine(state: SoakWorkerState, epochIndex: number): void {
  if (!cadenceHit({
    epoch_index: epochIndex,
    cadence_n: LH06_FULL_DIAGNOSTIC_EVERY_N_EPOCHS,
  })) {
    return;
  }
  state.telemetry.push({
    kind: "EPOCH",
    ts_ms: Date.now(),
    payload: {
      type: "LH06_DIAGNOSTIC",
      epoch: epochIndex,
      rss: process.memoryUsage().rss,
      heap_used: process.memoryUsage().heapUsed,
      lh05_replays: state.lh05_replays,
      lh04_executions: state.lh04_executions,
      resource_balance_is_zero:
        state.ledger.productionBalance().is_zero,
    },
  });
}
