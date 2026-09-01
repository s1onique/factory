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
  UNINITIALISED_APPEND_COUNTING,
  type AppendCountingFn,
} from "./_live_cases.js";
import {
  registerWriterSpawn,
  sweepAndProve,
  liveFixtureRegistrySize,
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
    appendCounting: STRICT ? appendCounting : UNINITIALISED_APPEND_COUNTING,
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
  const failed = await sweepAndProve();
  counters.residue = failed.length + liveFixtureRegistrySize();
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
