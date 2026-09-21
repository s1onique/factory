/**
 * LH-06 result schema tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *
 *   - schema = lh06.deterministic.soak.result.v1
 *   - contract_version = lh06.soak.contract.v1
 *   - environment identity captures OS / Node version
 *   - failure record carries typed kind
 *   - writeResult writes a valid JSON file
 *   - verdictForFailure maps each kind to a verdict
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import {
  LH06_RESULT_SCHEMA,
  LH06_SOAK_CONTRACT_VERSION,
} from "../../soak/types.js";
import {
  writeResult,
  verdictForFailure,
  type LH06FailureRecord,
  type LH06Result,
} from "../../soak/result.js";

test("LH-06 result: schema is the canonical string", () => {
  assert.equal(LH06_RESULT_SCHEMA, "lh06.deterministic.soak.result.v1");
});

test("LH-06 result: contract version is the canonical string", () => {
  assert.equal(LH06_SOAK_CONTRACT_VERSION, "lh06.soak.contract.v1");
});

const SAMPLE_RESULT: LH06Result = {
  schema: LH06_RESULT_SCHEMA,
  contract_version: LH06_SOAK_CONTRACT_VERSION,
  profile: "CI_SMOKE",
  started_at: "2026-01-01T00:00:00Z",
  finished_at: "2026-01-01T00:01:00Z",
  duration_ms: 60_000,
  environment_identity: {
    os: "linux/x64",
    arch: "x64",
    node_version: "v20.0.0",
    cpu_count: 1,
    total_memory_bytes: 0,
    contract_version: LH06_SOAK_CONTRACT_VERSION,
    profile: "CI_SMOKE",
    soak_run_id: "abc",
  },
  substrate: {
    phase_e_head: null,
    lh02_head: null,
    lh03_frozen_commit: "deadbeef",
    lh04_frozen_commit: "deadbeef",
    lh05_corpus_commit: "deadbeef",
    repo_commit: null,
  },
  epochs_completed: 10,
  cases_completed: 320,
  semantic: {
    drift_count: 0,
    fault_escape_count: 0,
    lifecycle_drift_count: 0,
    predecessor_dependency_count: 0,
    canary_before_equals_canary_after: true,
    cases_with_multiple_semantic_results: 0,
    lifecycle_drift_by_scenario: {},
  },
  resources: {
    post_gc_heap_first_window: 50 * 1024 * 1024,
    post_gc_heap_last_window: 51 * 1024 * 1024,
    post_gc_heap_delta: 1 * 1024 * 1024,
    heap_slope_bytes_per_epoch: 0,
    rss_first_window: 100 * 1024 * 1024,
    rss_last_window: 105 * 1024 * 1024,
    rss_delta: 5 * 1024 * 1024,
    rss_slope: 0,
    resource_balance_failures: 0,
    workspace_leaks: 0,
    heap_verdict: null,
  },
  latency: {
    first_window_median_ms: 100,
    last_window_median_ms: 110,
    drift_ratio: 1.1,
    verdict: null,
  },
  frozen_tree: {
    before_sha256: "abc",
    after_sha256: "abc",
    changed: false,
    status: { ok: true, kind: "VALID" },
  },
  repeatability: { semantic_repeatability: true },
  failure: null,
  verdict: "PASS_DETERMINISTIC_SOAK",
  telemetry_path: null,
  telemetry_sha256: null,
  telemetry_bytes: null,
  telemetry_line_count: null,
  supervisor_run_id: null,
  substrate_complete: true,
  publication_durability: null,
};

test("LH-06 result: writeResult writes JSON + returns sha256", () => {
  const path = `/tmp/factory-lh06-test/result-${Date.now()}.json`;
  const r = writeResult({ path, result: SAMPLE_RESULT });
  assert.equal(existsSync(path), true);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(parsed.schema, LH06_RESULT_SCHEMA);
  assert.equal(parsed.verdict, "PASS_DETERMINISTIC_SOAK");
  assert.equal(r.sha256.length, 64);
  rmSync(`/tmp/factory-lh06-test`, { recursive: true, force: true });
});

test("LH-06 result: verdictForFailure maps every failure kind", () => {
  const kinds: LH06FailureRecord["kind"][] = [
    "SEMANTIC_DRIFT",
    "RESOURCE_LEAK",
    "MEMORY_GROWTH",
    "LATENCY_DRIFT",
    "WORKSPACE_LEAK",
    "FROZEN_MUTATION",
    "WORKER_CRASH",
    "WORKER_HANG",
    "BASELINE_REGRESSION",
    "FAULT_ESCAPE",
    "LIFECYCLE_DRIFT",
    "INVALID_TELEMETRY",
    "INCONCLUSIVE_ENVIRONMENT",
  ];
  for (const k of kinds) {
    const v = verdictForFailure(k);
    assert.equal(typeof v, "string");
    assert.notEqual(v, "");
  }
});

test("LH-06 result: INCONCLUSIVE_ENVIRONMENT maps to INCONCLUSIVE_ENVIRONMENT verdict", () => {
  assert.equal(
    verdictForFailure("INCONCLUSIVE_ENVIRONMENT"),
    "INCONCLUSIVE_ENVIRONMENT",
  );
});
