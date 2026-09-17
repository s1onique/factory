/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure single-pass counter derivation over the ordered
 * Phase E evidence stream.
 *
 * Doctrine (M4):
 *   "Definitions MUST come from Phase-E events, not
 *    heuristics over text."
 *
 * Every counter in this module is mechanical: it walks the
 * event array once and counts. No heuristics over message
 * fields, no parsing of strings, no inference from non-event
 * shapes.
 *
 * The function returns structurally identical output for the
 * same input array (M2 — same-input -> same-output oracle).
 *
 * The structural counters (action / gate / repair / review)
 * are walked HERE in a single linear pass. The
 * authority-channel counters (M-C08 / M-C09) are delegated to
 * `metric-authority.ts`, which produces BOTH the
 * closure-channel invalidation count AND the orthogonal
 * review-blocker activation count from a SINGLE pure walk so
 * the metric has ONE interpretation of the frozen Phase E
 * precedence model (M-C09).
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent, RunEvent } from "../run/run-types.js";

/**
 * Pure structural counters derived from the ordered Phase E
 * event stream. Re-imported here to keep this module
 * self-contained; the actual `Counters` type lives in
 * `metric-types.ts`.
 */
import type { Counters } from "./metric-types.js";
import { walkAuthority } from "./metric-authority.js";

/**
 * Per-event structural counters accumulated during the
 * single forward pass. Authority-channel counts come from
 * `walkAuthority` rather than from this accumulator (M-C09).
 */
type CounterAccumulator = {
  action_count: number;
  successful_action_count: number;
  failed_action_count: number;
  gate_count: number;
  passing_gate_count: number;
  failing_gate_count: number;
  repair_cycle_count: number;
  review_count: number;
  passing_review_count: number;
  failing_review_count: number;
  /**
   * Work epoch as we walk the stream, mirroring Phase E's
   * E-C14 V2 rule: increments on ACTION_STARTED,
   * REPAIR_STARTED, and ACTION_FINISHED(ERROR).
   */
  workEpoch: number;
};

function emptyAccumulator(): CounterAccumulator {
  return {
    action_count: 0,
    successful_action_count: 0,
    failed_action_count: 0,
    gate_count: 0,
    passing_gate_count: 0,
    failing_gate_count: 0,
    repair_cycle_count: 0,
    review_count: 0,
    passing_review_count: 0,
    failing_review_count: 0,
    workEpoch: 0,
  };
}

/**
 * Apply one event's contribution to the counter accumulator.
 * Pure: no I/O, no mutation outside the accumulator.
 *
 * Counts closed (FINISHED) variants of each lifecycle pair
 * for the structural counter section (M4). Also walks the
 * Phase E E-C14 V2 work-epoch transition and the
 * fresh-positive-authority invariant so we can count
 * `historical_authority_invalidation_count` (M6 historical
 * correction burden, CORRECTION01).
 *
 * For ACTION we deliberately count ACTION_FINISHED rather
 * than ACTION_STARTED so that open attempts that never
 * close do not inflate `action_count`. Phase E's legality
 * machinery will already reject an ACTION_FINISHED without
 * a matching ACTION_STARTED upstream, so the projection of
 * this count cannot exceed the actual closed-attempt count.
 */
function applyEvent(
  acc: CounterAccumulator,
  event: CommittedRunEvent,
): void {
  const inner: RunEvent = event.event;
  switch (inner.type) {
    case "ACTION_STARTED":
      // E-C14 V2: ACTION_STARTED is the general harness-work
      // primitive and advances the work epoch. Authority-
      // channel effects (invalidation of fresh positive
      // closure authority) are now derived in
      // `metric-authority.ts` (CORRECTION02 M-C09).
      acc.workEpoch += 1;
      return;
    case "ACTION_FINISHED":
      acc.action_count += 1;
      if (inner.status === "OK") {
        acc.successful_action_count += 1;
      } else if (inner.status === "ERROR") {
        acc.failed_action_count += 1;
        // E-C21: ACTION_FINISHED(ERROR) is authoritative
        // negative execution evidence; it advances the
        // work epoch. (E-C14 V2 rule.)
        acc.workEpoch += 1;
      }
      return;
    case "GATE_FINISHED":
      acc.gate_count += 1;
      if (inner.pass === true) {
        acc.passing_gate_count += 1;
        // Authority-channel effect (establishing fresh
        // positive closure authority) is derived in
        // `metric-authority.ts`.
      } else {
        acc.failing_gate_count += 1;
      }
      return;
    case "REPAIR_STARTED":
      // E-C14 V2: REPAIR_STARTED advances work epoch.
      acc.workEpoch += 1;
      return;
    case "REPAIR_FINISHED":
      acc.repair_cycle_count += 1;
      return;
    case "REVIEW_FINISHED":
      acc.review_count += 1;
      if (inner.pass === true) {
        acc.passing_review_count += 1;
        // E-C22: REVIEW_FINISHED(true) supersedes a failing
        // verdict at the same work epoch. It does NOT
        // establish fresh positive closure authority on the
        // closure-authority channel — only a passing
        // GATE_FINISHED does. Review-blocker state is
        // maintained in `metric-authority.ts`.
      } else {
        acc.failing_review_count += 1;
        // E-C22: REVIEW_FINISHED(false) at the current
        // work epoch is authoritative negative review
        // evidence — but it acts on the ORTHOGONAL
        // review-blocker channel, not the closure-authority
        // channel (CORRECTION02 M-C08).
      }
      return;
    default:
      // Other event types intentionally contribute nothing
      // to structural counters or to authority tracking.
      // Including RUN_STARTED would inflate `action_count`-
      // like metrics with lifecycle markers, which the ACT
      // forbids.
      return;
  }
}

