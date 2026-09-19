/**
 * LH-05 semantic parity oracle test (L05-C12).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * PARITY01 — full semantic parity across every eligible
 *   (pi, reference) pair (terminal_outcome is necessary but
 *   NOT sufficient).
 * PARITY02 — same terminal_outcome, different authority
 *   predicate -> parity test fails.
 * PARITY03 — the candidate-neutral parity shape is projection
 *   stable across the full LH-05 corpus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_CORPUS_CATALOG } from "../../lifecycle-corpus/catalog.js";
import { runScenarioForHarness } from "../../lifecycle-corpus/runner.js";
import {
  semanticParityShape,
  compareSemanticParityShapes,
} from "../../lifecycle-corpus/semantic-parity.js";

const REPO_ROOT = process.cwd();

test("PARITY01 full semantic parity across eligible scenarios (pi == reference)", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (
      !scenario.eligible_harnesses.pi.eligible ||
      scenario.eligible_harnesses.fake_reference_control.eligible !== true
    ) {
      continue;
    }
    const pi = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "pi",
    });
    const fake = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "fake",
    });
    const piShape = semanticParityShape(pi);
    const fakeShape = semanticParityShape(fake);
    const mismatch = compareSemanticParityShapes(piShape, fakeShape);
    assert.equal(
      mismatch,
      null,
      `PARITY01 mismatch at ${scenario.id}: ${mismatch ? mismatch.join(", ") : "n/a"}`,
    );
  }
});

test("PARITY02 same terminal_outcome but different authority predicate MUST fail parity", () => {
  // Construct two parity shapes that agree on terminal_outcome
  // ("SUCCESS") but disagree on last_action_status.
  const piShape = {
    adapter_disposition_kind: "ACCEPTED",
    adapter_error_kind: null,
    phase_e: {
      lifecycle_state: "TERMINAL",
      terminal_outcome: "SUCCESS",
      closure_authority_fresh: true,
      current_epoch_action_failure: false,
      current_epoch_review_failure: false,
      last_gate_pass: true,
      last_action_status: "OK" as const,
      last_review_pass: null,
      action_failure_at_epoch: null,
      review_failure_at_epoch: null,
    },
    lh02: {
      passed: true,
      failed: [],
      metric_contract_version: "convergence.metric.contract.v1",
      terminal_outcome: "SUCCESS",
      eligible_for_success_normalized_metrics: true,
      historical_authority_invalidation_count: 0,
      metric_evidence_failure_observed: false,
    },
    success_normalized_metrics_emitted: true,
    forbidden_outcomes_absent: true,
    disposition: "PASS",
  };
  const fakeShape = {
    ...piShape,
    phase_e: { ...piShape.phase_e, last_action_status: "ERROR" as const },
  };
  const mismatch = compareSemanticParityShapes(piShape, fakeShape);
  assert.notEqual(
    mismatch,
    null,
    "PARITY02: parity MUST distinguish authority differences even when terminal_outcome matches",
  );
  assert.ok(
    mismatch!.includes("phase_e"),
    `PARITY02: phase_e must be the mismatching field, got [${mismatch!.join(", ")}]`,
  );
});

test("PARITY03 same terminal_outcome but different closure_authority_fresh fails parity", () => {
  const piShape = {
    adapter_disposition_kind: "ACCEPTED",
    adapter_error_kind: null,
    phase_e: {
      lifecycle_state: "TERMINAL",
      terminal_outcome: "SUCCESS",
      closure_authority_fresh: true,
      current_epoch_action_failure: false,
      current_epoch_review_failure: false,
      last_gate_pass: true,
      last_action_status: "OK" as const,
      last_review_pass: null,
      action_failure_at_epoch: null,
      review_failure_at_epoch: null,
    },
    lh02: {
      passed: true,
      failed: [],
      metric_contract_version: "convergence.metric.contract.v1",
      terminal_outcome: "SUCCESS",
      eligible_for_success_normalized_metrics: true,
      historical_authority_invalidation_count: 0,
      metric_evidence_failure_observed: false,
    },
    success_normalized_metrics_emitted: true,
    forbidden_outcomes_absent: true,
    disposition: "PASS",
  };
  const fakeShape = {
    ...piShape,
    phase_e: { ...piShape.phase_e, closure_authority_fresh: false },
  };
  const mismatch = compareSemanticParityShapes(piShape, fakeShape);
  assert.notEqual(mismatch, null, "closure_authority_fresh drift MUST be detected");
});

test("PARITY04 parity shape covers ALL PhaseEPredicates fields", () => {
  // Every PhaseEPredicates field that can differ MUST be
  // surface-checked. We force each field independently and
  // assert compareSemanticParityShapes catches it.
  const base = {
    adapter_disposition_kind: "ACCEPTED",
    adapter_error_kind: null,
    phase_e: {
      lifecycle_state: "TERMINAL",
      terminal_outcome: "SUCCESS",
      closure_authority_fresh: true,
      current_epoch_action_failure: false,
      current_epoch_review_failure: false,
      last_gate_pass: true,
      last_action_status: "OK" as const,
      last_review_pass: null,
      action_failure_at_epoch: null,
      review_failure_at_epoch: null,
    },
    lh02: {
      passed: true,
      failed: [],
      metric_contract_version: "convergence.metric.contract.v1",
      terminal_outcome: "SUCCESS",
      eligible_for_success_normalized_metrics: true,
      historical_authority_invalidation_count: 0,
      metric_evidence_failure_observed: false,
    },
    success_normalized_metrics_emitted: true,
    forbidden_outcomes_absent: true,
    disposition: "PASS",
  };
  const fieldMutations: Array<keyof typeof base.phase_e> = [
    "lifecycle_state",
    "terminal_outcome",
    "closure_authority_fresh",
    "current_epoch_action_failure",
    "current_epoch_review_failure",
    "last_gate_pass",
    "last_action_status",
    "last_review_pass",
    "action_failure_at_epoch",
    "review_failure_at_epoch",
  ];
  for (const field of fieldMutations) {
    const mutated = {
      ...base,
      phase_e: {
        ...base.phase_e,
        [field]: field === "terminal_outcome" ? "FAILURE" : field === "lifecycle_state" ? "INCOMPLETE" : field === "last_action_status" ? "ERROR" : !base.phase_e[field],
      },
    };
    const mismatch = compareSemanticParityShapes(base, mutated as typeof base);
    assert.notEqual(
      mismatch,
      null,
      `PARITY04 must detect drift in phase_e.${field}`,
    );
  }
});
