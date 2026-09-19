/**
 * LH-05 adversarial lifecycle corpus — scenario helpers.
 *
 * Shared golden-predicate helper factories, eligibility
 * blocks for the LC01..LC12 catalog. The scenarios themselves
 * are split across `lc01-lc04.ts`, `lc05-lc08.ts`, and
 * `lc10-lc12.ts` to keep each module under the
 * SOURCE_SIZE_DISCIPLINE 400-LOC ceiling (L05-C08).
 */
import type {
  HarnessEligibility,
  ExpectedAdapterDisposition,
  ExpectedPhaseE,
  ExpectedLH02,
  ForbiddenOutcomes,
  GoldenPredicates,
} from "../types.js";

export const PI_ELIGIBLE: HarnessEligibility["pi"] = { eligible: true };
export const CLINE_INELIGIBLE: HarnessEligibility["cline"] = {
  eligible: false,
  reason: "HALT_CLINE_NOT_INSTALLED",
};
export const FAKE_REFERENCE_CONTROL: HarnessEligibility["fake_reference_control"] = {
  eligible: true,
};
export const FAKE_NOT_APPLICABLE: HarnessEligibility["fake_reference_control"] = {
  eligible: false,
  reason:
    "scenario exercises Pi-native wire vocabulary (compaction / meta events); the reference control adapter is script-only and cannot express these",
};

export function accepted(): ExpectedAdapterDisposition {
  return { kind: "ACCEPTED" };
}
export function rejected(
  kind: "MALFORMED_NATIVE_EVENT" | "UNKNOWN_NATIVE_EVENT_KIND" | "EVIDENCE_CORRUPTION_DETECTED",
): ExpectedAdapterDisposition {
  return { kind: "REJECTED", expected_error_kind: kind };
}

export function phaseE(args: {
  readonly lifecycle_state: "TERMINAL" | "INVALID_EVIDENCE" | "INCOMPLETE" | "ACTIVE";
  readonly terminal_outcome: string | null;
  readonly closure_authority_fresh?: boolean;
  readonly current_epoch_action_failure?: boolean;
  readonly current_epoch_review_failure?: boolean;
  readonly last_gate_pass?: boolean | null;
  readonly last_action_status?: "OK" | "ERROR" | null;
  readonly last_review_pass?: boolean | null;
  readonly action_failure_at_epoch?: number | null;
  readonly review_failure_at_epoch?: number | null;
}): ExpectedPhaseE {
  return {
    lifecycle_state: args.lifecycle_state,
    terminal_outcome: args.terminal_outcome,
    work_epoch_predicates: {
      closure_authority_fresh: args.closure_authority_fresh ?? false,
      current_epoch_action_failure: args.current_epoch_action_failure ?? false,
      current_epoch_review_failure: args.current_epoch_review_failure ?? false,
    },
    authority_predicates: {
      last_gate_pass: args.last_gate_pass ?? null,
      last_action_status: args.last_action_status ?? null,
      last_review_pass: args.last_review_pass ?? null,
    },
    negative_evidence_predicates: {
      action_failure_at_epoch: args.action_failure_at_epoch ?? null,
      review_failure_at_epoch: args.review_failure_at_epoch ?? null,
    },
  };
}

export function lh02(args: {
  readonly terminal_outcome: string | null;
  readonly eligible_for_success_normalized_metrics?: boolean;
  readonly historical_authority_invalidation_count?: number;
  readonly metric_evidence_failure_observed?: boolean;
}): ExpectedLH02 {
  return {
    metric_contract_version: "convergence.metric.contract.v1",
    terminal_outcome: args.terminal_outcome,
    // L05-C06: defaults are concrete, projector-shaped
    // values. `null` would mean "not asserted", which is
    // reserved for adapter-rejection short-circuits.
    eligible_for_success_normalized_metrics:
      args.eligible_for_success_normalized_metrics ?? false,
    historical_authority_invalidation_count:
      args.historical_authority_invalidation_count ?? 0,
    metric_evidence_failure_observed:
      args.metric_evidence_failure_observed ?? false,
  };
}

export function forbidden(args: {
  readonly terminal_outcome_in?: readonly string[];
  readonly lifecycle_state_in?: readonly string[];
  readonly success_normalized_metrics_emitted?: boolean;
  readonly custom?: readonly string[];
}): ForbiddenOutcomes {
  return {
    terminal_outcome_in: args.terminal_outcome_in ?? null,
    lifecycle_state_in: args.lifecycle_state_in ?? null,
    success_normalized_metrics_emitted:
      args.success_normalized_metrics_emitted ?? false,
    custom: args.custom ?? [],
  };
}

export function golden(d: GoldenPredicates): GoldenPredicates {
  return d;
}
