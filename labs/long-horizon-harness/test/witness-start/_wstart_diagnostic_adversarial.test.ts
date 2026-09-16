/**
 * FOUNDATION04 — PHASE A — REBURN-CORRECTION01-MICROFIX03
 *
 * Adversarial oracles for the WSTART diagnostic
 * packet. These oracles pin the orthogonal-channel
 * law AND the corrected process/error algebra:
 *
 *   process-lifecycle evidence     ≡  processExitObservation
 *                                    (exit | timeout | unavailable)
 *   error channel                  ≡  errorEventObserved
 *                                    (independent of processExitObservation)
 *   stdio-output accounting        ≡  bootstrapOutputBoundary
 *
 * The three channels are NEVER collapsed.
 *
 * Critical laws pinned by these oracles:
 *
 *   1. An output boundary that resolves while the
 *      process is still alive MUST NOT be promoted
 *      to lifecycle authority (WDIAG04).
 *
 *   2. An 'error' event does NOT terminate the
 *      process-exit observation window. Node
 *      explicitly documents that after 'error' an
 *      'exit' may still fire. The error evidence
 *      is recorded in errorEventObserved; the
 *      process channel keeps waiting for 'exit' or
 *      for the bounded deadline (WDIAG02, WDIAG09).
 *
 *   3. The T2 (post-proof) sample is taken AFTER
 *      proveChildAbsent resolves. Sampling before
 *      the oracle (MICROFIX02 bug) would emit a
 *      stale snapshot whose name is dishonest
 *      (WDIAG08).
 *
 * These oracles are deterministic — they use fake
 * handles and synthetic emission timing so they
 * execute even on hosts where the live witness
 * cannot be spawned (UDS path too long, kernel
 * denying SIGKILL, etc.).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  observeLifecycle,
  type DiagnosticPort,
} from "./_wstart_diagnostic_helpers.js";

/**
 * Build a fake diagnostic port that emulates the
 * production `WitnessSpawnHandle.on("exit"|"error")`
 * subscription shape. Each listener is registered in
 * a list and can be triggered by the test body.
 *
 * The fake does NOT auto-fire listeners on `kill()`;
 * that is the test's responsibility. This keeps the
 * oracles mechanical and timing-deterministic.
 */
