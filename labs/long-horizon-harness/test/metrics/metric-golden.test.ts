/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Golden hand calculations (M21) for METRIC01..METRIC06,
 * METRIC08. Each test pins the expected metric values
 * directly (not derived via the same helper). The test
 * harness itself does NOT import the production counter /
 * distance helpers; the only production entry point used
 * is `computeRunMetrics`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { projectRun } from "../../src/run/run-projector.js";
import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  computeRunMetrics,
} from "../../src/metrics/index.js";
import {
  makeSuccessRunMinimal,
  makeSuccessRunOneRepair,
  makeActionErrorRecoverySuccess,
  makeReviewFailureRecoverySuccess,
  makeValidTerminalFailure,
  makeBudgetExhaustedRun,
} from "./_metric_helpers.js";

function compute(input: {
  readonly manifest: ReturnType<typeof makeSuccessRunMinimal>["manifest"];
  readonly events: ReturnType<typeof makeSuccessRunMinimal>["events"];
}): ReturnType<typeof computeRunMetrics> {
  const projection = projectRun(input.manifest, input.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("projection failed");
  return computeRunMetrics({
    subject: input.manifest.subject_id,
    manifest: input.manifest,
    orderedEvents: input.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
}

test("METRIC01 (golden): minimal SUCCESS run counters match the hand-pinned vector", () => {
  const r = makeSuccessRunMinimal({ seed: "golden-01" });
  const m = compute(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const c = m.report.counters;
  assert.equal(c.action_count, 1);
  assert.equal(c.successful_action_count, 1);
  assert.equal(c.failed_action_count, 0);
  assert.equal(c.gate_count, 1);
  assert.equal(c.passing_gate_count, 1);
  assert.equal(c.failing_gate_count, 0);
  assert.equal(c.repair_cycle_count, 0);
  assert.equal(c.completed_repair_cycle_count, 0);
  assert.equal(c.review_count, 0);
  assert.equal(c.passing_review_count, 0);
  assert.equal(c.failing_review_count, 0);
  // Exactly one ACTION_STARTED advances work_epoch to 1.
  assert.equal(c.work_epoch_count, 1);

  const d = m.report.distances;
  assert.equal(d.actions_to_terminal, 1);
  assert.equal(d.gates_to_terminal, 1);
  assert.equal(d.repairs_to_terminal, 0);
  assert.equal(d.reviews_to_terminal, 0);
  // *_to_last_authoritative_pass uses the same
  // ACTION_FINISHED discriminator as `action_count` so the
  // value is the count of CLOSED actions observed BEFORE
  // the last passing gate (position 5 in the METRIC01
  // stream). The single ACTION_FINISHED is at position 6,
  // so the count is 0.
  assert.equal(d.actions_to_last_authoritative_pass.available, true);
  if (!d.actions_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.actions_to_last_authoritative_pass.value, 0);
  // work_epochs_to_last_authoritative_pass is the 1-based
  // position of the gate (5 in the METRIC01 stream).
  assert.equal(
    d.work_epochs_to_last_authoritative_pass.available,
    true,
  );
  if (!d.work_epochs_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.work_epochs_to_last_authoritative_pass.value, 5);

  assert.equal(m.report.convergence.trustworthy_success, true);
  assert.equal(
    m.report.success_normalized.eligible_for_success_normalized_metrics,
    true,
  );
  assert.equal(
    m.report.success_normalized.actions_per_success.available,
    true,
  );
  if (!m.report.success_normalized.actions_per_success.available) throw new Error("ok");
  assert.equal(m.report.success_normalized.actions_per_success.value, 1);
});

test("METRIC02 (golden): success with one repair -> counters match the hand-pinned vector", () => {
  const r = makeSuccessRunOneRepair({ seed: "golden-02" });
  const m = compute(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const c = m.report.counters;
  assert.equal(c.action_count, 2);
  assert.equal(c.successful_action_count, 2);
  assert.equal(c.failed_action_count, 0);
  assert.equal(c.gate_count, 2);
  assert.equal(c.passing_gate_count, 1);
  assert.equal(c.failing_gate_count, 1);
  assert.equal(c.repair_cycle_count, 1);
  assert.equal(c.review_count, 0);
  // Phase E V2: ACTION_STARTED(A) -> 1, REPAIR_STARTED ->
  // 2, ACTION_STARTED(B) -> 3.
  assert.equal(c.work_epoch_count, 3);

  const d = m.report.distances;
  assert.equal(d.actions_to_terminal, 2);
  assert.equal(d.gates_to_terminal, 2);
  assert.equal(d.repairs_to_terminal, 1);
  assert.equal(d.reviews_to_terminal, 0);

  const b = m.report.correction_burden;
  assert.equal(b.repair_cycle_count, 1);
  assert.equal(b.failed_action_count, 0);
  assert.equal(b.failing_gate_count, 1);
  assert.equal(b.failing_review_count, 0);
  // The failing gate preceded the last passing gate; it
  // is NOT a current-epoch negative-evidence event.
  assert.equal(b.authority_invalidation_count, 0);
});

test("METRIC04 (golden): action ERROR -> recovery -> success counter vector", () => {
  const r = makeActionErrorRecoverySuccess({ seed: "golden-04" });
  const m = compute(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const c = m.report.counters;
  assert.equal(c.action_count, 2);
  assert.equal(c.successful_action_count, 1);
  assert.equal(c.failed_action_count, 1);
  assert.equal(c.gate_count, 2);
  assert.equal(c.passing_gate_count, 2);
  assert.equal(c.failing_gate_count, 0);
  assert.equal(c.repair_cycle_count, 0);
  assert.equal(c.review_count, 0);
  // Per Phase E E-C21 + V2 (E-C18): ACTION_FINISHED(ERROR)
  // ALSO advances workEpoch. So the three advancing events
  // are: ACTION_STARTED(A), ACTION_FINISHED(A,ERROR),
  // ACTION_STARTED(B) -> final workEpoch = 3.
  assert.equal(c.work_epoch_count, 3);

  // Correction burden: this run still achieves trustworthy
  // SUCCESS because the next fresh gate re-establishes
  // authority. authority_invalidation_count is therefore
  // 0 at the current epoch (Phase E E-C23).
  const b = m.report.correction_burden;
  assert.equal(b.authority_invalidation_count, 0);
  assert.equal(m.report.convergence.trustworthy_success, true);
});

test("METRIC05 (golden): review FAIL -> recovery -> SUCCESS review vector", () => {
  const r = makeReviewFailureRecoverySuccess({ seed: "golden-05" });
  const m = compute(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const c = m.report.counters;
  assert.equal(c.action_count, 1);
  assert.equal(c.gate_count, 1);
  assert.equal(c.review_count, 2);
  assert.equal(c.passing_review_count, 1);
  assert.equal(c.failing_review_count, 1);

  // E-C22: REVIEW_FINISHED(true) supersedes a prior FAIL at
  // the same work epoch.
  assert.equal(m.report.convergence.trustworthy_success, true);
  assert.equal(m.report.correction_burden.authority_invalidation_count, 0);
  assert.equal(m.report.surviving_defect_surface.failing_review_count, 1);
  assert.equal(
    m.report.surviving_defect_surface.final_review_state.available,
    true,
  );
  if (!m.report.surviving_defect_surface.final_review_state.available) {
    throw new Error("ok");
  }
  assert.equal(
    m.report.surviving_defect_surface.final_review_state.value,
    true,
  );
});

test("METRIC06 (golden): VALID_FAILURE terminal surfaces cancellation-grade failure shape", () => {
  const r = makeValidTerminalFailure({ seed: "golden-06" });
  const m = compute(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.trustworthy_success, false);
  assert.equal(m.report.convergence.terminal_outcome, "VALID_FAILURE");
  assert.equal(m.report.failure_shape.observed_failure, true);
  assert.equal(
    m.report.success_normalized.eligible_for_success_normalized_metrics,
    false,
  );
});

test("METRIC08 (golden): BUDGET_EXHAUSTED run surfaces total_tokens observation", () => {
  const r = makeBudgetExhaustedRun({ seed: "golden-08", tokens: 9999 });
  const m = compute(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.terminal_outcome, "BUDGET_EXHAUSTED");
  assert.equal(m.report.convergence.budget_exhausted, true);
  assert.equal(m.report.resources.total_tokens.available, true);
  if (!m.report.resources.total_tokens.available) throw new Error("ok");
  assert.equal(m.report.resources.total_tokens.value, 9999);
  // Input/output distinction is unsupported in V1 (M10).
  assert.equal(m.report.resources.input_tokens.available, false);
  assert.equal(m.report.resources.output_tokens.available, false);
});