/**
 * _seq05_admission_semaphore.ts
 *
 * (FOUNDATION04 PHASE A — REBURN-CORRECTION01)
 *
 * Test-side deterministic admission semaphore for
 * SEQ05. Replaces the reburn-falsified
 * probe-before-call admission-pacing abstraction.
 *
 * ─────────────────────────────────────────────────
 * WHY THIS REPLACES PROBE PACING
 * ─────────────────────────────────────────────────
 *
 * The reburn measured:
 *
 *   probe_refused_total                  = 27
 *   pacing_rescued_calls                 = 22
 *   canonical_failed_after_pacing_calls  = 5
 *   canonical_invoked_total              = 1000
 *
 * Meaning:
 *
 *   probe succeeded
 *   → probe closed
 *   → canonical connection raced independently
 *   → canonical ECONNREFUSED
 *
 * Probe-before-call is observation, not
 * capability. A successful disposable probe does
 * NOT grant transport capacity to a subsequent
 * canonical connection. (LAW B.)
 *
 * Therefore SEQ05 MUST NOT depend on probe pacing
 * for correctness. It must own its admission
 * budget through a deterministic semaphore that
 * bounds CONCURRENT canonical transport attempts.
 *
 * ─────────────────────────────────────────────────
 * SEMANTICS
 * ─────────────────────────────────────────────────
 *
 *   AdmissionSemaphore(N)
 *     withPermit(work):
 *       await permit  // bounded by N concurrent
 *       try { return await work() }
 *       finally { release() }
 *
 * Properties (mechanically pinned by ADM01..ADM08):
 *
 *   - active <= limit always
 *   - FIFO order unless documented otherwise
 *   - permit released in `finally`
 *   - permit released on success / returned error /
 *     thrown harness fault
 *   - no randomness, no wall-clock sleeps
 *   - no production imports
 *   - no mutation of caller identity
 *   - no retry of work
 *
 * ─────────────────────────────────────────────────
 * CONCURRENCY MODEL
 * ─────────────────────────────────────────────────
 *
 * Node.js event-loop serialisation makes
 * single-process mutation between awaits atomic.
 * The semaphore does not need locks: every
 * `active`, `queue`, `maxObservedActive`
 * mutation happens between awaits.
 *
 * `await permit` resolves when the FIFO queue
 * reaches the front AND `active < limit`. The
 * permit increment happens before `permit` is
 * observed by the next waiter, guaranteeing
 * `active <= limit` invariant even under burst
 * scheduling.
 *
 * ─────────────────────────────────────────────────
 * DEPENDENCY DIRECTION
 * ─────────────────────────────────────────────────
 *
 * Test-only module. NO production imports. NO
 * frozen-grammar reach-through. The semaphore
 * operates on opaque work functions and never
 * inspects the canonical LedgerWriter wire
 * protocol, lease, or sequence semantics.
 */

export type AdmissionSemaphore = {
  readonly limit: number;
  readonly active: () => number;
  readonly maxObservedActive: () => number;
  readonly queued: () => number;
  withPermit<T>(work: () => Promise<T>): Promise<T>;
};

/**
 * Construct a deterministic FIFO admission
 * semaphore.
 *
 * `limit` MUST be a positive integer. The
 * constructor throws on non-positive values so
 * SEQ05 cannot silently misconfigure.
 */
export function makeAdmissionSemaphore(limit: number): AdmissionSemaphore {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `makeAdmissionSemaphore: limit must be a positive integer; got ${limit}`,
    );
  }

  let active = 0;
  let maxObserved = 0;
  // FIFO queue. Each entry holds the resolver for
  // the next permit. We do not capture the work
  // itself — the caller awaits `withPermit()` which
  // suspends on a fresh promise until dequeued.
  const queue: Array<() => void> = [];

  function release(): void {
    if (active <= 0) {
      // Structural invariant violation: a permit
      // was released without being held. This is a
      // harness programming fault; surface it
      // loudly.
      throw new Error(
        "AdmissionSemaphore: release() called with no held permit",
      );
    }
    active -= 1;
    // Hand the permit to the next waiter (FIFO).
    const next = queue.shift();
    if (next !== undefined) {
      active += 1;
      if (active > maxObserved) maxObserved = active;
      next();
    }
  }

  return {
    limit,
    active: () => active,
    maxObservedActive: () => maxObserved,
    queued: () => queue.length,
    async withPermit<T>(work: () => Promise<T>): Promise<T> {
      // Wait for a permit (FIFO). If a permit is
      // available immediately, skip the queue.
      if (active < limit) {
        active += 1;
        if (active > maxObserved) maxObserved = active;
      } else {
        await new Promise<void>((resolve) => {
          queue.push(resolve);
        });
      }
      // `active` is guaranteed to be > 0 here (we
      // incremented on the fast path or on shift
      // during release).
      try {
        return await work();
      } finally {
        // Release whether work returned normally,
        // returned a rejected promise, or threw a
        // synchronous harness fault.
        release();
      }
    },
  };
}

/**
 * Convenience type alias for the canonical
 * LedgerWriter append argument identity triple.
 * The semaphore MUST preserve these fields
 * verbatim; ADM06 enforces that.
 */
export type CanonicalAppendIdentity = Readonly<{
  commitId: string;
  clientContentHash: string;
  event: Readonly<Record<string, unknown>>;
}>;
