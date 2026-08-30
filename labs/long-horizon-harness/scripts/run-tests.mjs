// Run all .test.ts files under test/. Uses Node's fs.readdirSync
// recursively so we don't depend on shell globstar.
//
// CORRECTION08: invoke node directly with --import tsx,
// not the tsx CLI binary. The tsx CLI tries to spin up a
// fork-mode IPC server (named pipe on macOS) which some
// restricted sandboxes cannot bind. Using --import tsx
// in-process avoids that IPC layer entirely.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
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
