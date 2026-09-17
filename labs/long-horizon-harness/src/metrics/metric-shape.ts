/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure orthogonal-fact derivations (M13, M14, M15).
 *
 * Doctrine (M13):
 *   "Certain metrics are meaningful only for trustworthy
 *    SUCCESS. For a single run, do not encode misleading
 *    divisions such as failed run -> infinity. Instead
 *    expose eligible_for_success_normalized_metrics = false.
 *    Cross-run aggregation belongs to a later ACT."
 *
 * Doctrine (M14):
 *   "Metric reports MUST retain Phase-E terminal
 *    classification. Additionally derive structural failure
 *    observations such as had_action_error etc. But do NOT
 *    infer causal statements. Separate OBSERVED_FAILURE
 *    from ATTRIBUTED_CAUSE."
 *
 * Doctrine (M15):
 *   "V1: CONVERGED = Phase-E terminal SUCCESS is too narrow
 *    for all experimental questions. Instead expose
 *    orthogonal facts: terminal, terminal_outcome,
 *    trustworthy_success, budget_exhausted, timed_out,
 *    incomplete. A later comparative-analysis phase can
 *    define population-level notions of convergence."
 *
 * This module is pure: no I/O.
 */

import type { RunProjection } from "../run/run-types.js";
import type {
  ConvergenceFacts,
  Counters,
  FailureObservations,
  ResourceMetrics,
  SuccessNormalized,
  TimeMetrics,
} from "./metric-types.js";
import { available, unavailable } from "./metric-types.js";

/**
 * Derive the ConvergenceFacts vector (M15).
 *
 * `terminal` and `terminal_outcome` mirror the Phase E
 * `lifecycle_state === "TERMINAL"` flag and the projector-
 * supplied `terminal_outcome` string verbatim.
 *
 * `trustworthy_success` is `terminal_outcome === "SUCCESS"`
 * AND `closure_authority_fresh === true`. The closure-
 * authority boolean comes from the projector
 * (`RunProjection.closure_authority_fresh`, E-C14).
 */
export function deriveConvergenceFacts(
  projection: RunProjection,
): ConvergenceFacts {
  const outcome = projection.terminal_outcome;
  const trustworthySuccess =
    outcome === "SUCCESS" &&
    projection.closure_authority_fresh === true;
  // `incomplete` doctrinally means "the run did not reach
  // terminal closure." Phase E distinguishes ACTIVE (a
  // non-empty stream still mid-flight) from INCOMPLETE
  // (the projector was given an empty stream OR no
  // terminal was observed yet). Both are "did not reach
  // terminal closure" in the metric sense, so we
  // surface a single `incomplete` flag that is true for
  // both lifecycle states.
  const incomplete =
    outcome === null &&
    (projection.lifecycle_state === "INCOMPLETE" ||
      projection.lifecycle_state === "ACTIVE");
  return {
    terminal: outcome !== null,
    terminal_outcome: outcome,
    trustworthy_success: trustworthySuccess,
    budget_exhausted: outcome === "BUDGET_EXHAUSTED",
    timed_out: outcome === "TIMEOUT",
    cancelled: outcome === "CANCELLED",
    incomplete,
    invalid_evidence:
      projection.lifecycle_state === "INVALID_EVIDENCE",
  };
}

/**
 * Determine whether a terminal semantic value represents a
 * failure outcome. SUCCESS / null are NOT failures; every
 * other TerminalSemantic is. Phase E V1 treats
 * VALID_FAILURE as a deliberate failure (the harness
 * decided the run was unrecoverable), which counts here.
 */
function outcomeIsFailure(
  outcome: RunProjection["terminal_outcome"],
): boolean {
  if (outcome === null) return false;
  return outcome !== "SUCCESS";
}

/**
 * Derive the FailureObservations vector (M14).
 *
 * OBSERVED facts only. The `attributed_cause` is always
 * unavailable in V1 (M14: "Separate OBSERVED_FAILURE from
 * ATTRIBUTED_CAUSE").
 */
export function deriveFailureObservations(
  counters: Counters,
  projection: RunProjection,
): FailureObservations {
  const hadActionError = projection.last_action_status === "ERROR";
  const hadReviewFailure = projection.last_review_pass === false;
  const hadAuthorityInvalidation =
    projection.current_epoch_action_failure === true ||
    projection.current_epoch_review_failure === true;
  const hadGateFailure = counters.failing_gate_count > 0;
  const hadRepair = counters.repair_cycle_count > 0;
  const observedFailure =
    outcomeIsFailure(projection.terminal_outcome) ||
    hadGateFailure ||
    hadActionError ||
    hadReviewFailure ||
    projection.lifecycle_state === "INVALID_EVIDENCE";
  return {
    had_action_error: hadActionError,
    had_gate_failure: hadGateFailure,
    had_review_failure: hadReviewFailure,
    had_repair: hadRepair,
    had_authority_invalidation: hadAuthorityInvalidation,
    observed_failure: observedFailure,
    attributed_cause: unavailable("UNSUPPORTED_BY_CONTRACT"),
  };
}

/**
 * Derive the SuccessNormalized vector (M13).
 *
 * For trustworthy SUCCESS only — else the eligibility flag
 * is `false` and the rate fields are unavailable.
 *
 * Doctrine (M13) is explicit: "Cross-run aggregation belongs
 * to a later ACT." V1 therefore does NOT divide by success
 * count (which is always 1 per run); it surfaces the same
 * scalar values under the per-success namespace. Aggregation
 * is the consumer's job.
 *
 * M13 examples call out:
 *   actions_per_success     = action_count
 *   repairs_per_success     = repair_cycle_count
 *   tokens_per_success      = total_tokens
 *   tool_calls_per_success  = tool_calls_total
 *   time_per_success_ms     = observed_run_duration_ms
 *
 * These are all already computed by the other sections;
 * `deriveSuccessNormalized` simply re-exports them under the
 * M13 namespace, gated by the eligibility flag.
 */
export function deriveSuccessNormalized(
  projection: RunProjection,
  counters: Counters,
  time: TimeMetrics,
  resources: ResourceMetrics,
): SuccessNormalized {
  const trustworthySuccess =
    projection.terminal_outcome === "SUCCESS" &&
    projection.closure_authority_fresh === true;

  if (!trustworthySuccess) {
    return {
      eligible_for_success_normalized_metrics: false,
      actions_per_success: unavailable("NOT_APPLICABLE"),
      repairs_per_success: unavailable("NOT_APPLICABLE"),
      tokens_per_success: unavailable("NOT_APPLICABLE"),
      tool_calls_per_success: unavailable("NOT_APPLICABLE"),
      time_per_success_ms: unavailable("NOT_APPLICABLE"),
    };
  }

  return {
    eligible_for_success_normalized_metrics: true,
    actions_per_success: available(counters.action_count),
    repairs_per_success: available(counters.repair_cycle_count),
    tokens_per_success: resources.total_tokens,
    tool_calls_per_success: resources.tool_calls_total,
    time_per_success_ms: time.observed_run_duration_ms,
  };
}
