/**
 * ledger-writer-live-qualification.test.ts
 * (B0-QUALIFICATION06)
 *
 * Strict LedgerWriter live qualification oracle.
 *
 * Two lanes:
 *   - ordinary: cases that require a UDS-spawnable
 *     capability BLOCKED_BY_ENVIRONMENT skip honestly.
 *   - strict (FACTORY_STRICT_LEDGER_WRITER_LIVE=1):
 *     tests MUST all execute and pass. SKIPPED > 0,
 *     FAILED > 0, or RESIDUE > 0 fail the suite.
 *
 * Invoked via `npm run qualify:ledger-writer-live`
 * with `FACTORY_QUALIFICATION_SUBJECT_COMMIT=<40 hex>`
 * exported so the operator can pin the SHA.
 *
 * The matrix is maintained as a single array in
 * `_live_cases.ts`. Tests are registered from that
 * array. QLW* tests are pure-function tests of the
 * `qualifies()` classifier — they do not touch
 * process state.
 *
 * B0-QUALIFICATION06 evidence-lifetime contract:
 *
 *   - WriterHandle.stop() kills + reaps the child
 *     ONLY; it never touches the runDir.
 *   - Each case reads evidence BEFORE invoking
 *     ctx.destroyRun(tmp).
 *   - Strict sole-authority law (LWQ08): a second
 *     LedgerWriter MUST NOT reach readiness against a
 *     runDir already owned by a live writer. Boot
 *     rejection is the contract — a returned
 *     WriterHandle is immediate FAIL regardless of
 *     subsequent append behavior.
 *   - Negative-delta evidence: LWQ08 establishes a
 *     known W1 baseline first; the durable state is
 *     then asserted to contain ONLY that baseline.
 *   - Missing-evidence is FAIL: ENOENT on a required
 *     durable artefact is not interpreted as "zero
 *     records".
 *   - destroyRunDir throws on failure so residue
 *     accounting cannot be silently bypassed.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  startWriterInTmpDir,
  type WriterHandle,
} from "./_writer_helper.js";
import {
  LEDGER_WRITER_LIVE_CASES,
  type LiveCaseCtx,
  type AppendCountingFn,
} from "./_live_cases.js";
import {
  registerWriterSpawn,
  sweepAndProve,
  destroyRunDir,
} from "./_live_registry.js";

const STRICT = process.env.FACTORY_STRICT_LEDGER_WRITER_LIVE === "1";
const EXPECTED_SHA = process.env.FACTORY_QUALIFICATION_SUBJECT_COMMIT ?? "";
const OBSERVED_SHA = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "<unable-to-resolve>";
  }
})();

// --------------------------------------------------------------------
// Capability probe (synchronous path-length check)
// --------------------------------------------------------------------

function tmpBase(): string {
  return process.env["TMPDIR"] ?? path.join(process.cwd(), ".lw-live");
}

function detectSpawnableBind(): boolean {
  const probeSock = `${tmpBase()}/.lws-probe1234/s`;
  return Buffer.byteLength(probeSock, "utf8") <= 100;
}

const SPAWNABLE = detectSpawnableBind();

// --------------------------------------------------------------------
// Counters + classification function
// --------------------------------------------------------------------

type MatrixCounters = {
  required: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  residue: number;
};

const counters: MatrixCounters = {
  required: LEDGER_WRITER_LIVE_CASES.length,
  executed: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  residue: 0,
};

function classifyCounters(c: MatrixCounters): {
  readonly ok: boolean;
  readonly reasons: ReadonlyArray<string>;
} {
  const reasons: string[] = [];
  if (c.executed !== c.required) {
    reasons.push(`executed=${c.executed} != required=${c.required}`);
  }
  if (c.passed !== c.required) {
    reasons.push(`passed=${c.passed} != required=${c.required}`);
  }
  if (c.failed !== 0) reasons.push(`failed=${c.failed} > 0`);
  if (c.skipped !== 0) reasons.push(`skipped=${c.skipped} > 0`);
  if (c.residue !== 0) reasons.push(`residue=${c.residue} > 0`);
  return { ok: reasons.length === 0, reasons };
}

function qualifies(c: MatrixCounters, strict: boolean): {
  readonly ok: boolean;
  readonly reasons: ReadonlyArray<string>;
} {
  const base = classifyCounters(c);
  const reasons = base.reasons.slice();
  if (strict && !SPAWNABLE) reasons.push("capability (UDS-spawnable) unavailable");
  if (strict && EXPECTED_SHA.length > 0 && EXPECTED_SHA !== OBSERVED_SHA) {
    reasons.push(`expected SHA ${EXPECTED_SHA} != observed SHA ${OBSERVED_SHA}`);
  }
  return { ok: reasons.length === 0, reasons };
}

function emitMatrix(): void {
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_SUBJECT_COMMIT=${OBSERVED_SHA}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_EXPECTED_COMMIT=${EXPECTED_SHA}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_STRICT=${STRICT ? "1" : "0"}`);
  // eslint-disable-next-line no-console
  console.log(`QUALIFICATION_TMP_BASE=${tmpBase()}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_LIVE_REQUIRED=${counters.required}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_LIVE_EXECUTED=${counters.executed}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_LIVE_PASSED=${counters.passed}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_LIVE_FAILED=${counters.failed}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_LIVE_SKIPPED=${counters.skipped}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_LIVE_RESIDUE=${counters.residue}`);
}

emitMatrix();

// --------------------------------------------------------------------
// Test context
// --------------------------------------------------------------------

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(tmpBase(), `.lwq-${prefix}-`));
}

async function bootHandle(tmp: string): Promise<WriterHandle> {
  const h = await startWriterInTmpDir(tmp);
  registerWriterSpawn({
    child: h.child,
    runDir: h.runDir,
    socketPath: h.socketPath,
  });
  return h;
}

/**
 * (B0-QUALIFICATION04) Explicit fixture lifecycle:
 *
 *   bootHandle()         — start writer, register fixtures
 *   h.stop()              — kill + reap child ONLY
 *   ctx.destroyRun()      — explicit runDir cleanup (proves
 *                          absence, unregisters fixture,
 *                          throws on failure so residue is
 *                          not silently bypassed)
 *
 * Previously `WriterHandle.stop()` was wrapped to also
 * `fs.rm(runDir)` — that destroyed evidence before the
 * case finished reading it. The strict oracle now
 * exposes two separate operations and disallows
 * implicit runDir destruction on writer stop.
 */

