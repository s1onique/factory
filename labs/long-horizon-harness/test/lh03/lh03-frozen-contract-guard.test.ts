/**
 * LH-03 §21 — Frozen-contract guard tests.
 *
 * These tests verify that the Phase E run/ directory and
 * the LH-02 metrics/ directory are unchanged from the
 * accepted immutable bases. They are the in-process
 * companion of `scripts/verify_lh03_frozen.sh`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { execSync } from "node:child_process";

const PHASE_E_FROZEN_HEAD = "61b0979ebba52e391e1408561fb2c20a79d28af7";
const LH_02_FROZEN_HEAD = "715e6390d78228f089270259e1bd1307140adb75";

function diffNonEmpty(commit: string, paths: string[]): string {
  // The expected outcome is an EMPTY diff. We capture
  // stderr too so missing base commits fail loudly.
  const argPaths = paths
    .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
    .join(" ");
  const cmd = `git diff --exit-code ${commit} -- ${argPaths}`;
  try {
    const out = execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    // If --exit-code is 0, the diff is empty. Return the
    // stdout (which should also be empty) for diagnostics.
    return out;
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const stdout = e.stdout ? e.stdout.toString("utf8") : "";
    const stderr = e.stderr ? e.stderr.toString("utf8") : "";
    return stdout + stderr;
  }
}

test("LH03-FROZEN-PHASE-E: Phase E run contract is unchanged from 61b0979", () => {
  const out = diffNonEmpty(PHASE_E_FROZEN_HEAD, [
    "labs/long-horizon-harness/src/run",
    "labs/long-horizon-harness/test/run",
  ]);
  assert.equal(out, "", `Phase E frozen diff is non-empty:\n${out}`);
});

test("LH03-FROZEN-LH02: LH-02 metrics contract is unchanged from 715e639", () => {
  const out = diffNonEmpty(LH_02_FROZEN_HEAD, [
    "labs/long-horizon-harness/src/metrics",
    "labs/long-horizon-harness/test/metrics",
  ]);
  assert.equal(out, "", `LH-02 frozen diff is non-empty:\n${out}`);
});
