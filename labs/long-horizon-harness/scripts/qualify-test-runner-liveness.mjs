// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX09)
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
// Output (MICROFIX07 — preserved in MF08/MF09):
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
//     QUALIFIER_CLEANUP_OUTCOME=SIGNAL_ACCEPTED|SIGNAL_ACCEPTED_UNCONFIRMED|PERMISSION_DENIED|FAILED|NOT_ATTEMPTED
//       How the qualifier attempted to clean up
//       the runner child AFTER the verdict was
//       settled. The MICROFIX07 qualifier performs (preserved in MF08/MF09):
//       two-phase settlement: the runner's liveness
//       boundary is settled FIRST, and THEN the
//       cleanup outcome is observed by waiting
//       boundedly for the asynchronous `'error'`,
//       `'exit'`, or `'close'` event from the
//       ChildProcess.
//
//       SIGNAL_ACCEPTED — `child.kill('SIGKILL')`
//         returned true AND the qualifier
//         subsequently observed the child's
//         `'exit'` (or `'close'`) event within
//         the bounded cleanup-observation window.
//         Per Node docs, `kill()` returning true
//         does NOT prove termination; this value
//         requires positive observation.
//       SIGNAL_ACCEPTED_UNCONFIRMED —
//         `child.kill('SIGKILL')` returned true
//         but neither `'exit'`, `'close'`, nor
//         `'error'` fired within the bounded
//         cleanup-observation window. The
//         qualifier was UNABLE to positively
//         observe termination, so we honestly
//         report unconfirmed signal acceptance.
//       PERMISSION_DENIED — the kernel refused
//         signal delivery (`err.code === "EPERM"`).
//       FAILED — kill() returned false, or
//         threw a non-EPERM error, or async
//         `'error'` reported any other err.code.
//       NOT_ATTEMPTED — no cleanup was attempted
//         (e.g. SPAWN_ERROR — no child existed
//         to clean up; or the runner exited
//         cleanly under its own power).
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

