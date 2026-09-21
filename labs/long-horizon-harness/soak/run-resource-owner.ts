/**
 * LH-06 run-resource lifecycle owner.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C42)
 *
 * The production qualification ran for an hour, produced a
 * valid negative result, then crashed with:
 *
 *     ResourceLedger.endRun: unknown runId 7aab74ed17082938
 *
 * The cause was a DOUBLE begin/end release chain:
 *
 *     runSoakFromEnv()    -> beginRun + endRun  (outer)
 *     runSoakWorker()     -> beginRun + endRun  (inner, idempotent)
 *
 * Two ownership paths tried to release the same runId.
 * CORRECTION02 introduced "idempotent" wrappers that
 * silently swallowed the duplicate release, masking the
 * ownership defect. CORRECTION11 removes the duplicate
 * ownership rather than treating a double release as a
 * feature:
 *
 *   DOUBLE_RELEASE_IS_A_BUG (not DOUBLE_RELEASE_IS_IGNORED)
 *
 * `runSoakWorker()` is the SOLE begin/end owner. It calls
 * `acquireRun(state)` exactly once at the top of the loop
 * and `releaseRun(state)` exactly once in a `finally`. The
 * env entrypoint MUST NOT independently acquire or release
 * the run counter; it only constructs the state and
 * delegates to the worker.
 *
 * `releaseRun(state)` MUST throw when the runId is not held
 * — silence here is exactly the path that hides real
 * ownership defects.
 */

import type { SoakWorkerState } from "./worker-state.js";

/**
 * Acquire the production run counter for `state.runId`.
 *
 * Throws when the same runId is already held. This is the
 * ONLY legitimate acquire path; callers that need a fresh
 * acquisition MUST construct a fresh `SoakWorkerState`.
 */
export function acquireRun(state: SoakWorkerState): void {
  state.ledger.beginRun(state.runId);
}

/**
 * Release the production run counter for `state.runId`.
 *
 * Throws when the runId is not currently held by the
 * ledger. "Unknown runId" is a typed failure — callers that
 * swallow it are masking an ownership defect. Use
 * `tryAcquireRun` only when the caller has authoritative
 * knowledge that another path might have already released
 * (e.g. tests that drive the worker directly).
 */
export function releaseRun(state: SoakWorkerState): void {
  state.ledger.endRun(state.runId);
}

/**
 * Inspect the ledger's in-flight set without mutating it.
 * Used by tests to assert single-ownership invariants.
 */
export function isRunHeldByLedger(
  state: SoakWorkerState,
  runId: string,
): boolean {
  const ledger = state.ledger as unknown as {
    inFlightRuns?: Set<string>;
  };
  return ledger.inFlightRuns !== undefined && ledger.inFlightRuns.has(runId);
}