const appendCounting: AppendCountingFn = async (h, args) => {
  // (B0-QUALIFICATION03) The wrapper used to return
  // `{result, wireAttempts:1}` — that was a constant,
  // not instrumentation. We delegate to the production
  // append client and return only the result.
  return await h.append({
    commitId: args.commitId,
    event: args.event,
    ...(args.clientContentHash !== undefined
      ? { clientContentHash: args.clientContentHash }
      : {}),
  });
};

const destroyRun = async (runDir: string): Promise<void> => {
  await destroyRunDir(runDir);
};

const trackRun = (_runDir: string): void => {
  // Reserved for cases that prefer after-suite cleanup.
  // The default qualification lane already registers
  // the runDir via bootHandle → registerWriterSpawn,
  // so no extra call is needed there. This stub keeps
  // the ctx API symmetric.
};

function makeCtx(): LiveCaseCtx {
  return {
    strict: STRICT,
    spawnable: SPAWNABLE,
    mkTmp,
    bootHandle,
    destroyRun,
    trackRun,
    // CORRECTION05: the qualification ctx always
    // delegates to the production append path. The
    // previous `STRICT ? appendCounting : UNINITIALISED_...`
    // routed the qualifying matrix through a sentinel
    // stub that returned
    //   {ok:false, error:{kind:"writer_busy", message:"uninitialised"}}.
    // That sentinel escaped into the production-shaped
    // Result and produced the LWQ02..LWQ11 failure
    // pattern (every case that exercised an append
    // failed identically with the same error).
    //
    // UNINITIALISED_APPEND_COUNTING is retained ONLY as
    // a structural anti-regression guard (see ORACLE02
    // below). It MUST NOT be wired into a ctx.
    appendCounting,
  };
}

// --------------------------------------------------------------------
// CAP01 + SHA binding tests
// --------------------------------------------------------------------

test("CAP01 capability probe (UDS-spawnable, path-length check)", () => {
  assert.equal(typeof SPAWNABLE, "boolean");
});

