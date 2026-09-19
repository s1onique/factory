/**
 * LH-05 expected handoff comparator.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Split from `expected.ts` for source-size discipline.
 */
import type {
  LifecycleScenario,
  LifecycleReplayResult,
  PhaseEPredicates,
  HarnessQualificationIdentity,
  Lh04HandoffResult,
} from "../types.js";
import { checkHandoffResult } from "./adapter.js";
import { checkPhaseE } from "./phase-e.js";
import { checkLH02, buildLH02ActualPredicates } from "./lh02.js";
import { checkForbiddenOutcomes } from "./forbidden.js";

/**
 * L05-C04 — Compare a typed LH-04 handoff result.
 *
 * The FAULT_LAB_HANDOFF scenarios (LC11) do NOT drive
 * Phase E projection; their disposition is determined
 * entirely by what the LH-04 frozen verifier says about
 * the mutated evidence. We check:
 *
 *   1. typed handoff outcome matches the catalog's
 *      expected_outcome (L05-C04).
 *   2. typed rejection kind matches the catalog's
 *      expected_rejection_kind, when pinned.
 *
 * Only LH04_HANDOFF_REJECTED_AS_EXPECTED produces PASS.
 * The four other outcomes produce typed failures so
 * regressions are unambiguous.
 */
export function compareScenarioWithHandoff(
  scenario: LifecycleScenario,
  harness: HarnessQualificationIdentity,
  handoff: Lh04HandoffResult,
): LifecycleReplayResult {
  const expectedDisposition = scenario.golden_predicates.expected_adapter_disposition;
  if (expectedDisposition.kind !== "LH04_HANDOFF") {
    throw new Error(
      `compareScenarioWithHandoff called for non-LH04_HANDOFF scenario ${scenario.id}`,
    );
  }
  const baseResult = {
    scenario_id: scenario.id,
    scenario_version: scenario.version,
    scenario_class: scenario.scenario_class,
    harness,
    execution_mode: "REPLAY" as const,
    adapter_disposition: expectedDisposition,
    adapter_error_kind: null,
    phase_e_lifecycle_state: "INCOMPLETE" as string | null,
    phase_e_terminal_outcome: null,
    phase_e_predicates: null as PhaseEPredicates | null,
  };
  const check = checkHandoffResult(expectedDisposition, handoff);
  if (check.ok) {
    const phaseEActual: PhaseEPredicates = {
      lifecycle_state: "INCOMPLETE",
      terminal_outcome: null,
      closure_authority_fresh: false,
      current_epoch_action_failure: false,
      current_epoch_review_failure: false,
      last_gate_pass: null,
      last_action_status: null,
      last_review_pass: null,
      action_failure_at_epoch: null,
      review_failure_at_epoch: null,
    };
    const phaseECheck = checkPhaseE(
      scenario.golden_predicates.expected_phase_e,
      phaseEActual,
    );
    if (!phaseECheck.ok) {
      return {
        ...baseResult,
        success_normalized_metrics_emitted: false,
        lh02_predicates: buildLH02ActualPredicates([phaseECheck.reason], null),
        forbidden_outcomes: { all_absent: true, observed: [] },
        disposition: "WRONG_PHASE_E_STATE",
        notes: phaseECheck.reason,
      };
    }
    const lh02Check = checkLH02(scenario.golden_predicates.expected_lh02, null);
    if (!lh02Check.ok) {
      return {
        ...baseResult,
        success_normalized_metrics_emitted: false,
        lh02_predicates: buildLH02ActualPredicates(lh02Check.failed, null),
        forbidden_outcomes: { all_absent: true, observed: [] },
        disposition: "WRONG_METRIC_STATE",
        notes: lh02Check.failed.join("; "),
      };
    }
    const fobs = checkForbiddenOutcomes(
      scenario.golden_predicates.forbidden_outcomes,
      { terminal_outcome: null, lifecycle_state: "INCOMPLETE", success_normalized_metrics_emitted: false },
    );
    if (!fobs.all_absent) {
      return {
        ...baseResult,
        success_normalized_metrics_emitted: false,
        lh02_predicates: buildLH02ActualPredicates([], null),
        forbidden_outcomes: fobs,
        disposition: "FORBIDDEN_OUTCOME",
        notes: `forbidden outcomes observed: ${fobs.observed.join("; ")}`,
      };
    }
    return {
      ...baseResult,
      success_normalized_metrics_emitted: false,
      lh02_predicates: buildLH02ActualPredicates([], null),
      forbidden_outcomes: fobs,
      disposition: "PASS",
      notes: `LH-04 rejected mutated evidence with ${check.rejection_kind ?? "unknown"}`,
    };
  }
  return {
    ...baseResult,
    success_normalized_metrics_emitted: false,
    lh02_predicates: buildLH02ActualPredicates([check.reason], null),
    forbidden_outcomes: { all_absent: true, observed: [] },
    disposition: "WRONG_ADAPTER_STATE",
    notes: check.reason,
  };
}
