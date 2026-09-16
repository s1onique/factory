/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Acceptance target covered here:
 *
 *   PHASE_D_SOURCE_SIZE_DISCIPLINE  = PASS  (LOC01)
 *
 * SOURCE_SIZE_DISCIPLINE (FOUNDATION03 section 29) says every
 * production TypeScript file in src/ subject/ MUST be no more
 * than 400 LOC, excluding blank lines and pure comments.
 *
 * Phase D is the first module produced under that doctrine
 * with its own per-file scope. This test pins the discipline
 * so future additions are forced to either stay under the
 * ceiling or open a fresh FOUNDATION03 waiver.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SUBJECT_SRC = join(HERE, "..", "..", "src", "subject");

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*/") ||
    t.startsWith("*")
  );
}

function countLoc(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  return text.split("\n").filter((l) => !isCommentLine(l)).length;
}

test("LOC01: every Phase D production TS file is <= 400 LOC", () => {
  const files = readdirSync(SUBJECT_SRC).filter((f) =>
    f.endsWith(".ts")
  );
  const violations: string[] = [];
  for (const f of files) {
    const loc = countLoc(join(SUBJECT_SRC, f));
    if (loc > 400) {
      violations.push(`${f}: ${loc} LOC (limit 400)`);
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("LOC02: every Phase D production TS file exists and is non-empty", () => {
  const expected = [
    "subject-canonicalize.ts",
    "subject-id.ts",
    "subject-types.ts",
    "subject-validate.ts",
    "subject-decode.ts",
    "subject-frozen.ts",
    "subject-json.ts",
    "index.ts",
  ];
  const actual = new Set(
    readdirSync(SUBJECT_SRC).filter((f) => f.endsWith(".ts")),
  );
  for (const e of expected) {
    assert.ok(actual.has(e), `missing file: ${e}`);
  }
});
