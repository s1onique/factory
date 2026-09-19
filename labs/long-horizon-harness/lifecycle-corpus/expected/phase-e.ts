/**
 * LH-05 expected Phase E comparator.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Split from `expected.ts` for source-size discipline.
 */
import type { ExpectedPhaseE, PhaseEPredicates } from "../types.js";

export function checkPhaseE(
  expected: ExpectedPhaseE,
  actual: PhaseEPredicates | null,
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
