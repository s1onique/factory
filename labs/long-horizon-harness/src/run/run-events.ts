/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Lifecycle legality checker (E13).
 *
 * The Phase E state machine is intentionally minimal. Phase E does
 * NOT compute a `RunState` the way the FOUNDATION01 reducer does;
 * it computes a `RunProjection` that distinguishes:
 *
 *   ACTIVE
 *   TERMINAL          (single, derivable terminal_outcome)
 *   INCOMPLETE        (no terminal event observed yet)
 *   INVALID_EVIDENCE  (state machine or sequence violation)
 *
 * The state machine rejects:
 *
 *   - non-monotonic sequence
 *   - sequence gap (must be exactly last_sequence + 1)
 *   - duplicate event_id with different content (E10)
 *   - event before RUN_STARTED
 *   - second RUN_STARTED
 *   - HARNESS_STOPPED before HARNESS_STARTED
 *   - GATE_STARTED without an open attempt
 *   - GATE_FINISHED without a matching open gate
 *   - REPAIR_FINISHED without a matching open repair
 *   - REVIEW_FINISHED without a matching open review
 *   - ACTION_FINISHED without a matching open attempt
 *   - terminal event after a successful terminal claim (E6)
 *   - two incompatible terminal claims (E6)
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent, TerminalSemantic } from "./run-types.js";
import { canonicalEventBytes } from "./run-serialize.js";

import {
  applyActionFinished,
  applyActionStarted,
  applyGateFinished,
  applyGateStarted,
  applyHarnessStarted,
  applyHarnessStopped,
  applyRepairFinished,
  applyRepairStarted,
  applyReviewFinished,
  applyReviewStarted,
  applyTerminal,
} from "./run-events-helpers.js";

export type LegalityFailure =
  | { readonly kind: "event_before_run_started"; readonly reason: string }
  | { readonly kind: "second_run_started"; readonly reason: string }
  | { readonly kind: "illegal_sequence"; readonly reason: string }
  | { readonly kind: "duplicate_event_id_with_changed_content"; readonly reason: string }
  | { readonly kind: "harness_stopped_without_start"; readonly reason: string }
  | { readonly kind: "gate_started_without_open_attempt"; readonly reason: string }
  | { readonly kind: "gate_finished_without_open_gate"; readonly reason: string }
  | { readonly kind: "repair_finished_without_open_repair"; readonly reason: string }
  | { readonly kind: "review_finished_without_open_review"; readonly reason: string }
  | { readonly kind: "action_finished_without_open_attempt"; readonly reason: string }
  | { readonly kind: "semantic_event_after_terminal"; readonly reason: string }
  | { readonly kind: "conflicting_terminal"; readonly reason: string };

export type LegalityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: LegalityFailure };

/**
 * Internal mutable tracker used by the projector. The projector
 * folds each event through `applyLegality` and consults the
 * tracker to decide whether the next event is legal.
 *
 * Tracker is a plain object the projector owns. It is intentionally
 * not exposed as part of the public Phase E API.
 */
