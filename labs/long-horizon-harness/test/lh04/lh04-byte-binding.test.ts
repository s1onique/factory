/**
 * LH-04 byte-binding fault matrix (ACT §4 F01, F02, F12-F16, F17).
 *
 * Each experiment mutates exactly one byte-level
 * authority dimension and asserts the verifier rejects
 * the mutation at the matching authority / error kind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultRepoRoot,
  runFaultExperiment,
} from "../../fault-lab/deterministic/runner.js";
import {
  findFault,
  FAULT_CATALOG,
} from "../../fault-lab/deterministic/fault-catalog.js";
import type { FaultExperimentResult } from "../../fault-lab/deterministic/types.js";

const REPO_ROOT = defaultRepoRoot();

async function expectPass(id: string): Promise<FaultExperimentResult> {
  const exp = findFault(id);
  assert.ok(exp !== undefined, `fault ${id} must exist in catalog`);
  const result = await runFaultExperiment({
    repoRoot: REPO_ROOT,
    experiment: exp,
  });
  assert.equal(
    result.baseline_passed,
    true,
    `baseline must pass for ${id}; notes=${result.notes}`,
  );
  assert.equal(
    result.disposition,
    "PASS",
    `${id} must pass; got ${result.disposition}; first=${result.observed_first_rejection_message}`,
  );
  assert.equal(result.observed_error_kind, exp.expected_error_kind);
  assert.equal(result.observed_authority, exp.expected_authority);
  return result;
}

test("F01: observation byte drift -> EVIDENCE_HASH_MISMATCH (byte_hash)", async () => {
  await expectPass("F01");
});

test("F02: invocation byte drift -> EVIDENCE_HASH_MISMATCH (invocation_byte_hash)", async () => {
  await expectPass("F02");
});

test("F12: stdout byte drift -> EVIDENCE_HASH_MISMATCH (byte_hash)", async () => {
  await expectPass("F12");
});

test("F13: stderr byte drift -> EVIDENCE_HASH_MISMATCH (byte_hash)", async () => {
  await expectPass("F13");
});

test("F14: process-result byte drift -> EVIDENCE_HASH_MISMATCH (byte_hash)", async () => {
  await expectPass("F14");
});

test("F15: native artifact byte drift -> EVIDENCE_HASH_MISMATCH (byte_hash)", async () => {
  await expectPass("F15");
});

test("F16: manifest byte drift -> EVIDENCE_HASH_MISMATCH (byte_hash)", async () => {
  await expectPass("F16");
});

test("F17: oracle-level semantic failure with valid hashes -> EVIDENCE_OBSERVATION_MISMATCH (oracle_semantic)", async () => {
  // F17 uses the postBuild hook: the catalog's
  // canonical baseline (with valid SHAs) is built
  // and verified first; then postBuild rewrites
  // the recorded `observed` to a sentinel that
  // disagrees with what the oracle recomputes
  // from the JSONL session envelope. The recorded
  // SHAs and paths remain canonical.
  await expectPass("F17");
});

test("LH-04 catalog summary: every fault has expected_authority + expected_error_kind", () => {
  for (const f of FAULT_CATALOG) {
    assert.ok(f.expected_authority.length > 0);
    assert.ok(f.expected_error_kind.length > 0);
    assert.ok(f.mutated_dimension.length > 0);
    assert.ok(f.preserved_dimensions.length > 0);
    assert.equal(typeof f.mutate, "function");
  }
});
