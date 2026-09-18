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
  classifyAuthority,
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

test("L04-C05: LH04_BASELINE_AUTHORITY_SUBSTRATE_MATCHES_LH03_FREEZE", () => {
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

/**
 * L04-C07 — classification provenance truth table.
 *
 * For every error kind the frozen LH-03 verifier can
 * emit, the classifier MUST honestly report whether it
 * used message text to reach its authority label. The
 * rule is:
 *
 *   if the classification depends on the message text
 *     in any way (positive match OR negative-match
 *     fallback), method = "message_prefix_inference".
 *
 *   if the kind alone uniquely identifies the
 *     authority, method = "structured_error_kind".
 *
 * This test mutates the message text in two ways for
 * every multi-branch kind and asserts that the
 * `method` field correctly reports message dependence
 * for every branch — including the default/fallback
 * branch, which is also message-dependent.
 */
test("L04-C07: classification provenance truth table (every message-dependent branch labelled message_prefix_inference)", () => {
  const messageDependentKinds: ReadonlyArray<{
    kind: "EVIDENCE_HASH_MISMATCH" | "EVIDENCE_PARSE_FAILED" | "EVIDENCE_EXECUTION_MISMATCH";
    sampleMessages: readonly string[];
    positiveAuthority: string;
    defaultAuthority: string;
  }> = [
    {
      kind: "EVIDENCE_HASH_MISMATCH",
      sampleMessages: [
        "Invocation artifact sha256 mismatch",
        "Observation manifest sha256 mismatch",
      ],
      positiveAuthority: "invocation_byte_hash",
      defaultAuthority: "byte_hash",
    },
    {
      kind: "EVIDENCE_PARSE_FAILED",
      sampleMessages: [
        "Invocation parse error: missing field",
        "Observation manifest parse error",
      ],
      positiveAuthority: "invocation_derivation",
      defaultAuthority: "oracle_semantic",
    },
    {
      kind: "EVIDENCE_EXECUTION_MISMATCH",
      sampleMessages: [
        "manifest declares capability X but axis Y is bound",
        "capture_origin mismatch between manifest and axis",
        "execution_id mismatch between probe and manifest",
        "axis probe binding disagrees with manifest.execution_id",
      ],
      positiveAuthority: "manifest_capability_binding",
      defaultAuthority: "execution_id_relationship",
    },
  ];
  for (const { kind, sampleMessages, positiveAuthority, defaultAuthority } of messageDependentKinds) {
    for (const msg of sampleMessages) {
      const got = classifyAuthority({ kind, key: "JSONL", message: msg });
      assert.equal(
        got.method,
        "message_prefix_inference",
        `${kind} with message=${JSON.stringify(msg)} must report message_prefix_inference (got ${got.method})`,
      );
    }
    const positive = classifyAuthority({
      kind,
      key: "JSONL",
      message: sampleMessages[0]!,
    });
    assert.equal(
      positive.authority,
      positiveAuthority,
      `${kind} positive message must classify to ${positiveAuthority} (got ${positive.authority})`,
    );
    const def = classifyAuthority({
      kind,
      key: "JSONL",
      message: sampleMessages[sampleMessages.length - 1]!,
    });
    assert.equal(
      def.authority,
      defaultAuthority,
      `${kind} default-fallback message must classify to ${defaultAuthority} (got ${def.authority})`,
    );
  }
  const structuredOnlyKinds: ReadonlyArray<{
    kind: "EVIDENCE_PATH_ESCAPE" | "EVIDENCE_ARTIFACT_MISSING" | "EVIDENCE_OBSERVATION_MISMATCH" | "EVIDENCE_ORACLE_FAILED";
    expectedAuthority: "path" | "oracle_semantic";
  }> = [
    { kind: "EVIDENCE_PATH_ESCAPE", expectedAuthority: "path" },
    { kind: "EVIDENCE_ARTIFACT_MISSING", expectedAuthority: "path" },
    { kind: "EVIDENCE_OBSERVATION_MISMATCH", expectedAuthority: "oracle_semantic" },
    { kind: "EVIDENCE_ORACLE_FAILED", expectedAuthority: "oracle_semantic" },
  ];
  for (const { kind, expectedAuthority } of structuredOnlyKinds) {
    for (const msg of ["", "arbitrary message text that includes Invocation", "x", "x x x"]) {
      const got = classifyAuthority({ kind, key: "JSONL", message: msg });
      assert.equal(
        got.method,
        "structured_error_kind",
        `${kind} with message=${JSON.stringify(msg)} must report structured_error_kind (got ${got.method})`,
      );
      assert.equal(
        got.authority,
        expectedAuthority,
        `${kind} must classify to ${expectedAuthority} regardless of message (got ${got.authority})`,
      );
    }
  }
});

/**
 * L04-C07 (mechanical) — the actual fault matrix counts.
 *
 * Runs every catalog fault and computes the
 * `classification_method_summary` from the matrix
 * in memory. Pins the histogram to the count the
 * provenance truth table proves correct, without
 * hand-counting any constant.
 */
test("L04-C07: per-fault classification_method is mechanically consistent with observed_error_kind", async () => {
  const { runFaultMatrix } = await import("../../fault-lab/deterministic/runner.js");
  const results = await runFaultMatrix({
    repoRoot: REPO_ROOT,
    experiments: FAULT_CATALOG,
  });
  // Expected rule: a fault's classification method is
  // `message_prefix_inference` iff its observed_error_kind
  // is one of the message-dependent kinds (HASH_MISMATCH,
  // PARSE_FAILED, EXECUTION_MISMATCH).
  const messageDependentKinds = new Set([
    "EVIDENCE_HASH_MISMATCH",
    "EVIDENCE_PARSE_FAILED",
    "EVIDENCE_EXECUTION_MISMATCH",
  ]);
  let structural = 0;
  let inferred = 0;
  for (const r of results) {
    const expectInferred =
      typeof r.observed_error_kind === "string" &&
      messageDependentKinds.has(r.observed_error_kind);
    if (expectInferred) {
      assert.equal(
        r.classified_authority_method,
        "message_prefix_inference",
        `${r.id} (kind=${r.observed_error_kind}) must be classified via message_prefix_inference`,
      );
      inferred++;
    } else {
      assert.equal(
        r.classified_authority_method,
        "structured_error_kind",
        `${r.id} (kind=${r.observed_error_kind}) must be classified via structured_error_kind`,
      );
      structural++;
    }
  }
  // Both buckets must be non-empty for the F01..F17 corpus
  // — guards against the matrix regressing to all-structured
  // (which would silently misrepresent provenance).
  assert.ok(
    structural > 0,
    `expected at least one structured_error_kind classification; got ${structural}`,
  );
  assert.ok(
    inferred > 0,
    `expected at least one message_prefix_inference classification; got ${inferred}`,
  );
});
