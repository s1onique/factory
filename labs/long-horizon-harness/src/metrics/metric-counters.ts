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
  };
}

/**
 * Apply one event's contribution to the counter accumulator.
 * Pure: no I/O, no mutation outside the accumulator.
 *
 * Counts closed (FINISHED) variants of each lifecycle pair.
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
    case "ACTION_FINISHED":
      acc.action_count += 1;
      if (inner.status === "OK") {
        acc.successful_action_count += 1;
      } else if (inner.status === "ERROR") {
        acc.failed_action_count += 1;
      }
      return;
    case "GATE_FINISHED":
      acc.gate_count += 1;
      if (inner.pass === true) {
        acc.passing_gate_count += 1;
      } else {
        acc.failing_gate_count += 1;
      }
      return;
    case "REPAIR_FINISHED":
      acc.repair_cycle_count += 1;
      return;
    case "REVIEW_FINISHED":
      acc.review_count += 1;
      if (inner.pass === true) {
        acc.passing_review_count += 1;
      } else {
        acc.failing_review_count += 1;
      }
      return;
    default:
      // Other event types intentionally contribute nothing
      // to structural counters. Including RUN_STARTED would
      // inflate `action_count`-like metrics with lifecycle
      // markers, which the ACT forbids.
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
  const acc = emptyAccumulator();
  for (const e of orderedEvents) {
    applyEvent(acc, e);
  }
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