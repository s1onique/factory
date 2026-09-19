/**
 * LH-05 source-size + patch-hygiene test (L05-C13).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * HYGIENE01 — every LH-05 production source file <= 400 LOC
 * HYGIENE02 — expected.ts is a small re-export shim
 * HYGIENE03 — expected/ subdirectory carries the split helpers
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const LH05_ROOT = join(REPO_ROOT, "lifecycle-corpus");
const CEILING = 400;

function collectProductionFiles(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      out.push(...collectProductionFiles(full));
    } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

test("HYGIENE01 every LH-05 production source file <= 400 LOC", () => {
  const files = collectProductionFiles(LH05_ROOT);
  const violations: Array<{ file: string; loc: number }> = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    const loc = lines.length;
    if (loc > CEILING) {
      violations.push({ file: f.replace(REPO_ROOT + "/", ""), loc });
    }
  }
  assert.deepEqual(
    violations,
    [],
    `LH-05 source-size discipline violations:\n${violations.map((v) => `  ${v.file}: ${v.loc} LOC`).join("\n")}`,
  );
});

test("HYGIENE02 lifecycle-corpus expected.ts is now a re-export shim <= 400 LOC", () => {
  const path = join(LH05_ROOT, "expected.ts");
  const loc = readFileSync(path, "utf8").split(/\r?\n/).length;
  assert.ok(loc <= CEILING, `expected.ts = ${loc} LOC > ${CEILING}`);
});

test("HYGIENE03 expected.ts physical LOC strictly below the previous 445-LOC violation", () => {
  const path = join(LH05_ROOT, "expected.ts");
  const loc = readFileSync(path, "utf8").split(/\r?\n/).length;
  // The pre-CORRECTION02 violation was 445 LOC. After the
  // split into expected/ subdirectory, the shim must be
  // strictly smaller.
  assert.ok(loc < 200, `expected.ts = ${loc} LOC; expected < 200 (shim only)`);
});

test("HYGIENE04 lifecycle-corpus expected/ subdirectory exists with split files", () => {
  const expectedDir = join(LH05_ROOT, "expected");
  const stat = statSync(expectedDir);
  assert.ok(stat.isDirectory(), "expected/ must be a directory");
  const required = ["adapter.ts", "phase-e.ts", "lh02.ts", "forbidden.ts", "comparison.ts", "handoff.ts", "index.ts"];
  for (const f of required) {
    const filePath = join(expectedDir, f);
    const exists = (() => {
      try { return statSync(filePath).isFile(); } catch { return false; }
    })();
    assert.ok(exists, `${f} must exist under expected/`);
  }
});
