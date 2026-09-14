// (FOUNDATION04 PHASE A — LIVENESS01-CORRECTION01-MICROFIX09)
//
// Ambient type declarations for the qualifier's
// exported `runDeadlineCleanup` helper. LIV16,
// LIV17, and LIV18 import this helper for
// behavioral adversarial testing against an
// injected fake ChildProcess.
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
