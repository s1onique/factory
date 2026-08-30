// Run all .test.ts files under test/. Uses Node's fs.readdirSync
// recursively so we don't depend on shell globstar.
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

const tsx = path.join(root, "node_modules", ".bin", "tsx");
const args = [
  "--test",
  "--test-force-exit",
  "--test-reporter=spec",
  ...files,
];
const child = spawn(tsx, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