// --------------------------------------------------------------------
// MICROFIX07 LIV16/LIV17 — EXPORTED PURE HELPER for
// adversarial behavioral testing.
//
// The deadline's kill+observe flow is encapsulated
// here as an exported pure function so LIV16 and
// LIV17 can exercise it against a fake ChildProcess
// seam (cases A–I from the reviewer's brief). The
// helper does NOT touch module-level state — every
// input is passed in. The LIVE main flow (below)
// calls this same helper with the real child after
// phase 1 settles, so LIVE behavior and TEST
// behavior are guaranteed to match.
//
// MICROFIX07 — atomic listeners-before-kill + synchronous
// settlement:
//
//   Per Node docs, `subprocess.kill()` may emit
//   `'error'` SYNCHRONOUSLY when the signal cannot
//   be delivered, and `'exit'`/`'close'` may also
//   fire during/after the kill call. To observe
//   these without racing, this helper arms the
//   `'error'`, `'exit'`, and `'close'` listeners
//   BEFORE invoking `child.kill()`.
//
//   Node's EventEmitter invokes listeners
//   SYNCHRONOUSLY (in registration order), so a
//   lifecycle event fired during `kill()` settles
//   the helper BEFORE `kill()` returns. The
//   `settled` flag below prevents double-settlement
//   even when kill both synchronously emits
//   `'error'` and throws (case I). Timers and
//   listeners are always torn down on the first
//   settle.
//
// MICROFIX09 — ORTHOGONAL EVIDENCE DIMENSIONS.
//
// Node's kill(2) contract has TWO independent
// dimensions of truth:
//
//   signal-attempt evidence   (kill() return / throw)
//   termination evidence      ('exit' / 'close')
//
// A successful kill(2) does NOT prove termination,
// and observed termination does NOT prove the
// signal was delivered (a child can exit on its
// own concurrently with — or before — kill()).
//
// The pre-MF09 helper collapsed both into one
// string `cleanupOutcome`. That category error
// forced contradictory cells (e.g. kill returned
// false + 'exit' was observed → reported as
// SIGNAL_ACCEPTED, which claims the signal
// succeeded when it did not).
//
// MF09 makes the two dimensions orthogonal:
//
//   signalAttempt:
//     NOT_ATTEMPTED       — helper short-circuited
//     ACCEPTED            — kill returned true
//                            (or sync `'error'`
//                             confirmed delivery)
//     PERMISSION_DENIED   — sync/async `'error'`
//                            with err.code=EPERM
//     FAILED              — kill returned false,
//                            threw non-EPERM, or
//                            async `'error'` with
//                            non-EPERM code
//
//   terminationObservation:
//     NOT_OBSERVED        — no 'exit' / 'close' yet
//     EXIT_OBSERVED       — 'exit' fired
//     CLOSE_OBSERVED      — 'close' fired
//
// The legacy single-string `cleanupOutcome` is
// still emitted for backward-compat with LIV16
// cases A–F and the downstream log key
// `QUALIFIER_CLEANUP_OUTCOME`. It is now DERIVED
// from the orthogonal pair, not authoritative.
//
// Mapping (helper → legacy string):
//
//   (NOT_ATTEMPTED, _)                    → NOT_ATTEMPTED
//   (ACCEPTED, EXIT_OBSERVED|CLOSE_OBS.)  → SIGNAL_ACCEPTED
//   (ACCEPTED, NOT_OBSERVED)              → SIGNAL_ACCEPTED_UNCONFIRMED
//   (PERMISSION_DENIED, _)                → PERMISSION_DENIED
//   (FAILED, _)                           → FAILED
//
// MICROFIX09 invariant (the reviewer's call):
//
//   EXIT_OBSERVED  ⇒ signal attempted successfully
//                    IS NOT established.
//   CLOSE_OBSERVED ⇒ signal attempted successfully
//                    IS NOT established.
//
// The two dimensions are reported together. No
// "first observation wins" is needed across
// orthogonal facts — both survive.
// --------------------------------------------------------------------
/**
 * @param {{
 *   child: { kill:(sig:string)=>boolean, on:(ev:string,fn:any)=>any, removeListener:(ev:string,fn:any)=>any },
 *   observationWindowMs: number,
 *   classifyCleanupError: (err:any)=>"PERMISSION_DENIED"|"FAILED",
 *   state: { signalAttempt?: string, terminationObservation?: string, cleanupOutcome?: string },
 * }} args
 * @returns {Promise<{
 *   killResult: boolean,
 *   threw: boolean,
 *   cleanupOutcome: string,
 *   signalAttempt: "NOT_ATTEMPTED"|"ACCEPTED"|"PERMISSION_DENIED"|"FAILED",
 *   terminationObservation: "NOT_OBSERVED"|"EXIT_OBSERVED"|"CLOSE_OBSERVED",
 *   observed: {error: boolean, exit: boolean, close: boolean, timedOut: boolean}
 * }>}
 */
