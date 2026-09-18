/**
 * LH-04 baseline acceptance test (ACT §3, §12).
 *
 * The unmutated baseline MUST pass the closed-world
 * verifier. If the baseline fails, the entire fault
 * matrix is unqualified; the runner's per-experiment
 * `BASELINE_REGRESSION` disposition protects against
 * silent regressions, but this test pins the canonical
 * baseline to its full disposition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  buildCanonicalBaseline,
  canonicalBaselineIdentityHash,
  canonicalBaselineIdentityShape,
  CANONICAL_BASELINE_FILES,
  loadFrozenCanonicalCapabilities,
} from "../../fault-lab/deterministic/baseline.js";
import {
  classify,
  cleanupWorkspace,
  defaultRepoRoot,
  prepareWorkspace,
} from "../../fault-lab/deterministic/runner.js";
import { verifyLiveQualificationEvidence } from "../../src/adapter-common/evidence-verifier.js";
import { FAULT_CATALOG, findFault } from "../../fault-lab/deterministic/fault-catalog.js";
import * as catalogModule from "../../fault-lab/deterministic/fault-catalog.js";
import * as typesModule from "../../fault-lab/deterministic/types.js";

const REPO_ROOT = defaultRepoRoot();

test("LH-04 baseline: every CANONICAL_BASELINE_FILES exists in repoRoot", () => {
  for (const rel of CANONICAL_BASELINE_FILES) {
    const abs = resolve(REPO_ROOT, rel);
    assert.equal(existsSync(abs), true, `${rel} must exist in repoRoot`);
  }
});

test("LH-04 baseline: canonical baseline passes verifier end-to-end", () => {
  const ws = prepareWorkspace({ repoRoot: REPO_ROOT, label: "baseline" });
  try {
    const caps = buildCanonicalBaseline({ workspaceRoot: ws });
    const result = verifyLiveQualificationEvidence(caps, ws);
    if (result.ok !== true) {
      console.log(
        "LH-04 baseline errors:",
        result.errors
          .slice(0, 5)
          .map((e) => `${e.kind}: ${e.message}`)
          .join("\n"),
      );
    }
    assert.equal(result.ok, true, "canonical baseline must pass verifier");
  } finally {
    cleanupWorkspace(ws);
  }
});

test("LH-04 baseline: classify() returns PASS for matching authority+kind", () => {
  const v = classify({
    verifierOk: false,
    verifierErrors: [
      {
        kind: "EVIDENCE_HASH_MISMATCH",
        key: "JSONL",
        message: "drift",
      },
    ],
    expectedAuthority: "byte_hash",
    expectedErrorKind: "EVIDENCE_HASH_MISMATCH",
  });
  assert.equal(v.disposition, "PASS");
  assert.equal(v.observedErrorKind, "EVIDENCE_HASH_MISMATCH");
  assert.equal(v.classifiedAuthority, "byte_hash");
});

test("LH-04 baseline: classify() returns ESCAPED when verifier passes", () => {
  const v = classify({
    verifierOk: true,
    verifierErrors: [],
    expectedAuthority: "byte_hash",
    expectedErrorKind: "EVIDENCE_HASH_MISMATCH",
  });
  assert.equal(v.disposition, "ESCAPED");
});

test("LH-04 baseline: classify() returns WRONG_AUTHORITY when kind differs", () => {
  const v = classify({
    verifierOk: false,
    verifierErrors: [
      {
        kind: "EVIDENCE_PATH_ESCAPE",
        key: "JSONL",
        message: "escape",
      },
    ],
    expectedAuthority: "byte_hash",
    expectedErrorKind: "EVIDENCE_HASH_MISMATCH",
  });
  assert.equal(v.disposition, "WRONG_AUTHORITY");
  assert.equal(v.classifiedAuthority, "path");
});

test("LH-04 fault catalog is closed-world: 17 experiments with all expected authorities", () => {
  const ids = ["F01","F02","F03","F04","F05","F06","F07","F08","F09","F10","F11","F12","F13","F14","F15","F16","F17"];
  for (const id of ids) {
    const exp = findFault(id);
    assert.ok(exp !== undefined, `catalog must contain ${id}`);
    assert.equal(exp.id, id);
    // L04-C02: every catalog entry must carry a mutation_taxonomy.
    assert.ok(
      typeof exp.mutation_taxonomy === "string" &&
        ["SINGLE_DIMENSION","GUARD_REACHABILITY_CONSTRUCTION","COMPOUND_FORGERY","COMPOUND_AXIS_SPLICE"].includes(
          exp.mutation_taxonomy,
        ),
      `${id} must carry a valid mutation_taxonomy (got ${exp.mutation_taxonomy})`,
    );
  }
  assert.equal(FAULT_CATALOG.length, 17);
});

test("L04-C02: catalog is the single fault-contract authority (no separate table)", () => {
  assert.equal(
    "FAULT_AUTHORITY_KIND" in catalogModule,
    false,
    "FAULT_AUTHORITY_KIND must be derived from FAULT_CATALOG, not exported separately",
  );
  assert.equal(
    "FAULT_AUTHORITY_KIND" in typesModule,
    false,
    "FAULT_AUTHORITY_KIND must be derived from FAULT_CATALOG, not exported from types",
  );
});

test("L04-C02: every catalog entry's (authority, kind) tuple is a known combination", () => {
  const valid: ReadonlyArray<{ authority: string; kind: string }> = [
    { authority: "byte_hash", kind: "EVIDENCE_HASH_MISMATCH" },
    { authority: "invocation_byte_hash", kind: "EVIDENCE_HASH_MISMATCH" },
    { authority: "execution_relationship", kind: "EVIDENCE_EXECUTION_MISMATCH" },
    { authority: "execution_id_relationship", kind: "EVIDENCE_EXECUTION_MISMATCH" },
    { authority: "manifest_capability_binding", kind: "EVIDENCE_EXECUTION_MISMATCH" },
    { authority: "manifest_origin_discriminator", kind: "EVIDENCE_EXECUTION_MISMATCH" },
    { authority: "path", kind: "EVIDENCE_PATH_ESCAPE" },
    { authority: "oracle_semantic", kind: "EVIDENCE_OBSERVATION_MISMATCH" },
    { authority: "invocation_derivation", kind: "EVIDENCE_PARSE_FAILED" },
  ];
  for (const exp of FAULT_CATALOG) {
    const ok = valid.some(
      (v) =>
        v.authority === exp.expected_authority &&
        v.kind === exp.expected_error_kind,
    );
    assert.ok(
      ok,
      `${exp.id}: (authority=${exp.expected_authority}, kind=${exp.expected_error_kind}) is not a known (authority,kind) tuple`,
    );
  }
});

test("L04-C05: reconstructed baseline equals frozen canonical capability document", () => {
  const ws = prepareWorkspace({ repoRoot: REPO_ROOT, label: "baseline-identity" });
  try {
    const reconstructed = buildCanonicalBaseline({ workspaceRoot: ws });
    const frozen = loadFrozenCanonicalCapabilities({ repoRoot: REPO_ROOT });
    // Diagnostic: print the diff so failures are debuggable.
    const aDoc = JSON.stringify(canonicalBaselineIdentityShape(reconstructed), null, 2);
    const bDoc = JSON.stringify(canonicalBaselineIdentityShape(frozen), null, 2);
    if (aDoc !== bDoc) {
      console.log("L04-C05 baseline-identity DIFF:");
      console.log("RECONSTRUCTED:\n" + aDoc);
      console.log("FROZEN:\n" + bDoc);
    }
    const a = canonicalBaselineIdentityHash(reconstructed);
    const b = canonicalBaselineIdentityHash(frozen);
    assert.equal(
      a,
      b,
      "reconstructed baseline must equal frozen canonical capability document on the fields the lab does not rewrite",
    );
  } finally {
    cleanupWorkspace(ws);
  }
});
