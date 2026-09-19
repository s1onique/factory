/**
 * LH-05 adversarial lifecycle corpus — golden expectation helpers.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * Test-side authority for comparing the production
 * projection / metric report against the hand-pinned
 * golden_predicates in the catalog.
 *
 * Required invariant:
 *   EXPECTED_RESULT_NOT_DERIVED_FROM_SYSTEM_UNDER_TEST = TRUE
 */
import type {
  LifecycleScenario,
  ExpectedAdapterDisposition,
  ExpectedPhaseE,
  ExpectedLH02,
  ForbiddenOutcomes,
  LH02ActualPredicates,
  ForbiddenOutcomesActual,
  LifecycleReplayResult,
  AdapterErrorKind,
  HarnessQualificationIdentity,
  Lh04HandoffResult,
} from "./types.js";

export function checkAdapterDisposition(
  expected: ExpectedAdapterDisposition,
  actual:
    | { readonly kind: "ACCEPTED" }
    | { readonly kind: "REJECTED"; readonly error_kind: AdapterErrorKind },
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (expected.kind === "ACCEPTED") {
    if (actual.kind === "ACCEPTED") return { ok: true };
    return { ok: false, reason: `expected adapter ACCEPTED but adapter REJECTED(${actual.error_kind})` };
  }
  if (expected.kind === "LH04_HANDOFF") {
    return {
      ok: false,
      reason: `expected adapter disposition is LH04_HANDOFF (${expected.expected_outcome}); use compareScenarioWithHandoff instead`,
    };
  }
  // expected.kind === "REJECTED"
  if (actual.kind === "ACCEPTED") {
    return { ok: false, reason: `expected adapter REJECTED(${expected.expected_error_kind}) but adapter ACCEPTED` };
  }
  // Both REJECTED.
  if (expected.expected_error_kind === actual.error_kind) return { ok: true };
  return { ok: false, reason: `expected adapter REJECTED(${expected.expected_error_kind}) but adapter REJECTED(${actual.error_kind})` };
}

/**
 * L05-C04 — Compare a typed LH-04 handoff result against
 * the catalog's expected handoff outcome. Only
 * LH04_HANDOFF_REJECTED_AS_EXPECTED can PASS; the other four
 * outcomes produce distinct, named failures.
 */
export function checkHandoffResult(
  expected: Extract<ExpectedAdapterDisposition, { kind: "LH04_HANDOFF" }>,
  actual: Lh04HandoffResult,
): { readonly ok: true; readonly rejection_kind: string | null } | { readonly ok: false; readonly reason: string } {
  if (actual.kind === "LH04_HANDOFF_REJECTED_AS_EXPECTED") {
    if (expected.expected_outcome !== "LH04_HANDOFF_REJECTED_AS_EXPECTED") {
      return {
        ok: false,
        reason: `LH-04 handoff rejected (${actual.rejection_kind}) but catalog expected ${expected.expected_outcome}`,
      };
    }
    if (
      expected.expected_rejection_kind !== undefined &&
      expected.expected_rejection_kind !== actual.rejection_kind
    ) {
      return {
        ok: false,
        reason: `LH-04 handoff rejected with ${actual.rejection_kind}; catalog pinned ${expected.expected_rejection_kind}`,
      };
    }
    return { ok: true, rejection_kind: actual.rejection_kind };
  }
  // The handoff did NOT produce the expected rejection.
  const detail =
    actual.kind === "LH04_HANDOFF_ESCAPED"
      ? "LH-04 frozen verifier ACCEPTED the mutated evidence (ESCAPED); LH-05 invariant cannot be proven"
      : actual.kind === "LH04_BASELINE_INVALID"
        ? "LH-04 frozen verifier REJECTED the unmutated canonical baseline; handoff substrate is broken"
        : actual.kind === "LH04_FAULT_NOT_FOUND"
          ? `LH-04 fault catalog does not contain '${actual.fault_id}'`
          : `LH-04 handoff internal error: ${actual.message}`;
  return {
    ok: false,
    reason: `LH-04 handoff produced ${actual.kind}; expected ${expected.expected_outcome}. ${detail}`,
  };
}

