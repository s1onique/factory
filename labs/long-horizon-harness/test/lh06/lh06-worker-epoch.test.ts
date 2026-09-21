/**
 * LH-06 worker epoch tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * The worker / epoch tests run REAL LH-04 + LH-05 cases
 * against the frozen corpus. The tests run with
 * `max_epochs: 1` so they don't sleep for a long time, but
 * they DO prove that one canonical epoch produces a
 * terminal result.
 *
 * L06-CORRECTION03 L06-C21: tests that expect a PASS
 * MUST inject a complete substrate via the
 * `state.substrateOverride` field (a CI_SMOKE-only test
 * seam). The production profiles (QUALIFICATION /
 * EXTENDED) reject the override.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSoakWorker } from "../../soak/worker-runner.js";
import { createWorkerState } from "../../soak/worker-state.js";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SoakWorkerState } from "../../soak/worker-state.js";
import type { LH06SubstrateBinding } from "../../soak/result.js";

const REPO_ROOT = process.cwd();

/**
 * L06-CORRECTION03 L06-C21: a CI_SMOKE test seam that
 * injects a complete substrate without consulting the
 * live qualification artifacts. Production profiles
 * reject the override.
 */
function withCompleteSubstrate(state: SoakWorkerState): SoakWorkerState {
  const sub: LH06SubstrateBinding = {
    phase_e_head: "test-phase-e",
    lh02_head: "test-lh02",
    lh03_frozen_commit: "test-lh03",
    lh04_frozen_commit: "test-lh04",
    lh05_corpus_commit: "test-lh05",
    repo_commit: "test-repo",
  };
  return {
    ...state,
    substrateOverride: sub,
  } as unknown as SoakWorkerState;
}

test("LH-06 worker: single epoch produces a valid terminal result", async () => {
  const base = createWorkerState({
    profile: "CI_SMOKE",
    injection: { kind: "NONE" },
    repoRoot: REPO_ROOT,
  });
  const state = withCompleteSubstrate(base);
  const tmpDir = `/tmp/factory-lh06-test-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  try {
    const result = await runSoakWorker({
      state,
      result_path: resultPath,
      max_epochs: 1,
    });
    assert.equal(existsSync(resultPath), true);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(written.schema, "lh06.deterministic.soak.result.v1");
    assert.equal(written.profile, "CI_SMOKE");
    assert.equal(written.epochs_completed >= 1, true);
    assert.equal(written.contract_version, "lh06.soak.contract.v1");
    // Under-length CI_SMOKE run (1 < 10 minimum) MUST be
    // reported as QUALIFICATION_INCOMPLETE — never PASS.
    assert.equal(
      written.verdict,
      "QUALIFICATION_INCOMPLETE",
      `under-length CI_SMOKE (epochs_completed=${written.epochs_completed}) must not be PASS`,
    );
    void result;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LH-06 worker: respects max_epochs ceiling", async () => {
  const base = createWorkerState({
    profile: "CI_SMOKE",
    injection: { kind: "NONE" },
    repoRoot: REPO_ROOT,
  });
  const state = withCompleteSubstrate(base);
  const tmpDir = `/tmp/factory-lh06-test-${Date.now()}-2`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  try {
    const result = await runSoakWorker({
      state,
      result_path: resultPath,
      max_epochs: 2,
    });
    assert.equal(result.epochs_completed <= 2, true);
    assert.equal(result.verdict, "QUALIFICATION_INCOMPLETE");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LH-06 worker: QUALIFICATION profile with LEAK01 injection refuses to run", async () => {
  const state = createWorkerState({
    profile: "QUALIFICATION",
    injection: { kind: "LEAK01_RETAIN_BYTES_PER_EPOCH", bytes: 1024 },
    repoRoot: REPO_ROOT,
  });
  const tmpDir = `/tmp/factory-lh06-test-${Date.now()}-3`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  try {
    const result = await runSoakWorker({
      state,
      result_path: resultPath,
      max_epochs: 1,
    });
    assert.equal(result.failure !== null, true);
    assert.equal(result.failure?.kind, "WORKER_CRASH");
    assert.equal(result.epochs_completed, 0);
    assert.equal(result.verdict, "FAIL_WORKER");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("LH-06 worker: 10-epoch CI_SMOKE run satisfies minimum contract", async () => {
  const base = createWorkerState({
    profile: "CI_SMOKE",
    injection: { kind: "NONE" },
    repoRoot: REPO_ROOT,
  });
  const state = withCompleteSubstrate(base);
  const tmpDir = `/tmp/factory-lh06-test-${Date.now()}-4`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  try {
    const result = await runSoakWorker({
      state,
      result_path: resultPath,
      max_epochs: 10,
    });
    assert.equal(result.epochs_completed, 10);
    assert.equal(result.verdict, "PASS_DETERMINISTIC_SOAK");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
