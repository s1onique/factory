/**
 * FOUNDATION04 — PHASE A — REBURN-CORRECTION01-MICROFIX02
 *
 * Adversarial oracles for the WSTART diagnostic
 * packet. These oracles pin the orthogonal-channel
 * law:
 *
 *   process-lifecycle evidence     ≡  processExitObservation
 *                                    ∪ errorEventObserved
 *   stdio-output accounting        ≡  bootstrapOutputBoundary
 *
 * The two channels are NEVER collapsed. An output
 * boundary that resolves while the process is still
 * alive MUST NOT be promoted to lifecycle authority;
 * a process that exits while the output barrier is
 * still pending MUST NOT be hidden behind an
 * unresolved boundary.
 *
 * These oracles are deterministic — they use fake
 * handles and synthetic emission timing so they
 * execute even on hosts where the live witness
 * cannot be spawned (UDS path too long, kernel
 * denying SIGKILL, etc.).
 *
 * The crucial regression oracle is WDIAG04: an
 * output boundary that resolves while the process
 * remains alive MUST be classified as
 * `processExitObservation.kind !== "exit"`. The
 * previous conceptual model (which labeled the
 * post-boundary exitInfo as authoritative process
 * evidence) would have classified it incorrectly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  observeLifecycle,
  type DiagnosticPort,
  type ProcessExitObservation,
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
// WDIAG02 — error event asynchronously after the kill is
// observed as `errorEventObserved.seen === true` AND
// `processExitObservation.kind === "error"`. The fake
// fires the error on a `setImmediate`-after-microtask
// delay to PROVE the previous one-microtask window was
// unsound — the new code MUST keep the listener armed
// past microtask boundaries.
// ----------------------------------------------------------------------
test("WDIAG02: error asynchronously after kill → errorEventObserved.seen=true, processExitObservation={kind:'error'}", async () => {
  const fake = makeFakeHandle({ pid: 900_002 });
  setImmediate(() => {
    const err = Object.assign(new Error("EPERM: cannot kill"), {
      code: "EPERM",
    });
    fake.fireError(err);
  });
  const r = await observeLifecycle(fake.port, {
    processDeadlineMs: 500,
    outputDeadlineMs: 500,
  });
  assert.equal(r.errorEventObserved.seen, true,
    "WDIAG02: async error event MUST be observed; got " +
      JSON.stringify(r.errorEventObserved));
  if (r.errorEventObserved.seen) {
    assert.equal(r.errorEventObserved.code, "EPERM",
      "WDIAG02: error code must be EPERM");
  }
  assert.equal(r.processExitObservation.kind, "error",
    "WDIAG02: processExitObservation MUST be {kind:'error'} when error fires without exit; got " +
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
// NOT promoted to a kernel-rejection claim.
// ----------------------------------------------------------------------
test("WDIAG06: kill() returns false → signalRequestOutcome={kind:'returned_false'}, no EPERM claim", async () => {
  const fake = makeFakeHandle({ pid: 900_006, killReturns: false });
  const r = await observeLifecycle(fake.port, {
    processDeadlineMs: 100,
    outputDeadlineMs: 200,
  });
  assert.equal(r.signalRequestOutcome.kind, "returned_false",
    "WDIAG06: kill returning false MUST be {kind:'returned_false'}; got " +
      JSON.stringify(r.signalRequestOutcome));
  assert.equal(r.errorEventObserved.seen, false,
    "WDIAG06: a kill that returned false alone MUST NOT mint an error event");
  assert.notEqual(
    (r.processExitObservation as ProcessExitObservation).kind,
    "error",
    "WDIAG06: returned_false is not an error classification; got " +
      JSON.stringify(r.processExitObservation),
  );
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