export function checkPhaseE(
  expected: ExpectedPhaseE,
  actual: {
    readonly lifecycle_state: string;
    readonly terminal_outcome: string | null;
    readonly closure_authority_fresh: boolean;
    readonly current_epoch_action_failure: boolean;
    readonly current_epoch_review_failure: boolean;
    readonly last_gate_pass: boolean | null;
    readonly last_action_status: "OK" | "ERROR" | null;
    readonly last_review_pass: boolean | null;
    readonly action_failure_at_epoch: number | null;
    readonly review_failure_at_epoch: number | null;
  } | null,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (actual === null)
    return { ok: false, reason: "expected Phase E projection but adapter rejected before projection" };
  const checks: Array<[string, unknown, unknown]> = [
    ["lifecycle_state", actual.lifecycle_state, expected.lifecycle_state],
    ["terminal_outcome", actual.terminal_outcome, expected.terminal_outcome],
    ["closure_authority_fresh", actual.closure_authority_fresh, expected.work_epoch_predicates.closure_authority_fresh],
    ["current_epoch_action_failure", actual.current_epoch_action_failure, expected.work_epoch_predicates.current_epoch_action_failure],
    ["current_epoch_review_failure", actual.current_epoch_review_failure, expected.work_epoch_predicates.current_epoch_review_failure],
    ["last_gate_pass", actual.last_gate_pass, expected.authority_predicates.last_gate_pass],
    ["last_action_status", actual.last_action_status, expected.authority_predicates.last_action_status],
    ["last_review_pass", actual.last_review_pass, expected.authority_predicates.last_review_pass],
    ["action_failure_at_epoch", actual.action_failure_at_epoch, expected.negative_evidence_predicates.action_failure_at_epoch],
    ["review_failure_at_epoch", actual.review_failure_at_epoch, expected.negative_evidence_predicates.review_failure_at_epoch],
  ];
  for (const [field, a, e] of checks) {
    if (a !== e)
      return { ok: false, reason: `${field} mismatch: expected ${e === null ? "null" : JSON.stringify(e)}, got ${a === null ? "null" : JSON.stringify(a)}` };
  }
  return { ok: true };
}

export function checkLH02(
  expected: ExpectedLH02,
  actual: {
    readonly metric_contract_version: string | null;
    readonly terminal_outcome: string | null;
    readonly eligible_for_success_normalized_metrics: boolean | null;
    readonly historical_authority_invalidation_count: number | null;
    readonly metric_evidence_failure_observed: boolean | null;
  } | null,
): { readonly ok: true; readonly failed: readonly string[] } | { readonly ok: false; readonly failed: readonly string[] } {
  const failed: string[] = [];
  if (actual === null) {
    // ADAPTER_BOUNDARY_REJECTION short-circuit:
    // when the adapter correctly rejected the input, no
    // MetricReport can be produced. We treat this as
    // "evidence not produced" and only fail if the catalog
    // expects metric_evidence_failure_observed = false (which
    // would imply the projector still saw valid evidence).
    if (expected.metric_evidence_failure_observed === true) {
      return { ok: true, failed: [] };
    }
    failed.push("expected LH-02 metrics but metrics report was not produced");
    return { ok: false, failed };
  }
  if (actual.metric_contract_version !== expected.metric_contract_version)
    failed.push(`metric_contract_version mismatch: expected ${expected.metric_contract_version}, got ${actual.metric_contract_version ?? "null"}`);
  if (actual.terminal_outcome !== expected.terminal_outcome)
    failed.push(`terminal_outcome mismatch: expected ${expected.terminal_outcome ?? "null"}, got ${actual.terminal_outcome ?? "null"}`);
  // L05-C06: STRICT null comparison. `null` in the catalog
  // means "this predicate is not asserted" and the actual
  // MUST also be null/undefined. We do NOT silently equate
  // expected-null with actual-0/actual-false. MISSING_EVIDENCE
  // != ZERO and the projector always produces concrete values
  // when it produces a report.
  if (expected.eligible_for_success_normalized_metrics !== actual.eligible_for_success_normalized_metrics)
    failed.push(`eligible_for_success_normalized_metrics mismatch: expected ${String(expected.eligible_for_success_normalized_metrics)}, got ${String(actual.eligible_for_success_normalized_metrics)}`);
  if (expected.historical_authority_invalidation_count !== actual.historical_authority_invalidation_count)
    failed.push(`historical_authority_invalidation_count mismatch: expected ${String(expected.historical_authority_invalidation_count)}, got ${String(actual.historical_authority_invalidation_count)}`);
  if (expected.metric_evidence_failure_observed !== actual.metric_evidence_failure_observed)
    failed.push(`metric_evidence_failure_observed mismatch: expected ${String(expected.metric_evidence_failure_observed)}, got ${String(actual.metric_evidence_failure_observed)}`);
  return { ok: failed.length === 0, failed };
}

export function buildLH02ActualPredicates(
  failed: readonly string[],
  lh02: {
    readonly metric_contract_version: string | null;
    readonly terminal_outcome: string | null;
    readonly eligible_for_success_normalized_metrics: boolean | null;
    readonly historical_authority_invalidation_count: number | null;
    readonly metric_evidence_failure_observed: boolean | null;
  } | null,
): LH02ActualPredicates {
  return {
    passed: failed.length === 0,
    failed,
    metric_contract_version: lh02?.metric_contract_version ?? null,
    terminal_outcome: lh02?.terminal_outcome ?? null,
    eligible_for_success_normalized_metrics: lh02?.eligible_for_success_normalized_metrics ?? null,
    historical_authority_invalidation_count: lh02?.historical_authority_invalidation_count ?? null,
    metric_evidence_failure_observed: lh02?.metric_evidence_failure_observed ?? null,
  };
}

