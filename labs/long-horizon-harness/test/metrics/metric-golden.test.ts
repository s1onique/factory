/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Golden hand calculations (M21) for METRIC01..METRIC06,
 * METRIC08, plus the CORRECTION01 probes METRIC28..METRIC32
 * (M-C02) and METRIC33..METRIC35 (M-C04). Each test pins
 * the expected metric values directly (not derived via the
 * same helper). The test harness itself does NOT import the
 * production counter / distance helpers; the only
 * production entry point used is `computeRunMetrics`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  computeRunMetrics,
} from "../../src/metrics/index.js";
import {
  computeRunMetricsFor,
  makeSuccessRunMinimal,
  makeActionErrorRecoverySuccess,
  makeReviewFailureRecoverySuccess,
  makeValidTerminalFailure,
  makeBudgetExhaustedRun,
  makePassThenTerminal,
  makePassThenMoreWorkThenPass,
  makeActionErrorAfterPass,
  makeReviewFailThenReviewPass,
  makeTwoInvalidationsThenSuccess,
  makePassThenFailThenValidFailure,
  makePassWorkPassSuccess,
  makePassReviewFailTerminal,
} from "./_metric_helpers.js";

/**
 * Convenience: invoke `computeRunMetrics` with the V1
 * contract version (no runProjection param). This is the
 * canonical entry point per CORRECTION01 M-C01.
 */
