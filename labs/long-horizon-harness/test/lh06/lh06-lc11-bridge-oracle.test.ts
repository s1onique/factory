/**
 * LH-06 LC11 bridge oracle tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION12 L06-C49)
 *
 * The CORRECTION11 C45 test file (`lh06-lc11-canonical-root.test.ts`)
 * exercised the canonical-temp-root primitives in isolation.
 * It did NOT exercise the actual LC11 / LH-04 handoff
 * through the production wrapper. The SRE reviewer
 * identified this as a test-suite gap: the wrapper
 * utilities may be correct in isolation but the bridge
 * correction is not proven.
 *
 * This file pins the bridge oracle:
 *   - unmodified LC11 baseline -> verifier PASS
 *   - the wrapper makes runScenarioForHarness actually
 *     reach the LH-04 frozen verifier (not silently
 *     destroyed before it can run)
 *
 * It deliberately invokes `runScenarioForHarness` against
 * the real LC11 scenario under the real
 * `withCanonicalTempRoot` wrapper so a regression in the
 * wrapper's resource-lifetime semantics is caught here,
 * not in a 60-minute supervised run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenarioForHarness } from "../../lifecycle-corpus/runner.js";
import { withCanonicalTempRoot } from "../../soak/canonical-temp-root.js";
import { labRoot } from "./_lh06-lab-root.js";

const repoRoot = labRoot();

test("L06-C49-BRIDGE-01: runScenarioForHarness(LC11, pi) reaches the LH-04 frozen verifier through the canonical wrapper", async () => {
  const result = await withCanonicalTempRoot({
    prefix: "lh06-c49-bridge-",
    invoke: async () =>
      runScenarioForHarness({
        repoRoot,
        scenarioId: "LC11",
        harness: "pi",
      }),
  });
  // The LC11 scenario is `FAULT_LAB_HANDOFF`. The frozen
  // LH-04 verifier is the only thing that should classify
  // it. The wrapper MUST preserve the workspace long
  // enough for the verifier to run.
  assert.equal(
    result.disposition,
    "PASS",
    `LC11 must PASS through the wrapper; got disposition=${result.disposition} notes=${result.notes}`,
  );
  // The notes should be the LH-04 rejection reason, not an
  // internal-error sentinel.
  assert.match(
    result.notes ?? "",
    /LH-04 rejected mutated evidence with EVIDENCE_HASH_MISMATCH/,
  );
});

test("L06-C49-BRIDGE-02: canonical wrapper does NOT turn a real PASS into WRONG_ADAPTER_STATE", async () => {
  // This is the exact regression QUALIFICATION01 surfaced:
  // the wrapper previously returned WRONG_ADAPTER_STATE
  // because it deleted the workspace while the async
  // work was still using it.
  const result = await withCanonicalTempRoot({
    prefix: "lh06-c49-not-wrong-",
    invoke: async () =>
      runScenarioForHarness({
        repoRoot,
        scenarioId: "LC11",
        harness: "pi",
      }),
  });
  assert.notEqual(result.disposition, "WRONG_ADAPTER_STATE");
  assert.notEqual(result.disposition, "FAIL_INTERNAL_ERROR");
  assert.equal(result.disposition, "PASS");
});

test("L06-C49-BRIDGE-03: LC11 PASS is reproducible across two independent wrapper invocations (no shared-state pollution)", async () => {
  const first = await withCanonicalTempRoot({
    prefix: "lh06-c49-rep1-",
    invoke: async () =>
      runScenarioForHarness({
        repoRoot,
        scenarioId: "LC11",
        harness: "pi",
      }),
  });
  const second = await withCanonicalTempRoot({
    prefix: "lh06-c49-rep2-",
    invoke: async () =>
      runScenarioForHarness({
        repoRoot,
        scenarioId: "LC11",
        harness: "pi",
      }),
  });
  assert.equal(first.disposition, "PASS");
  assert.equal(second.disposition, "PASS");
});
