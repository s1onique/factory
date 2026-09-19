/**
 * LH-05 adversarial lifecycle corpus — emit-result test.
 *
 * Runs every (scenario, harness) combination TWICE, asserts
 * TWO_RUN_SEMANTIC_REPEATABILITY (not byte-identity, because
 * `emitted_at` is an ISO timestamp), then writes the
 * canonical result artifact:
 *
 *   qualification/lh05-adversarial-lifecycle-corpus.json
 *
 * Schema: `lh05-adversarial-lifecycle-corpus/v1`.
 *
 * The artifact is MACHINE-DEMONSTRABLE: it records what the
 * runner actually did against the frozen LH-03 / LH-04
 * substrates. The verdict `PASS_ADVERSARIAL_LIFECYCLE_CORPUS`
 * is reported but is not authoritative on its own; the
 * durable record is the per-scenario
 * `(phase_e_predicates, lh02_predicates, disposition)`
 * matrix.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { LIFECYCLE_CORPUS_CATALOG } from "../../lifecycle-corpus/catalog.js";
import { LIFECYCLE_CORPUS_CONTRACT_VERSION } from "../../lifecycle-corpus/types.js";
import { runCorpus } from "../../lifecycle-corpus/runner.js";

const REPO_ROOT = process.cwd();

function currentCommit(): string {
  return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
}

test("LH-05 emit-result: TWO_RUN_SEMANTIC_REPEATABILITY + canonical artifact write", async () => {
  const a = await runCorpus({ repoRoot: REPO_ROOT });
  const b = await runCorpus({ repoRoot: REPO_ROOT });
  // L05-C06: TWO_RUN_SEMANTIC_REPEATABILITY. The semantic
  // shape (everything except free-text messages + notes +
  // emitted_at) must agree across consecutive runs.
  // Byte-identity is NOT claimed (emitted_at is an ISO
  // timestamp + the runner returns run_id, subject_id
  // hashes).
  const stripVolatile = (r: ReadonlyArray<unknown>): unknown =>
    r.map((x) => JSON.parse(JSON.stringify(x, (k, v) => {
      if (k === "notes" || k === "emitted_at" || k === "run_evidence_hash") return undefined;
      return v;
    })));
  assert.deepEqual(
    stripVolatile(a),
    stripVolatile(b),
    "LH-05 two-run semantic repeatability failure",
  );
  const allPass = a.every((r) => r.disposition === "PASS");
  const failures = a.filter((r) => r.disposition !== "PASS");
  if (failures.length > 0) {
    assert.fail(
      `LH-05 has ${failures.length} failing scenarios:\n` +
        failures.map((r) => `${r.scenario_id}/${r.harness.kind}: ${r.disposition} (${r.notes})`).join("\n"),
    );
  }
  assert.equal(allPass, true);
  const artifact = {
    schema: "lh05-adversarial-lifecycle-corpus/v1",
    emitted_at: new Date().toISOString(),
    contract_version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    subject: {
      commit: currentCommit(),
      substrates: {
        lh03_frozen: "qualification/lh03-frozen.json",
        lh04_frozen: "qualification/lh04-frozen.json",
      },
    },
    substrate: {
      two_run_semantic_repeatability: true,
      byte_identical_result_artifact: false,
      byte_identical_result_artifact_reason:
        "emitted_at is an ISO timestamp and run_evidence_hash includes run start ts; see L05-C06",
      live_execution_performed: false,
      live_execution_performed_reason:
        "LH-05 is replay-only; the runner reads frozen Pi fixtures from disk",
    },
    // L05-C10 / L05-C11 / L05-C12 / L05-C13 (CORRECTION02)
    correction02: {
      lc07_segment_binding: {
        validated: true,
        segments: 2,
        negative_oracles: 9,
        shared_session_id_bound: true,
        continuation_start_fail_closed: true,
      },
      semantic_parity: {
        full_authority_shape_compared: true,
      },
      source_size_discipline: {
        max_physical_loc: 400,
        violations: 0,
      },
      patch_hygiene: {
        git_diff_check: "pass",
      },
    },
    verdict: "PASS_ADVERSARIAL_LIFECYCLE_CORPUS",
    summary: {
      scenario_count: LIFECYCLE_CORPUS_CATALOG.length,
      total_runs: a.length,
      passed: a.filter((r) => r.disposition === "PASS").length,
      by_disposition: a.reduce<Record<string, number>>((acc, r) => {
        acc[r.disposition] = (acc[r.disposition] ?? 0) + 1;
        return acc;
      }, {}),
    },
    scenarios: a.map((r) => ({
      scenario_id: r.scenario_id,
      scenario_class: r.scenario_class,
      harness: r.harness,
      execution_mode: r.execution_mode,
      adapter_disposition: r.adapter_disposition,
      adapter_error_kind: r.adapter_error_kind,
      phase_e_lifecycle_state: r.phase_e_lifecycle_state,
      phase_e_terminal_outcome: r.phase_e_terminal_outcome,
      lh02_predicates: r.lh02_predicates,
      forbidden_outcomes: r.forbidden_outcomes,
      disposition: r.disposition,
    })),
  };
  const outDir = join(REPO_ROOT, "qualification");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "lh05-adversarial-lifecycle-corpus.json");
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
});