test("SUBJECT_SHA binding: FACTORY_QUALIFICATION_SUBJECT_COMMIT must equal HEAD when set", () => {
  if (EXPECTED_SHA.length > 0) {
    assert.equal(OBSERVED_SHA, EXPECTED_SHA,
      `expected SHA ${EXPECTED_SHA} != observed SHA ${OBSERVED_SHA}`);
  } else {
    assert.match(OBSERVED_SHA, /^[0-9a-f]{40}$|^<unable-to-resolve>$/);
  }
});

// ----------------------------------------------------------------
// CORRECTION05 anti-regression guards.
//
// These two tests fail closed if anyone re-wires the
// qualification ctx to the UNINITIALISED_APPEND_COUNTING
// sentinel, OR if anyone reintroduces a synthetic
// LedgerWriterAppendError with the literal "uninitialised"
// message into the qualification lane.
//
// ORACLE01 — the ctx we ship delegates to production.
// ORACLE02 — the source does not contain the
//            "uninitialised" sentinel.
// ----------------------------------------------------------------

test("ORACLE01: qualification ctx.appendCounting delegates to production append", () => {
  // We cannot easily run a real append here (would
  // need a live UDS-spawnable host). Instead we
  // verify that the ctx's appendCounting is the
  // local `appendCounting` closure, NOT
  // UNINITIALISED_APPEND_COUNTING. This locks in
  // the structural property "ctx wired to the real
  // adapter".
  const ctx = makeCtx();
  assert.equal(
    ctx.appendCounting,
    appendCounting,
    "ORACLE01: ctx.appendCounting MUST be the production-delegating adapter, NOT the uninitialised sentinel",
  );
  // The sentinel's signature is identical (returns
  // Promise<Result>) — only the implementation
  // differs. To distinguish them at runtime, we
  // could call each with a synthetic handle and
  // check the SHAPE of the failure message. We
  // skip that here: ORACLE02 (source-grep) catches
  // any reintroduction of the sentinel into the
  // qualifying matrix's wiring path.
});

test("ORACLE02: qualification source must not contain the 'uninitialised' sentinel", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const src = await fs.promises.readFile(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), "_live_cases.ts"),
    "utf8",
  );
  // The sentinel string MUST only appear inside the
  // UNINITIALISED_APPEND_COUNTING stub definition.
  // It MUST NOT appear inside any wiring that would
  // feed the qualifying matrix.
  const occurrences = (src.match(/uninitialised/g) ?? []).length;
  // The stub defines the literal string ONCE in
  // its returned error message. We allow exactly
  // ONE occurrence (the stub itself). Anything
  // more means the sentinel is being propagated
  // somewhere else.
  assert.ok(
    occurrences === 1,
    `ORACLE02: 'uninitialised' must appear exactly once (in the stub); got ${occurrences}`,
  );
  // Belt-and-braces: confirm the wiring site in
  // THIS file does not WIRE the sentinel into a
  // ctx. The symbol name `UNINITIALISED_APPEND_COUNTING`
  // is allowed ONLY in `import { ... }` lines (for
  // documentation/re-export purposes) and in
  // comment lines. Any other reference is a wiring
  // violation.
  const wiringSrc = await fs.promises.readFile(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), "ledger-writer-live-qualification.test.ts"),
    "utf8",
  );
  const lines = wiringSrc.split("\n");
  let inImportBlock = false;
  let inOracle02 = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Locate the ORACLE02 test body so we can
    // exclude it from the structural scan
    // (the test name itself appears in comments
    // inside its own body — that is structural
    // intent, not a wiring violation).
    if (/^\s*test\(\s*["']ORACLE02/.test(line)) {
      inOracle02 = true;
    }
    if (/UNINITIALISED_APPEND_COUNTING/.test(line)) {
      const isImportBlock = inImportBlock || /^import\b/.test(line.trim());
      const isComment = /^\s*\/\//.test(line) || /^\s*\*/.test(line);
      const isDocReference = /ORACLE02|UNINITIALISED_APPEND_COUNTING stub|structural anti-regression|UNINITIALISED_APPEND_COUNTING is retained ONLY/.test(line);
      assert.ok(
        isImportBlock || isComment || isDocReference || inOracle02,
        `ORACLE02: UNINITIALISED_APPEND_COUNTING must not be wired into a ctx (line ${i + 1}: ${line.trim()})`,
      );
    }
    if (/^import\b/.test(line.trim())) {
      inImportBlock = true;
      // Closing brace ends the import block.
      if (/}\s*from/.test(line)) inImportBlock = false;
    } else if (inImportBlock && /^\s*}\s*from/.test(line)) {
      inImportBlock = false;
    }
    // Closing brace + paren at column 0 ends the test.
    if (/^\}\);?\s*$/.test(line)) {
      inOracle02 = false;
    }
  }
});

