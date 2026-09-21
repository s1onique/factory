/**
 * LH-06 source-size + patch-hygiene test.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * HYGIENE01 — every LH-06 production source file <= 400 LOC
 * HYGIENE02 — the contract module is small and authoritative
 * HYGIENE03 — types/contract/result modules are stable
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const LH06_ROOT = join(REPO_ROOT, "soak");
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

test("HYGIENE01 every LH-06 production source file <= 400 LOC", () => {
  const files = collectProductionFiles(LH06_ROOT);
  const violations: Array<{ file: string; loc: number }> = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    const loc = lines.length;
    if (loc > CEILING) {
      violations.push({
        file: f.replace(REPO_ROOT + "/", ""),
        loc,
      });
    }
  }
  assert.deepEqual(
    violations,
    [],
    `LH-06 source-size discipline violations:\n${violations.map((v) => `  ${v.file}: ${v.loc} LOC`).join("\n")}`,
  );
});

test("HYGIENE02 LH-06 contract module is small (<= 200 LOC)", () => {
  const path = join(LH06_ROOT, "contract.ts");
  const loc = readFileSync(path, "utf8").split(/\r?\n/).length;
  assert.ok(loc <= 200, `contract.ts = ${loc} LOC > 200`);
});

test("HYGIENE03 LH-06 types module is small (<= 150 LOC)", () => {
  const path = join(LH06_ROOT, "types.ts");
  const loc = readFileSync(path, "utf8").split(/\r?\n/).length;
  assert.ok(loc <= 150, `types.ts = ${loc} LOC > 150`);
});

test("HYGIENE04 LH-06 result module is small (<= 250 LOC)", () => {
  const path = join(LH06_ROOT, "result.ts");
  const loc = readFileSync(path, "utf8").split(/\r?\n/).length;
  assert.ok(loc <= 250, `result.ts = ${loc} LOC > 250`);
});

test("HYGIENE05 LH-06 schedule module is small (<= 200 LOC)", () => {
  const path = join(LH06_ROOT, "schedule.ts");
  const loc = readFileSync(path, "utf8").split(/\r?\n/).length;
  assert.ok(loc <= 200, `schedule.ts = ${loc} LOC > 200`);
});