export const runDeadlineCleanup = async (args) => {
  const {
    child,
    observationWindowMs,
    classifyCleanupError,
    state,
  } = args;
  // The bounded observation envelope: arm the
  // lifecycle observers BEFORE requesting the
  // transition. This guarantees synchronous
  // `'error'` / `'exit'` / `'close'` events fired
  // DURING `child.kill()` are observable.
  //
  // MICROFIX07 — EventEmitter synchrony (preserved in MF08/MF09):
  //   Node's EventEmitter invokes listeners
  //   SYNCHRONOUSLY, in registration order. We
  //   therefore settle synchronously from each
  //   handler — no setImmediate() deferral.
  //   Synchronous settlement is what makes the
  //   post-kill logic trustworthy: when kill()
  //   returns, `settled` already reflects any
  //   sync `'error'` / `'exit'` / `'close'` that
  //   fired during the call, so the post-kill
  //   inspection is not racing.
  //
  // The single closure-scoped `settled` flag
  // guarantees exactly-once settlement even when
  // kill() synchronously emits multiple events,
  // throws, and returns false in the same call.
  // MICROFIX09 — orthogonal dimensions initialized.
  // Both default to "no evidence yet"; the helper's
  // first settle will publish authoritative values
  // for each independently. No single string is
  // authoritative; the legacy cleanupOutcome is
  // derived at the bottom from the pair.
  const observed = { error: false, exit: false, close: false, timedOut: false };
  let killResult = false;
  let threw = false;
  // MICROFIX10 — TWO INDEPENDENT DIMENSIONAL
  // SETTLEMENT FLAGS.
  //
  // MF09 declared the two dimensions orthogonal,
  // but the MF09 implementation still used a
  // SINGLE global `settled` flag. That made the
  // observer a sum type again: whichever event
  // fired first removed ALL listeners, blocking
  // the other dimension from ever being observed.
  //
  // MF10 replaces the global flag with two
  // independent flags — one per dimension —
  // and a third "operationDone" flag that closes
  // out the helper when BOTH dimensions have
  // finalized (or the observation window for
  // the still-unsettled one expires).
  //
  // The two dimensions are now TRULY observed
  // independently:
  //   * `'error'`           → finalizes SIGNAL
  //                            dimension only;
  //                            removal of the
  //                            'error' listener
  //                            does NOT touch
  //                            'exit'/'close'.
  //   * `'exit'/'close'`    → finalizes TERMINATION
  //                            dimension only;
  //                            removal of the
  //                            'exit'/'close'
  //                            listeners does
  //                            NOT touch 'error'.
  //   * timer expires       → if SIGNAL not yet
  //                            settled, fill it
  //                            from killResult;
  //                            TERMINATION stays
  //                            NOT_OBSERVED.
  //                            Then close out.
  //
  // The `close` event PROMOTES `exit` along a
  // monotonic lattice:
  //   NOT_OBSERVED → EXIT_OBSERVED → CLOSE_OBSERVED
  // because Node docs document `'close'` as
  // occurring AFTER process termination and stdio
  // closure — strictly later than `'exit'`.
  let signalAttempt = "NOT_ATTEMPTED";
  let terminationObservation = "NOT_OBSERVED";

  await new Promise((resolve) => {
    // MF10 — per-dimension settlement flags.
    let signalSettled = false;
    let terminationSettled = false;
    let operationDone = false;
    // closedByTimeout tracks whether the helper
    // resolved because the observation window
    // expired (true) versus because both dim-
    // specific listeners fired naturally (false).
    let closedByTimeout = false;
    // anyListenerFired tracks whether ANY dim-
    // specific listener fired during this run.
    // If no listener fired at all and the timer
    // expires, observed.timedOut is true. If at
    // least one listener fired (even on the
    // OTHER dim), observed.timedOut stays false
    // because the helper's eventual close was
    // not a "no-evidence" timeout.
    let anyListenerFired = false;

    // Close out the helper when BOTH dimensions
    // have finalized. Used by per-dim finalizers.
    const tryResolve = () => {
      if (operationDone) return;
      if (signalSettled && terminationSettled) {
        operationDone = true;
        resolve();
      }
    };

    // Per-dimension finalizers. Each is guarded
    // by ITS OWN flag. Listener removal is
    // scoped to the dimension it serves.
    const finalizeSignal = (reason, syncErr) => {
      if (signalSettled) return;
      signalSettled = true;
      anyListenerFired = true;
      child.removeListener("error", onError);
      observed.error = (reason === "error");
      if (reason === "error") {
        signalAttempt = syncErr
          ? classifyCleanupError(syncErr)
          : "FAILED";
      } else if (reason === "killResult") {
        signalAttempt = syncErr ? "ACCEPTED" : "FAILED";
      } else if (reason === "throw") {
        signalAttempt = classifyCleanupError(syncErr);
      }
      tryResolve();
    };
    const finalizeTermination = (reason) => {
      // MF10 MONOTONIC LATTICE — 'close' can
      // ALWAYS upgrade an already-settled
      // 'exit' observation. We check for
      // close FIRST before the early-return
      // guard so the promotion lands even if
      // terminationSettled is already true
      // from a prior 'exit'.
      if (reason === "close") {
        // close is the upper bound of the
        // lattice; promote unconditionally.
        observed.close = true;
        terminationObservation = "CLOSE_OBSERVED";
        anyListenerFired = true;
        if (!terminationSettled) {
          terminationSettled = true;
          child.removeListener("exit", onExit);
          child.removeListener("close", onClose);
        }
        tryResolve();
        return;
      }
      if (terminationSettled) return;
      terminationSettled = true;
      anyListenerFired = true;
      // MF10 MONOTONIC LATTICE — we remove ONLY
      // the 'exit' listener here. The 'close'
      // listener stays armed so a later 'close'
      // can promote EXIT_OBSERVED → CLOSE_OBSERVED.
      // ('close' is the upper bound of the
      // lattice.)
      child.removeListener("exit", onExit);
      if (reason === "exit") {
        observed.exit = true;
        // Monotonic: NOT_OBSERVED → EXIT_OBSERVED.
        if (terminationObservation === "NOT_OBSERVED") {
          terminationObservation = "EXIT_OBSERVED";
        }
      }
      tryResolve();
    };
    // Timeout: fill any unsettled dimension and
    // resolve. This is the ONLY place that closes
    // out the helper via time, and it does so
    // for BOTH dimensions.
    //
    // `observed.timedOut` is true ONLY if the
    // timer was the SOLE source of settlement
    // (no dim-specific listener ever fired).
    // If at least one listener fired (sync or
    // async) on either dimension, observed.timedOut
    // stays false — the helper was closed
    // partially by listener evidence, partially
    // by the timer filling the unfilled dim.
    const finalizeTimeout = () => {
      closedByTimeout = true;
      if (!signalSettled) {
        signalSettled = true;
        child.removeListener("error", onError);
        signalAttempt = killResult ? "ACCEPTED" : "FAILED";
      }
      if (!terminationSettled) {
        terminationSettled = true;
        child.removeListener("exit", onExit);
        child.removeListener("close", onClose);
      }
      if (!anyListenerFired) {
        observed.timedOut = true;
      }
      operationDone = true;
      resolve();
    };

    // ---- SYNCHRONOUS handlers. ----
    // Each handler finalizes ITS dimension only.
    const onError = (err) => finalizeSignal("error", err);
    const onExit = () => finalizeTermination("exit");
    const onClose = () => finalizeTermination("close");

    // ---- ARM observers BEFORE kill. ----
    child.on("error", onError);
    child.on("exit", onExit);
    child.on("close", onClose);
    const timer = setTimeout(finalizeTimeout, observationWindowMs);

    // ---- Request the lifecycle transition. ----
    // Sync `'error'` / `'exit'` / `'close'` here
    // are observable via the listeners armed above,
    // and EventEmitter invokes them SYNCHRONOUSLY.
    // MF10: each handler finalizes ONLY its
    // dimension, so other-dimension listeners
    // remain armed even after one fires.
    //
    // CRITICAL (MF10): we DO NOT call
    // finalizeSignal("killResult", ...) here.
    // That would prematurely settle the signal
    // dimension with ACCEPTED/FAILED and block
    // an async `'error'` event from later
    // overwriting with PERMISSION_DENIED (LIV16
    // CASE A: kill=true + async EPERM must
    // classify as PERMISSION_DENIED, not
    // ACCEPTED). The signal dimension is
    // settled ONLY by:
    //   * a typed `'error'` event (sync/async),
    //   * a throw from kill(), or
    //   * the observation window timeout
    //     (fallback to killResult).
    try {
      killResult = child.kill("SIGKILL");
    } catch (err) {
      threw = true;
      killResult = false;
      // MF10: feed the thrown err to the SIGNAL
      // dimension via the throw reason. The
      // catch path is THE source of typed
      // signal-attempt evidence — under MF09
      // the catch's signalAttempt was THROWN
      // AWAY if a sync 'exit'/'close' listener
      // had already settled (LIV19 case O).
      finalizeSignal("throw", err);
      return;
    }
    // kill() returned without throwing.
    //   * If kill returned FALSE → the helper
    //     knows immediately that the signal
    //     attempt failed. Settle signal dim
    //     now with FAILED. No async observation
    //     can rescue signal from FAILED (kill
    //     returned false). LIV16 CASE C asserts
    //     observed.timedOut=false because the
    //     observation window should NOT have to
    //     run.
    //   * If kill returned TRUE → signal dim
    //     stays OPEN. The async 'error' listener
    //     still has a chance to fire and
    //     reclassify via classifyCleanupError
    //     (LIV16 CASE A: kill=true + async EPERM
    //     MUST classify as PERMISSION_DENIED,
    //     not be prematurely locked to ACCEPTED).
    //     The observation window timeout
    //     fills signal from killResult if
    //     nothing else arrives.
    if (killResult === false) {
      finalizeSignal("killResult", killResult);
    }
  });

  // After the helper settles, derive the legacy
  // single-string cleanupOutcome from the
  // orthogonal pair. This preserves the
  // downstream log key
  // `QUALIFIER_CLEANUP_OUTCOME` and LIV16 cases
  // A–F.
  //
  // Mapping (helper → legacy string):
  //
  //   (NOT_ATTEMPTED, *)                   → NOT_ATTEMPTED
  //   (PERMISSION_DENIED, *)               → PERMISSION_DENIED
  //   (FAILED, *)                          → FAILED
  //   (ACCEPTED, EXIT_OBSERVED|CLOSE_OBS.) → SIGNAL_ACCEPTED
  //   (ACCEPTED, NOT_OBSERVED)             → SIGNAL_ACCEPTED_UNCONFIRMED
  //
  // Note: with the orthogonal algebra, a
  // `kill=false + exit observed` pair (case K)
  // now reports `(FAILED, EXIT_OBSERVED)` →
  // legacy `FAILED`. PRE-MF09 this case
  // reported `SIGNAL_ACCEPTED`, which falsely
  // claimed the signal was delivered. MF09
  // truthfully reports the signal attempt
  // failed and termination was observed
  // anyway — which is exactly the cause/effect
  // separation the reviewer requested.
  let cleanupOutcome;
  if (signalAttempt === "NOT_ATTEMPTED") {
    cleanupOutcome = "NOT_ATTEMPTED";
  } else if (signalAttempt === "PERMISSION_DENIED") {
    cleanupOutcome = "PERMISSION_DENIED";
  } else if (signalAttempt === "FAILED") {
    cleanupOutcome = "FAILED";
  } else if (signalAttempt === "ACCEPTED") {
    cleanupOutcome = (terminationObservation === "EXIT_OBSERVED" ||
        terminationObservation === "CLOSE_OBSERVED")
      ? "SIGNAL_ACCEPTED"
      : "SIGNAL_ACCEPTED_UNCONFIRMED";
  } else {
    // Defensive default — should not happen.
    cleanupOutcome = "FAILED";
  }

  // Reflect the derived legacy value back onto
  // state so the LIVE main flow can read it
  // through state.cleanupOutcome as before.
  if (typeof state.cleanupOutcome === "string") {
    state.cleanupOutcome = cleanupOutcome;
  }

  return {
    killResult,
    threw,
    cleanupOutcome,
    signalAttempt,
    terminationObservation,
    observed,
  };
};

