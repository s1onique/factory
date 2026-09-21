/**
 * LH-06 bounded lifecycle-drift attribution tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 C47)
 *
 * QUALIFICATION01 produced `lifecycle_drift_count=38075`
 * but the terminal output did not say WHICH scenario
 * drifted. The 38075 drifts were forced manual forensic
 * correlation against the LH-05 catalog.
 *
 * L06-CORRECTION11 C47 (authorized here because it
 * directly addresses the QUALIFICATION01 observability
 * gap): bounded per-scenario drift attribution. The
 * `lifecycle_drift_by_scenario` map MUST have keys drawn
 * from the LC01..LC12 closed-world set and integer
 * counters as values. Memory complexity is O(scenarios),
 * NOT O(failures observed).
 *
 * L06-CORRECTION12 L06-C50: under the corrected wrapper
 * the LC11 baseline MUST PASS deterministically. The
 * C47 attribution map therefore MUST NOT accumulate
 * non-PASS observations for LC11 — a non-PASS observation
 * means either the wrapper was torn down early, the
 * substrate is stale, or the LH-04 frozen verifier was
 * bypassed. None of those is a "may PASS or FAIL"
 * condition; all three are regression markers and the
 * attribution map MUST surface them.
 *
 * Diagnostic only. It MUST NOT affect the verdict.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerState } from "../../soak/worker-state.js";
import { runLh05Case } from "../../soak/case-runner.js";
import { mkdirSync, rmSync } from "node:fs";
import { LH06_LAB_ROOT } from "./_lh06-lab-root.js";

test("L06-C47: lifecycle_drift_by_scenario starts empty", () => {
  const state = createWorkerState({
    profile: "CI_SMOKE",
    injection: { kind: "NONE" },
    repoRoot: LH06_LAB_ROOT,
  });
  // The initial state is an empty record.
  assert.deepEqual(state.lifecycle_drift_by_scenario, {});
});

test("L06-C47: runLh05Case attribution increments the bound map for non-PASS scenarios", async () => {
  const tmpDir = `/tmp/factory-lh06-c47-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: { kind: "NONE" },
      repoRoot: LH06_LAB_ROOT,
    });
    // L06-CORRECTION12 L06-C50: under the corrected
    // wrapper the LC11 baseline MUST PASS deterministically.
    // Run LC11 three times. Each invocation MUST yield
    // disposition === "PASS" and the attribution map MUST
    // NOT record any non-PASS observation for LC11.
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await runLh05Case(state, "LC11", i, null);
      assert.equal(
        r.disposition,
        "PASS",
        `LC11 baseline MUST PASS through the corrected wrapper on iteration ${i}; got disposition=${r.disposition}`,
      );
      counts.push(r.disposition === "PASS" ? 0 : 1);
      const v = state.lifecycle_drift_by_scenario["LC11"];
      if (v !== undefined) {
        assert.equal(typeof v, "number");
      }
    }
    // The total of non-PASS observations MUST be zero.
    const totalNonPass = counts.reduce((a, b) => a + b, 0);
    assert.equal(
      totalNonPass,
      0,
      `LC11 must produce zero non-PASS observations under the corrected wrapper; got ${totalNonPass}`,
    );
    assert.equal(
      state.lifecycle_drift_by_scenario["LC11"] ?? 0,
      0,
      `LC11 attribution map must be empty under the corrected wrapper; got ${state.lifecycle_drift_by_scenario["LC11"] ?? 0}`,
    );
    // The map MUST NOT contain any other key besides
    // the closed-world scenarios.
    for (const key of Object.keys(state.lifecycle_drift_by_scenario)) {
      assert.match(key, /^LC\d{2}$/);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("L06-C47: bounded cardinality invariant (no per-event retention)", async () => {
  const tmpDir = `/tmp/factory-lh06-c47-bounded-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: { kind: "NONE" },
      repoRoot: LH06_LAB_ROOT,
    });
    // Drive a long sequence of LC11 calls. The map's
    // cardinality MUST NOT grow beyond 12 keys.
    // L06-CORRECTION12 L06-C50: under the corrected
    // wrapper every LC11 invocation MUST PASS. The map
    // MUST stay empty (zero non-PASS observations).
    for (let i = 0; i < 20; i++) {
      const r = await runLh05Case(state, "LC11", i, null);
      assert.equal(
        r.disposition,
        "PASS",
        `LC11 iteration ${i} must PASS; got ${r.disposition}`,
      );
    }
    const keys = Object.keys(state.lifecycle_drift_by_scenario);
    assert.ok(keys.length <= 12, `map cardinality ${keys.length} > 12`);
    assert.deepEqual(
      state.lifecycle_drift_by_scenario,
      {},
      `LC11 attribution map must remain empty under the corrected wrapper; got ${JSON.stringify(state.lifecycle_drift_by_scenario)}`,
    );
    assert.equal(
      state.lifecycle_drift_count,
      0,
      `lifecycle_drift_count must stay 0; got ${state.lifecycle_drift_count}`,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});