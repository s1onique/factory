/**
 * LH-04 full matrix acceptance test.
 *
 * Runs every FaultExperiment in FAULT_CATALOG against
 * the canonical baseline and asserts each one either:
 *
 *   - PASSES at its declared authority + error kind,
 *   - or is currently UNQUALIFIED (BASELINE_REGRESSION,
 *     NOT_YET_QUALIFIED) — recorded but not failed.
 *
 * A fault that ESCAPES the verifier (i.e. verifier
 * returns ok=true) is a critical failure: it means the
 * frozen verifier accepted a controlled mutation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultRepoRoot, runFaultMatrix, semanticResultShape } from "../../fault-lab/deterministic/runner.js";
import { FAULT_CATALOG } from "../../fault-lab/deterministic/fault-catalog.js";

const REPO_ROOT = defaultRepoRoot();

test("LH-04 full matrix: every catalog experiment runs deterministically", async () => {
  const results = await runFaultMatrix({
    repoRoot: REPO_ROOT,
    experiments: FAULT_CATALOG,
  });
  for (const r of results) {
    if (r.disposition === "PASS") continue;
    // FAIL loud — every fault MUST be qualified.
    assert.fail(
      `LH-04 fault ${r.id} disposition=${r.disposition} expected_authority=${r.expected_authority} expected_kind=${r.expected_error_kind} got_authority=${r.observed_authority} got_kind=${r.observed_error_kind} msg=${r.observed_first_rejection_message}`,
    );
  }
  assert.equal(results.length, FAULT_CATALOG.length);
});

test("LH-04 full matrix: two consecutive runs produce identical semantic shape", async () => {
  const a = await runFaultMatrix({
    repoRoot: REPO_ROOT,
    experiments: FAULT_CATALOG,
  });
  const b = await runFaultMatrix({
    repoRoot: REPO_ROOT,
    experiments: FAULT_CATALOG,
  });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    const sa = semanticResultShape(a[i]!);
    const sb = semanticResultShape(b[i]!);
    assert.deepEqual(
      sa,
      sb,
      `LH-04 determinism failure at ${a[i]!.id}`,
    );
  }
});
