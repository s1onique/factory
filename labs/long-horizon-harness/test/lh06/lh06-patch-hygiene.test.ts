/**
 * LH-06 patch hygiene test.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Verifies that the soak module's source files:
 *   - terminate with LF
 *   - contain no whitespace errors per `git diff --check`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const LH06_ROOT = join(REPO_ROOT, "soak");

test("HYGIENE06 every LH-06 file terminates with LF", () => {
  const out = execSync(`find "${LH06_ROOT}" -type f -name '*.ts'`, {
    encoding: "utf8",
  }).trim().split("\n");
  for (const f of out) {
    const content = readFileSync(f);
    if (content.length === 0) continue;
    const lastByte = content[content.length - 1];
    assert.equal(
      lastByte,
      0x0a,
      `${f.replace(REPO_ROOT + "/", "")} must terminate with LF`,
    );
  }
});

test("HYGIENE07 git diff --check finds no whitespace errors in soak/", () => {
  const r = spawnSync("git", ["diff", "--check", "HEAD", "--", "soak/"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.log(r.stdout);
    console.log(r.stderr);
  }
  assert.equal(r.status, 0);
});