export type LegalityTracker = {
  seenRunStarted: boolean;
  seenTerminal: boolean;
  terminalSemantic: TerminalSemantic | null;
  harnessStarted: boolean;
  harnessStopped: boolean;
  openAttemptId: string | null;
  openGateId: string | null;
  openGateAttemptId: string | null;
  openRepairId: string | null;
  openReviewId: string | null;
  /**
   * E-C02 authoritative-success predicate counters. The
   * projector maintains these while folding so it can decide
   * whether a SUCCESS claim is supported by independent
   * evidence without rescanning the event stream.
   */
  actionFinishedCount: number;
  passingGateCount: number;
  lastGateFinishedId: string | null;
  lastGateFinishedAttemptId: string | null;
  lastGateFinishedPass: boolean | null;
  /**
   * E-C14 — closure-authority epoch model.
   *
   * `workEpoch` is a monotonic counter advanced by any event
   * that can make previously validated work stale. A successful
   * closure gate records `(closureGateEpoch, closureGatePass)`:
   * the work epoch at the moment the gate closed and the gate's
   * pass/fail verdict. SUCCESS requires
   *
   *   closureGatePass === true
   *     && closureGateEpoch === workEpoch
   *     && no open structural scopes
   *
   * so any later epoch-advancing event invalidates the prior
   * gate authority. This replaces the stale
   * `lastGateFinishedPass` boolean with explicit freshness.
   *
   * V2 rule (frozen by CORRECTION04): both `ACTION_STARTED` and
   * `REPAIR_STARTED` advance the work epoch. Rationale: ACTION
   * is the general harness-work primitive. Until an action is
   * mechanically proven read-only, activity after a passing
   * qualification must stale that qualification. The desired
   * property is:
   *
   *   work -> gate PASS -> success                          OK
   *   work -> gate PASS -> more work -> success             INVALID
   *   work -> gate PASS -> more work -> gate PASS -> success OK
   *
   * i.e. SUCCESS requires a fresh passing gate at the CURRENT
   * work epoch. The open-scope check still catches any attempt
   * or repair that was never closed before terminal closure;
   * the epoch check additionally catches the subtler case of a
   * completed-then-properly-closed action after a gate.
   */
  workEpoch: number;
  closureGateEpoch: number | null;
  closureGatePass: boolean | null;
  /**
   * E-C21 — ACTION_FINISHED(ERROR) is authoritative negative
   * execution evidence and stales any prior positive gate
   * authority. We capture the work epoch at which the most
   * recent action ERROR was observed so the projection can
   * surface it as diagnostic state (E-C23) and the success
   * predicate can reject the SUCCESS claim as long as no
   * later work advanced the epoch.
   *
   * E-C22 — REVIEW_FINISHED(pass=false) is also authoritative
   * negative evidence. The same epoch-tracking discipline
   * applies: `reviewVerdictEpoch` records the work epoch at
   * the most recent REVIEW_FINISHED, and `reviewVerdictPass`
   * records its pass value. A later review at the same work
   * epoch with pass=true may supersede an earlier failing
   * verdict; a later ACTION_STARTED / REPAIR_STARTED advances
   * the work epoch and makes the prior verdict historical.
   *
   * Precedence:
   *   - ACTION_FINISHED(ERROR): invalidates prior positive
   *     closure authority at the current work epoch (E-C21).
   *   - REVIEW_FINISHED(false): blocks SUCCESS at the current
   *     work epoch (E-C22).
   *   - REVIEW_FINISHED(true): clears the failing-review block
   *     at the current work epoch (E-C22).
   *   - Subsequent ACTION_STARTED / REPAIR_STARTED advances
   *     workEpoch so any prior verdict is historical; a
   *     subsequent fresh gate then qualifies the modified
   *     artifact.
   */
  actionFailureAtEpoch: number | null;
  reviewVerdictEpoch: number | null;
  reviewVerdictPass: boolean | null;
  reviewFailureAtEpoch: number | null;
  /**
   * E-C23 — last observed ACTION_FINISHED status. Exposed so
   * the projection can surface the most recent negative
   * evidence without forcing operators to re-derive it from
   * raw stream archaeology.
   */
  lastActionStatus: "OK" | "ERROR" | null;
  /**
   * E-C23 — last observed REVIEW_FINISHED pass value.
   * Exposed for the same diagnostic reason.
   */
  lastReviewPass: boolean | null;
  /**
   * Event-id-to-canonical-content map. Used to detect same-id +
   * different-content corruption (E10). Keyed by the literal
   * RunEventId string.
   */
  eventIdToContent: Map<string, string>;
  /** last accepted sequence number. */
  lastSeq: number;
  /** counters maintained by the projector */
  repair_count: number;
  review_count: number;
};

export function emptyTracker(): LegalityTracker {
  return {
    seenRunStarted: false,
    seenTerminal: false,
    terminalSemantic: null,
    harnessStarted: false,
    harnessStopped: false,
    openAttemptId: null,
    openGateId: null,
    openGateAttemptId: null,
    openRepairId: null,
    openReviewId: null,
    actionFinishedCount: 0,
    passingGateCount: 0,
    lastGateFinishedId: null,
    lastGateFinishedAttemptId: null,
    lastGateFinishedPass: null,
    workEpoch: 0,
    closureGateEpoch: null,
    closureGatePass: null,
    actionFailureAtEpoch: null,
    reviewVerdictEpoch: null,
    reviewVerdictPass: null,
    reviewFailureAtEpoch: null,
    lastActionStatus: null,
    lastReviewPass: null,
    eventIdToContent: new Map<string, string>(),
    lastSeq: 0,
    repair_count: 0,
    review_count: 0,
  };
}

/**
 * Canonical bytes for the inner RunEvent payload. Used by the
 * event-id duplicate detector (E10): same event_id + same canonical
 * bytes is treated as idempotent (accepted); same event_id +
 * different bytes is rejected as duplicate-with-changed-content.
 *
 * E-C10: this re-exports the SINGLE authority
 * (`deterministicJson` from run-serialize.ts). The store,
 * projector, default EventIdSource, and envelope decoder
 * all consume the same encoder. There is no parallel
 * `canonicalEventBytes` implementation in Phase E.
 */
