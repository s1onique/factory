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
    assert.equal(
      pi.disposition,
      fake.disposition,
      `LH-05 semantic-equivalence drift at ${scenario.id}: pi=${pi.disposition} vs fake=${fake.disposition}`,
    );
  }
});