function compute(input: {
  readonly manifest: ReturnType<typeof makeSuccessRunMinimal>["manifest"];
  readonly events: ReturnType<typeof makeSuccessRunMinimal>["events"];
}) {
  return computeRunMetrics({
    subject: input.manifest.subject_id,
    manifest: input.manifest,
    orderedEvents: input.events,
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
  // CORRECTION01 M-C03: actions_to_* discriminates
  // ACTION_STARTED. The single ACTION_STARTED in this run
  // is at position 3; ACTION_FINISHED is at position 6
  // (post-gate). For *_to_terminal we count all
  // ACTION_STARTED observed up to terminal (position 8 in
  // the stream): exactly 1.
  assert.equal(d.actions_to_terminal, 1);
  assert.equal(d.gates_to_terminal, 1);
  assert.equal(d.repairs_to_terminal, 0);
  assert.equal(d.reviews_to_terminal, 0);
  // *_to_last_authoritative_pass discriminates
  // ACTION_STARTED. The authoritative pass (GATE_FINISHED
  // at position 5) is preceded by exactly ONE
  // ACTION_STARTED (the action in flight owning the gate).
  // The action has not yet finished (ACTION_FINISHED is
  // at position 6), so the unit "attempts entered"
  // counts it. M-C03 requires the metric to measure
  // iterations/convergence, not closed-action count.
  assert.equal(d.actions_to_last_authoritative_pass.available, true);
  if (!d.actions_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.actions_to_last_authoritative_pass.value, 1);
  // CORRECTION01 M-C03: work_epochs_to_last_authoritative_pass
  // is the actual Phase E work epoch at the anchor gate.
  // The single ACTION_STARTED before the gate advances
  // work_epoch to 1, so the gate at position 5 closes at
  // work_epoch 1.
  assert.equal(
    d.work_epochs_to_last_authoritative_pass.available,
    true,
  );
  if (!d.work_epochs_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.work_epochs_to_last_authoritative_pass.value, 1);
  // work_epochs_to_terminal is the actual work epoch at the
  // terminal event. No further epoch-advancing events
  // happen after the gate, so work_epoch is still 1 at
  // terminal.
  assert.equal(d.work_epochs_to_terminal, 1);

  assert.equal(m.report.convergence.trustworthy_success, true);
  assert.equal(
    m.report.success_normalized.eligible_for_success_normalized_metrics,
    true,
  );
  // CORRECTION01 M-C02: no invalidation observed in this
  // minimal-success run.
  assert.equal(
    m.report.correction_burden.historical_authority_invalidation_count,
    0,
  );
  assert.equal(
    m.report.correction_burden.current_authority_blocker_count,
    0,
  );
});

test("METRIC04 (golden): ACTION ERROR -> recovery -> SUCCESS still counts a historical invalidation", () => {
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

  // CORRECTION01 M-C02: historical burden counts the
  // ACTION_FINISHED(ERROR) that invalidated prior fresh
  // positive authority; the subsequent second gate
  // re-establishes authority but does NOT decrement the
  // historical count. Current-epoch blocker is 0 because
  // the run ultimately recovered.
  const b = m.report.correction_burden;
  assert.equal(b.historical_authority_invalidation_count, 1);
  assert.equal(b.current_authority_blocker_count, 0);
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
  // CORRECTION01 M-C02: the REVIEW_FINISHED(false) at the
  // current epoch DID invalidate prior fresh positive
  // authority. The historical count reflects that; the
  // current blocker is 0 because the failing verdict was
  // superseded by a later passing review at the same epoch.
  assert.equal(
    m.report.correction_burden.historical_authority_invalidation_count,
    1,
  );
  assert.equal(
    m.report.correction_burden.current_authority_blocker_count,
    0,
  );
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
  // CORRECTION01 M-C04: for non-SUCCESS runs the
  // *_to_last_authoritative_pass fields surface
  // unavailable("NOT_APPLICABLE").
  assert.equal(
    m.report.distances.actions_to_last_authoritative_pass.available,
    false,
  );
  if (m.report.distances.actions_to_last_authoritative_pass.available)
    throw new Error("ok");
  assert.equal(
    m.report.distances.actions_to_last_authoritative_pass.reason,
    "NOT_APPLICABLE",
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

// ---------------------------------------------------------------------------
// CORRECTION01 probes (M-C02 historical authority invalidation count).
//
// METRIC28..METRIC32 each pin one corner of the
// historical-invalidation walk. The walk mirrors Phase E's
// E-C14 V2 transition and E-C21 / E-C22 negative-evidence
// rules; surviving recovery does NOT decrement the count.
// ---------------------------------------------------------------------------

test("METRIC28 (M-C02): minimal SUCCESS run -> 0 invalidations", () => {
  const r = makePassThenTerminal({ seed: "mc02-28" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const b = m.report.correction_burden;
  assert.equal(b.historical_authority_invalidation_count, 0);
  assert.equal(b.current_authority_blocker_count, 0);
  assert.equal(m.report.convergence.trustworthy_success, true);
});

test("METRIC29 (M-C02): PASS -> more work -> PASS -> 1 invalidation", () => {
  const r = makePassThenMoreWorkThenPass({ seed: "mc02-29" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const b = m.report.correction_burden;
  assert.equal(b.historical_authority_invalidation_count, 1);
  assert.equal(b.current_authority_blocker_count, 0);
  assert.equal(m.report.convergence.trustworthy_success, true);
});

test("METRIC30 (M-C02): PASS -> ACTION ERROR -> work -> PASS -> invalidation survives recovery", () => {
  const r = makeActionErrorAfterPass({ seed: "mc02-30" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const b = m.report.correction_burden;
  // The ACTION_FINISHED(ERROR) after the first PASS counts
  // as a historical invalidation; the subsequent PASS
  // re-establishes authority but does NOT decrement.
  assert.equal(b.historical_authority_invalidation_count >= 1, true);
  assert.equal(b.current_authority_blocker_count, 0);
  assert.equal(m.report.convergence.trustworthy_success, true);
});

test("METRIC31 (M-C02): PASS -> REVIEW FAIL -> REVIEW PASS -> 1 invalidation", () => {
  const r = makeReviewFailThenReviewPass({ seed: "mc02-31" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const b = m.report.correction_burden;
  assert.equal(b.historical_authority_invalidation_count, 1);
  assert.equal(b.current_authority_blocker_count, 0);
  assert.equal(m.report.convergence.trustworthy_success, true);
});

test("METRIC32 (M-C02): PASS -> work -> PASS -> repair -> PASS -> 2 invalidations", () => {
  const r = makeTwoInvalidationsThenSuccess({ seed: "mc02-32" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const b = m.report.correction_burden;
  assert.equal(b.historical_authority_invalidation_count, 2);
  assert.equal(b.current_authority_blocker_count, 0);
  assert.equal(m.report.convergence.trustworthy_success, true);
});

// ---------------------------------------------------------------------------
// CORRECTION01 probes (M-C04 authoritative-pass semantics).
// ---------------------------------------------------------------------------

test("METRIC33 (M-C04): PASS -> FAIL -> VALID_FAILURE -> last_authoritative_pass unavailable", () => {
  const r = makePassThenFailThenValidFailure({ seed: "mc04-33" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.trustworthy_success, false);
  assert.equal(m.report.convergence.terminal_outcome, "VALID_FAILURE");
  const d = m.report.distances;
  assert.equal(d.actions_to_last_authoritative_pass.available, false);
  if (d.actions_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.actions_to_last_authoritative_pass.reason, "NOT_APPLICABLE");
  assert.equal(d.work_epochs_to_last_authoritative_pass.available, false);
  if (d.work_epochs_to_last_authoritative_pass.available)
    throw new Error("ok");
  assert.equal(
    d.work_epochs_to_last_authoritative_pass.reason,
    "NOT_APPLICABLE",
  );
});

test("METRIC34 (M-C04): PASS -> work -> PASS -> SUCCESS -> anchor is the second PASS", () => {
  const r = makePassWorkPassSuccess({ seed: "mc04-34" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.trustworthy_success, true);
  const d = m.report.distances;
  // Two ACTION_STARTEDs entered; the second gate is the
  // authoritative one. actions_to_last_authoritative_pass
  // counts ACTION_STARTED up to and including the
  // authoritative gate: 2.
  assert.equal(d.actions_to_last_authoritative_pass.available, true);
  if (!d.actions_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.actions_to_last_authoritative_pass.value, 2);
  // work_epochs_to_last_authoritative_pass: the second gate
  // is at work_epoch 2 (the first ACTION_STARTED advanced
  // to 1, the second to 2).
  assert.equal(d.work_epochs_to_last_authoritative_pass.available, true);
  if (!d.work_epochs_to_last_authoritative_pass.available)
    throw new Error("ok");
  assert.equal(d.work_epochs_to_last_authoritative_pass.value, 2);
});

test("METRIC35 (M-C04): PASS -> REVIEW FAIL -> terminal VALID_FAILURE -> last_authoritative_pass unavailable", () => {
  const r = makePassReviewFailTerminal({ seed: "mc04-35" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.trustworthy_success, false);
  const d = m.report.distances;
  assert.equal(d.actions_to_last_authoritative_pass.available, false);
  if (d.actions_to_last_authoritative_pass.available) throw new Error("ok");
  assert.equal(d.actions_to_last_authoritative_pass.reason, "NOT_APPLICABLE");
});