// Detect whether the script is being imported (test
// harness) vs executed directly. When imported, only
// the helper above is exported; the spawn below and
// the rest of the main flow are skipped.
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (!isMain) {
  // Test harness import path — do NOT spawn npm or
  // run the qualification flow; only the exported
  // `runDeadlineCleanup` helper is needed.
}

const CLEANUP_OBSERVATION_MS = Number(
  process.env.LIVENESS_CLEANUP_OBSERVATION_MS ?? 2_000,
);

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
const child = isMain
  ? spawn(
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
  )
  : null;

let stderrBuf = "";
child?.stderr?.on("data", (d) => { stderrBuf += d.toString(); });

const start = Date.now();

// --------------------------------------------------------------------
// MICROFIX07 — TWO-PHASE SETTLEMENT.
//
// The qualifier settles the runner's liveness in TWO
// distinct phases:
//
//   Phase 1 — `runnerSettledPromise`
//     Resolves when the runner's liveness boundary is
//     KNOWN: `'exit'` (CLEAN_EXIT), pre-settlement
//     `'error'` (SPAWN_ERROR / SIGNAL_ERROR), or the
//     wall-clock deadline firing (DEADLINE).
//
//   Phase 2 — bounded cleanup observation
//     Resolves AFTER phase 1, ONLY if phase 1 settled
//     as DEADLINE. Phase 2 calls the exported
//     `runDeadlineCleanup` helper, which:
//       1. Calls `child.kill('SIGKILL')`.
//       2. If kill returns true, waits boundedly
//          (CLEANUP_OBSERVATION_MS, default 2000ms)
//          for one of:
//          * `'error'`   — kill failed async, re-classify
//                           via classifyCleanupError(err).
//          * `'exit'`/`'close'` — child observed as
//                           terminated. Promote
//                           SIGNAL_ACCEPTED_UNCONFIRMED
//                           → SIGNAL_ACCEPTED.
//          * cleanup-observation deadline — neither
//                           event arrived. Stay at
//                           SIGNAL_ACCEPTED_UNCONFIRMED.
//     This eliminates the prior race where the
//     qualifier emitted SENT before the async
//     `'error'` event that would have correctly
//     re-classified it to PERMISSION_DENIED.
//
// Node docs are explicit: `subprocess.kill()`
// returning true does NOT prove termination; the
// `'exit'` event is the only positive signal of
// termination. Phase 2 enforces that the qualifier
// waits for positive observation (or its bounded
// budget) before emitting final evidence.
//
// MICROFIX03 P1-3 (carried forward):
//   (1) The deadline is settled FIRST, via a single-
//       settlement guard.
//   (2) The kill attempt happens AFTER settlement
//       and its outcome is recorded separately as
//       QUALIFIER_CLEANUP_OUTCOME.
//   (3) `'error'` after settlement is IGNORED for
//       boundary purposes; it only feeds the
//       cleanup-outcome re-classification in phase 2.
// --------------------------------------------------------------------
let settled = false;
/** @type {"DEADLINE"|"CLEAN_EXIT"|"SPAWN_ERROR"|"SIGNAL_ERROR"|null} */
let boundary = null;
/** @type {"SIGNAL_ACCEPTED"|"SIGNAL_ACCEPTED_UNCONFIRMED"|"PERMISSION_DENIED"|"FAILED"|"NOT_ATTEMPTED"} */
let cleanupOutcome = "NOT_ATTEMPTED";
/** Optimistic cleanup state set during phase 1 — may
 *  be re-classified by async `'error'` in phase 2.
 *  (MICROFIX07: removed — the phase-2 helper
 *  observes lifecycle events directly via its
 *  own listeners and does not depend on a
 *  cross-handler pending reclassification
 *  written by an outer shared `'error'` handler.
 *  The helper's own `onError` catches the err
 *  synchronously and passes it to classifyCleanupError.)
 */
