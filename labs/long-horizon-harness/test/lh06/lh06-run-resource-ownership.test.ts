/**
 * LH-06 run-resource lifecycle ownership tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C42)
 *
 * The production qualification crashed with:
 *   `ResourceLedger.endRun: unknown runId 7aab74ed17082938`
 *
 * The cause was a double begin / end release chain:
 *   runSoakFromEnv() -> beginRun + endRun (outer)
 *   runSoakWorker()  -> beginRun + endRun (inner, idempotent)
 *
 * CORRECTION02 made the inner release "idempotent" by
 * checking the in-flight set before calling endRun. That
 * hid the ownership defect. CORRECTION11 removes the
 * duplicate ownership entirely:
 *
 *   - `runSoakWorker()` is the SOLE owner of the
 *     production run counter.
 *   - `runSoakFromEnv()` MUST NOT call beginRun / endRun.
 *   - The ledger throws on a duplicate release.
 *
 * These tests pin the contract so a future correction
 * cannot reintroduce the double-ownership chain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerState } from "../../soak/worker-state.js";
import { runSoakWorker } from "../../soak/worker-runner.js";
import { parseInjection } from "../../soak/result-builder.js";
import {
  acquireRun,
  releaseRun,
  isRunHeldByLedger,
} from "../../soak/run-resource-owner.js";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const REPO_ROOT = process.cwd();

test("L06-C42-C42-RUN01: normal runSoakWorker acquires exactly once and releases exactly once", async () => {
  const tmpDir = `/tmp/factory-lh06-c42-run01-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: parseInjection("NONE"),
      repoRoot: REPO_ROOT,
    });
    let beginCalls = 0;
    let endCalls = 0;
    const ledger = state.ledger;
    const origBegin = ledger.beginRun.bind(ledger);
    const origEnd = ledger.endRun.bind(ledger);
    (ledger as unknown as { beginRun: (id: string) => void }).beginRun = (id: string) => {
      if (id === state.runId) beginCalls += 1;
      origBegin(id);
    };
    (ledger as unknown as { endRun: (id: string) => void }).endRun = (id: string) => {
      if (id === state.runId) endCalls += 1;
      origEnd(id);
    };
    await runSoakWorker({
      state,
      result_path: join(tmpDir, "result.json"),
      max_epochs: 2,
    });
    assert.equal(beginCalls, 1, `beginRun must be called exactly once; got ${beginCalls}`);
    assert.equal(endCalls, 1, `endRun must be called exactly once; got ${endCalls}`);
    assert.equal(state.ledger.snapshot().active_soak_runs, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("L06-C42-C42-RUN02: QUALIFICATION_INCOMPLETE path releases the run counter exactly once", async () => {
  const tmpDir = `/tmp/factory-lh06-c42-run02-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: parseInjection("NONE"),
      repoRoot: REPO_ROOT,
    });
    let endCalls = 0;
    const ledger = state.ledger;
    const origEnd = ledger.endRun.bind(ledger);
    (ledger as unknown as { endRun: (id: string) => void }).endRun = (id: string) => {
      if (id === state.runId) endCalls += 1;
      origEnd(id);
    };
    // CI_SMOKE minimum is 10 epochs; running 5 leaves the
    // run as QUALIFICATION_INCOMPLETE.
    await runSoakWorker({
      state,
      result_path: join(tmpDir, "result.json"),
      max_epochs: 5,
    });
    assert.equal(endCalls, 1);
    assert.equal(state.ledger.snapshot().active_soak_runs, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("L06-C42-C42-RUN03: invalid-injection failure releases the run counter exactly once", async () => {
  const tmpDir = `/tmp/factory-lh06-c42-run03-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "QUALIFICATION",
      // LEAK01 is only allowed on CI_SMOKE; QUALIFICATION
      // rejects it -> the worker builds a WORKER_CRASH
      // failure record and returns.
    // deno-lint-ignore no-explicit-any
    injection: { kind: "LEAK01_RETAIN_BYTES_PER_EPOCH", bytes: 1024 } as any,
      repoRoot: REPO_ROOT,
    });
    let endCalls = 0;
    const ledger = state.ledger;
    const origEnd = ledger.endRun.bind(ledger);
    (ledger as unknown as { endRun: (id: string) => void }).endRun = (id: string) => {
      if (id === state.runId) endCalls += 1;
      origEnd(id);
    };
    await runSoakWorker({
      state,
      result_path: join(tmpDir, "result.json"),
    });
    assert.equal(endCalls, 1);
    assert.equal(state.ledger.snapshot().active_soak_runs, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("L06-C42-C42-RUN04: explicit second endRun after terminal result still fails closed", () => {
  const state = createWorkerState({
    profile: "CI_SMOKE",
    injection: parseInjection("NONE"),
    repoRoot: REPO_ROOT,
  });
  acquireRun(state);
  assert.equal(isRunHeldByLedger(state, state.runId), true);
  releaseRun(state);
  assert.equal(isRunHeldByLedger(state, state.runId), false);
  // The second release MUST throw — DOUBLE_RELEASE_IS_A_BUG.
  assert.throws(() => releaseRun(state), /unknown runId/);
});

test("L06-C42-C42-RUN05: runSoakWorker called directly does not double-release", async () => {
  const tmpDir = `/tmp/factory-lh06-c42-run05-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: parseInjection("NONE"),
      repoRoot: REPO_ROOT,
    });
    let endCalls = 0;
    const ledger = state.ledger;
    const origEnd = ledger.endRun.bind(ledger);
    (ledger as unknown as { endRun: (id: string) => void }).endRun = (id: string) => {
      if (id === state.runId) endCalls += 1;
      origEnd(id);
    };
    await runSoakWorker({
      state,
      result_path: join(tmpDir, "result.json"),
      max_epochs: 1,
    });
    assert.equal(endCalls, 1, `expected 1 endRun, got ${endCalls}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("L06-C42-C42-RUN06: explicit second ledger.endRun(runId) still fails closed as unknown runId", () => {
  const state = createWorkerState({
    profile: "CI_SMOKE",
    injection: parseInjection("NONE"),
    repoRoot: REPO_ROOT,
  });
  acquireRun(state);
  releaseRun(state);
  // The underlying ledger MUST refuse a second release —
  // this is what QUALIFICATION01 observed.
  assert.throws(
    () => state.ledger.endRun(state.runId),
    /unknown runId/,
  );
});

test("L06-C42-C42-RUN07: isRunHeldByLedger reports membership correctly", () => {
  const state = createWorkerState({
    profile: "CI_SMOKE",
    injection: parseInjection("NONE"),
    repoRoot: REPO_ROOT,
  });
  assert.equal(isRunHeldByLedger(state, state.runId), false);
  acquireRun(state);
  assert.equal(isRunHeldByLedger(state, state.runId), true);
  releaseRun(state);
  assert.equal(isRunHeldByLedger(state, state.runId), false);
});

test("L06-C42-C42-RUN08: DOUBLE_END_RUN_AFTER_TERMINAL_RESULT is IMPOSSIBLE", async () => {
  const tmpDir = `/tmp/factory-lh06-c42-run08-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: parseInjection("NONE"),
      repoRoot: REPO_ROOT,
    });
    await runSoakWorker({
      state,
      result_path: join(tmpDir, "result.json"),
      max_epochs: 1,
    });
    assert.equal(isRunHeldByLedger(state, state.runId), false);
    assert.throws(() => state.ledger.endRun(state.runId));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});