// ORACLE03 — durable fixture invariant (CORRECTION07).
//
// LWQ14 and LWQ15 each spawn a helper child, register
// it, then must NOT return until the child has
// actually closed. The contract is:
//
//   arm observers → request termination
//   → await 'close' boundary
//   → on 'close' → success
//   → on 'error' before 'close' → failure
//   → on deadline expiry → failure
//   → only then return
//
// We verify the contract with FOUR runtime oracles
// (positive + three negative paths) so a lie in any
// one direction fails the suite:
//
//   ORACLE03a: close observed → resolves
//   ORACLE03b: no close before deadline → rejects
//   ORACLE03c: error before close → rejects
//   ORACLE03d: listener armed before termination
//              → fast child cannot lose close event
//
// Plus a static source-grep guard so the case
// bodies cannot revert to the bad pattern.

const liveCasesModule = "./_live_cases.js";

/**
 * Cleanup-only wrapper for ORACLE03 negative
 * paths. The test body has already asserted the
 * negative contract (rejection). The cleanup MUST
 * still observe the actual 'close' boundary
 * rather than naked-kill, because the doctrine
 * forbids a fixture that itself violates the
 * doctrine it is asserting.
 *
 * Sequence:
 *   1. Try the atomic primitive (signal + wait).
 *      If it succeeds, we're done.
 *   2. If it throws (kill EPERM on a sandboxed
 *      host, kill returns false, or kill threw),
 *      fall back to: best-effort raw kill() +
 *      awaitChildClose() to still OBSERVE the
 *      boundary even when the atomic primitive
 *      itself is broken.
 *   3. Any residual rejection is swallowed
 *      (the test body already proved the
 *      negative path; cleanup is best-effort).
 */
async function terminateHelperAndAwaitCloseSilent(
  child: import("node:child_process").ChildProcess,
  timeoutMs = 2000,
): Promise<void> {
  const mod = await import(liveCasesModule);
  const exited = (child.exitCode !== null && child.exitCode !== undefined) ||
                 (child.signalCode !== null && child.signalCode !== undefined);
  // First try the atomic primitive.
  try {
    if (exited) {
      await mod.awaitChildClose(child, timeoutMs);
      return;
    }
    await mod.terminateHelperAndAwaitClose(child, timeoutMs);
    return;
  } catch {
    // Fall through to fallback.
  }
  // Fallback: best-effort raw kill + observe
  // close boundary. This obeys the doctrine:
  // we still observe 'close' before returning;
  // we just don't require the atomic primitive
  // to succeed (it may be broken in this
  // negative-path test).
  try { child.kill("SIGKILL"); } catch { /* */ }
  try {
    await mod.awaitChildClose(child, timeoutMs);
  } catch {
    // Best-effort. The test body already
    // proved the negative contract.
  }
}

// (a) Positive: natural-exit child → resolves on
//     the actual 'close' boundary (the ONLY path
//     that constructs `{kind:"closed"}`).
test("ORACLE03a: awaitChildClose resolves on natural 'close'", async () => {
  const { spawn } = await import("node:child_process");
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const { awaitChildClose } = await import(liveCasesModule);
  const r = await awaitChildClose(c, 3000);
  assert.equal(r.kind, "closed");
  // The kernel must have reaped the pid. Allow one
  // tick of slack for hosts where 'close' precedes
  // the kernel reap by microseconds.
  let alive = true;
  try { process.kill(c.pid ?? -1, 0); } catch { alive = false; }
  if (alive) {
    await new Promise((res) => setImmediate(res));
    try { process.kill(c.pid ?? -1, 0); alive = true; } catch { alive = false; }
  }
  assert.equal(alive, false,
    "ORACLE03a: kernel must reap the child after awaitChildClose resolves");
});

