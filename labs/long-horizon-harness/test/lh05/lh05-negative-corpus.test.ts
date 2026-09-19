/**
 * LH-05 negative corpus test.
 *
 * Asserts that for every forbidden_outcome (terminal_outcome_in,
 * lifecycle_state_in, success_normalized_metrics_emitted,
 * custom), the runner's actuals do NOT exhibit the
 * forbidden outcome.
 *
 * This is the structural test for "the corpus asserts
 * forbidden properties, not just expected properties".
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_CORPUS_CATALOG } from "../../lifecycle-corpus/catalog.js";
import { runScenarioForHarness } from "../../lifecycle-corpus/runner.js";

const REPO_ROOT = process.cwd();

test("LH-05 every scenario's terminal_outcome is NOT in forbidden_outcome_in", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    const forbidden = scenario.golden_predicates.forbidden_outcomes.terminal_outcome_in;
    if (!forbidden || forbidden.length === 0) continue;
    if (!scenario.eligible_harnesses.pi.eligible) continue;
    const r = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "pi",
    });
    if (r.phase_e_terminal_outcome && forbidden.includes(r.phase_e_terminal_outcome)) {
      assert.fail(
        `${scenario.id}: terminal_outcome '${r.phase_e_terminal_outcome}' is in forbidden list [${forbidden.join(", ")}]`,
      );
    }
  }
});

test("LH-05 every scenario's lifecycle_state is NOT in forbidden_lifecycle_state_in", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    const forbidden = scenario.golden_predicates.forbidden_outcomes.lifecycle_state_in;
    if (!forbidden || forbidden.length === 0) continue;
    if (!scenario.eligible_harnesses.pi.eligible) continue;
    const r = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "pi",
    });
    if (r.phase_e_lifecycle_state && forbidden.includes(r.phase_e_lifecycle_state)) {
      assert.fail(
        `${scenario.id}: lifecycle_state '${r.phase_e_lifecycle_state}' is in forbidden list [${forbidden.join(", ")}]`,
      );
    }
  }
});

test("LH-05 no scenario emits success_normalized_metrics when forbidden", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (
      scenario.golden_predicates.forbidden_outcomes.success_normalized_metrics_emitted !== true
    ) {
      continue;
    }
    if (!scenario.eligible_harnesses.pi.eligible) continue;
    const r = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "pi",
    });
    assert.equal(
      r.success_normalized_metrics_emitted,
      false,
      `${scenario.id}: success_normalized_metrics MUST NOT be emitted (forbidden)`,
    );
  }
});
