// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX03)
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
// Output (MICROFIX03 P1-3):
//
//   The qualifier emits FIVE independent key=value
//   lines on stdout. `RUNNER_LIVENESS_QUALIFIER_DISPOSITION`
//   is RETAINED for backward compatibility with
//   earlier consumers but is now derived from
//   `RUNNER_BOUNDARY` and `QUALIFIER_CLEANUP_OUTCOME`.
//
//     RUNNER_LIVENESS=PASS|FAIL
//       PASS — the runner exited naturally within
//              the deadline (wall-clock bounded).
//       FAIL — the runner hit the deadline
//              (was hanging), or could not be
//              spawned, or its cleanup was
//              refused by the kernel.
//
//     RUNNER_BOUNDARY=CLEAN_EXIT|DEADLINE|SPAWN_ERROR|SIGNAL_ERROR
//       WHY the runner's liveness verdict was
//       assigned, BEFORE any cleanup attempt:
//         CLEAN_EXIT   — runner exited under its
//                        own power within the
//                        deadline (liveness PASS
//                        unless cleanup refused).
//         DEADLINE     — wall-clock deadline fired
//                        first. ALWAYS liveness
//                        FAIL. Cleanup outcome
//                        is reported separately
//                        via QUALIFIER_CLEANUP_OUTCOME.
//         SPAWN_ERROR  — Node could not even
//                        start the runner child
//                        (e.g. ENOENT for npm).
//                        ALWAYS liveness FAIL.
//                        Cleanup is NOT_ATTEMPTED.
//         SIGNAL_ERROR — Node emitted the
//                        ChildProcess `'error'`
//                        event AFTER the runner
//                        had already started
//                        (the previous
//                        implementation conflated
//                        this with spawn-error).
//                        ALWAYS liveness FAIL.
//
//     RUNNER_TEST_DISPOSITION=PASS|FAIL|UNKNOWN
//       PASS — the runner exited with code 0
//              (every canonical test FILE passed).
//       FAIL — the runner exited with non-zero.
//              This is EXPECTED on a strict
//              sandbox that fails EPERM-based
//              writer tests; it does NOT mean
//              liveness regressed.
//       UNKNOWN — the runner could not be started
//                 (spawn error) so its test
//                 disposition could not be
//                 observed.
//
//     QUALIFIER_CLEANUP_OUTCOME=SENT|PERMISSION_DENIED|FAILED|NOT_ATTEMPTED
//       How the qualifier attempted to clean up
//       the runner child AFTER the verdict was
//       settled. SENT means the signal was
//       delivered. PERMISSION_DENIED means the
//       kernel refused (EPERM). FAILED means kill
//       returned false or threw an unexpected
//       error. NOT_ATTEMPTED means no cleanup was
//       attempted (e.g. SPAWN_ERROR — no child
//       existed to clean up).
//
//     DESCENDANT_CLEANUP_PROVEN=true|false
//       Whether the qualifier actually proved
//       that the runner's descendants (Node
//       workers, per-file processes spawned by
//       the test runner) were also cleaned up.
//       On a host where the kernel refuses
//       signals, this MUST be `false`. A `true`
//       value requires positive residue proof.
//
//     RUNNER_LIVENESS_QUALIFIER_DISPOSITION=OK|HUNG|SPAWN_ERROR
//       Diagnostic alias of the liveness decision,
//       retained for backward compatibility.
//       Derived as:
//         OK            — RUNNER_LIVENESS === PASS
//         HUNG          — RUNNER_BOUNDARY === DEADLINE
//         SPAWN_ERROR   — RUNNER_BOUNDARY in
//                          {SPAWN_ERROR, SIGNAL_ERROR}
//
//   The qualifier's own process exit code is:
//
//       0   liveness PASS (regardless of test
//           disposition — see above)
//       1   liveness FAIL (DEADLINE / CLEAN_EXIT
//                         with refused cleanup /
//                         SIGNAL_ERROR)
//       2   liveness FAIL (SPAWN_ERROR)
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

// --------------------------------------------------------------------
// MICROFIX03 P1-3 — DEADLINE/KILL RACE FIX.
//
// The previous implementation had a race: when the
// deadline fired it called `child.kill('SIGKILL')`,
// which could itself synchronously fail (e.g. EPERM
// on a sandboxed host) and emit the ChildProcess
// `'error'` event. The `'error'` handler would then
// resolve with `{kind:'error'}`, OVERWRITING the
// `{kind:'deadline'}` settlement and reporting
// `SPAWN_ERROR` for a child that had actually been
// running fine until the deadline fired.
//
// Fix:
//   (1) The deadline is settled FIRST, via a single-
//       settlement guard.
//   (2) The kill attempt happens AFTER settlement
//       and its outcome is recorded separately as
//       QUALIFIER_CLEANUP_OUTCOME.
//   (3) `'error'` after settlement is IGNORED (not
//       a re-settlement); `'error'` BEFORE the
//       runner has even emitted `test_runner_start`
//       is reported as `SPAWN_ERROR`; `'error'`
//       AFTER `test_runner_start` is reported as
//       `SIGNAL_ERROR`.
// --------------------------------------------------------------------
let settled = false;
/** @type {"DEADLINE"|"CLEAN_EXIT"|"SPAWN_ERROR"|"SIGNAL_ERROR"|null} */
let boundary = null;
/** @type {"SENT"|"PERMISSION_DENIED"|"FAILED"|"NOT_ATTEMPTED"} */
let cleanupOutcome = "NOT_ATTEMPTED";
let descendantCleanupProven = false;
/** @type {number|null} */
let runnerExitCode = null;
/** @type {NodeJS.Signals|null} */
let runnerSignal = null;