let descendantCleanupProven = false;
/** @type {number|null} */
let runnerExitCode = null;
/** @type {NodeJS.Signals|null} */
let runnerSignal = null;

// --------------------------------------------------------------------
// MICROFIX04 QFIX01+QFIX02 — TYPED CLEANUP-ERROR CLASSIFIER.
//
// Node's ChildProcess emits `'error'` for several
// distinct failure modes (inability to spawn,
// inability to kill, failed IPC, abort). It also
// documents that `subprocess.kill()` may synchronously
// throw on signal-delivery failure.
//
// The earlier MICROFIX03 implementation treated EVERY
// post-kill `'error'` as `PERMISSION_DENIED`, which is
// exactly the evidence-provenance inversion this
// Factory doctrine forbids: a generic ESRCH (process
// already gone) or an EACCES (file-mode refusal, not
// a signal-rights refusal) would be reported as
// PERMISSION_DENIED without examining `err.code`.
//
// The classifier is now strictly typed:
//
//     err.code === "EPERM"
//       → PERMISSION_DENIED (the canonical
//         kernel-meaningful errno for "the host
//         refused signal delivery to this child").
//     err.code === "ESRCH" | "EACCES" | anything else
//       → FAILED (NOT PERMISSION_DENIED).
//
// This same classifier is applied to BOTH the
// synchronous `kill()` catch AND the asynchronous
// `'error'` event — the two paths previously used
// different mappings, which is itself an evidence-
// inversion (synchronous EPERM → FAILED, async EPERM
// → PERMISSION_DENIED).
// --------------------------------------------------------------------
const classifyCleanupError = (err) => {
  return err && err.code === "EPERM"
    ? "PERMISSION_DENIED"
    : "FAILED";
};

