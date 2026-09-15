// (FOUNDATION04 PHASE A — LIVENESS01-CORRECTION01-MICROFIX11)
//
// Ambient type declarations for the qualifier's
// exported `runDeadlineCleanup` helper. LIV16,
// LIV17, LIV18, LIV19, and LIV20 import this
// helper for behavioral adversarial testing
// against an injected fake ChildProcess.
//
// MICROFIX07: removed `pendingCleanupReclassification`
// from `state` (the helper no longer reads it —
// sync lifecycle listeners classify directly via
// `classifyCleanupError`).
//
// MICROFIX08: the `catch (err)` block no longer
// mutates `state.cleanupOutcome` independently.
// All outcome mutation now goes through
// `finalize()`, so the `settled` guard governs
// BOTH Promise resolution AND semantic outcome
// (first-observation-wins).
//
// MICROFIX09: signalAttempt and
// terminationObservation are TWO ORTHOGONAL
// dimensions of truth. The legacy single-string
// `cleanupOutcome` is now DERIVED from the
// product, not authoritative. LIV18 pins the
// product algebra.
//
// MICROFIX10: per-dimension settlement flags
// (`signalSettled`, `terminationSettled`) replace
// the single global `settled` flag, so the two
// dimensions are observed TRULY independently.
// The 'close' event PROMOTES 'exit' along a
// monotonic lattice. LIV19 pins the orthogonal
// observation machine with cells that assert
// BOTH dimensions survive regardless of event
// ordering.
//
// MICROFIX11: COMPLETION BOUNDARY (Option A).
// `'close'` is the strongest terminal observation
// in the lattice; the helper WAITS for it (or
// for the observation window to expire) before
// resolving. All close-out paths funnel through
// a single idempotent `finishOperation()` which
// cancels the timer and removes every listener
// so no refs outlive the returned result. The
// flag `anyListenerFired` is renamed
// `lifecycleOrErrorEventObserved` and is mutated
// ONLY from the listener handlers themselves
// (never from `killResult`/`throw` processing).
// Result shape gains `closedByTimeout` — explicit
// proof the observation window expired versus
// resolved naturally because all dim-specific
// listeners fired. LIV20 pins async exit-then-
// close fidelity and clean timer/listener
// teardown.

export type CleanupOutcome =
  | "SIGNAL_ACCEPTED"
  | "SIGNAL_ACCEPTED_UNCONFIRMED"
  | "PERMISSION_DENIED"
  | "FAILED"
  | "NOT_ATTEMPTED";

export type Reclassification = "PERMISSION_DENIED" | "FAILED";

// MICROFIX09 — orthogonal dimensions.
export type SignalAttempt =
  | "NOT_ATTEMPTED"
  | "ACCEPTED"
  | "PERMISSION_DENIED"
  | "FAILED";

export type TerminationObservation =
  | "NOT_OBSERVED"
  | "EXIT_OBSERVED"
  | "CLOSE_OBSERVED";

export interface FakeChildLike {
  kill: (signal: string) => boolean;
  on: (event: string, fn: (...args: any[]) => any) => any;
  removeListener: (event: string, fn: (...args: any[]) => any) => any;
}

export interface RunDeadlineCleanupArgs {
  child: FakeChildLike;
  observationWindowMs: number;
  classifyCleanupError: (err: any) => Reclassification;
  state: {
    cleanupOutcome?: CleanupOutcome | string;
  };
}

export interface RunDeadlineCleanupResult {
  killResult: boolean;
  threw: boolean;
  cleanupOutcome: CleanupOutcome | string;
  signalAttempt: SignalAttempt;
  terminationObservation: TerminationObservation;
  observed: {
    error: boolean;
    exit: boolean;
    close: boolean;
    timedOut: boolean;
  };
}

export const runDeadlineCleanup: (
  args: RunDeadlineCleanupArgs,
) => Promise<RunDeadlineCleanupResult>;