const settleOnce = (kind) => {
  if (settled) return;
  settled = true;
  boundary = kind;
};

const settledPromise = new Promise((resolve) => {
  const onSettled = () => resolve();
  const timer = setTimeout(() => {
    settleOnce("DEADLINE");
    let killResult;
    try { killResult = child.kill("SIGKILL"); } catch { killResult = false; }
    if (killResult === false) {
      cleanupOutcome = "FAILED";
    } else {
      cleanupOutcome = "SENT";
      descendantCleanupProven = false;
    }
    clearTimeout(timer);
    onSettled();
  }, DEADLINE_MS);

  child.on("exit", (code, signal) => {
    runnerExitCode = code;
    runnerSignal = signal;
    if (settled) return; // boundary remains DEADLINE
    settleOnce("CLEAN_EXIT");
    cleanupOutcome = "NOT_ATTEMPTED";
    clearTimeout(timer);
    onSettled();
  });

  child.on("error", () => {
    if (settled) {
      if (cleanupOutcome === "SENT") {
        cleanupOutcome = "PERMISSION_DENIED";
        descendantCleanupProven = false;
      }
      return;
    }
    const hasStart = /"kind":"test_runner_start"/.test(stderrBuf);
    settleOnce(hasStart ? "SIGNAL_ERROR" : "SPAWN_ERROR");
    cleanupOutcome = hasStart ? "FAILED" : "NOT_ATTEMPTED";
    clearTimeout(timer);
    onSettled();
  });
});

await settledPromise;
const elapsed_ms = Date.now() - start;

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX03)
//
// Classify liveness and test disposition INDEPENDENTLY.
//
//   liveness (does the runner exit naturally at all):
//     CLEAN_EXIT AND exit code was observed (not null)
//       → PASS
//     all other boundaries (DEADLINE / SPAWN_ERROR /
//     SIGNAL_ERROR)
//       → FAIL
//
//   test_disposition (did the tests pass):
//     liveness FAIL → UNKNOWN
//     liveness PASS AND exit code === 0
//       → PASS
//     liveness PASS AND exit code !== 0
//       → FAIL
const liveness = (boundary === "CLEAN_EXIT" && runnerExitCode !== null)
  ? "PASS"
  : "FAIL";

const testDisposition = liveness === "FAIL"
  ? "UNKNOWN"
  : (runnerExitCode === 0 ? "PASS" : "FAIL");

const livenessQualifierDisposition = liveness === "PASS"
  ? "OK"
  : (boundary === "DEADLINE" ? "HUNG" : "SPAWN_ERROR");

const observed = {
  kind: "liveness_qualifier_result",
  deadline_ms: DEADLINE_MS,
  tmpdir: TMPDIR,
  elapsed_ms,
  runner_exit_code: runnerExitCode,
  runner_signal: runnerSignal,
  boundary,
  cleanup_outcome: cleanupOutcome,
  descendant_cleanup_proven: descendantCleanupProven,
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

// Emit the independent key=value lines.
// Order matters for tooling that greps stdout:
// emit LIVENESS first, then BOUNDARY + CLEANUP, then
// TEST_DISPOSITION, then DESCENDANT_CLEANUP_PROVEN,
// then the legacy alias.
console.log("RUNNER_LIVENESS=" + liveness);
console.log("RUNNER_BOUNDARY=" + boundary);
console.log("QUALIFIER_CLEANUP_OUTCOME=" + cleanupOutcome);
console.log("RUNNER_TEST_DISPOSITION=" + testDisposition);
console.log("DESCENDANT_CLEANUP_PROVEN=" + (descendantCleanupProven ? "true" : "false"));
console.log("RUNNER_LIVENESS_QUALIFIER_DISPOSITION=" + livenessQualifierDisposition);

if (liveness === "FAIL") {
  process.stderr.write(
    `[liveness-qualifier] FAIL elapsed=${elapsed_ms}ms ` +
      `boundary=${boundary} cleanup=${cleanupOutcome} ` +
      `runner_exit_code=${runnerExitCode}\n`,
  );
  process.stderr.write(
    `[liveness-qualifier] ${JSON.stringify(observed)}\n`,
  );
  process.exit(boundary === "SPAWN_ERROR" ? 2 : 1);
}
process.stderr.write(
  `[liveness-qualifier] OK elapsed=${elapsed_ms}ms ` +
    `runner_exit_code=${runnerExitCode} ` +
    `test_disposition=${testDisposition} ` +
    `cleanup=${cleanupOutcome}\n`,
);
process.exit(0);