// (b) Negative: an unresponsive child → REJECT on
//     deadline. We spawn a sleeper longer than
//     the deadline and assert the deadline
//     rejects. The child is then cleaned up by
//     the doctrine-observant helper.
test("ORACLE03b: awaitChildClose rejects when deadline expires", async () => {
  const { spawn } = await import("node:child_process");
  // 5s sleep > 250 ms deadline. (60s was too
  // long: the cleanup path could not observe
  // close before the test runner exits.)
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const { awaitChildClose } = await import(liveCasesModule);
  let rejected = false;
  let msg = "";
  try {
    await awaitChildClose(c, 250);
  } catch (e: unknown) {
    rejected = true;
    msg = e instanceof Error ? e.message : String(e);
  }
  // Cleanup: observe the actual 'close' boundary
  // of our 60s sleeper so we do not violate the
  // same doctrine the test is asserting.
  await terminateHelperAndAwaitCloseSilent(c);
  assert.equal(rejected, true,
    "ORACLE03b: awaitChildClose MUST reject on deadline expiry; a deadline that means success lies about a boundary the fixture did not observe");
  assert.ok(/deadline \d+ms expired/.test(msg),
    `ORACLE03b: rejection message must mention the deadline (got: ${msg})`);
});

// (c) Negative: an 'error' event with no 'close' →
//     REJECT. We synthesise by emitting 'error' on
//     the ChildProcess (Node treats this as an
//     async lifecycle event).
test("ORACLE03c: awaitChildClose rejects on 'error' before 'close'", async () => {
  const { spawn } = await import("node:child_process");
  // Short-sleeping child; we synthesise an
  // 'error' event before any 'close' can fire,
  // then the cleanup helper waits for the
  // child to exit on its own.
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 200)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const { awaitChildClose } = await import(liveCasesModule);
  const p = awaitChildClose(c, 5000);
  // Emit an 'error' WITHOUT emitting 'close'.
  c.emit("error", new Error("synthesized test failure"));
  let rejected = false;
  let msg = "";
  try { await p; } catch (e: unknown) {
    rejected = true;
    msg = e instanceof Error ? e.message : String(e);
  }
  // Cleanup: observe the actual 'close' boundary
  // — the doctrine forbids naked kill+return.
  await terminateHelperAndAwaitCloseSilent(c);
  assert.equal(rejected, true,
    "ORACLE03c: awaitChildClose MUST reject on 'error' before 'close'; 'error' is not equivalent to 'close'");
  assert.ok(/'error' before 'close'/.test(msg),
    `ORACLE03c: rejection message must mention the 'error' boundary (got: ${msg})`);
});

