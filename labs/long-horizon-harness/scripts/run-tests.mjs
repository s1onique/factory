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
//
// FACTORY_TEST_RUNNER_TRACE=1 enables bounded runner
// observability. Default behavior is unchanged when unset.
// The runner invokes a SINGLE global `node --test` against
// all discovered files; per-file completion is NOT visible
// from the parent via stdio:inherit. We therefore emit
// truthful batch/process-level observations only — never
// claim stronger semantics than observed.
//
// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01) `--test-timeout=60000` is a per-test bound,
// NOT a per-file bound. It bounds how long an individual
// test inside a FILE may run before being declared a
// failure; it does NOT bound how long a FILE may stay
// alive past all its tests (which is what the residue
// hang is). The real fix is at the ownership site of each
// test FILE that owns long-lived children: that FILE's
// `after()` hook MUST call `detachResidualHandles()` to
// detach any Socket/Pipe handles from the event loop.
// This runner does NOT add `--test-timeout` because doing
// so would not change the per-file hang behaviour — the
// timeout only fires between tests, not during the
// residual stream cleanup. We leave `--test-timeout` at
// Node 26's default (`0` = no per-test timeout) so each
// test FILE's own domain contract remains the authority.
// The runner's bounded runtime is enforced by the
// caller (e.g. `timeout --signal=KILL 600 npm test`).
const TRACE = process.env.FACTORY_TEST_RUNNER_TRACE === "1";

function trace(record) {
  if (!TRACE) return;
  try {
    process.stderr.write(JSON.stringify(record) + "\n");
  } catch {
    // never let tracing crash the runner
  }
}

const runStart = Date.now();
trace({
  kind: "test_runner_start",
  pid: process.pid,
  file_count: files.length,
});

const args = [
  "--import", "tsx",
  "--test",
  "--test-reporter=spec",
  ...files,
];
trace({
  kind: "test_batch_start",
  id: "all-tests",
  files: files.length,
});

const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code) => {
  trace({
    kind: "test_batch_finish",
    id: "all-tests",
    rc: code ?? 1,
    elapsed_ms: Date.now() - runStart,
  });
  trace({
    kind: "test_runner_finish",
    rc: code ?? 1,
    elapsed_ms: Date.now() - runStart,
  });
  process.exit(code ?? 1);
});