function makeFakeHandle(opts: {
  pid: number;
  killReturns?: boolean;
} = { pid: 999_001 }): {
  port: DiagnosticPort;
  fireExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  fireError: (err: Error) => void;
} {
  const exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  const errorListeners: Array<(err: Error) => void> = [];
  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  const port: DiagnosticPort = {
    pid: opts.pid,
    kill: (_sig) => {
      // Mirror production: returns the configured
      // value (default true), or throws when caller
      // wants to simulate EPERM throwing.
      if (opts.killReturns === undefined) return true;
      if (opts.killReturns === false) return false;
      return true;
    },
    exitInfo: () => ({
      exited,
      code: exitCode,
      signal: exitSignal,
    }),
    on: ((_event, listener) => {
      exitListeners.push(listener as (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => void);
      return port;
    }),
    onError: ((_event, listener) => {
      errorListeners.push(listener as (err: Error) => void);
      return port;
    }),
    whenBootstrapOutputClosed: () => Promise.resolve({}),
  };
  return {
    port,
    fireExit: (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      for (const l of exitListeners) l(code, signal);
    },
    fireError: (err) => {
      for (const l of errorListeners) l(err);
    },
  };
}
// ----------------------------------------------------------------------
// WDIAG01 — exit synchronously during kill is observed
// as {kind:"exit", code, signal}. The fake fires the
// 'exit' listener inside the kill() call to prove the
// listener is armed BEFORE the kill and receives the
// exit synchronously, not on a future microtask.
// ----------------------------------------------------------------------
test("WDIAG01: exit synchronously during kill → processExitObservation={kind:'exit'}", async () => {
  const fake = makeFakeHandle({ pid: 900_001 });
  let didFire = false;
  const wrapped = (sig?: NodeJS.Signals): boolean => {
    if (!didFire) {
      didFire = true;
      fake.fireExit(0, sig ?? "SIGTERM");
    }
    return true;
  };
  const port: DiagnosticPort = {
    ...fake.port,
    kill: wrapped,
  };
  const r = await observeLifecycle(port, {
    processDeadlineMs: 200,
    outputDeadlineMs: 200,
  });
  assert.equal(r.processExitObservation.kind, "exit",
    "WDIAG01: synchronous exit during kill MUST be observed as {kind:'exit'}; got " +
      JSON.stringify(r.processExitObservation));
  if (r.processExitObservation.kind === "exit") {
    assert.equal(r.processExitObservation.signal, "SIGTERM",
      "WDIAG01: exit signal must be SIGTERM");
  }
  assert.equal(r.bootstrapOutputBoundary.kind, "closed",
    "WDIAG01: output boundary is closed (independent fact)");
  assert.equal(r.exitInfoBeforeTermination?.exited, false,
    "WDIAG01: T0 sample MUST be {exited:false}");
  assert.equal(r.exitInfoAfterProcessObservation?.exited, true,
    "WDIAG01: T1a sample after process observation MUST be {exited:true}");
});

// ----------------------------------------------------------------------
// WDIAG02 — error event asynchronously after the kill,
// NO subsequent exit. The error is recorded in
// `errorEventObserved.seen === true`. The
// `processExitObservation` channel does NOT settle
// on the error — it MUST wait for `exit` or for the
// bounded deadline. Since no exit fires in this
// scenario, the process observation settles as
// `{kind:'timeout'}`.
// (FOUNDATION04 PHASE A — REBURN-CORRECTION01-MICROFIX03)
// Previous version of this oracle pinned the
// WRONG algebra: processExitObservation={kind:'error'}
// on async error. That was the category mistake.
// The error listener is NOT on the process race.
// ----------------------------------------------------------------------
test("WDIAG02: error asynchronously after kill (no exit) → errorEventObserved.seen=true, processExitObservation={kind:'timeout'}", async () => {
  const fake = makeFakeHandle({ pid: 900_002 });
  setImmediate(() => {
    const err = Object.assign(new Error("EPERM: cannot kill"), {
      code: "EPERM",
    });
    fake.fireError(err);
  });
  const r = await observeLifecycle(fake.port, {
    processDeadlineMs: 80,
    outputDeadlineMs: 500,
  });
  assert.equal(r.errorEventObserved.seen, true,
    "WDIAG02: async error event MUST be observed; got " +
      JSON.stringify(r.errorEventObserved));
  if (r.errorEventObserved.seen) {
    assert.equal(r.errorEventObserved.code, "EPERM",
      "WDIAG02: error code must be EPERM");
  }
  // The error did NOT terminate the process-exit
  // observation window. The process observation
  // waited for `exit` (never fired) and settled as
  // `timeout` after the bounded deadline.
  assert.equal(r.processExitObservation.kind, "timeout",
    "WDIAG02: processExitObservation MUST be {kind:'timeout'} when error fires WITHOUT exit; got " +
      JSON.stringify(r.processExitObservation));
});

// ----------------------------------------------------------------------
// WDIAG03 — no exit, no error → processExitObservation
// settles as {kind:'timeout'} after the bounded
// deadline. The fake NEVER fires either listener.
// ----------------------------------------------------------------------
test("WDIAG03: no exit, no error → processExitObservation={kind:'timeout'}", async () => {
  const fake = makeFakeHandle({ pid: 900_003 });
  const r = await observeLifecycle(fake.port, {
    processDeadlineMs: 50,
    outputDeadlineMs: 200,
  });
  assert.equal(r.processExitObservation.kind, "timeout",
    "WDIAG03: silent child MUST settle as {kind:'timeout'}; got " +
      JSON.stringify(r.processExitObservation));
  if (r.processExitObservation.kind === "timeout") {
    assert.equal(r.processExitObservation.deadlineMs, 50,
      "WDIAG03: timeout observation MUST carry the deadline");
  }
  assert.equal(r.errorEventObserved.seen, false,
    "WDIAG03: silent child → no error observed");
});

// ----------------------------------------------------------------------
// WDIAG04 (REGRESSION ORACLE) — output boundary resolves
// while the process remains alive. The previous
// conceptual model labeled the post-boundary exitInfo
// as authoritative process evidence; this oracle
// MECHANICALLY FAILS that model. Under the corrected
// model, output boundary is ORTHOGONAL to process
// exit, so a closed output boundary MUST NOT cause the
// packet to classify the process as exited.
// ----------------------------------------------------------------------
test("WDIAG04 (regression): output boundary closed while process remains alive MUST NOT classify processExitObservation={kind:'exit'}", async () => {
  const fake = makeFakeHandle({ pid: 900_004 });
  // Output boundary resolves IMMEDIATELY (before the
  // process ever fires 'exit'). Process never exits.
  const port: DiagnosticPort = {
    ...fake.port,
    whenBootstrapOutputClosed: () => Promise.resolve({ stdout: {}, stderr: {} }),
  };
  const r = await observeLifecycle(port, {
    processDeadlineMs: 100,
    outputDeadlineMs: 200,
  });
  assert.equal(r.bootstrapOutputBoundary.kind, "closed",
    "WDIAG04: output boundary is closed (orthogonal fact)");
  assert.notEqual(r.processExitObservation.kind, "exit",
    "WDIAG04: REGRESSION — output boundary close MUST NOT promote " +
      "processExitObservation to {kind:'exit'}; got " +
      JSON.stringify(r.processExitObservation));
  assert.equal(r.processExitObservation.kind, "timeout",
    "WDIAG04: silent child with closed output boundary settles as " +
      "{kind:'timeout'}; got " +
      JSON.stringify(r.processExitObservation));
  assert.equal(r.exitInfoAfterOutputBoundaryWait?.exited, false,
    "WDIAG04: exitInfo MUST NOT reflect process exit just because " +
      "the output boundary closed; got " +
      JSON.stringify(r.exitInfoAfterOutputBoundaryWait));
});

// ----------------------------------------------------------------------
// WDIAG05 — output boundary errors independently of
// process exit. Even if the output barrier rejects,
// process-lifecycle classification is still
// authoritative. The error is reported as
// `bootstrapOutputBoundary.kind === "error"` but
// processExitObservation is unaffected.
// ----------------------------------------------------------------------
test("WDIAG05: output boundary error is orthogonal to process exit", async () => {
  const fake = makeFakeHandle({ pid: 900_005 });
  const port: DiagnosticPort = {
    ...fake.port,
    whenBootstrapOutputClosed: () => Promise.reject(
      Object.assign(new Error("ERR_STREAM_PREMATURE_CLOSE"), {
        code: "ERR_STREAM_PREMATURE_CLOSE",
      }),
    ),
  };
  setImmediate(() => fake.fireExit(0, null));
  const r = await observeLifecycle(port, {
    processDeadlineMs: 200,
    outputDeadlineMs: 200,
  });
  assert.equal(r.bootstrapOutputBoundary.kind, "error",
    "WDIAG05: output boundary error MUST be reported; got " +
      JSON.stringify(r.bootstrapOutputBoundary));
  assert.equal(r.processExitObservation.kind, "exit",
    "WDIAG05: process exit is still authoritative when output barrier errors; got " +
      JSON.stringify(r.processExitObservation));
  assert.equal(r.errorEventObserved.seen, false,
    "WDIAG05: output barrier rejection is NOT a process error event");
});

// ----------------------------------------------------------------------
// WDIAG06 — kill returns false is recorded as
// `signalRequestOutcome={kind:'returned_false'}` and is
// NOT promoted to a kernel-rejection claim. The
// process-observation window keeps waiting for `exit`
// or for the bounded deadline. Since no `exit` fires
// in this scenario, the process observation settles
// as `{kind:'timeout'}` (NOT as an error classification).
// ----------------------------------------------------------------------
test("WDIAG06: kill() returns false → signalRequestOutcome={kind:'returned_false'}, process settles as timeout (not error)", async () => {
  const fake = makeFakeHandle({ pid: 900_006, killReturns: false });
  const r = await observeLifecycle(fake.port, {
    processDeadlineMs: 80,
    outputDeadlineMs: 200,
  });
  assert.equal(r.signalRequestOutcome.kind, "returned_false",
    "WDIAG06: kill returning false MUST be {kind:'returned_false'}; got " +
      JSON.stringify(r.signalRequestOutcome));
  assert.equal(r.errorEventObserved.seen, false,
    "WDIAG06: a kill that returned false alone MUST NOT mint an error event");
  // (FOUNDATION04 PHASE A — REBURN-CORRECTION01-MICROFIX03)
  // Under the corrected algebra, the process channel
  // has NO 'error' kind. A returned_false kill that
  // never sees 'exit' settles as {kind:'timeout'}.
  assert.equal(r.processExitObservation.kind, "timeout",
    "WDIAG06: returned_false kill with no exit MUST settle as {kind:'timeout'}; got " +
      JSON.stringify(r.processExitObservation));
});

// ----------------------------------------------------------------------
// WDIAG07 — exit fires BEFORE kill is sent (child
// pre-exited). The process-observation channel sees
// {kind:'exit'} even though the kill request arrives
// after the child is already gone. exitInfo stays
// authoritative via the owned handle's exitInfo().
// ----------------------------------------------------------------------
test("WDIAG07: pre-exited child → processExitObservation={kind:'exit'} with T0 sample already exited", async () => {
  const fake = makeFakeHandle({ pid: 900_007 });
  fake.fireExit(137, "SIGKILL");
  const r = await observeLifecycle(fake.port, {
    processDeadlineMs: 200,
    outputDeadlineMs: 200,
  });
  assert.equal(r.exitInfoBeforeTermination?.exited, true,
    "WDIAG07: T0 sample MUST reflect pre-existing exit");
  assert.equal(r.processExitObservation.kind, "exit",
    "WDIAG07: pre-exited child MUST classify as {kind:'exit'}");
  if (r.processExitObservation.kind === "exit") {
    assert.equal(r.processExitObservation.code, 137,
      "WDIAG07: code preserved as 137");
    assert.equal(r.processExitObservation.signal, "SIGKILL",
      "WDIAG07: signal preserved as SIGKILL");
  }
});

// ----------------------------------------------------------------------
// WDIAG08 — T2 ordering: the post-proof exitInfo
// sample MUST be taken AFTER the proof oracle
// resolves, not before. This is the regression
// oracle for the T2 typo the reviewer caught in
// MICROFIX02's live code: `exitInfoAfterProof =
// readExitInfo()` was sampled BEFORE
// `proveChildAbsent(child)` resolved.
//
// This oracle has TWO parts:
//
//   (1) Behavioral part — drives a fake port
//       through a hand-rolled "proof-equivalent":
//       exitInfo.exited flips from false to true
//       on a deferred tick. After the
//       proof-equivalent, a T2 sample MUST observe
//       exited=true. Before the proof-equivalent,
//       it would observe exited=false.
//
//   (2) Static-guard part — reads the LIVE test
//       file's source and mechanically verifies
//       that the `exitInfoAfterProof = readExitInfo()`
//       assignment appears AFTER the
//       `await proveChildAbsent(child)` call. If a
//       future regression reorders them, WDIAG08
//       fails.
//
// The MICROFIX02 bug had the assignment BEFORE the
// await — that ordering would have produced a stale
// T2 sample whose name was dishonest.
// ----------------------------------------------------------------------
test("WDIAG08: T2 (post-proof) exitInfo sample MUST be taken AFTER the proof oracle resolves", async () => {
  const { promises: fs } = await import("node:fs");
  const liveUrl = new URL(
    "../witness-start/witness-start-live.test.ts",
    import.meta.url,
  );
  const liveText = await fs.readFile(liveUrl, "utf8");
  // Strip comments so comment text can't satisfy
  // the static guard.
  const liveCodeOnly = liveText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+\/\/.*$/g, "");

  // (1) BEHAVIORAL: a T2 sample taken after a
  //     proof-equivalent that flips state MUST
  //     observe the new state.
  const fake = makeFakeHandle({ pid: 900_008 });
  assert.equal(fake.port.exitInfo?.().exited, false,
    "WDIAG08: T0 starts with exited=false");
  // Hand-rolled "proof oracle": flip exitInfo.exited
  // to true on a deferred tick.
  await new Promise<void>((res) => {
    setImmediate(() => {
      fake.fireExit(0, "SIGTERM");
      res();
    });
  });
  const exitInfoAfterProof = fake.port.exitInfo?.();
  assert.equal(exitInfoAfterProof?.exited, true,
    "WDIAG08: T2 sample taken AFTER the proof-equivalent MUST observe exited=true; got " +
      JSON.stringify(exitInfoAfterProof));

  // (2) STATIC-GUARD: in the live test file, the
  //     `exitInfoAfterProof = readExitInfo()` line
  //     MUST appear AFTER `await proveChildAbsent`.
  //     If it appears BEFORE, the field's name is
  //     dishonest (stale snapshot).
  const proveMatch = /await\s+proveChildAbsent\s*\(\s*child\s*\)/.exec(liveCodeOnly);
  const t2Match = /exitInfoAfterProof\s*=\s*readExitInfo\s*\(/.exec(liveCodeOnly);
  assert.ok(proveMatch !== null,
    "WDIAG08: live file must contain `await proveChildAbsent(child)`");
  assert.ok(t2Match !== null,
    "WDIAG08: live file must contain `exitInfoAfterProof = readExitInfo()`");
  assert.ok(
    (t2Match?.index ?? 0) > (proveMatch?.index ?? 0),
    "WDIAG08: `exitInfoAfterProof = readExitInfo()` MUST appear AFTER " +
      "`await proveChildAbsent(child)` (regression: T2 ordering typo in MICROFIX02). " +
      "The T2 sample's NAME requires that the read happens post-proof.",
  );
});

// ----------------------------------------------------------------------
// WDIAG09 — error first, then later exit. This is
// the DECISIVE FALSIFIER for the MICROFIX02 algebra
// (where 'error' terminated the process-exit window
// and pinned processExitObservation={kind:'error'}).
//
// Under the corrected algebra:
//   - The error event is recorded in
//     errorEventObserved.seen=true.
//   - The process-exit observation window does NOT
//     terminate on the error; it keeps waiting for
//     `exit` or the bounded deadline.
//   - When `exit` finally fires (after the error,
//     Node-permitted), processExitObservation settles
//     as {kind:'exit'}.
//
// Under the previous algebra, the `error` listener
// resolved the helper's race on `errorSettled`. The
// helper then proceeded to the bootstrap output wait.
// Because we make the output barrier resolve
// IMMEDIATELY (no_barrier / 0ms) under this oracle,
// the helper returned BEFORE the late `exit` fired,
// and the packet would have settled
// processExitObservation={kind:'error'}.
//
// This oracle is constructed so that, under the OLD
// code (where 'error' is on the race), the helper
// returns BEFORE the late exit — making
// processExitObservation={kind:'error'} observable.
// Under the NEW code (where 'error' is NOT on the
// race), the helper waits for the late exit and
// returns processExitObservation={kind:'exit'}.
// ----------------------------------------------------------------------
test("WDIAG09: error first, then later exit → errorEventObserved.seen=true, processExitObservation={kind:'exit'}", async () => {
  const fake = makeFakeHandle({ pid: 900_009 });
  // Drop the bootstrap output barrier entirely so
  // the helper's bootstrap wait is a no-op (returns
  // immediately as no_barrier). Under the OLD code,
  // this means the helper returns IMMEDIATELY after
  // the error fires — BEFORE the late `exit`.
  const port: DiagnosticPort = {
    ...fake.port,
    whenBootstrapOutputClosed: undefined,
  };
  // Fire `error` first (5ms), then `exit` much
  // later (well past what the OLD code would need
  // to return). Both are within processDeadlineMs
  // so the NEW code's race can still see the exit.
  setTimeout(() => {
    const err = Object.assign(new Error("EPERM: cannot kill"), {
      code: "EPERM",
    });
    fake.fireError(err);
  }, 5);
  setTimeout(() => fake.fireExit(0, "SIGTERM"), 150);
  const r = await observeLifecycle(port, {
    processDeadlineMs: 500,
    outputDeadlineMs: 1, // almost-immediate output barrier
  });
  assert.equal(r.errorEventObserved.seen, true,
    "WDIAG09: error evidence MUST be preserved even when exit fires later; got " +
      JSON.stringify(r.errorEventObserved));
  if (r.errorEventObserved.seen) {
    assert.equal(r.errorEventObserved.code, "EPERM",
      "WDIAG09: error code is EPERM");
  }
  // The process channel kept waiting past the
  // error and observed the later exit.
  assert.equal(r.processExitObservation.kind, "exit",
    "WDIAG09: late `exit` MUST still be observed as {kind:'exit'}; the error MUST NOT have terminated the window. Got " +
      JSON.stringify(r.processExitObservation));
  if (r.processExitObservation.kind === "exit") {
    assert.equal(r.processExitObservation.code, 0,
      "WDIAG09: exit code 0");
    assert.equal(r.processExitObservation.signal, "SIGTERM",
      "WDIAG09: exit signal SIGTERM");
  }
});
