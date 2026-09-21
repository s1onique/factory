/**
 * LH-06 substrate authority tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C43)
 *
 * QUALIFICATION01 produced `phase_e_head = null` and
 * `lh02_head = null` because the previous binding code
 * tried to derive these identities from the capability-
 * matrix artifact — a record that source does NOT carry
 * Phase E or LH-02 freezes. That is a source-authority
 * error.
 *
 * These tests pin the contract:
 *
 *   - Each frozen identity MUST come from the record
 *     that owns its freeze.
 *   - The capability-matrix artifact MUST NOT be
 *     consulted for Phase E or LH-02.
 *   - Missing authority records / fields / malformed
 *     SHAs surface as typed failures.
 *   - `repo_commit` MUST match `git rev-parse HEAD`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSoakSubstrateBinding,
  authorityTableForTests,
  isSubstrateComplete,
} from "../../soak/substrate-authority.js";
import { LH06_LAB_ROOT, LH06_REPO_ROOT } from "./_lh06-lab-root.js";

test("L06-C43-SUB01: all six substrate identities resolve from the authority records", () => {
  const r = resolveSoakSubstrateBinding({ repoRoot: LH06_LAB_ROOT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.notEqual(r.binding.phase_e_head, null);
  assert.notEqual(r.binding.lh02_head, null);
  assert.notEqual(r.binding.lh03_frozen_commit, null);
  assert.notEqual(r.binding.lh04_frozen_commit, null);
  assert.notEqual(r.binding.lh05_corpus_commit, null);
  assert.notEqual(r.binding.repo_commit, null);
});

test("L06-C43-SUB02: phase_e_head resolves from the Phase-E authority record", () => {
  const r = resolveSoakSubstrateBinding({ repoRoot: LH06_LAB_ROOT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const prov = r.provenance.find((p) => p.field === "phase_e_head");
  assert.ok(prov !== undefined);
  assert.equal(prov?.source_path, "qualification/phase-e-frozen.json");
  assert.equal(prov?.source_field, "subject.commit");
  assert.match(prov?.resolved_commit ?? "", /^[0-9a-f]{40}$/);
});

test("L06-C43-SUB03: lh02_head resolves from the LH-02 authority record", () => {
  const r = resolveSoakSubstrateBinding({ repoRoot: LH06_LAB_ROOT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const prov = r.provenance.find((p) => p.field === "lh02_head");
  assert.ok(prov !== undefined);
  assert.equal(prov?.source_path, "qualification/lh02-frozen.json");
  assert.equal(prov?.source_field, "subject.commit");
  assert.match(prov?.resolved_commit ?? "", /^[0-9a-f]{40}$/);
});

test("L06-C43-SUB04: no Phase-E/LH-02 lookup uses capability-matrix fields", () => {
  const table = authorityTableForTests();
  for (const prov of Object.values(table)) {
    assert.notEqual(
      prov.source_path,
      "qualification/capability-matrix.json",
      `phase_e_head or lh02_head MUST NOT be sourced from capability-matrix (got ${prov.source_path})`,
    );
  }
});

test("L06-C43-SUB05: missing authority field -> typed failure", () => {
  // Synthesize a minimal repoRoot that lacks the phase-e
  // authority record.
  const fakeRoot = `/tmp/factory-lh06-fake-${Date.now()}`;
  // no files written; absence is the trigger.
  const r = resolveSoakSubstrateBinding({ repoRoot: fakeRoot });
  assert.equal(r.ok, false);
  if (r.ok) return;
  // The resolver visits fields in declaration order. The
  // first field is phase_e_head, so the first failure
  // surfaces there.
  assert.equal(r.field, "phase_e_head");
  assert.equal(r.kind, "AUTHORITY_RECORD_MISSING");
});

test("L06-C43-SUB06: malformed SHA -> typed failure", () => {
  // Override the repo_commit to a malformed value.
  const r = resolveSoakSubstrateBinding({
    repoRoot: LH06_LAB_ROOT,
    repoCommitOverride: "not-a-sha",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.field, "repo_commit");
  assert.equal(r.kind, "INVALID_COMMIT_ID");
});

test("L06-C43-SUB07: repo_commit == git rev-parse HEAD", async () => {
  const { execFileSync } = await import("node:child_process");
  const stdout = execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: LH06_REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const expected = stdout.trim();
  const r = resolveSoakSubstrateBinding({ repoRoot: LH06_LAB_ROOT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.binding.repo_commit, expected);
});

test("L06-C43-SUB08: resolved binding isSubstrateComplete(binding) == true", () => {
  const r = resolveSoakSubstrateBinding({ repoRoot: LH06_LAB_ROOT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(isSubstrateComplete(r.binding), true);
});

test("L06-C43-SUB09: provenance is visible for every identity", () => {
  const r = resolveSoakSubstrateBinding({ repoRoot: LH06_LAB_ROOT });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const fields = new Set(r.provenance.map((p) => p.field));
  for (const f of [
    "phase_e_head",
    "lh02_head",
    "lh03_frozen_commit",
    "lh04_frozen_commit",
    "lh05_corpus_commit",
    "repo_commit",
  ]) {
    assert.ok(fields.has(f as never), `provenance missing for ${f}`);
  }
});