/**
 * Derive the full Counters vector from an ordered Phase E
 * evidence stream.
 *
 * `work_epoch_count` is taken from the projector-supplied
 * `RunProjection.work_epoch` rather than re-derived here.
 * Doing so binds the metric to the same authority Phase E
 * uses for the success predicate, and avoids two
 * independent epochs living in the report.
 *
 * Phase E `work_epoch` is zero at RUN_STARTED and
 * increments on every ACTION_STARTED / REPAIR_STARTED. The
 * "count of distinct work epochs observed" is exactly
 * that number, so we just lift it verbatim.
 */
export function deriveCounters(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
  workEpochFromProjection: number,
): Counters {
  const acc = walkCounters(orderedEvents);
  return {
    action_count: acc.action_count,
    successful_action_count: acc.successful_action_count,
    failed_action_count: acc.failed_action_count,
    gate_count: acc.gate_count,
    passing_gate_count: acc.passing_gate_count,
    failing_gate_count: acc.failing_gate_count,
    repair_cycle_count: acc.repair_cycle_count,
    completed_repair_cycle_count: acc.repair_cycle_count,
    review_count: acc.review_count,
    passing_review_count: acc.passing_review_count,
    failing_review_count: acc.failing_review_count,
    work_epoch_count: workEpochFromProjection,
  };
}

/**
 * Read the orthogonal authority-channel counters from the
 * canonical authority walk (CORRECTION02 M-C08 / M-C09).
 *
 * Re-exposed here so `metric-distances.ts` and the
 * `CorrectionBurden` derivation consume the SAME walk
 * result rather than re-walking the stream themselves.
 *
 * The historical closure-invalidation count is the
 * CORRECTION02 definition: events that staled previously
 * established POSITIVE closure authority. REVIEW_FINISHED
 * events no longer contribute here; they live on the
 * orthogonal review-blocker channel and are surfaced as
 * `historical_review_blocker_activation_count`.
 */
export function deriveAuthorityChannels(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): {
  readonly historical_authority_invalidation_count: number;
  readonly historical_review_blocker_activation_count: number;
  readonly freshPositiveAuthority: boolean;
  readonly reviewBlockerOpen: boolean;
  readonly lastAuthoritativeGatePosition: number | null;
} {
  const w = walkAuthority(orderedEvents);
  return {
    historical_authority_invalidation_count:
      w.closure_authority_invalidation_count,
    historical_review_blocker_activation_count:
      w.review_blocker_activation_count,
    freshPositiveAuthority: w.fresh_closure_authority,
    reviewBlockerOpen: w.review_blocker_open_at_end,
    lastAuthoritativeGatePosition: w.last_authoritative_gate_position,
  };
}

/**
 * Back-compat alias for `deriveAuthorityChannels`, kept so
 * prior callers / tests can still request the closure-
 * channel invalidation count by its previous name.
 *
 * New code SHOULD prefer `deriveAuthorityChannels` so the
 * review-blocker channel is visible.
 */
export function deriveAuthorityInvalidation(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): {
  readonly historical_authority_invalidation_count: number;
  readonly freshPositiveAuthority: boolean;
} {
  const w = deriveAuthorityChannels(orderedEvents);
  return {
    historical_authority_invalidation_count:
      w.historical_authority_invalidation_count,
    freshPositiveAuthority: w.freshPositiveAuthority,
  };
}

/**
 * Internal: single forward pass that produces the full
 * accumulator. Pure: same input -> same output.
 */
function walkCounters(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): CounterAccumulator {
  const acc = emptyAccumulator();
  for (const e of orderedEvents) {
    applyEvent(acc, e);
  }
  return acc;
}
