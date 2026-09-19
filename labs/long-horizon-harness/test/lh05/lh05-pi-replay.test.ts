/**
 * LH-05 Pi-replay path test.
 *
 * For every scenario eligible for the Pi harness, run the
 * adapter normalization → mapper → Phase E projector
 * pipeline against the recorded Pi-native session and
 * assert PASS against golden_predicates.
 *
 * This test exercises the CLOSED-WORLD Pi-adapter
 * normalization path. Phase E / terminal events come
 * from the per-scenario phase_e_oracle.json (hand-pinned).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_CORPUS_CATALOG, findScenario } from "../../lifecycle-corpus/catalog.js";
import { runScenarioForHarness } from "../../lifecycle-corpus/runner.js";

const REPO_ROOT = process.cwd();

test("LH-05 pi-replay: every scenario eligible for Pi produces PASS", async () => {
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (!scenario.eligible_harnesses.pi.eligible) {
      continue;
    }
    const r = await runScenarioForHarness({
      repoRoot: REPO_ROOT,
      scenarioId: scenario.id,
      harness: "pi",
    });
    assert.equal(
      r.disposition,
      "PASS",
      `LH-05 pi-replay ${scenario.id} expected PASS, got ${r.disposition}: ${r.notes}`,
    );
  }
});

test("LH-05 pi-replay: LC05 is the only scenario expected to be REJECTED by the adapter", async () => {
  const lc05 = findScenario("LC05");
  assert.ok(lc05, "LC05 must exist");
  const r = await runScenarioForHarness({
    repoRoot: REPO_ROOT,
    scenarioId: "LC05",
    harness: "pi",
  });
  assert.equal(r.disposition, "PASS", `LC05 should PASS under the harness-rejection short-circuit`);
  assert.equal(r.adapter_disposition.kind, "REJECTED", `LC05 must be REJECTED`);
  assert.equal(r.adapter_disposition.expected_error_kind, "MALFORMED_NATIVE_EVENT");
});

test("LH-05 pi-replay: LC11 is the FAULT_LAB_HANDOFF scenario and is REJECTED with EVIDENCE_CORRUPTION_DETECTED", async () => {
  const lc11 = findScenario("LC11");
  assert.ok(lc11, "LC11 must exist");
  const r = await runScenarioForHarness({
    repoRoot: REPO_ROOT,
    scenarioId: "LC11",
    harness: "pi",
  });
  assert.equal(r.disposition, "PASS", `LC11 should PASS via FAULT_LAB_HANDOFF short-circuit`);
  assert.equal(r.adapter_disposition.kind, "REJECTED");
  assert.equal(r.adapter_disposition.expected_error_kind, "EVIDENCE_CORRUPTION_DETECTED");
});