// (d) Boundary truthfulness: awaitChildClose MUST
//     wait for the actual 'close' event, not
//     synthesise `{kind:"closed"}` from cached
//     exitCode/signalCode. We spawn a child that
//     exits naturally in ~150 ms with a specific
//     exit code, and assert that awaitChildClose
//     takes >= 100 ms (i.e. waited for the
//     boundary) and returns the actual exit
//     code. A fast-path synthesis would resolve
//     in <1 ms.
test("ORACLE03d: awaitChildClose observes the real 'close' boundary (not synthesized)", async () => {
  const { spawn } = await import("node:child_process");
  const c = spawn(process.execPath, ["-e", "setTimeout(() => { process.exit(42); }, 150)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const { awaitChildClose } = await import(liveCasesModule);
  const t0 = Date.now();
  const r = await awaitChildClose(c, 5000);
  const elapsed = Date.now() - t0;
  assert.equal(r.kind, "closed",
    "ORACLE03d: awaitChildClose must return a typed result via the real 'close' boundary");
  assert.equal(r.code, 42,
    `ORACLE03d: typed result must carry the actual child exit code (got code=${r.code}, signal=${r.signal})`);
  assert.ok(elapsed >= 100,
    `ORACLE03d: elapsed time MUST be >= 100 ms to prove the real 'close' was awaited (got ${elapsed}ms; a sub-1ms resolve would imply a synthesised closed)`);
});

// (f) kill() returns false → REJECT the SAME
//     promise, NO orphan Promise, NO listener
//     leak. We synthesise a "kill returns false"
//     child by overriding the `.kill` method on
//     the ChildProcess instance.
test("ORACLE03f: terminateHelperAndAwaitClose rejects when kill() returns false and leaves no orphan Promise", async () => {
  const { spawn } = await import("node:child_process");
  // Long-lived child but with a graceful exit
  // so cleanup doesn't hang waiting for an
  // infinite process.
  const c = spawn(process.execPath, ["-e", "setTimeout(() => { process.exit(0); }, 2000)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  // Override kill to simulate OS refusal (e.g.
  // signal already accepted, or EPERM). Save
  // the original so the cleanup can still
  // actually kill the child.
  const originalKill = c.kill.bind(c);
  (c as { kill: (sig?: NodeJS.Signals | number) => boolean }).kill = () => false;
  const { terminateHelperAndAwaitClose } = await import(liveCasesModule);
  // Hook unhandledRejection for this tick so we
  // can prove no orphan surfaces.
  let unhandled: Error | null = null;
  const onUnhandled = (e: unknown): void => {
    if (e instanceof Error) unhandled = e;
  };
  process.on("unhandledRejection", onUnhandled);
  let rejected = false;
  let msg = "";
  try {
    await terminateHelperAndAwaitClose(c, 5000);
  } catch (e: unknown) {
    rejected = true;
    msg = e instanceof Error ? e.message : String(e);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    // Restore the real kill() so cleanup can
    // actually terminate the live child.
    (c as { kill: (sig?: NodeJS.Signals | number) => boolean }).kill = originalKill;
    // Observe its real close so we do not leak it.
    await terminateHelperAndAwaitCloseSilent(c);
  }
  assert.equal(rejected, true,
    "ORACLE03f: terminateHelperAndAwaitClose MUST reject when kill() returns false");
  assert.ok(/kill\(\) returned false/.test(msg),
    `ORACLE03f: rejection must mention the kill failure (got: ${msg})`);
  // Type assertion: assert.equal narrows
  // `unhandled` to null after the equality
  // succeeds. We re-fetch it via the captured
  // reference at assertion time using a string
  // coercion that defeats narrowing.
  const f_unhandled = unhandled as unknown;
  assert.ok(f_unhandled === null,
    `ORACLE03f: kill failure MUST NOT orphan the observer (unhandledRejection fired: ${f_unhandled instanceof Error ? f_unhandled.message : String(f_unhandled)})`);
});

// (g) kill() throws → REJECT the SAME promise,
//     NO orphan Promise.
test("ORACLE03g: terminateHelperAndAwaitClose rejects when kill() throws and leaves no orphan Promise", async () => {
  const { spawn } = await import("node:child_process");
  // Long-lived child but with a graceful exit
  // so cleanup doesn't hang waiting for an
  // infinite process.
  const c = spawn(process.execPath, ["-e", "setTimeout(() => { process.exit(0); }, 2000)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  // Override kill to simulate a synchronous
  // throw (e.g. EPERM from libuv translated).
  // Save the original so cleanup can still
  // actually kill the child.
  const originalKill = c.kill.bind(c);
  (c as { kill: (sig?: NodeJS.Signals | number) => boolean }).kill = () => {
    throw new Error("synthesized kill throw");
  };
  const { terminateHelperAndAwaitClose } = await import(liveCasesModule);
  let unhandled: Error | null = null;
  const onUnhandled = (e: unknown): void => {
    if (e instanceof Error) unhandled = e;
  };
  process.on("unhandledRejection", onUnhandled);
  let rejected = false;
  let msg = "";
  try {
    await terminateHelperAndAwaitClose(c, 5000);
  } catch (e: unknown) {
    rejected = true;
    msg = e instanceof Error ? e.message : String(e);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    // Restore real kill() so cleanup can
    // terminate the live child.
    (c as { kill: (sig?: NodeJS.Signals | number) => boolean }).kill = originalKill;
    await terminateHelperAndAwaitCloseSilent(c);
  }
  assert.equal(rejected, true,
    "ORACLE03g: terminateHelperAndAwaitClose MUST reject when kill() throws");
  assert.ok(/kill\(\) threw/.test(msg),
    `ORACLE03g: rejection must mention the kill throw (got: ${msg})`);
  const g_unhandled = unhandled as unknown;
  assert.ok(g_unhandled === null,
    `ORACLE03g: kill throw MUST NOT orphan the observer (unhandledRejection fired: ${g_unhandled instanceof Error ? g_unhandled.message : String(g_unhandled)})`);
});

// (h) terminateHelperAndAwaitClose: live child
//     → kill (mocked to succeed) → observe real
//     'close'. This proves the arm-then-kill
//     ordering on hosts that permit kill: the
//     call returns a typed result via the real
//     boundary, not a synthesised one.
test("ORACLE03h: terminateHelperAndAwaitClose arms listeners, runs kill, observes real 'close'", async () => {
  const { spawn } = await import("node:child_process");
  // The child exits naturally with code 42
  // after 150 ms. We mock kill() to succeed
  // (return true) so the production code goes
  // through the arm-then-kill path. On this
  // sandbox, the real kill() would throw EPERM
  // — we deliberately side-step that to test
  // the positive contract.
  const c = spawn(process.execPath, ["-e", "setTimeout(() => { process.exit(42); }, 150)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  (c as { kill: (sig?: NodeJS.Signals | number) => boolean }).kill = () => true;
  const { terminateHelperAndAwaitClose } = await import(liveCasesModule);
  const r = await terminateHelperAndAwaitClose(c, 5000);
  assert.equal(r.kind, "closed",
    "ORACLE03h: terminateHelperAndAwaitClose must return a typed result via the real 'close' boundary");
  assert.equal(r.code, 42,
    `ORACLE03h: typed result must carry the actual child exit code (got code=${r.code}, signal=${r.signal})`);
});

// (e) Static guard: the LWQ14/LWQ15 case bodies
//     call terminateHelperAndAwaitClose, NOT a
//     bare kill followed by an unguarded await.
test("ORACLE03e: LWQ14 and LWQ15 case bodies use terminateHelperAndAwaitClose", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const src = await fs.promises.readFile(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), "_live_cases.ts"),
    "utf8",
  );
  const lwq14Start = src.indexOf("const LWQ14: LiveCase");
  const lwq15Start = src.indexOf("const LWQ15: LiveCase");
  assert.ok(lwq14Start > 0, "ORACLE03e: LWQ14 case must exist");
  assert.ok(lwq15Start > 0, "ORACLE03e: LWQ15 case must exist");
  const lwq14 = src.slice(lwq14Start, lwq15Start);
  const lwq15 = src.slice(lwq15Start);
  for (const [name, body] of [["LWQ14", lwq14], ["LWQ15", lwq15]] as const) {
    assert.equal(
      /terminateHelperAndAwaitClose\(/.test(body),
      true,
      `ORACLE03e: ${name} must call 'terminateHelperAndAwaitClose('`,
    );
    // The old `try { c.kill(...); } catch { }`
    // swallowed-kill anti-pattern must not return.
    // That pattern would let a kill() EPERM go
    // unreported.
    assert.equal(
      /try\s*\{\s*c\.kill\([^)]*\)\s*;\s*\}\s*catch\s*\{[^}]*\}/.test(body),
      false,
      `ORACLE03e: ${name} must NOT contain the 'swallowed kill' anti-pattern`,
    );
  }
});

// --------------------------------------------------------------------
// Live case registration — one test per LWQ case.
// --------------------------------------------------------------------

function live(name: string, body: () => Promise<void>): void {
  test(name, async (t) => {
    if (!SPAWNABLE) {
      counters.executed += 1;
      if (STRICT) {
        counters.failed += 1;
        throw new Error("strict lane: UDS-spawnable capability unavailable");
      }
      counters.skipped += 1;
      t.skip("BLOCKED_BY_ENVIRONMENT: UDS-spawnable capability unavailable");
      return;
    }
    counters.executed += 1;
    try {
      await body();
      counters.passed += 1;
    } catch (e) {
      counters.failed += 1;
      throw e;
    }
  });
}

for (const c of LEDGER_WRITER_LIVE_CASES) {
  live(`${c.id} ${c.title}`, async () => {
    await c.run(makeCtx());
  });
}

// --------------------------------------------------------------------
// Post-suite residue sweep + matrix invariants
// --------------------------------------------------------------------

after(async () => {
  // CORRECTION04: single-source residue count.
  // `sweepAndProve()` returns the set of fixtures
  // that could NOT be proven absent; it ALSO leaves
  // them in the registry (so the strict lane fails
  // closed). Therefore:
  //
  //   failed.length === liveFixtureRegistrySize()
  //
  // (every unproven entry is BOTH retained in the
  // registry AND in the residue list). Using
  // `failed.length + liveFixtureRegistrySize()`
  // would double-count — that is exactly the bug
  // the reviewer flagged at RESIDUE=28 (which was
  // 14+14, the same 14 denied children counted
  // twice).
  //
  // We use ONE source: `failed.length`. The other
  // (`liveFixtureRegistrySize()`) is documented here
  // for completeness but MUST NOT be added back.
  //
  // CORRECTION04 also: the residue oracle is now
  // observation-only (no SIGTERM/SIGKILL inside the
  // sweep). The residue breakdown will reflect
  // whatever the capability-owning test site left
  // behind — typically `permission_denied` on hosts
  // that block signal delivery, or `pid_absent`
  // elsewhere.
  const failed = await sweepAndProve();
  counters.residue = failed.length;
  // CORRECTION02: emit a typed breakdown of residue
  // observations so the operator can classify the
  // remaining failures (env denial vs. ownership
  // defect) instead of seeing one opaque count.
  const breakdown: Record<string, number> = {};
  for (const e of failed) {
    const obs = (e as { observation?: string }).observation ?? "unknown";
    breakdown[obs] = (breakdown[obs] ?? 0) + 1;
  }
  emitMatrix();
  if (Object.keys(breakdown).length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `LEDGER_WRITER_RESIDUE_BREAKDOWN=${JSON.stringify(breakdown)}`,
    );
    // CORRECTION06: identity emitter — print the
    // actual residue entries (kind, pid, note,
    // observation, path) so the operator can tell
    // whether the surviving entry is a writer child
    // from a previous case or a helper child that
    // has not yet finished kernel teardown. This is
    // a diagnostic; it does NOT change behavior.
    // eslint-disable-next-line no-console
    console.log(
      `LEDGER_WRITER_RESIDUE_ENTRIES=${JSON.stringify(
        failed.map((e) => ({
          kind: e.kind,
          pid: e.pid,
          note: e.note,
          path: e.path,
          observation: (e as { observation?: string }).observation ?? null,
        })),
      )}`,
    );
  }
  const r = qualifies(counters, STRICT);
  if (!r.ok) {
    const msg = `LEDGER_WRITER_QUALIFICATION_DISPOSITION=FAIL: ${r.reasons.join("; ")}`;
    // eslint-disable-next-line no-console
    console.log(msg);
    if (STRICT) throw new Error(msg);
  } else {
    // eslint-disable-next-line no-console
    console.log(`LEDGER_WRITER_QUALIFICATION_DISPOSITION=OK`);
  }
});

// --------------------------------------------------------------------
// QLW01..QLW06 — pure-function tests of `qualifies()`.
// --------------------------------------------------------------------

const ZERO_COUNTERS: MatrixCounters = {
  required: 15,
  executed: 15,
  passed: 15,
  failed: 0,
  skipped: 0,
  residue: 0,
};

test("QLW01 classifier: exact success → qualifies=true", () => {
  const r = classifyCounters(ZERO_COUNTERS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});

test("QLW02 classifier: skipped>0 → qualifies=false", () => {
  const c: MatrixCounters = { ...ZERO_COUNTERS, skipped: 1 };
  const r = classifyCounters(c);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((s) => s.includes("skipped")));
});

test("QLW03 classifier: failed>0 → qualifies=false", () => {
  const c: MatrixCounters = { ...ZERO_COUNTERS, failed: 1 };
  const r = classifyCounters(c);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((s) => s.includes("failed")));
});

test("QLW04 classifier: executed<required → qualifies=false", () => {
  const c: MatrixCounters = { ...ZERO_COUNTERS, executed: 14, passed: 14 };
  const r = classifyCounters(c);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((s) => s.includes("executed")));
});

test("QLW05 classifier: residue>0 → qualifies=false", () => {
  const c: MatrixCounters = { ...ZERO_COUNTERS, residue: 1 };
  const r = classifyCounters(c);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((s) => s.includes("residue")));
});

test("QLW06 matrix drift: REQUIRED === LEDGER_WRITER_LIVE_CASES.length", () => {
  assert.equal(LEDGER_WRITER_LIVE_CASES.length, counters.required);
  assert.equal(counters.required, 15,
    "matrix size must be 15 cases (LWQ01..LWQ15)");
});
