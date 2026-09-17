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
 * The walk also maintains `workEpoch` and
 * `freshPositiveAuthority` so that:
 *
 *   - `work_epoch_count` (already lifted from the
 *     projector-supplied work epoch) is independently
 *     reproducible from the event stream by mirroring
 *     Phase E's E-C14 V2 transition rule.
 *   - `historical_authority_invalidation_count` can be
 *     counted as the metric walks the same stream
 *     using Phase E's frozen precedence semantics.
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

/**
 * Per-event counters accumulated during a single forward pass.
 * The accumulator is intentionally plain mutable state so we
 * can stay linear in time; the publicly-returned `Counters`
 * value is constructed once at the end.
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
   * REPAIR_STARTED, and ACTION_FINISHED(ERROR). Used to
   * check whether a GATE_FINISHED / REVIEW_FINISHED event
   * happened at the CURRENT work epoch.
   */
  workEpoch: number;
  /**
   * True iff a passing closure gate has been observed at
   * the current work epoch (i.e. the projector would
   * consider closure authority fresh RIGHT NOW at this
   * point in the walk). Mirrors Phase E's
   * `closure_authority_fresh` invariant.
   */
  freshPositiveAuthority: boolean;
  /**
   * Count of events that invalidated previously established
   * positive closure authority. This is the HISTORICAL
   * correction burden; it survives later recovery (a later
   * ACTION_STARTED that re-establishes authority does NOT
   * subtract from this count).
   */
  historical_authority_invalidation_count: number;
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
    freshPositiveAuthority: false,
    historical_authority_invalidation_count: 0,
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
      // primitive and advances the work epoch. If fresh
      // positive authority existed (a passing gate at the
      // previous epoch), this event invalidates it.
      if (acc.freshPositiveAuthority) {
        acc.historical_authority_invalidation_count += 1;
        acc.freshPositiveAuthority = false;
      }
      acc.workEpoch += 1;
      return;
    case "ACTION_FINISHED":
      acc.action_count += 1;
      if (inner.status === "OK") {
        acc.successful_action_count += 1;
      } else if (inner.status === "ERROR") {
        acc.failed_action_count += 1;
        // E-C21: ACTION_FINISHED(ERROR) is authoritative
        // negative execution evidence; it both invalidates
        // fresh positive authority AND advances the work
        // epoch. (E-C14 V2 rule.)
        if (acc.freshPositiveAuthority) {
          acc.historical_authority_invalidation_count += 1;
          acc.freshPositiveAuthority = false;
        }
        acc.workEpoch += 1;
      }
      return;
    case "GATE_FINISHED":
      acc.gate_count += 1;
      if (inner.pass === true) {
        acc.passing_gate_count += 1;
        // A passing gate at the current work epoch
        // establishes fresh positive authority. Phase E
        // guarantees gates close at the current work epoch
        // (E-C14); the metric does NOT need to verify the
        // epoch separately.
        acc.freshPositiveAuthority = true;
      } else {
        acc.failing_gate_count += 1;
        // E-C14: a failing gate stales any prior passing
        // gate at the same work epoch.
        if (acc.freshPositiveAuthority) {
          acc.historical_authority_invalidation_count += 1;
          acc.freshPositiveAuthority = false;
        }
      }
      return;
    case "REPAIR_STARTED":
      // E-C14 V2: REPAIR_STARTED advances work epoch AND
      // invalidates fresh positive authority.
      if (acc.freshPositiveAuthority) {
        acc.historical_authority_invalidation_count += 1;
        acc.freshPositiveAuthority = false;
      }
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
        // verdict at the same work epoch; it does NOT
        // establish fresh positive closure authority (only
        // a passing GATE_FINISHED does).
      } else {
        acc.failing_review_count += 1;
        // E-C22: REVIEW_FINISHED(false) at the current
        // work epoch is authoritative negative review
        // evidence. (A REPAIR_STARTED before would have
        // advanced the epoch and made the verdict
        // historical.)
        if (acc.freshPositiveAuthority) {
          acc.historical_authority_invalidation_count += 1;
          acc.freshPositiveAuthority = false;
        }
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
 * Walk the ordered evidence stream once and return the
 * structural counters plus the historical authority-
 * invalidation count. Exposed separately from
 * `deriveCounters` so the metric projector can read the
 * historical count without having to expose it on the
 * public `Counters` type.
 *
 * The walk mirrors Phase E's E-C14 V2 work-epoch
 * transition and the fresh-positive-authority invariant.
 * The historical count is the number of events in the run
 * that invalidated previously established positive closure
 * authority (survives later recovery).
 */
export function deriveAuthorityInvalidation(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): {
  readonly historical_authority_invalidation_count: number;
  readonly freshPositiveAuthority: boolean;
} {
  const acc = walkCounters(orderedEvents);
  return {
    historical_authority_invalidation_count:
      acc.historical_authority_invalidation_count,
    freshPositiveAuthority: acc.freshPositiveAuthority,
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
