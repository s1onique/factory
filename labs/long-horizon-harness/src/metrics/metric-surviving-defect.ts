/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Surviving-defect surface derivations (M7).
 *
 * Doctrine (M7):
 *   "Phase E currently records review verdict, not a
 *    structured defect inventory. Therefore V1 MUST NOT
 *    fabricate `surviving_defect_count` from
 *    review pass=false. Instead distinguish:
 *
 *      failing_review_count
 *      final_review_state
 *
 *    If actual defect cardinality is desired later, add a
 *    separately versioned evidence vocabulary in a future
 *    phase. Doctrine: NO_METRIC_WITHOUT_OBSERVABLE_EVIDENCE."
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent } from "../run/run-types.js";
import type {
  Counters,
  MetricValue,
  SurvivingDefectSurface,
} from "./metric-types.js";
import { available, unavailable } from "./metric-types.js";

/**
 * Locate the LAST `REVIEW_FINISHED` event in the stream, if
 * any. Returns `null` if no review was ever observed. The
 * projection already exposes `last_review_pass` directly;
 * we still recompute it from the stream so this module has
 * no dependency on the projector surface (hand-rolled tests
 * can construct synthetic streams and verify the field).
 */
function findLastReviewFinishedPass(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): boolean | null {
  let lastPass: boolean | null = null;
  for (const e of orderedEvents) {
    if (e.event.type === "REVIEW_FINISHED") {
      lastPass = e.event.pass;
    }
  }
  return lastPass;
}

/**
 * Derive the SurvivingDefectSurface vector (M7).
 *
 * `surviving_defect_count` is explicitly unavailable in V1
 * because Phase E does not capture a defect inventory. M7
 * names the field but forbids fabricating it. We surface it
 * as `unavailable("UNSUPPORTED_BY_CONTRACT")` so the type
 * already carries the slot a future ACT may fill.
 *
 * `failing_review_count` is lifted from `Counters` (V1
 * keeps these aligned); `final_review_state` is recomputed
 * from the event stream so this module is independent of
 * the projector surface — a hand-rolled synthetic stream
 * can drive the function directly.
 */
export function deriveSurvivingDefectSurface(
  counters: Counters,
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): SurvivingDefectSurface {
  const finalReviewPassValue = findLastReviewFinishedPass(orderedEvents);
  const finalReviewState: MetricValue<boolean> =
    finalReviewPassValue === null
      ? unavailable("NOT_OBSERVED")
      : available(finalReviewPassValue);
  return {
    failing_review_count: counters.failing_review_count,
    final_review_state: finalReviewState,
    surviving_defect_count: unavailable("UNSUPPORTED_BY_CONTRACT"),
  };
}