// (FOUNDATION04 PHASE A — LIVENESS01-CORRECTION01-MICROFIX13)
//
// Ambient type declarations for the qualifier's
// exported `runDeadlineCleanup` helper. LIV16,
// LIV17, LIV18, LIV19, LIV20, LIV21, and LIV22
// import this helper for behavioral adversarial
// testing against an injected fake ChildProcess.
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
//
// MICROFIX12: SYNCHRONOUS-SHORT-CIRCUIT
// REMOVED. The MF11 synchronous-completion
// short-circuit (when kill=false or kill throws
// synchronously AND no listener has fired yet)
// set `closedByTimeout=true` immediately,
// before the observation timer had actually
// fired. That was synthetic timeout evidence.
// MF12 removes that bypass entirely: signal
// can settle immediately on kill=false or
// throw, but termination ALWAYS waits for
// either `'close'` or the real observation
// deadline. `closedByTimeout=true` is now
// set ONLY inside `finalizeTimeout()` — the
// timer is the sole authority. LIV21 cells
// X/Y/Z/AA pin this invariant.
//
// MICROFIX13: PRESERVE ERROR CHANNEL AFTER
// KILL-RESULT / THROW. MF12 correctly stopped
// closing the termination dimension on
// synchronous signal failure, but it still
// removed the `'error'` listener on
// `finalizeSignal("killResult", ...)` and
// `finalizeSignal("throw", ...)`. Node
// documents that `'error'` MAY be emitted
// after `kill()` returns false (the signal
// couldn't be delivered). MF12's own
// priority law —
//   `observed.error > threw > killResult` —
// demands that a later typed `'error'` be
// able to UPGRADE the signal value
// (e.g. FAILED → PERMISSION_DENIED). The
// listener-removal was destroying that
// upgrade channel. MF13 gates
// `listenerRemoved.error` on `reason ===
// "error"` so the `'error'` listener stays
// armed through kill=false / throw paths and
// can still deliver typed evidence before
// the observation envelope closes.
// LIV22 cells AB/AC/AD/AE pin the
// preservation property.

export type CleanupOutcome =
  | "SIGNAL_ACCEPTED"
  | "SIGNAL_ACCEPTED_UNCONFIRMED"
  | "PERMISSION_DENIED"
  | "FAILED"
  | "NOT_ATTEMPTED";

export type Reclassification = "PERMISSION_DENIED" | "FAILED";

// MICROFIX09 — orthogonal dimensions.
//
// `ACCEPTED` means: kill() returned true and
// no higher-authority failure evidence was
// observed before the observation envelope
// closed. An `'error'` event does NOT confirm
// delivery — in the helper's classifier it
// indicates failure (PERMISSION_DENIED via
// EPERM, or FAILED via any other code).
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
  // MICROFIX11/12 — `closedByTimeout` is true
  // iff the ACTUAL observation deadline
  // fired (i.e. `finalizeTimeout()` ran).
  // Under MF12 this is set ONLY inside
  // `finalizeTimeout()` — never by any
  // synchronous kill-failure short-circuit.
  // LIV21 pins this invariant via a
  // source-level regex on `closedByTimeout
  // = true`.
  closedByTimeout: boolean;
}

export const runDeadlineCleanup: (
  args: RunDeadlineCleanupArgs,
) => Promise<RunDeadlineCleanupResult>;