export function checkForbiddenOutcomes(
  expected: ForbiddenOutcomes,
  actual: {
    readonly terminal_outcome: string | null;
    readonly lifecycle_state: string | null;
    readonly success_normalized_metrics_emitted: boolean;
  } | null,
): ForbiddenOutcomesActual {
  const observed: string[] = [];
  if (actual === null) return { all_absent: true, observed };
  if (expected.terminal_outcome_in !== null) {
    for (const bad of expected.terminal_outcome_in) {
      if (actual.terminal_outcome === bad) observed.push(`terminal_outcome=${bad} (forbidden)`);
    }
  }
  if (expected.lifecycle_state_in !== null) {
    for (const bad of expected.lifecycle_state_in) {
      if (actual.lifecycle_state === bad) observed.push(`lifecycle_state=${bad} (forbidden)`);
    }
  }
  if (expected.success_normalized_metrics_emitted === true && actual.success_normalized_metrics_emitted === true)
    observed.push("success_normalized_metrics_emitted (forbidden)");
  return { all_absent: observed.length === 0, observed };
}

export function compareScenario(
  scenario: LifecycleScenario,
  harness: HarnessQualificationIdentity,
  actuals: {
    readonly adapter:
      | { readonly kind: "ACCEPTED" }
      | { readonly kind: "REJECTED"; readonly error_kind: AdapterErrorKind };
    readonly phase_e: {
      readonly lifecycle_state: string;
      readonly terminal_outcome: string | null;
      readonly closure_authority_fresh: boolean;
      readonly current_epoch_action_failure: boolean;
      readonly current_epoch_review_failure: boolean;
      readonly last_gate_pass: boolean | null;
      readonly last_action_status: "OK" | "ERROR" | null;
      readonly last_review_pass: boolean | null;
      readonly action_failure_at_epoch: number | null;
      readonly review_failure_at_epoch: number | null;
    } | null;
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
  };
  const adapterCheck = checkAdapterDisposition(scenario.golden_predicates.expected_adapter_disposition, actuals.adapter);
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
  // ADAPTER_BOUNDARY_REJECTION scenarios short-circuit:
  // if the adapter correctly rejected the input, the
  // remaining Phase E / LH-02 predicates are still expected
  // (the catalog records what the projector SHOULD have
  // produced given the partial evidence). The adapter
  // disposition is the contract authority.
  const adapterRejected = actuals.adapter.kind === "REJECTED";
  const fobs = checkForbiddenOutcomes(scenario.golden_predicates.forbidden_outcomes, actuals.phase_e === null ? null : { terminal_outcome: actuals.phase_e.terminal_outcome, lifecycle_state: actuals.phase_e.lifecycle_state, success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted });
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
  const phaseECheck = checkPhaseE(scenario.golden_predicates.expected_phase_e, adapterRejected ? {
    lifecycle_state: actuals.phase_e === null ? "INCOMPLETE" : actuals.phase_e.lifecycle_state,
    terminal_outcome: actuals.phase_e === null ? null : actuals.phase_e.terminal_outcome,
    closure_authority_fresh: false,
    current_epoch_action_failure: false,
    current_epoch_review_failure: false,
    last_gate_pass: null,
    last_action_status: null,
    last_review_pass: null,
    action_failure_at_epoch: null,
    review_failure_at_epoch: null,
  } : actuals.phase_e);
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
  const lh02Check = checkLH02(scenario.golden_predicates.expected_lh02, adapterRejected ? null : actuals.lh02);
  if (!lh02Check.ok) {
    return {
      ...baseResult,
      success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
      lh02_predicates: buildLH02ActualPredicates(lh02Check.failed, adapterRejected ? null : actuals.lh02),
      forbidden_outcomes: fobs,
      disposition: "WRONG_METRIC_STATE",
      notes: lh02Check.failed.join("; "),
    };
  }
  return {
    ...baseResult,
    success_normalized_metrics_emitted: actuals.success_normalized_metrics_emitted,
    lh02_predicates: buildLH02ActualPredicates([], adapterRejected ? null : actuals.lh02),
    forbidden_outcomes: fobs,
    disposition: "PASS",
    notes: "",
  };
}

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
  };
  const check = checkHandoffResult(expectedDisposition, handoff);
  if (check.ok) {
    // The handoff succeeded. For LC11 the Phase E / LH-02
    // predicates are still declared INCOMPLETE / null /
    // metric_evidence_failure_observed=true (per the catalog),
    // so the comparison must check those too.
    const phaseEActual = {
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
