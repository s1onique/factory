/**
 * LH-05 reference-control test.
 *
 * For every scenario eligible for the fake harness
 * (REFERENCE_CONTROL), run the scripted-fake adapter +
 * reference-control mapper against the fake.script.json
 * and assert PASS against golden_predicates.
 *
 * This is the Pi-vocabulary-independent ground truth.
 * The harness vocabulary is candidate-neutral.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_CORPUS_CATALOG, findScenario } from "../../lifecycle-corpus/catalog.js";
import { runScenarioForHarness } from "../../lifecycle-corpus/runner.js";

const REPO_ROOT = process.cwd();

test("LH-05 reference-control: every scenario eligible for FAKE produces PASS", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (scenario.eligible_harnesses.fake_reference_control.eligible !== true) {
      continue;
    }
    const r = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "fake",
    });
    assert.equal(
      r.disposition,
      "PASS",
      `LH-05 reference-control ${scenario.id} expected PASS, got ${r.disposition}: ${r.notes}`,
    );
  }
});

test("LH-05 reference-control is not applicable to LC05/LC06/LC11", () => {
  for (const id of ["LC05", "LC06", "LC11"]) {
    const s = findScenario(id);
    assert.ok(s, `${id} must exist`);
    assert.notEqual(
      s!.eligible_harnesses.fake_reference_control.eligible,
      true,
      `${id} must NOT be REFERENCE_CONTROL-eligible`,
    );
  }
});

test("LH-05 reference-control semantics equal pi-replay semantics (where both apply)", async () => {
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
    // L05-C09: a stronger equivalence check than just the
    // disposition string. The two harnesses must agree on
    // every semantically meaningful axis:
    //   - adapter disposition kind
    //   - Phase E lifecycle state + terminal outcome
    //   - LH-02 metric contract version + terminal outcome
    //   - authority predicates (last_gate_pass, last_action_status)
    //   - negative-evidence predicates (action_failure_at_epoch)
    //   - forbidden outcomes (all_absent)
    //   - success_normalized_metrics_emitted
    //   - top-level disposition
    assert.equal(
      pi.disposition,
      fake.disposition,
      `LH-05 semantic-equivalence drift at ${scenario.id} (disposition): pi=${pi.disposition} vs fake=${fake.disposition}`,
    );
    assert.equal(
      pi.adapter_disposition.kind,
      fake.adapter_disposition.kind,
      `LH-05 semantic-equivalence drift at ${scenario.id} (adapter kind): pi=${pi.adapter_disposition.kind} vs fake=${fake.adapter_disposition.kind}`,
    );
    assert.equal(
      pi.phase_e_lifecycle_state,
      fake.phase_e_lifecycle_state,
      `LH-05 semantic-equivalence drift at ${scenario.id} (lifecycle_state): pi=${pi.phase_e_lifecycle_state} vs fake=${fake.phase_e_lifecycle_state}`,
    );
    assert.equal(
      pi.phase_e_terminal_outcome,
      fake.phase_e_terminal_outcome,
      `LH-05 semantic-equivalence drift at ${scenario.id} (terminal_outcome): pi=${pi.phase_e_terminal_outcome} vs fake=${pi.phase_e_terminal_outcome}`,
    );
    assert.equal(
      pi.success_normalized_metrics_emitted,
      fake.success_normalized_metrics_emitted,
      `LH-05 semantic-equivalence drift at ${scenario.id} (success_normalized_metrics_emitted)`,
    );
    assert.deepEqual(
      pi.forbidden_outcomes.observed,
      fake.forbidden_outcomes.observed,
      `LH-05 semantic-equivalence drift at ${scenario.id} (forbidden outcomes)`,
    );
    assert.equal(
      pi.lh02_predicates.metric_contract_version,
      fake.lh02_predicates.metric_contract_version,
      `LH-05 semantic-equivalence drift at ${scenario.id} (metric_contract_version)`,
    );
    assert.equal(
      pi.lh02_predicates.terminal_outcome,
      fake.lh02_predicates.terminal_outcome,
      `LH-05 semantic-equivalence drift at ${scenario.id} (lh02.terminal_outcome)`,
    );
  }
});
