/**
 * LH-05 expected LH-02 comparator and predicate builder.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Split from `expected.ts` for source-size discipline.
 */
import type { ExpectedLH02, LH02ActualPredicates } from "../types.js";

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
  // L05-C06: STRICT null comparison.
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
