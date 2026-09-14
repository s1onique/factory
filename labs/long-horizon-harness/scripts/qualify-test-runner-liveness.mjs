// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX01)
//
// External qualifier for the canonical-main test
// runner liveness.
//
// Why this lives OUTSIDE the canonical test corpus:
//
//   The earlier LIV04 oracle lived inside
//   `test/_liveness_oracle.test.ts` and SPAWNED
//   `scripts/run-tests.mjs` as a subprocess. Because
//   the runner discovers `test/**/*.test.ts`
//   recursively, the LIV oracle file was ALSO part
//   of what the spawned runner tried to execute —
//   producing recursive self-invocation and a false
//   "11/11 PASS in 2.6s" claim that could not
//   coexist with the observed ~80 second canonical
//   runtime.
//
//   This script runs the canonical `npm test`
//   EXACTLY ONCE, externally, with a bounded
//   wall-clock deadline. The runner does not
//   recursively invoke itself.
//
//   The LIV oracle file (`test/_liveness_oracle.test.ts`)
//   is EXCLUDED from canonical discovery by
//   `scripts/run-tests.mjs` so even if this script
//   were invoked twice it would not re-enter itself.
//
// Usage:
//
//   node scripts/qualify-test-runner-liveness.mjs
//
//   Default deadline: 600 seconds (10 minutes),
//   well above the observed ~80 second canonical
//   post-fix runtime.
//
// Output (MICROFIX01 P1-6):
//
//   The qualifier emits THREE independent key=value
//   lines on stdout so that liveness and test
//   disposition cannot be conflated:
//
//     RUNNER_LIVENESS=PASS|FAIL
//       PASS — the runner exited naturally within
//              the deadline (wall-clock bounded).
//       FAIL — the runner hit the deadline
//              (was hanging), or could not be
//              spawned.
//
//     RUNNER_TEST_DISPOSITION=PASS|FAIL|UNKNOWN
//       PASS — the runner exited with code 0
//              (every canonical test FILE passed).
//       FAIL — the runner exited with non-zero
//              (one or more test FILEs failed).
//              This is EXPECTED on a strict sandbox
//              that fails EPERM-based writer tests;
//              it does NOT mean liveness regressed.
//       UNKNOWN — the runner could not be started
//                 (spawn error) so its test
//                 disposition could not be
//                 observed.
//
//     RUNNER_LIVENESS_QUALIFIER_DISPOSITION=OK|HUNG|SPAWN_ERROR
//       Diagnostic alias of the liveness decision,
//       retained for backward compatibility with
//       earlier consumers (was previously the only
//       field emitted).
//
//   The qualifier's own process exit code is:
//
//       0   liveness PASS (regardless of test
//           disposition — see above)
//       1   liveness FAIL (hung past deadline)
//       2   liveness FAIL (spawn error)
//
//   This means the qualifier exit code is purely a
//   liveness verdict. Test correctness must be
//   reported via `RUNNER_TEST_DISPOSITION` and
//   acted on by separate tooling.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const DEADLINE_MS = Number(process.env.LIVENESS_DEADLINE_MS ?? 600_000);
const TMPDIR = process.env.TMPDIR ?? "/tmp";
const TRACE = process.env.LIVENESS_QUALIFIER_TRACE === "1";

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX01)
//
// We invoke `npm test` exactly as a human would, with
// the documented TMPDIR override and the runner's
// diagnostic trace flag enabled so we can observe the
// runner's start/finish trace events without parsing
// its TTY-aware stdout (the runner writes its
// `test_runner_start` / `test_runner_finish` JSON lines
// to stderr).
const child = spawn(
  "npm",
  ["test"],
  {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      TMPDIR,
      FACTORY_TEST_RUNNER_TRACE: "1",
    },
  },
);

let stderrBuf = "";
child.stderr?.on("data", (d) => { stderrBuf += d.toString(); });

const start = Date.now();
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
    resolve({ kind: "deadline" });
  }, DEADLINE_MS);
  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    resolve({ kind: "exit", code, signal });
  });
  child.on("error", (err) => {
    clearTimeout(timer);
    resolve({ kind: "error", err: err.message });
  });
});
const elapsed_ms = Date.now() - start;

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX01)
//
// Classify liveness and test disposition INDEPENDENTLY
// (MICROFIX01 P1-6).
//
//   liveness (does the runner exit naturally at all):
//     exit_kind === "exit" AND a code was observed
//       → PASS
//     else
//       → FAIL
//
//   test_disposition (did the tests pass):
//     liveness FAIL → UNKNOWN
//     liveness PASS AND exit code === 0
//       → PASS
//     liveness PASS AND exit code !== 0
//       → FAIL
const liveness = result.kind === "exit" && result.code !== null
  ? "PASS"
  : "FAIL";
const testDisposition = liveness === "FAIL"
  ? "UNKNOWN"
  : (result.code === 0 ? "PASS" : "FAIL");
const livenessQualifierDisposition = liveness === "PASS"
  ? "EXITED_NATURALLY"
  : (result.kind === "deadline" ? "HUNG_PAST_DEADLINE" : "SPAWN_ERROR");

const observed = {
  kind: "liveness_qualifier_result",
  deadline_ms: DEADLINE_MS,
  tmpdir: TMPDIR,
  elapsed_ms,
  runner_exit_code: result.kind === "exit" ? result.code : null,
  runner_signal: result.kind === "exit" ? result.signal : null,
  liveness,
  test_disposition: testDisposition,
  liveness_qualifier_disposition: livenessQualifierDisposition,
  trace: {
    has_start: /"kind":"test_runner_start"/.test(stderrBuf),
    has_finish: /"kind":"test_runner_finish"/.test(stderrBuf),
    stderr_tail: stderrBuf.slice(-500),
  },
};

if (TRACE) {
  process.stdout.write(JSON.stringify(observed) + "\n");
}

// Emit the three independent key=value lines.
// Order matters for tooling that greps stdout:
// emit LIVENESS first, then TEST_DISPOSITION, then
// the legacy liveness qualifier disposition.
console.log("RUNNER_LIVENESS=" + liveness);
console.log("RUNNER_TEST_DISPOSITION=" + testDisposition);
console.log("RUNNER_LIVENESS_QUALIFIER_DISPOSITION=" + livenessQualifierDisposition);

if (liveness === "FAIL") {
  process.stderr.write(
    `[liveness-qualifier] FAIL elapsed=${elapsed_ms}ms ` +
      `runner_exit_code=${observed.runner_exit_code} kind=${result.kind}\n`,
  );
  process.stderr.write(
    `[liveness-qualifier] ${JSON.stringify(observed)}\n`,
  );
  process.exit(result.kind === "deadline" ? 1 : 2);
}
process.stderr.write(
  `[liveness-qualifier] OK elapsed=${elapsed_ms}ms ` +
    `runner_exit_code=${observed.runner_exit_code} ` +
    `test_disposition=${testDisposition}\n`,
);
process.exit(0);