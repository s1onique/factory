#!/usr/bin/env node
/**
 * qualify-phase-a.mjs — external-subject-binding runner.
 *
 * Doctrine (external-subject-binding law + post-gate-purity law):
 *   A qualification oracle may observe the current SHA,
 *   but it may not MANUFACTURE the expected SHA from the
 *   same observation. The operator must pin the expected
 *   SHA out-of-band (env var). The runner also re-asserts
 *   SHA + worktree-clean + freeze-guard AFTER the gates
 *   finish — qualification is not complete until the
 *   subject is re-proven.
 *
 * Usage:
 *   FACTORY_QUALIFICATION_SUBJECT_COMMIT=<40-hex-sha> \
 *     node scripts/qualify-phase-a.mjs
 *
 * Failure modes (printed, non-zero exit):
 *   - missing env (FACTORY_QUALIFICATION_SUBJECT_COMMIT)
 *   - HEAD != expected (mismatch; possible manufactured SHA)
 *   - worktree dirty (any tracked or untracked file under .)
 *   - B0 freeze guard violated (src/ledger-writer/ changed since B0)
 *   - any matrix disposition != OK
 *   - post-gate: HEAD != expected, worktree dirty, or
 *     freeze-guard violated after the gates finish
 *
 *   Note: this script DOES run `git rev-parse HEAD` and
 *   `git status --porcelain` to OBSERVE; it does NOT use
 *   either observation to construct the expected value.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const EXPECTED = process.env.FACTORY_QUALIFICATION_SUBJECT_COMMIT ?? "";
const B0_FREEZE_COMMIT = "1048c5c680597d1911e5559ee416425d61842b78";

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function tryReadJsonlSha256(rel) {
  // Hash a JSONL evidence file deterministically. Used
  // for evidence-lifetime pinning where it matters.
  try {
    const p = path.join(root, rel);
    return createHash("sha256").update(readFileSync(p)).digest("hex");
  } catch {
    return "<unreadable>";
  }
}

if (EXPECTED === "") {
  console.error("FACTORY_QUALIFICATION_SUBJECT_COMMIT is required");
  process.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(EXPECTED)) {
  console.error(
    "FACTORY_QUALIFICATION_SUBJECT_COMMIT must be a 40-char lowercase hex",
  );
  process.exit(2);
}

const HEAD_BEFORE = sh("git", ["rev-parse", "HEAD"]);
if (HEAD_BEFORE !== EXPECTED) {
  console.error(
    "EXPECTED_SHA_MISMATCH: expected=" + EXPECTED + " observed=" + HEAD_BEFORE,
  );
  process.exit(2);
}
const STATUS_BEFORE = sh("git", ["status", "--porcelain"]);
if (STATUS_BEFORE !== "") {
  console.error("WORKTREE_DIRTY_PRE_GATE: " + STATUS_BEFORE);
  process.exit(2);
}
const FREEZE_BEFORE = sh("git", ["diff", "--exit-code",
  B0_FREEZE_COMMIT + "..HEAD", "--", "src/ledger-writer/"]);
if (FREEZE_BEFORE !== "") {
  console.error("B0_FREEZE_GUARD_VIOLATED_PRE_GATE");
  process.exit(2);
}

console.log("PHASE_A_QUALIFICATION_EXPECTED_COMMIT=" + EXPECTED);
console.log("PHASE_A_QUALIFICATION_OBSERVED_COMMIT_PRE=" + HEAD_BEFORE);
console.log("PHASE_A_QUALIFICATION_SUBJECT_BINDING=external");

// Now run the two strict matrices. We invoke npm run
// with the env var set so the inner scripts see the
// same EXPECTED; we do NOT let nested npm scripts
// overwrite it (npm run sets process.env from the
// caller's process.env; child processes inherit).
const cmd = "npm";
const args = ["run", "qualify:phase-a"];
const env = { ...process.env, FACTORY_QUALIFICATION_SUBJECT_COMMIT: EXPECTED };
let rc;
try {
  execFileSync(cmd, args, { stdio: "inherit", env, cwd: root });
  rc = 0;
} catch (e) {
  rc = (e.status !== null && e.status !== undefined) ? e.status : 1;
}

const HEAD_AFTER = sh("git", ["rev-parse", "HEAD"]);
const STATUS_AFTER = sh("git", ["status", "--porcelain"]);
let FREEZE_AFTER = "";
try {
  sh("git", ["diff", "--exit-code",
    B0_FREEZE_COMMIT + "..HEAD", "--", "src/ledger-writer/"]);
} catch (e) {
  FREEZE_AFTER = String(e.message ?? e);
}

console.log("PHASE_A_FINAL_HEAD=" + HEAD_AFTER);
console.log("PHASE_A_FINAL_WORKTREE_CLEAN=" + (STATUS_AFTER === "" ? "yes" : "no"));
console.log("PHASE_A_B0_FREEZE_GUARD=" + (FREEZE_AFTER === "" ? "clean" : "violated"));

if (HEAD_AFTER !== EXPECTED) {
  console.error(
    "POST_GATE_HEAD_MISMATCH: expected=" + EXPECTED + " observed=" + HEAD_AFTER,
  );
  process.exit(3);
}
if (STATUS_AFTER !== "") {
  console.error("POST_GATE_WORKTREE_DIRTY: " + STATUS_AFTER);
  process.exit(3);
}
if (FREEZE_AFTER !== "") {
  console.error("POST_GATE_B0_FREEZE_VIOLATED: " + FREEZE_AFTER);
  process.exit(3);
}

if (rc !== 0) {
  console.error("PHASE_A_MATRIX_FAIL: rc=" + rc);
  process.exit(rc);
}
console.log("PHASE_A_DISPOSITION=OK");
process.exit(0);
