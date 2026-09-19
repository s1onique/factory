/**
 * LH-05 expected scenario comparators.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Split from `expected.ts` for source-size discipline.
 */
import type {
  LifecycleScenario,
  LifecycleReplayResult,
  PhaseEPredicates,
  AdapterErrorKind,
  HarnessQualificationIdentity,
} from "../types.js";
import { checkAdapterDisposition } from "./adapter.js";
import { checkPhaseE } from "./phase-e.js";
import { checkLH02, buildLH02ActualPredicates } from "./lh02.js";
import { checkForbiddenOutcomes } from "./forbidden.js";

export function compareScenario(
  scenario: LifecycleScenario,
  harness: HarnessQualificationIdentity,
  actuals: {
    readonly adapter:
      | { readonly kind: "ACCEPTED" }
      | { readonly kind: "REJECTED"; readonly error_kind: AdapterErrorKind };
    readonly phase_e: PhaseEPredicates | null;
    readonly lh02: {
      readonly metric_contract_version: string | null;
      readonly terminal_outcome: string | null;
      readonly eligible_for_success_normalized_metrics: boolean | null;
      readonly historical_authority_invalidation_count: number | null;
      readonly metric_evidence_failure_observed: boolean | null;
    } | null;
    readonly success_normalized_metrics_emitted: boolean;
  },
): LifecycleReplayResult {
  const baseResult = {
    scenario_id: scenario.id,
    scenario_version: scenario.version,
    scenario_class: scenario.scenario_class,
    harness,
    execution_mode: "REPLAY" as const,
    adapter_disposition: scenario.golden_predicates.expected_adapter_disposition,
    adapter_error_kind: actuals.adapter.kind === "REJECTED" ? actuals.adapter.error_kind : null,
    phase_e_lifecycle_state: actuals.phase_e?.lifecycle_state ?? null,
    phase_e_terminal_outcome: actuals.phase_e?.terminal_outcome ?? null,
    phase_e_predicates: actuals.phase_e,
  };
  const adapterCheck = checkAdapterDisposition(
    scenario.golden_predicates.expected_adapter_disposition,
    actuals.adapter,
  );
  if (!adapterCheck.ok) {
    return {
      ...baseResult,
      success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
      lh02_predicates: buildLH02ActualPredicates([adapterCheck.reason], null),
      forbidden_outcomes: { all_absent: true, observed: [] },
      disposition: "WRONG_ADAPTER_STATE",
      notes: adapterCheck.reason,
    };
  }
  const adapterRejected = actuals.adapter.kind === "REJECTED";
  const fobs = checkForbiddenOutcomes(
    scenario.golden_predicates.forbidden_outcomes,
    actuals.phase_e === null
      ? null
      : {
          terminal_outcome: actuals.phase_e.terminal_outcome,
          lifecycle_state: actuals.phase_e.lifecycle_state,
          success_normalized_metrics_emitted:
            actuals.success_normalized_metrics_emitted,
        },
  );
  if (!fobs.all_absent) {
    return {
      ...baseResult,
      success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
      lh02_predicates: buildLH02ActualPredicates(["forbidden outcome observed"], null),
      forbidden_outcomes: fobs,
      disposition: "FORBIDDEN_OUTCOME",
      notes: `forbidden outcomes observed: ${fobs.observed.join("; ")}`,
    };
  }
  const phaseECheck = checkPhaseE(
    scenario.golden_predicates.expected_phase_e,
    adapterRejected
      ? {
          lifecycle_state:
            actuals.phase_e === null ? "INCOMPLETE" : actuals.phase_e.lifecycle_state,
          terminal_outcome:
            actuals.phase_e === null ? null : actuals.phase_e.terminal_outcome,
          closure_authority_fresh: false,
          current_epoch_action_failure: false,
          current_epoch_review_failure: false,
          last_gate_pass: null,
          last_action_status: null,
          last_review_pass: null,
          action_failure_at_epoch: null,
          review_failure_at_epoch: null,
        }
      : actuals.phase_e,
  );
  if (!phaseECheck.ok) {
    return {
      ...baseResult,
      success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
      lh02_predicates: buildLH02ActualPredicates([phaseECheck.reason], null),
      forbidden_outcomes: fobs,
      disposition: "WRONG_PHASE_E_STATE",
      notes: phaseECheck.reason,
    };
  }
  const lh02Check = checkLH02(
    scenario.golden_predicates.expected_lh02,
    adapterRejected ? null : actuals.lh02,
  );
  if (!lh02Check.ok) {
    return {
      ...baseResult,
      success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
      lh02_predicates: buildLH02ActualPredicates(
        lh02Check.failed,
        adapterRejected ? null : actuals.lh02,
      ),
      forbidden_outcomes: fobs,
      disposition: "WRONG_METRIC_STATE",
      notes: lh02Check.failed.join("; "),
    };
  }
  return {
    ...baseResult,
    success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
    lh02_predicates: buildLH02ActualPredicates(
      [],
      adapterRejected ? null : actuals.lh02,
    ),
    forbidden_outcomes: fobs,
    disposition: "PASS",
    notes: "",
  };
}
