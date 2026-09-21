/**
 * LH-06 negative-evidence preservation tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C44)
 *
 * QUALIFICATION01 produced a valid negative result
 * (`FAIL_SEMANTIC_DRIFT` with `LIFECYCLE_DRIFT`), but the
 * supervisor's verifier rejected the artifact because
 * `substrate_complete === false`. The supervisor then
 * synthesized `FAIL_WORKER / verifier_rejected:
 * INCOMPLETE_SUBSTRATE`, destroying the specific
 * `LIFECYCLE_DRIFT` evidence.
 *
 * These tests pin the rule:
 *
 *   VALID_RESULT != PASS_ELIGIBLE_RESULT
 *
 * Negative verdicts (FAIL_*, INCONCLUSIVE_*,
 * QUALIFICATION_INCOMPLETE) are PRESERVED as their
 * specific worker verdict when:
 *
 *   - the binding's actual completeness matches the
 *     declared `substrate_complete` flag, AND
 *   - the verdict is NOT PASS_DETERMINISTIC_SOAK.
 *
 * Only PASS requires complete substrate; non-PASS
 * preserves negative evidence regardless.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSubstrateCompleteness } from "../../soak/verifier-helpers.js";
import { isSubstrateComplete } from "../../soak/substrate-authority.js";
import { LH06_LAB_ROOT as _LH06_LAB_ROOT } from "./_lh06-lab-root.js";
void _LH06_LAB_ROOT;

/**
 * Build a synthetic worker result record. Test-only.
 */
function makeRaw(overrides: {
  readonly verdict?: string;
  readonly failure?: unknown;
  readonly substrate_complete?: boolean;
  readonly substrate_null_fields?: readonly string[];
} = {}): unknown {
  const substrateNull = new Set(overrides.substrate_null_fields ?? []);
  const sub = {
    phase_e_head: substrateNull.has("phase_e_head") ? null : "a".repeat(40),
    lh02_head: substrateNull.has("lh02_head") ? null : "b".repeat(40),
    lh03_frozen_commit: substrateNull.has("lh03_frozen_commit") ? null : "c".repeat(40),
    lh04_frozen_commit: substrateNull.has("lh04_frozen_commit") ? null : "d".repeat(40),
    lh05_corpus_commit: substrateNull.has("lh05_corpus_commit") ? null : "e".repeat(40),
    repo_commit: substrateNull.has("repo_commit") ? null : "f".repeat(40),
  };
  const verdict = overrides.verdict ?? "FAIL_SEMANTIC_DRIFT";
  const failure =
    overrides.failure !== undefined
      ? overrides.failure
      : {
          kind: "LIFECYCLE_DRIFT",
          epoch: null,
          last_completed_case: "LC01",
          minimal_diff: { lifecycle_drift_count: 38075 },
          message: "lifecycle drift detected",
        };
  return {
    schema: "lh06.deterministic.soak.result.v1",
    contract_version: "lh06.soak.contract.v1",
    profile: "QUALIFICATION",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 0,
    environment_identity: {
      os: "darwin/arm64",
      arch: "arm64",
      node_version: "v26.0.0",
      cpu_count: 1,
      total_memory_bytes: 1,
      contract_version: "lh06.soak.contract.v1",
      profile: "QUALIFICATION",
      soak_run_id: "0000000000000001",
    },
    substrate: sub,
    epochs_completed: 0,
    cases_completed: 0,
    semantic: {
      drift_count: 0,
      fault_escape_count: 0,
      lifecycle_drift_count: 38075,
      predecessor_dependency_count: 0,
      canary_before_equals_canary_after: true,
      cases_with_multiple_semantic_results: 0,
      lifecycle_drift_by_scenario: { LC11: 38075 },
    },
    resources: {
      post_gc_heap_first_window: 1,
      post_gc_heap_last_window: 1,
      post_gc_heap_delta: 0,
      heap_slope_bytes_per_epoch: 0,
      rss_first_window: 1,
      rss_last_window: 1,
      rss_delta: 0,
      rss_slope: 0,
      resource_balance_failures: 0,
      workspace_leaks: 0,
      heap_verdict: null,
    },
    latency: {
      first_window_median_ms: 1,
      last_window_median_ms: 1,
      drift_ratio: 1,
      verdict: null,
    },
    frozen_tree: {
      before_sha256: null,
      after_sha256: null,
      changed: null,
      status: { ok: false, kind: "UNREADABLE_EVIDENCE", path: "x", detail: "y" },
    },
    repeatability: { semantic_repeatability: false },
    failure,
    verdict,
    telemetry_path: null,
    telemetry_sha256: null,
    telemetry_bytes: null,
    telemetry_line_count: null,
    supervisor_run_id: "test-run",
    substrate_complete: overrides.substrate_complete ?? false,
    publication_durability: "ATOMIC_ONLY",
  };
}

