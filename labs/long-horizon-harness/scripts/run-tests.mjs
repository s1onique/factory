// Run all .test.ts files under test/. Uses Node's fs.readdirSync
// recursively so we don't depend on shell globstar.
//
// CORRECTION08: invoke node directly with --import tsx,
// not the tsx CLI binary. The tsx CLI tries to spin up a
// fork-mode IPC server (named pipe on macOS) which some
// restricted sandboxes cannot bind. Using --import tsx
// in-process avoids that IPC layer entirely.
//
// CORRECTION11: enforce the FOUNDATION01 frozen inherited
// file-size waiver mechanically via SHA-256. The waived file
// MUST NOT change unless the waiver is explicitly revised.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// CORRECTION11 §4: mechanical anchor for the FOUNDATION01
// frozen inherited file-size waiver. If the hash drifts,
// the run fails discipline BEFORE any test runs.
const WAIVED_FILE = "src/evidence/jsonl-ledger.ts";
const WAIVED_SHA256 =
  "6d58a4c95ebc7a029d643980b2190db234f9556437f0667caf01acb311b31cf4";
const waivedPath = path.join(root, WAIVED_FILE);
const actual = createHash("sha256")
  .update(readFileSync(waivedPath))
  .digest("hex");
if (actual !== WAIVED_SHA256) {
  process.stderr.write(
    `[discipline] ${WAIVED_FILE} sha256 drifted.\n` +
    `  expected: ${WAIVED_SHA256}\n` +
    `  actual:   ${actual}\n` +
    `  The FOUNDATION01 frozen inherited file-size waiver is ` +
    `violated. Re-anchor the waiver in docs/SOURCE_SIZE_DISCIPLINE.md ` +
    `with the new SHA-256 and the reviewed commit.\n`,
  );
  process.exit(1);
}

const testDir = path.join(root, "test");

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && e.name.endsWith(".test.ts")) files.push(full);
  }
}
walk(testDir);
files.sort();

// Use --import tsx so .ts files load in-process; we DO NOT
// use --test-force-exit. A test runner that refuses to exit
// is itself evidence; we keep that signal.
const args = [
  "--import", "tsx",
  "--test",
  "--test-reporter=spec",
  ...files,
];
const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
