/**
 * LH-05 semantic parity helper (L05-C12).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Canonical parity shape used to compare Pi and reference
 * results. Every candidate-neutral semantic field that both
 * adapters can meaningfully produce MUST appear here.
 *
 * Required invariant:
 *   TERMINAL_OUTCOME_EQUALITY_ALONE_COUNTS_AS_SEMANTIC_PARITY = FALSE
 */
import type {
  LifecycleReplayResult,
  PhaseEPredicates,
  LH02ActualPredicates,
} from "./types.js";

/**
 * The closed-world parity surface. Adding a new field here
 * requires the parity comparator (and every test that uses
 * it) to grow with it; a deliberate change.
 */
export type SemanticParityShape = {
  readonly adapter_disposition_kind: string;
  readonly adapter_error_kind: string | null;
  readonly phase_e: PhaseEPredicates | null;
  readonly lh02: LH02ActualPredicates;
  readonly success_normalized_metrics_emitted: boolean;
  readonly forbidden_outcomes_absent: boolean;
  readonly disposition: string;
};

/**
 * Project a `LifecycleReplayResult` onto its candidate-
 * neutral parity surface. Two harnesses are semantically
 * equivalent iff their parity shapes are deepEqual.
 */
export function semanticParityShape(
  result: LifecycleReplayResult,
): SemanticParityShape {
  return {
    adapter_disposition_kind: result.adapter_disposition.kind,
    adapter_error_kind: result.adapter_error_kind,
    phase_e: result.phase_e_predicates,
    lh02: result.lh02_predicates,
    success_normalized_metrics_emitted: result.success_normalized_metrics_emitted,
    forbidden_outcomes_absent: result.forbidden_outcomes.all_absent,
    disposition: result.disposition,
  };
}

/**
 * Convenience: full candidate-neutral key/value equality
 * between two semantic parity shapes. Returns `null` when
 * equal; otherwise a list of mismatched field names.
 */
export function compareSemanticParityShapes(
  a: SemanticParityShape,
  b: SemanticParityShape,
): ReadonlyArray<string> | null {
  const mismatched: string[] = [];
  if (a.adapter_disposition_kind !== b.adapter_disposition_kind) {
    mismatched.push("adapter_disposition_kind");
  }
  if (a.adapter_error_kind !== b.adapter_error_kind) {
    mismatched.push("adapter_error_kind");
  }
  if (!samePhaseEPredicates(a.phase_e, b.phase_e)) {
    mismatched.push("phase_e");
  }
  if (!sameLH02Predicates(a.lh02, b.lh02)) {
    mismatched.push("lh02");
  }
  if (a.success_normalized_metrics_emitted !== b.success_normalized_metrics_emitted) {
    mismatched.push("success_normalized_metrics_emitted");
  }
  if (a.forbidden_outcomes_absent !== b.forbidden_outcomes_absent) {
    mismatched.push("forbidden_outcomes_absent");
  }
  if (a.disposition !== b.disposition) {
    mismatched.push("disposition");
  }
  return mismatched.length === 0 ? null : mismatched;
}

function samePhaseEPredicates(
  a: PhaseEPredicates | null,
  b: PhaseEPredicates | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.lifecycle_state === b.lifecycle_state &&
    a.terminal_outcome === b.terminal_outcome &&
    a.closure_authority_fresh === b.closure_authority_fresh &&
    a.current_epoch_action_failure === b.current_epoch_action_failure &&
    a.current_epoch_review_failure === b.current_epoch_review_failure &&
    a.last_gate_pass === b.last_gate_pass &&
    a.last_action_status === b.last_action_status &&
    a.last_review_pass === b.last_review_pass &&
    a.action_failure_at_epoch === b.action_failure_at_epoch &&
    a.review_failure_at_epoch === b.review_failure_at_epoch
  );
}

function sameLH02Predicates(
  a: LH02ActualPredicates,
  b: LH02ActualPredicates,
): boolean {
  return (
    a.metric_contract_version === b.metric_contract_version &&
    a.terminal_outcome === b.terminal_outcome &&
    a.eligible_for_success_normalized_metrics ===
      b.eligible_for_success_normalized_metrics &&
    a.historical_authority_invalidation_count ===
      b.historical_authority_invalidation_count &&
    a.metric_evidence_failure_observed === b.metric_evidence_failure_observed
  );
}