export { canonicalEventBytes } from "./run-serialize.js";

/**
 * Apply a single event to the tracker and return either ok or a
 * typed LegalityFailure. This is the ONLY entry point for state
 * transitions in Phase E.
 */
export function applyLegality(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  // (1) Sequence must be strictly monotonic +1.
  if (event.sequence !== tracker.lastSeq + 1) {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason:
          `sequence ${event.sequence} does not follow last sequence ${tracker.lastSeq}`,
      },
    };
  }

  // (2) Duplicate event_id detection (E10). Idempotent on
  //     identical content; rejected on differing content.
  const contentBytes = canonicalEventBytes(event.event);
  const prev = tracker.eventIdToContent.get(event.event_id);
  if (prev !== undefined) {
    if (prev !== contentBytes) {
      return {
        ok: false,
        failure: {
          kind: "duplicate_event_id_with_changed_content",
          reason:
            `event_id '${event.event_id}' already seen with different content`,
        },
      };
    }
    // Same id + same content: idempotently accepted. We still
    // record the sequence advance so the rest of the legality
    // chain runs; in practice a duplicate-id case is rare and
    // most callers should not produce them.
  }

  // (3) RUN_STARTED is the first legal event.
  if (event.event.type === "RUN_STARTED") {
    if (tracker.seenRunStarted) {
      return {
        ok: false,
        failure: {
          kind: "second_run_started",
          reason: "RUN_STARTED already observed for this run",
        },
      };
    }
    tracker.seenRunStarted = true;
    tracker.lastSeq = event.sequence;
    tracker.eventIdToContent.set(event.event_id, contentBytes);
    return { ok: true };
  }

  if (!tracker.seenRunStarted) {
    return {
      ok: false,
      failure: {
        kind: "event_before_run_started",
        reason: `event '${event.event.type}' observed before RUN_STARTED`,
      },
    };
  }

  // (4) No semantic event after terminal closure (E6).
  if (tracker.seenTerminal) {
    return {
      ok: false,
      failure: {
        kind: "semantic_event_after_terminal",
        reason:
          `event '${event.event.type}' observed after terminal closure '${tracker.terminalSemantic}'`,
      },
    };
  }

  // (5) Per-event legality checks.
  const r = applyNonStartLegality(tracker, event);
  if (!r.ok) return r;

  tracker.lastSeq = event.sequence;
  tracker.eventIdToContent.set(event.event_id, contentBytes);
  return { ok: true };
}

function applyNonStartLegality(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  switch (event.event.type) {
    case "HARNESS_STARTED":
      return applyHarnessStarted(tracker);
    case "HARNESS_STOPPED":
      return applyHarnessStopped(tracker);
    case "ACTION_STARTED":
      return applyActionStarted(tracker, event);
    case "ACTION_FINISHED":
      return applyActionFinished(tracker, event);
    case "GATE_STARTED":
      return applyGateStarted(tracker, event);
    case "GATE_FINISHED":
      return applyGateFinished(tracker, event);
    case "REPAIR_STARTED":
      return applyRepairStarted(tracker, event);
    case "REPAIR_FINISHED":
      return applyRepairFinished(tracker, event);
    case "REVIEW_STARTED":
      return applyReviewStarted(tracker, event);
    case "REVIEW_FINISHED":
      return applyReviewFinished(tracker, event);
    case "RUN_CANCEL_REQUESTED":
      // Non-terminal (E-C03). Cancellation REQUESTED is observation
      // of intent only; the run remains ACTIVE until a true terminal
      // event (RUN_ABORTED(CANCELLED) or RUN_TIMEOUT(CANCELLED))
      // arrives. No state mutation is performed here.
      return { ok: true };
    case "RUN_TIMEOUT":
    case "RUN_FINISHED":
    case "RUN_ABORTED":
      return applyTerminal(tracker, event);
    case "RUN_STARTED":
      return {
        ok: false,
        failure: {
          kind: "second_run_started",
          reason: "unreachable",
        },
      };
  }
  // Unreachable: the switch above is exhaustive over the
  // closed-world RunEventType union. Any future variant must
  // be added explicitly above; this fallthrough exists only
  // to satisfy the return-type checker and would be caught
  // by tests via the absence of an expected new case.
  return {
    ok: false,
    failure: {
      kind: "illegal_sequence",
      reason: `unknown event type '${String((event.event as { type: unknown }).type)}'`,
    },
  };
}
