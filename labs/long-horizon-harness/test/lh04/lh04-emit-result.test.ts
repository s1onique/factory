/**
 * LH-04 deterministic-fault-lab result artifact emitter.
 *
 * Runs every catalog experiment twice, asserts
 * TWO_RUN_SEMANTIC_REPEATABILITY (L04-C06), then writes
 * `qualification/lh04-deterministic-faults.json` with
 * the canonical results.
 *
 * This artifact is machine-demonstrable (not
 * self-authoritative): it records what the frozen LH-03
 * verifier actually did in response to each controlled
 * fault. The verdict (`PASS_DETERMINISTIC_FAULT_LAB`)
 * is reported but is not authoritative on its own —
 * the durable record is the per-fault
 * `classified_authority` + `classified_authority_method`
 * + `observed_error_kind` matrix.
 *
 * Note: `classified_authority` is the lab's
 * classification of the verifier's first rejection,
 * not a structured verifier field. The
 * `classified_authority_method` records whether the
 * classification came from the structured
 * `errorKind` alone, from `errorKind` plus axis
 * context, or from message-prefix inference. Reviewers
 * can audit the inference model by reading
 * `runner.classifyAuthority`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRepoRoot, runFaultMatrix, semanticResultShape } from "../../fault-lab/deterministic/runner.js";
import { FAULT_CATALOG } from "../../fault-lab/deterministic/fault-catalog.js";

const REPO_ROOT = defaultRepoRoot();

test("LH-04 result artifact emitter: write deterministic-faults.json", async () => {
  const a = await runFaultMatrix({
    repoRoot: REPO_ROOT,
    experiments: FAULT_CATALOG,
  });
  const b = await runFaultMatrix({
    repoRoot: REPO_ROOT,
    experiments: FAULT_CATALOG,
  });
  // L04-C06: TWO_RUN_SEMANTIC_REPEATABILITY. The
  // semantic shape (everything except free-text
  // messages + notes) must agree across consecutive
  // runs. Byte-identity is NOT claimed because the
  // emitted artifact embeds `emitted_at` ISO timestamps.
  for (let i = 0; i < a.length; i++) {
    const sa = semanticResultShape(a[i]!);
    const sb = semanticResultShape(b[i]!);
    assert.deepEqual(sa, sb, `LH-04 two-run semantic repeatability failure at ${a[i]!.id}`);
  }
  let allPass = true;
  const failures: string[] = [];
  for (const r of a) {
    if (r.disposition !== "PASS") {
      allPass = false;
      failures.push(
        `${r.id}: disposition=${r.disposition} expected_authority=${r.expected_authority} expected_kind=${r.expected_error_kind} got_authority=${r.classified_authority} got_kind=${r.observed_error_kind} msg=${r.observed_first_rejection_message}`,
      );
    }
  }
  assert.equal(
    allPass,
    true,
    `LH-04 has ${failures.length} failing faults:\n${failures.join("\n")}`,
  );
  const artifact = {
    schema: "lh04-deterministic-faults/v1",
    emitted_at: new Date().toISOString(),
    subject: {
      commit: "7be31164b939f327c557847eb9a8b0c4ffd16b87",
      predecessor: "qualification/lh03-frozen.json",
      frozen_verifier_path: "src/adapter-common/evidence-verifier.ts",
    },
    substrate: {
      baseline_passes_verifier: true,
      workspace_isolation: "fresh-tmpdir-per-experiment",
      two_run_semantic_repeatability: true,
      byte_identical_result_artifact: false,
      byte_identical_result_artifact_reason:
        "emitted_at is an ISO timestamp; see L04-C06",
    },
    verdict: "PASS_DETERMINISTIC_FAULT_LAB",
    summary: {
      total_experiments: a.length,
      passed: a.filter((r) => r.disposition === "PASS").length,
      baseline_regressions: a.filter((r) => r.disposition === "BASELINE_REGRESSION").length,
      escaped: a.filter((r) => r.disposition === "ESCAPED").length,
      wrong_authority: a.filter((r) => r.disposition === "WRONG_AUTHORITY").length,
    },
    classification_method_summary: {
      structured_error_kind: a.filter(
        (r) => r.classified_authority_method === "structured_error_kind",
      ).length,
      structured_error_kind_plus_axis_context: a.filter(
        (r) =>
          r.classified_authority_method ===
          "structured_error_kind_plus_axis_context",
      ).length,
      message_prefix_inference: a.filter(
        (r) => r.classified_authority_method === "message_prefix_inference",
      ).length,
    },
    fault_matrix: a.map((r) => ({
      id: r.id,
      description: r.description,
      mutated_dimension: r.mutated_dimension,
      mutation_taxonomy: r.mutation_taxonomy,
      preserved_dimensions: r.preserved_dimensions,
      expected_authority: r.expected_authority,
      expected_error_kind: r.expected_error_kind,
      classified_authority: r.classified_authority,
      classified_authority_method: r.classified_authority_method,
      observed_error_kind: r.observed_error_kind,
      disposition: r.disposition,
      baseline_passed: r.baseline_passed,
    })),
  };
  const outDir = join(REPO_ROOT, "qualification");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "lh04-deterministic-faults.json");
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
});