test("L06-C44-EVID01: PASS + incomplete substrate => REJECT INCOMPLETE_SUBSTRATE", () => {
  const sub = {
    phase_e_head: "a".repeat(40),
    lh02_head: "b".repeat(40),
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: null,
  };
  const sc = checkSubstrateCompleteness({
    verdict: "PASS_DETERMINISTIC_SOAK",
    substrate: sub,
    substrate_complete_flag: false,
  });
  assert.equal(sc.ok, false);
  if (!sc.ok) assert.equal(sc.reason, "INCOMPLETE_SUBSTRATE");
});

test("L06-C44-EVID02: FAIL_SEMANTIC_DRIFT + incomplete substrate + flag=false => ACCEPT", () => {
  const sub = {
    phase_e_head: "a".repeat(40),
    lh02_head: "b".repeat(40),
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: null,
  };
  const sc = checkSubstrateCompleteness({
    verdict: "FAIL_SEMANTIC_DRIFT",
    substrate: sub,
    substrate_complete_flag: false,
  });
  assert.equal(sc.ok, true);
});

test("L06-C44-EVID03: FAIL_RESOURCE_STABILITY + incomplete substrate => ACCEPT", () => {
  const sub = {
    phase_e_head: "a".repeat(40),
    lh02_head: null,
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: "f".repeat(40),
  };
  const sc = checkSubstrateCompleteness({
    verdict: "FAIL_RESOURCE_STABILITY",
    substrate: sub,
    substrate_complete_flag: false,
  });
  assert.equal(sc.ok, true);
});

test("L06-C44-EVID04: QUALIFICATION_INCOMPLETE + incomplete substrate => ACCEPT", () => {
  const sub = {
    phase_e_head: "a".repeat(40),
    lh02_head: null,
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: "f".repeat(40),
  };
  const sc = checkSubstrateCompleteness({
    verdict: "QUALIFICATION_INCOMPLETE",
    substrate: sub,
    substrate_complete_flag: false,
  });
  assert.equal(sc.ok, true);
});

test("L06-C44-EVID05: incomplete substrate + flag=true => REJECT INCONSISTENT_SUBSTRATE_FLAG", () => {
  const sub = {
    phase_e_head: "a".repeat(40),
    lh02_head: null,
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: "f".repeat(40),
  };
  const sc = checkSubstrateCompleteness({
    verdict: "FAIL_SEMANTIC_DRIFT",
    substrate: sub,
    substrate_complete_flag: true,
  });
  assert.equal(sc.ok, false);
  if (!sc.ok) assert.equal(sc.reason, "INCONSISTENT_SUBSTRATE_FLAG");
});

test("L06-C44-EVID06: complete substrate + flag=false => REJECT INCONSISTENT_SUBSTRATE_FLAG", () => {
  const sub = {
    phase_e_head: "a".repeat(40),
    lh02_head: "b".repeat(40),
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: "f".repeat(40),
  };
  const sc = checkSubstrateCompleteness({
    verdict: "FAIL_SEMANTIC_DRIFT",
    substrate: sub,
    substrate_complete_flag: false,
  });
  assert.equal(sc.ok, false);
  if (!sc.ok) assert.equal(sc.reason, "INCONSISTENT_SUBSTRATE_FLAG");
});

test("L06-C44: isSubstrateComplete reflects the actual binding geometry", () => {
  const complete = {
    phase_e_head: "a".repeat(40),
    lh02_head: "b".repeat(40),
    lh03_frozen_commit: "c".repeat(40),
    lh04_frozen_commit: "d".repeat(40),
    lh05_corpus_commit: "e".repeat(40),
    repo_commit: "f".repeat(40),
  };
  assert.equal(isSubstrateComplete(complete), true);
  const incomplete = { ...complete, phase_e_head: null };
  assert.equal(isSubstrateComplete(incomplete), false);
});

test("L06-C44: helper preserves negative evidence on a synthetic raw record", () => {
  const raw = makeRaw({
    verdict: "FAIL_SEMANTIC_DRIFT",
    substrate_complete: false,
    substrate_null_fields: ["repo_commit"],
  });
  const r = raw as Record<string, unknown>;
  const sc = checkSubstrateCompleteness({
    verdict: r["verdict"] as never,
    substrate: r["substrate"] as never,
    substrate_complete_flag: r["substrate_complete"] as boolean,
  });
  assert.equal(sc.ok, true);
});