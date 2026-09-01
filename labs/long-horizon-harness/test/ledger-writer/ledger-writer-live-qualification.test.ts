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

// ORACLE03 — durable fixture invariant (CORRECTION06).
//
// LWQ14 and LWQ15 each spawn a helper child, register
// it, then must NOT return until the child has
// actually closed. The contract is:
//
//   request termination → await 'close' → then return
//
// We verify the contract two ways:
//   (a) awaitChildClose resolves only after the
//       child's 'close' event has fired (or after
//       a defensive timeout — we cannot wait
//       forever for a runaway child).
//   (b) The lwq14/lwq15 case bodies call
//       awaitChildClose(c) before the case returns;
//       a static grep catches any revert.
test("ORACLE03: awaitChildClose waits for the child lifecycle boundary", async () => {
  const { spawn } = await import("node:child_process");
  // Spawn a trivial child that exits on its own.
  // We don't signal it (some sandboxes block
  // parent→child signaling); we just observe that
  // awaitChildClose resolves only after Node has
  // observed the child's natural exit. The contract
  // being proven is: awaitChildClose awaits the
  // lifecycle boundary it owns, period.
  const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 50)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  const start = Date.now();
  const { awaitChildClose } = await import("./_live_cases.js");
  await awaitChildClose(c, 3000);
  const elapsed = Date.now() - start;
  // After awaitChildClose returns, Node MUST have
  // observed the exit (the lifecycle boundary it
  // owns).
  assert.equal(
    c.exitCode !== null || c.signalCode !== null,
    true,
    `ORACLE03: child exit must be observed by Node before awaitChildClose resolves (elapsed=${elapsed}ms, exitCode=${c.exitCode}, signalCode=${c.signalCode})`,
  );
  // And the kernel must have reaped it. Allow a
  // one-tick retry window for hosts where 'close'
  // precedes the kernel reap by microseconds.
  let alive = true;
  try { process.kill(c.pid ?? -1, 0); } catch { alive = false; }
  if (alive) {
    await new Promise((r) => setImmediate(r));
    try { process.kill(c.pid ?? -1, 0); alive = true; } catch { alive = false; }
  }
  assert.equal(alive, false,
    `ORACLE03: kernel must reap the child after awaitChildClose resolves (pid=${c.pid}, elapsed=${elapsed}ms)`);
});

test("ORACLE03b: LWQ14 and LWQ15 case bodies call awaitChildClose before returning", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const src = await fs.promises.readFile(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), "_live_cases.ts"),
    "utf8",
  );
  // Slice the LWQ14 and LWQ15 case bodies. Each
  // must contain `await awaitChildClose(c)` AFTER
  // the `c.kill` call.
  const lwq14Start = src.indexOf("const LWQ14: LiveCase");
  const lwq15Start = src.indexOf("const LWQ15: LiveCase");
  const lwq14End = lwq15Start > 0 ? lwq15Start : src.length;
  const lwq15End = src.length;
  const lwq14 = src.slice(lwq14Start, lwq14End);
  const lwq15 = src.slice(lwq15Start, lwq15End);
  for (const [name, body] of [["LWQ14", lwq14], ["LWQ15", lwq15]] as const) {
    const killIdx = body.indexOf("c.kill(");
    const awaitIdx = body.indexOf("await awaitChildClose(");
    assert.ok(
      killIdx >= 0 && awaitIdx > killIdx,
      `ORACLE03b: ${name} must call 'await awaitChildClose(c)' AFTER 'c.kill(' (killIdx=${killIdx}, awaitIdx=${awaitIdx})`,
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
