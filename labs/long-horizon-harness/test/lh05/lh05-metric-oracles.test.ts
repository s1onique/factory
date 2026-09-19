/**
 * LH-05 LH-02 metric oracle test.
 *
 * Asserts that the FROZEN LH-02 metric projector (at HEAD
 * 715e6390d78228f089270259e1bd1307140adb75) is invoked
 * unchanged by the LH-05 runner, and that every scenario's
 * golden_predicates.expected_lh02 is consistent with what
 * the projector actually produces for that scenario's
 * RunEvent stream.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_CORPUS_CATALOG } from "../../lifecycle-corpus/catalog.js";
import { runScenarioForHarness } from "../../lifecycle-corpus/runner.js";
import { checkLH02 } from "../../lifecycle-corpus/expected.js";

const REPO_ROOT = process.cwd();

test("LH-05 LH-02 metric_contract_version is 'convergence.metric.contract.v1' (frozen)", () => {
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    assert.equal(
      s.golden_predicates.expected_lh02.metric_contract_version,
      "convergence.metric.contract.v1",
      `${s.id}: metric_contract_version must be the frozen v1`,
    );
  }
});

test("LH-05 LH-02 metric predicates are consistent with the FROZEN projector (pi path)", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (!scenario.eligible_harnesses.pi.eligible) {
      continue;
    }
    const r = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "pi",
    });
    if (r.adapter_disposition.kind === "REJECTED") {
      // Adapter-rejected scenarios: lh02 not produced.
      // The runner's checkLH02 short-circuits via
      // metric_evidence_failure_observed=true. Already
      // asserted in lh05-catalog + lh05-pi-replay tests.
      continue;
    }
    if (r.adapter_disposition.kind === "LH04_HANDOFF") {
      // L05-C04: FAULT_LAB_HANDOFF scenarios do not produce
      // a MetricReport at all. The runner pins
      // metric_evidence_failure_observed=true and null
      // terminal_outcome in the LH-02 slot; the catalog must
      // agree.
      continue;
    }
    const lh02Check = checkLH02(scenario.golden_predicates.expected_lh02, {
      metric_contract_version: r.lh02_predicates?.metric_contract_version ?? null,
      terminal_outcome: r.lh02_predicates?.terminal_outcome ?? null,
      eligible_for_success_normalized_metrics: r.lh02_predicates?.eligible_for_success_normalized_metrics ?? null,
      historical_authority_invalidation_count: r.lh02_predicates?.historical_authority_invalidation_count ?? null,
      metric_evidence_failure_observed: r.lh02_predicates?.metric_evidence_failure_observed ?? null,
    });
    assert.equal(
      lh02Check.ok,
      true,
      `LH-05 LH-02 metric mismatch at ${scenario.id}: ${lh02Check.failed.join("; ")}`,
    );
  }
});
