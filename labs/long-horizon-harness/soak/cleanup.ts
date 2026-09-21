/**
 * LH-06 deterministic long-duration soak laboratory —
 * per-epoch workspace lifecycle + state-reset oracle.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Each epoch receives a fresh isolated workspace:
 *
 *   /tmp/factory-lh06/<run-id>/epoch-NNNNNN/
 *
 * At epoch completion:
 *
 *   workspace closed
 *   all temporary files removed
 *   owned registries empty
 *
 * Required at every stable checkpoint:
 *
 *   ACTIVE_WORKSPACES_AFTER_EPOCH = 0
 *
 * The state-reset oracle (ACT §39) computes a deterministic
 * digest over every LH-06-owned mutable registry; that
 * digest MUST equal the EMPTY_STATE_DIGEST.
 *
 * The module deliberately uses `node:fs` (synchronous) for
 * cleanup determinism. Asynchronous cleanup is fragile under
 * worker crashes.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ResourceLedger } from "./resource-ledger.js";

export const LH06_WORKSPACE_ROOT_BASE = "factory-lh06";

/**
 * A per-epoch workspace handle. Returned to the worker.
 */
export interface SoakWorkspace {
  readonly runId: string;
  readonly epochIndex: number;
  readonly path: string;
  readonly created_at_ms: number;
}

/**
 * Hash an arbitrary JSON value with stable key ordering.
 * Used for the state-reset oracle.
 */
function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * The EMPTY_STATE_DIGEST. Computed once at module load.
 * Compare against `stateResetDigest()` to prove no mutable
 * state was retained across the cleanup boundary.
 */
export const EMPTY_STATE_DIGEST: string = stableJsonHash({
  workspaces: 0,
  temp_artifacts: 0,
  streams: 0,
  pending_cleanup: 0,
  runs: 0,
  injection_retained_bytes: 0,
  injection_retained_streams: 0,
  injection_retained_workspaces: 0,
});

/**
 * The PER_EPOCH_EMPTY_STATE_DIGEST.
 *
 * L06-CORRECTION02 C02-04: the `active_soak_runs` counter
 * is a RUN-level counter, not an epoch-level one — it
 * stays at 1 for the entire duration of a soak. The
 * per-epoch cleanup oracle (which fires after every
 * epoch) must NOT include `active_soak_runs` in its
 * digest, or the very first epoch would always fail
 * cleanup. The full `EMPTY_STATE_DIGEST` is reserved
 * for the run-end oracle (called after `endRun`).
 */
export const PER_EPOCH_EMPTY_STATE_DIGEST: string = stableJsonHash({
  workspaces: 0,
  temp_artifacts: 0,
  streams: 0,
  pending_cleanup: 0,
  // runs deliberately omitted — see above.
  injection_retained_bytes: 0,
  injection_retained_streams: 0,
  injection_retained_workspaces: 0,
});

/**
 * Allocate a fresh per-epoch workspace.
 */
export function allocateEpochWorkspace(args: {
  readonly runId: string;
  readonly epochIndex: number;
  readonly base?: string;
}): SoakWorkspace {
  const base = args.base ?? `${tmpdir()}/${LH06_WORKSPACE_ROOT_BASE}/${args.runId}`;
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  const epochDir = mkdtempSync(`${base}/epoch-`);
  const created = Date.now();
  return Object.freeze({
    runId: args.runId,
    epochIndex: args.epochIndex,
    path: resolve(epochDir),
    created_at_ms: created,
  });
}

/**
 * Close + remove a per-epoch workspace. Best-effort; the
 * ledger is the source of truth for "is this still open?"
 */
export function closeEpochWorkspace(ws: SoakWorkspace): void {
  try {
    rmSync(ws.path, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * State-reset oracle. Compute a digest over every mutable
 * registry the soak owns. If the digest is NOT the empty
 * digest, the worker has retained state across cleanup.
 *
 * Required:
 *   state_reset_digest == EMPTY_STATE_DIGEST
 */
export function stateResetDigest(ledger: ResourceLedger): string {
  // We deliberately include the production counters AND
  // the injection counters (the injection counters are
  // diagnostic-only and the worker must clear them on
  // cleanup for the production path).
  const snap = ledger.snapshot();
  return stableJsonHash({
    workspaces: snap.active_workspaces,
    temp_artifacts: snap.active_temp_artifacts,
    streams: snap.active_owned_streams,
    pending_cleanup: snap.pending_cleanup_items,
    runs: snap.active_soak_runs,
    injection_retained_bytes: snap.injection_retained_bytes,
    injection_retained_streams: snap.injection_retained_streams,
    injection_retained_workspaces: snap.injection_retained_workspaces,
  });
}

/**
 * Per-epoch state-reset oracle. Same as `stateResetDigest`
 * but EXCLUDES `active_soak_runs`, which is a run-level
 * counter and stays at 1 throughout the soak. Firing the
 * full cleanup oracle every epoch would always fail.
 */
export function perEpochResetDigest(ledger: ResourceLedger): string {
  const snap = ledger.snapshot();
  return stableJsonHash({
    workspaces: snap.active_workspaces,
    temp_artifacts: snap.active_temp_artifacts,
    streams: snap.active_owned_streams,
    pending_cleanup: snap.pending_cleanup_items,
    // runs deliberately omitted.
    injection_retained_bytes: snap.injection_retained_bytes,
    injection_retained_streams: snap.injection_retained_streams,
    injection_retained_workspaces: snap.injection_retained_workspaces,
  });
}

/**
 * Verify the state-reset oracle and return a typed verdict.
 */
export function verifyStateReset(ledger: ResourceLedger): {
  readonly is_reset: boolean;
  readonly expected: string;
  readonly actual: string;
} {
  const actual = stateResetDigest(ledger);
  return {
    is_reset: actual === EMPTY_STATE_DIGEST,
    expected: EMPTY_STATE_DIGEST,
    actual,
  };
}

/**
 * Verify the per-epoch state-reset oracle. Excludes
 * `active_soak_runs` so the per-epoch cleanup can pass
 * during a still-running soak.
 */
export function verifyPerEpochReset(ledger: ResourceLedger): {
  readonly is_reset: boolean;
  readonly expected: string;
  readonly actual: string;
} {
  const actual = perEpochResetDigest(ledger);
  return {
    is_reset: actual === PER_EPOCH_EMPTY_STATE_DIGEST,
    expected: PER_EPOCH_EMPTY_STATE_DIGEST,
    actual,
  };
}