// --------------------------------------------------------------------
// MICROFIX04 QFIX03 — ChildProcess `'spawn'` AS SPAWN AUTHORITY.
//
// The earlier MICROFIX03 implementation decided
// whether an `'error'` was a spawn-error by
// parsing the runner's own stderr for the
// `test_runner_start` telemetry line. That is an
// application-level documentary signal, not the
// ChildProcess-level lifecycle event.
//
// Node's ChildProcess emits `'spawn'` exactly once,
// AFTER the child has been successfully spawned. If
// spawning fails, `'spawn'` is NEVER emitted.
//
//     spawned === false && error → SPAWN_ERROR
//     spawned === true  && error → SIGNAL_ERROR
//                                       (process-control
//                                        / runtime error)
//
// The runner-trace `has_start` regex is RETAINED as
// corroborating evidence (in `observed.trace.has_start`)
// but is no longer used to classify the boundary.
// --------------------------------------------------------------------
let spawned = false;

const settleOnce = (kind) => {
  if (settled) return;
  settled = true;
  boundary = kind;
};

let settledPromise;
if (isMain) {
  settledPromise = new Promise((resolve) => {
    const onSettled = () => resolve();
    const timer = setTimeout(() => {
      // Phase 1 — settle the boundary only. The
      // kill + bounded-observation step is the LIVE
      // main flow's responsibility (see
      // `runDeadlineCleanup` invocation below).
      settleOnce("DEADLINE");
      descendantCleanupProven = false;
      onSettled();
    }, DEADLINE_MS);

    // QFIX03: typed spawn authority.
    child.once("spawn", () => {
      spawned = true;
    });

    child.on("exit", (code, signal) => {
      runnerExitCode = code;
      runnerSignal = signal;
      if (!settled) {
        settleOnce("CLEAN_EXIT");
        cleanupOutcome = "NOT_ATTEMPTED";
        clearTimeout(timer);
        onSettled();
        return;
      }
      // Post-settlement: phase-2 will observe this.
    });

    child.on("close", () => {
      // `'close'` fires after `'exit'` once all
      // stdio streams are drained. Phase-2 listens
      // for this as a positive termination signal.
    });

    child.on("error", (err) => {
      if (settled) {
        // Post-settlement: this is an async error
        // that arrived after phase 1 already
        // settled the boundary. MICROFIX07: the
        // phase-2 helper observes errors via its
        // OWN listener (the one it armed before
        // kill()), so this outer shared handler
        // does NOT need to do anything here. We
        // deliberately do not reclassify: any
        // authoritative cleanup outcome is
        // produced by the phase-2 helper's own
        // observation. Returning here keeps the
        // shared handler non-authoritative for
        // cleanup outcomes.
        return;
      }
      // Pre-settlement: classify by whether the child
      // was ever actually spawned (QFIX03).
      settleOnce(spawned ? "SIGNAL_ERROR" : "SPAWN_ERROR");
      cleanupOutcome = spawned
        ? classifyCleanupError(err)
        : "NOT_ATTEMPTED";
      clearTimeout(timer);
      onSettled();
    });
  });
}

