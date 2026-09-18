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
  CANONICAL_BASELINE_FILES,
} from "../../fault-lab/deterministic/baseline.js";
import {
  classify,
  cleanupWorkspace,
  defaultRepoRoot,
  prepareWorkspace,
} from "../../fault-lab/deterministic/runner.js";
import { verifyLiveQualificationEvidence } from "../../src/adapter-common/evidence-verifier.js";
import { findFault } from "../../fault-lab/deterministic/fault-catalog.js";

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
  assert.equal(v.observedAuthority, "byte_hash");
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
  assert.equal(v.observedAuthority, "path");
});

test("LH-04 fault catalog is closed-world: 17 experiments with all expected authorities", () => {
  const ids = ["F01","F02","F03","F04","F05","F06","F07","F08","F09","F10","F11","F12","F13","F14","F15","F16","F17"];
  for (const id of ids) {
    const exp = findFault(id);
    assert.ok(exp !== undefined, `catalog must contain ${id}`);
    assert.equal(exp.id, id);
  }
});