// MAIN ENTRYPOINT BLOCK — only runs when this script
// is invoked directly. The test-harness import path
// short-circuits here, before any awaits run.
if (!isMain) {
  // Stop early for test-harness imports. The
  // `runDeadlineCleanup` export is the only thing
  // LIV16 needs.
} else {
await settledPromise;
// Phase 2 — bounded cleanup observation. Only run
// when the deadline fired (the only case where the
// cleanup outcome is not already finalized). For all
// other boundaries, the cleanup outcome is already
// determined (NOT_ATTEMPTED for CLEAN_EXIT, the
// sync-classified value for SPAWN_ERROR/SIGNAL_ERROR).
let cleanupObservationArmed = false;
let cleanupObserved = null;
if (boundary === "DEADLINE") {
  cleanupObservationArmed = true;
  cleanupObserved = await runDeadlineCleanup({
    child,
    observationWindowMs: CLEANUP_OBSERVATION_MS,
    classifyCleanupError,
    state: {
      cleanupOutcome,
    },
  });
  cleanupOutcome = cleanupObserved.cleanupOutcome;
}

const elapsed_ms = Date.now() - start;

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01-MICROFIX09)
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
    // QFIX03: these are CORROBORATING telemetry
    // signals only. The authoritative spawn/lifecycle
    // signal is the ChildProcess `'spawn'` event
    // (tracked internally as `spawned`), NOT these
    // regex matches on stderr.
    has_start: /"kind":"test_runner_start"/.test(stderrBuf),
    has_finish: /"kind":"test_runner_finish"/.test(stderrBuf),
    spawned_via_typed_event: spawned,
    // MICROFIX07 phase-2 audit trail.
    cleanup_observation_armed: cleanupObservationArmed,
    cleanup_observation_window_ms: CLEANUP_OBSERVATION_MS,
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

} // end of main-entrypoint isMain block
