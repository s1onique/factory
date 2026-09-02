/**
 * CORRECTION18 — Adversarial tests for the SEQ05
 * load-admission pacing adapter.
 *
 * Supersedes CORRECTION17's AP01-AP10 oracle matrix.
 * CORRECTION18 fixes the asymmetric semantic hole:
 * "reaching canonical" was treated as sufficient for
 * "rescued" but the canonical RPC can fail independently
 * because the pacing probe socket is destroyed before
 * the canonical connection is opened. Therefore:
 *
 *   pacing_rescued_calls =
 *     probe_refused>0 ∧ canonical_invoked>0 ∧ result.ok===true
 *
 * Reached canonical but failed ⇒ canonical_failed_after_pacing_calls
 * (NOT rescued).
 *
 * AP01 + AP09 are tightened to bind their
 * `pacing_rescued_calls` derivation to `r.ok === true`.
 * AP11 (NEW) drives the cross-product:
 *   refusal → probe success → canonical failure
 * and asserts that pacing_rescued_calls stays 0.
 *
 * Oracle matrix (each one asserts a property the
 * implementation actually has, not a property the
 * documentation wishes it had):
 *
 *   AP01  ECONNREFUSED ×3 → probe success → exactly one
 *         canonical append invocation with the SAME args.
 *         (Pacing does not change the canonical client's
 *         view of the operation.) Also: observation
 *         stream records the per-iteration
 *         [probe_attempted, probe_refused] sequence
 *         followed by a final probe_attempted +
 *         canonical_invoked for the successful probe.
 *         The successful call is
 *         `pacing_rescued_calls=1`
 *         (probe_refused>0 ∧ canonical_invoked>0 ∧
 *          result.ok===true).
 *   AP02  Canonical append returns protocol_error → exactly
 *         ONE canonical append; no reprobe. Observation
 *         stream records [probe_attempted, canonical_invoked].
 *   AP03  Canonical append returns connect_failed → exactly
 *         ONE canonical append; adapter does NOT
 *         reinterpret/retry it. Observation stream records
 *         exactly one canonical_invoked.
 *   AP04  Socket missing → zero probe, zero append.
 *         Observation stream is EMPTY (lstat failure is
 *         not a probe attempt).
 *   AP05  Pacing budget exhausted → zero canonical append;
 *         observation stream records
 *         [probe_attempted+probe_refused × 32,
 *          probe_budget_exhausted]. NO canonical_invoked.
 *         pacing_rescued_calls=0, pacing_exhausted_calls=1.
 *   AP06  Exact deterministic delay sequence: assert
 *         sleepFn was called with [5,5,5,...] (constant).
 *         Proves from VALUES, not from wallclock.
 *   AP07  Errno classification uses Error.code; a
 *         non-pacing-recoverable code (ENOTRECOVERABLE)
 *         is surfaced on the first probe regardless of
 *         message prose. Observation stream records
 *         [probe_attempted, probe_nonrecoverable] and
 *         NO canonical_invoked. pacing_rescued_calls=0.
 *   AP08  Pacing-recoverable set is narrow: only
 *         ECONNREFUSED. ECONNRESET/EPIPE/EAGAIN are NOT
 *         pacing-recoverable.
 *   AP09  Typed observation contract (probe-level
 *         arithmetic): the adapter's onObservation seam
 *         emits the expected sequence of
 *         `AdmissionPacingObservation` events for each
 *         scenario above. The adapter MUST classify via
 *         typed events; the test harness MUST NOT
 *         inspect Error.message.
 *   AP10  (CORRECTION17) Algebra separation: budget
 *         exhaustion MUST NOT mint rescue evidence. With
 *         32× ECONNREFUSED, the adapter emits 32 probe_refused
 *         events + 1 probe_budget_exhausted; derived call-
 *         level: pacing_rescued_calls=0, canonical_invoked=0.
 *         The CORRECTION16 violation was that
 *         pacing_rescued was conflated with probe_refused.
 *         AP10 pins the corrected algebra.
 *   AP11  (NEW CORRECTION18) Result-bound rescue:
 *         reaching canonical is necessary but NOT
 *         sufficient for rescue. Cross-product scenario:
 *           probe 0 = ECONNREFUSED
 *           probe 1 = success
 *           appendFn returns connect_failed
 *         The pacing probe socket was destroyed before
 *         the canonical RPC. The canonical connection
 *         independently failed. The call was NOT rescued.
 *         Asserts:
 *           probe_refused_total = 1
 *           canonical_invoked_total = 1
 *           final_result.ok = false
 *           pacing_rescued_calls = 0
 *           canonical_failed_after_pacing_calls = 1
 *         Without CORRECTION18, CORRECTION17 would have
 *         counted this as a rescue (probe_refused>0 ∧
 *         canonical_invoked>0); that was the semantic
 *         hole the expert flagged.
 *
 * The harness uses the adapter's injectable seams
 * (`probeFn`, `appendFn`, `sleepFn`, `onObservation`)
 * to drive a deterministic sequence of outcomes. No real
 * UDS, no spawned writer.
 */

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";

import {
  appendToLedgerWriterWithAdmissionPacing,
  MAX_PACING_ATTEMPTS,
  CONNECT_PACING_INTERVAL_MS,
  PACING_RECOVERABLE_ERRNOS,
  type AdmissionPacingObservation,
} from "./_seq05_admission_pacing.js";
import type {
  LedgerWriterAppendResult,
  LedgerWriterClientOptions,
} from "../../src/ledger-writer/ledger-writer-client.js";

let dummySockPath: string;
let dummyServer: Server;
let dummyOpts: LedgerWriterClientOptions;

const dummyArgs = {
  commitId: "ap-deterministic",
  clientContentHash: "h",
  event: makeEvent("ev-deterministic"),
};
function makeEvent(eventId: string): {
  readonly kind: "lifecycle";
  readonly eventId: string;
  readonly observedAt: number;
  readonly event: { readonly type: "run_created" };
} {
  return {
    kind: "lifecycle",
    eventId,
    observedAt: 0,
    event: { type: "run_created" },
  };
}

before((_t, done) => {
  const dir = mkdtempSync(join(tmpdir(), "seq05-ap-"));
  dummySockPath = join(dir, "s");
  dummyServer = createServer();
  dummyServer.on("connection", (sock) => sock.destroy());
  dummyServer.listen(dummySockPath, () => {
    dummyOpts = { socketPath: dummySockPath };
    done();
  });
});

after((_t, done) => {
  if (dummyServer) {
    dummyServer.close(() => done());
    try {
      rmSync(dummySockPath, { force: true });
    } catch {
      // best-effort cleanup
    }
  } else {
    done();
  }
});

test("AP01: ECONNREFUSED ×3 then ok → exactly one canonical append with same args", async () => {
  const appendCalls: Array<{ readonly commitId: string; readonly clientContentHash: string }> = [];
  const probeSeq: ReadonlyArray<{ readonly code: string } | { readonly ok: true }> = [
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { ok: true },
  ];
  let pIdx = 0;
  const probeFn = () => {
    const r = probeSeq[pIdx++] as { readonly code: string } | { readonly ok: true };
    if ("ok" in r) return Promise.resolve({ ok: true as const });
    return Promise.resolve({
      ok: false as const,
      code: r.code,
      message: `probe: ${r.code}`,
    });
  };
  const appendFn = (
    _opts: LedgerWriterClientOptions,
    args: { readonly commitId: string; readonly clientContentHash: string },
  ): Promise<LedgerWriterAppendResult> => {
    appendCalls.push({ commitId: args.commitId, clientContentHash: args.clientContentHash });
    return Promise.resolve({
      ok: true,
      value: {
        sequence: 42,
        commitId: args.commitId,
        contentHash: args.clientContentHash,
        committed: "appended",
      },
    });
  };
  const sleepCalls: number[] = [];
  const sleepFn = (ms: number) => {
    sleepCalls.push(ms);
    return Promise.resolve();
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    { commitId: "ap1", clientContentHash: "h1", event: makeEvent("ev-ap1") },
    {
      probeFn,
      appendFn,
      sleepFn,
      onObservation: (e) => observations.push(e),
    },
  );
  assert.ok(r.ok, "expected success after pacing");
  assert.equal(r.value.sequence, 42);
  assert.equal(r.value.commitId, "ap1");
  assert.equal(r.value.committed, "appended");
  assert.equal(appendCalls.length, 1, "exactly one canonical append call");
  const call = appendCalls[0]!;
  assert.equal(call.commitId, "ap1");
  assert.equal(call.clientContentHash, "h1");
  assert.equal(pIdx, 4, "exactly 3 ECONNREFUSED probes + 1 success");
  assert.deepEqual(sleepCalls, [
    CONNECT_PACING_INTERVAL_MS,
    CONNECT_PACING_INTERVAL_MS,
    CONNECT_PACING_INTERVAL_MS,
  ], "constant delay between every pacing-recoverable failure");
  // CORRECTION16: observation stream records typed
  // probe outcomes and the canonical invocation. The
  // harness asserts the typed stream — it does NOT
  // inspect Error.message. The adapter emits events in
  // source-order: probe_attempted, then the outcome
  // event (probe_refused/probe_nonrecoverable) for
  // each iteration, then canonical_invoked. A call that
  // ends in canonical_invoked after one or more probe_refused
  // events is a `pacing_rescued_calls` candidate (derived
  // algebraically from per-call events).
  assert.deepEqual(
    observations,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "probe_refused", attempt: 0, code: "ECONNREFUSED" },
      { kind: "probe_attempted", attempt: 1 },
      { kind: "probe_refused", attempt: 1, code: "ECONNREFUSED" },
      { kind: "probe_attempted", attempt: 2 },
      { kind: "probe_refused", attempt: 2, code: "ECONNREFUSED" },
      { kind: "probe_attempted", attempt: 3 },
      { kind: "canonical_invoked" },
    ],
    "typed observation stream: 4 probe_attempted + 3 probe_refused (one per pacing-recoverable failure) + 1 canonical_invoked ⇒ pacing_rescued_calls=1",
  );
  // Call-level derivation (result-bound algebra):
  // this call observed 3 probe_refused AND 1 canonical_invoked
  // AND r.ok === true ⇒ pacing_rescued_calls == 1.
  const hasRefused = observations.some((o) => o.kind === "probe_refused");
  const hasCanonical = observations.some((o) => o.kind === "canonical_invoked");
  const pacingRescuedCalls =
    (hasRefused && hasCanonical && r.ok === true) ? 1 : 0;
  assert.equal(pacingRescuedCalls, 1,
    "CORRECTION17+18: a successful call with ≥1 refused probe AND canonical reached AND result.ok === true is a rescued call (derived, NOT emitted)");
});

test("AP02: canonical append returns protocol_error → exactly one canonical append, no reprobe", async () => {
  let appendCalls = 0;
  let probeCalls = 0;
  const probeFn = () => {
    probeCalls++;
    return Promise.resolve({ ok: true as const });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    appendCalls++;
    return Promise.resolve({
      ok: false,
      error: { kind: "protocol_error", error: { kind: "unexpected" } },
    });
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false);
  assert.equal((r as { error: { kind: string } }).error.kind, "protocol_error");
  assert.equal(appendCalls, 1, "exactly one canonical append");
  assert.equal(probeCalls, 1, "no reprobe on protocol_error");
  // CORRECTION16: observation stream records a single
  // probe attempt followed by canonical_invoked.
  assert.deepEqual(
    observations,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "canonical_invoked" },
    ],
    "typed observation stream: 1 probe_attempted + 1 canonical_invoked",
  );
});

test("AP03: canonical append returns connect_failed → exactly one canonical append; adapter does NOT retry it", async () => {
  let appendCalls = 0;
  let probeCalls = 0;
  const probeFn = () => {
    probeCalls++;
    return Promise.resolve({ ok: true as const });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    appendCalls++;
    return Promise.resolve({
      ok: false,
      error: { kind: "connect_failed", message: "frozen client connect failed mid-RPC" },
    });
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false);
  const err = (r as { error: { kind: string; message: string } }).error;
  assert.equal(err.kind, "connect_failed");
  assert.equal(appendCalls, 1, "exactly one canonical append; adapter does not retransmit");
  assert.equal(probeCalls, 1, "probe was called once; no reprobe after append");
  // CORRECTION16: the adapter emits canonical_invoked
  // exactly once even when the canonical client returns
  // connect_failed. The adapter does NOT emit
  // probe_attempted again.
  assert.deepEqual(
    observations,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "canonical_invoked" },
    ],
    "typed observation stream: 1 probe_attempted + 1 canonical_invoked (no reprobe after frozen client's connect_failed)",
  );
});

test("AP04: socket missing → zero probe, zero append", async () => {
  let probeCalls = 0;
  let appendCalls = 0;
  const dir = mkdtempSync(join(tmpdir(), "seq05-missing-"));
  rmSync(dir, { recursive: true, force: true });
  const sockPath = join(dir, "s");
  const opts: LedgerWriterClientOptions = { socketPath: sockPath };
  const probeFn = () => {
    probeCalls++;
    return Promise.resolve({ ok: true as const });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    appendCalls++;
    return Promise.resolve({
      ok: true,
      value: { sequence: 1, commitId: "x", contentHash: "h", committed: "appended" },
    });
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    opts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false);
  assert.equal(
    (r as { error: { kind: string } }).error.kind,
    "socket_missing",
    "socket_missing surfaced on first attempt; no pacing",
  );
  assert.equal(probeCalls, 0, "probe is never called when socket is missing");
  assert.equal(appendCalls, 0, "append is never called when socket is missing");
  // CORRECTION16: socket_missing short-circuits BEFORE
  // the probe loop, so the observation stream is empty.
  assert.deepEqual(
    observations,
    [],
    "typed observation stream: empty (lstat failure is not a probe attempt)",
  );
});

test("AP05: pacing budget exhausted → zero canonical append", async () => {
  let pIdx = 0;
  const probeFn = () => {
    pIdx++;
    return Promise.resolve({ ok: false as const, code: "ECONNREFUSED", message: "probe: ECONNREFUSED" });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    throw new Error("appendFn should not be called when pacing exhausted");
  };
  const sleepCalls: number[] = [];
  const sleepFn = (ms: number) => {
    sleepCalls.push(ms);
    return Promise.resolve();
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn,
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false);
  const err = (r as { error: { kind: string; message: string } }).error;
  assert.equal(err.kind, "connect_failed");
  assert.match(err.message, /pacing exhausted/);
  assert.equal(pIdx, MAX_PACING_ATTEMPTS, "probed exactly MAX_PACING_ATTEMPTS times");
  // sleep was called between every probe failure EXCEPT
  // the last one (no point sleeping after the budget is
  // already exhausted). 31 sleeps for 32 probes.
  assert.equal(sleepCalls.length, MAX_PACING_ATTEMPTS - 1);
  for (const ms of sleepCalls) {
    assert.equal(ms, CONNECT_PACING_INTERVAL_MS);
  }
  // CORRECTION17: observation stream records the full
  // budget drain. The histogram has a TYPED single-source
  // sink for "pacing gave up" (probe_budget_exhausted) —
  // the SEQ05 harness does not parse Error.message for
  // it. Events are emitted in source order:
  // probe_attempted, then probe_refused (every failed
  // probe here is pacing-recoverable), for each of the
  // 32 iterations, then the terminal probe_budget_exhausted.
  // (The 32nd probe_refused and the probe_budget_exhausted
  // are independent signals: probe_refused records "the
  // kernel refused this connect(2)"; probe_budget_exhausted
  // records "pacing gave up". Neither of them, individually
  // or together, implies the call was rescued.)
  const expected: AdmissionPacingObservation[] = [];
  for (let i = 0; i < MAX_PACING_ATTEMPTS; i++) {
    expected.push({ kind: "probe_attempted", attempt: i });
    expected.push({ kind: "probe_refused", attempt: i, code: "ECONNREFUSED" });
  }
  expected.push({ kind: "probe_budget_exhausted", attempts: MAX_PACING_ATTEMPTS });
  assert.deepEqual(
    observations,
    expected,
    "typed observation stream: probe_attempted+probe_refused × 32, then probe_budget_exhausted (NO canonical_invoked)",
  );
  // Algebra separation (AP10 prelude): budget exhaustion
  // MUST NOT mint rescue evidence.
  //   pacing_rescued_calls = 0
  //     (probe_refused>0 ∧ canonical_invoked>0 is FALSE
  //      because canonical_invoked never fired)
  //   pacing_exhausted_calls = 1
  //     (probe_budget_exhausted fired exactly once)
  // This assertion pins the corrected algebra: rescue
  // and probe-refused are distinct quantities.
  const hasCanonical = observations.some((o) => o.kind === "canonical_invoked");
  const hasBudgetExhausted = observations.some((o) => o.kind === "probe_budget_exhausted");
  assert.equal(hasCanonical, false,
    "AP10 PRELUDE: budget-exhausted call MUST NOT have reached canonical_invoked");
  assert.equal(hasBudgetExhausted, true,
    "AP10 PRELUDE: budget-exhausted call MUST have emitted probe_budget_exhausted");
});

test("AP06: exact deterministic delay sequence (constant); assert from values, not wallclock", async () => {
  // The pacing loop calls sleepFn exactly once between
  // every consecutive pair of ECONNREFUSED probes.
  // For N consecutive ECONNREFUSED followed by success,
  // sleepFn is called N-1 times, each with
  // CONNECT_PACING_INTERVAL_MS (constant schedule).
  const sleepCalls: number[] = [];
  const sleepFn = (ms: number) => {
    sleepCalls.push(ms);
    return Promise.resolve();
  };
  const probeSeq: ReadonlyArray<{ readonly code: string } | { readonly ok: true }> = [
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { ok: true },
  ];
  let pIdx = 0;
  const probeFn = () => {
    const r = probeSeq[pIdx++] as { readonly code: string } | { readonly ok: true };
    if ("ok" in r) return Promise.resolve({ ok: true as const });
    return Promise.resolve({
      ok: false as const,
      code: r.code,
      message: `probe: ${r.code}`,
    });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => Promise.resolve({
    ok: true,
    value: { sequence: 1, commitId: "ap6", contentHash: "h", committed: "appended" },
  });
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    { commitId: "ap6", clientContentHash: "h", event: makeEvent("ev-ap6") },
    { probeFn, appendFn, sleepFn },
  );
  assert.ok(r.ok);
  // Constant schedule: [5, 5, 5, 5, 5] (one delay after
  // each of the 5 ECONNREFUSED probes; the 6th probe is
  // the success and returns immediately). Asserted from
  // values, not wallclock.
  const expected = Array(5).fill(CONNECT_PACING_INTERVAL_MS);
  assert.deepEqual(sleepCalls, expected);
});

test("AP07: classification uses Error.code, not Error.message (decoy prose rejected)", async () => {
  let pIdx = 0;
  const probeFn = () => {
    pIdx++;
    // The message LOOKS like the recoverable errno but the
    // typed code is non-pacing-recoverable. The adapter MUST
    // trust the code.
    return Promise.resolve({
      ok: false as const,
      code: "ENOTRECOVERABLE",
      message: "synthetic decoy: includes ECONNREFUSED substring as misdirection",
    });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    throw new Error("appendFn should not be called");
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false);
  const err = (r as { error: { kind: string; message: string } }).error;
  assert.equal(err.kind, "connect_failed");
  assert.equal(pIdx, 1, "non-pacing-recoverable code surfaces on first probe");
  // CORRECTION16: the typed code drives classification.
  // The observation stream emits a probe_nonrecoverable
  // event carrying the typed code (NOT the prose); the
  // error.message is human-only.
  assert.deepEqual(
    observations,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "probe_nonrecoverable", attempt: 0, code: "ENOTRECOVERABLE" },
    ],
    "typed observation stream: 1 probe_attempted + 1 probe_nonrecoverable {code: ENOTRECOVERABLE}",
  );
});

test("AP08: pacing-recoverable set is narrow: only ECONNREFUSED", async () => {
  // The empirical SEQ05 evidence names only ECONNREFUSED
  // as pacing-recoverable. AP08 pins the narrow set so a
  // future regression that adds speculative codes
  // (ECONNRESET, EPIPE, EAGAIN, ENOTRECOVERABLE, ENOENT)
  // fails. The doctrine comment in the adapter module is
  // the single source of truth.
  assert.equal(PACING_RECOVERABLE_ERRNOS.size, 1);
  assert.ok(PACING_RECOVERABLE_ERRNOS.has("ECONNREFUSED"));
  assert.ok(!PACING_RECOVERABLE_ERRNOS.has("ECONNRESET"));
  assert.ok(!PACING_RECOVERABLE_ERRNOS.has("EPIPE"));
  assert.ok(!PACING_RECOVERABLE_ERRNOS.has("EAGAIN"));
  assert.ok(!PACING_RECOVERABLE_ERRNOS.has("ENOTRECOVERABLE"));
  assert.ok(!PACING_RECOVERABLE_ERRNOS.has("ENOENT"));

  // Functional verification: an ECONNRESET probe is
  // surfaced on the first attempt (no pacing absorption).
  let pIdx = 0;
  const probeFn = () => {
    pIdx++;
    return Promise.resolve({
      ok: false as const,
      code: "ECONNRESET",
      message: "peer closed during connect handshake",
    });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    throw new Error("appendFn should not be called on non-recoverable code");
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false);
  assert.equal(
    (r as { error: { kind: string; message: string } }).error.kind,
    "connect_failed",
  );
  assert.equal(pIdx, 1, "ECONNRESET is NOT pacing-recoverable; surfaced immediately");
  // CORRECTION17: ECONNRESET emits probe_nonrecoverable
  // with the typed code, NOT a probe_refused event.
  // pacing_rescued_calls = 0 because canonical_invoked
  // never fired.
  assert.deepEqual(
    observations,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "probe_nonrecoverable", attempt: 0, code: "ECONNRESET" },
    ],
    "typed observation stream: 1 probe_attempted + 1 probe_nonrecoverable {code: ECONNRESET}",
  );
});

test("AP09: typed observation contract — adapter MUST classify via onObservation, NOT Error.message", async () => {
  // CORRECTION17: this is the prose-classification
  // regression guard. The adapter's diagnostic histogram
  // is built from the `onObservation` event stream.
  // A future regression that re-introduces
  // Error.message-based classification (e.g. parsing
  // "pacing exhausted") is detectable by inspecting the
  // observation stream: the test counts each event kind
  // and asserts the totals match the implied behavior.
  //
  // Scenario: ECONNREFUSED ×3, then success. The
  // adapter should emit:
  //   probe_attempted × 4   (3 ECONNREFUSED + 1 success)
  //   probe_refused × 3     (all pacing-recoverable)
  //   canonical_invoked × 1
  //   NO probe_nonrecoverable
  //   NO probe_budget_exhausted
  // Call-level derived: pacing_rescued_calls = 1
  //   (probe_refused>0 ∧ canonical_invoked>0)
  const probeSeq: ReadonlyArray<{ readonly code: string } | { readonly ok: true }> = [
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { code: "ECONNREFUSED" },
    { ok: true },
  ];
  let pIdx = 0;
  const probeFn = () => {
    const r = probeSeq[pIdx++] as { readonly code: string } | { readonly ok: true };
    if ("ok" in r) return Promise.resolve({ ok: true as const });
    return Promise.resolve({
      ok: false as const,
      code: r.code,
      message: `probe: ${r.code}`,
    });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => Promise.resolve({
    ok: true,
    value: { sequence: 1, commitId: "ap9", contentHash: "h", committed: "appended" },
  });
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    { commitId: "ap9", clientContentHash: "h", event: makeEvent("ev-ap9") },
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.ok(r.ok, "expected success");
  // Count each kind. The histogram must be built from
  // these counts, never from Error.message parsing.
  const counts = {
    probe_attempted: 0,
    probe_refused: 0,
    probe_budget_exhausted: 0,
    probe_nonrecoverable: 0,
    canonical_invoked: 0,
  };
  for (const o of observations) {
    counts[o.kind]++;
  }
  assert.equal(counts.probe_attempted, 4, "four probe attempts issued (3 ECONNREFUSED + 1 ok)");
  assert.equal(counts.probe_refused, 3, "three ECONNREFUSED refusals (typed events, not prose)");
  assert.equal(counts.canonical_invoked, 1, "canonical client invoked exactly once");
  assert.equal(counts.probe_budget_exhausted, 0, "pacing budget NOT exhausted");
  assert.equal(counts.probe_nonrecoverable, 0, "no non-recoverable probe");
  // Sanity: the SAME totals that the SEQ05 harness would
  // record under the typed-observation algebra. If a future
  // regression re-introduces Error.message parsing, the
  // histogram counts here will diverge from the prose
  // (e.g. message says "connect refused" but count is 0).
  // Invariant: every NON-SUCCESSFUL probe MUST emit a
  // typed outcome event (single source of truth). The
  // successful probe emits probe_attempted + canonical_invoked
  // but no refusal/non-recoverable/budget event.
  const typedFailureOutcomes = counts.probe_refused +
    counts.probe_nonrecoverable +
    counts.probe_budget_exhausted;
  const successfulProbes = counts.canonical_invoked; // each canonical_invoked corresponds to exactly one successful probe
  const failedProbes = counts.probe_attempted - successfulProbes;
  assert.equal(typedFailureOutcomes, failedProbes,
    "every NON-SUCCESSFUL probe MUST emit exactly one of: probe_refused, probe_nonrecoverable, probe_budget_exhausted");
  // Result-bound call-level derivation: a successful call
  // that observed ≥1 probe_refused AND reached canonical
  // AND has result.ok===true is a rescued call.
  // pacing_rescued_calls = 1 iff
  //   probe_refused>0 ∧ canonical_invoked>0 ∧ result.ok===true
  // For this scenario, r.ok is checked above; we are in
  // the success branch, so the condition holds.
  const hasRefused = counts.probe_refused > 0;
  const hasCanonical = counts.canonical_invoked > 0;
  const resultOk = r.ok === true;
  assert.equal(hasRefused && hasCanonical && resultOk, true,
    "CORRECTION17+18: this scenario has probe_refused>0 ∧ canonical_invoked>0 ∧ result.ok===true ⇒ pacing_rescued_calls++");

  // Second scenario: probe hits ECONNRESET. The
  // observation stream MUST emit probe_nonrecoverable
  // (NOT probe_refused) regardless of any prose in the
  // returned error message.
  const obs2: AdmissionPacingObservation[] = [];
  const r2 = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn: () => Promise.resolve({
        ok: false as const,
        code: "ECONNRESET",
        // Decoy: include the string "pacing exhausted" in
        // the message to confirm the adapter does NOT
        // classify from prose. (The adapter never sees
        // this prose anyway, but it's a regression guard
        // against a future change that adds message
        // parsing.)
        message: "fictional pacing exhausted — ignore me, classify by code",
      }),
      appendFn: () => {
        throw new Error("appendFn MUST NOT be called on non-recoverable code");
      },
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => obs2.push(e),
    },
  );
  assert.equal(r2.ok, false);
  assert.equal(
    (r2 as { error: { kind: string } }).error.kind,
    "connect_failed",
  );
  assert.deepEqual(
    obs2,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "probe_nonrecoverable", attempt: 0, code: "ECONNRESET" },
    ],
    "ECONNRESET with decoy 'pacing exhausted' prose MUST be classified by code, not prose",
  );
});

test("AP10: budget exhaustion MUST NOT mint rescue evidence (CORRECTION17 algebra)", async () => {
  // CORRECTION17: probe-level pressure (probe_refused) and
  // call-level rescue (pacing_rescued_calls) are distinct
  // concepts. The CORRECTION16 violation conflated them
  // — `pacing_rescued` was incremented for every
  // ECONNREFUSED probe, including the last one that
  // exhausted the budget.
  //
  // Algebra:
  //   pacing_rescued_calls =
  //     (probe_refused>0) ∧ (canonical_invoked>0)
  //
  // For a budget-exhausted adapter invocation,
  // canonical_invoked is FALSE, so pacing_rescued_calls
  // MUST be 0 — even though probe_refused_total == 32.
  //
  // This is the algebraic regression guard. Without
  // AP10, a future "refactor" that brings back the
  // CORRECTION16 conflation would not be caught by
  // AP05 (which only checks the observation stream
  // shape, not the derived call-level algebra).
  let probeCalls = 0;
  const probeFn = () => {
    probeCalls++;
    return Promise.resolve({
      ok: false as const,
      code: "ECONNREFUSED",
      message: "probe: ECONNREFUSED",
    });
  };
  const appendFn = (): Promise<LedgerWriterAppendResult> => {
    throw new Error("appendFn MUST NOT be called when pacing is exhausted");
  };
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  assert.equal(r.ok, false, "budget-exhausted call returns connect_failed");
  assert.equal(probeCalls, MAX_PACING_ATTEMPTS,
    "exactly MAX_PACING_ATTEMPTS probes issued");
  // Probe-level arithmetic (CORRECTION17):
  let probeRefusedTotal = 0;
  let probeBudgetExhaustedTotal = 0;
  let canonicalInvokedTotal = 0;
  for (const o of observations) {
    if (o.kind === "probe_refused") probeRefusedTotal++;
    else if (o.kind === "probe_budget_exhausted") probeBudgetExhaustedTotal++;
    else if (o.kind === "canonical_invoked") canonicalInvokedTotal++;
  }
  assert.equal(probeRefusedTotal, MAX_PACING_ATTEMPTS,
    "AP10: probe_refused_total = MAX_PACING_ATTEMPTS (kernel refused every probe)");
  assert.equal(probeBudgetExhaustedTotal, 1,
    "AP10: probe_budget_exhausted_total = 1 (terminal exhaustion event)");
  assert.equal(canonicalInvokedTotal, 0,
    "AP10: canonical_invoked_total = 0 (canonical client NEVER reached)");
  // Call-level derived algebra (CORRECTION17):
  //   pacing_rescued_calls = (probeRefused>0) ∧ (canonicalInvoked>0)
  //                        = TRUE ∧ FALSE
  //                        = FALSE
  //   pacing_rescued_calls = 0  ← MUST NOT mint rescue evidence
  //
  // CORRECTION16 conflated probeRefusedTotal with
  // pacing_rescued. CORRECTION17 separates them:
  //   probeRefusedTotal = 32   (kernel pressure observations)
  //   pacing_rescued_calls = 0 (no call was rescued)
  //   pacing_exhausted_calls = 1 (one call exhausted)
  const hasRefused = probeRefusedTotal > 0;
  const hasCanonical = canonicalInvokedTotal > 0;
  const pacingRescuedCalls = (hasRefused && hasCanonical) ? 1 : 0;
  const pacingExhaustedCalls = probeBudgetExhaustedTotal > 0 ? 1 : 0;
  assert.equal(pacingRescuedCalls, 0,
    "AP10 CORRECTION17 ALGEBRA: budget-exhausted call MUST NOT be counted as rescued " +
    `(probe_refused=${probeRefusedTotal}, canonical_invoked=${canonicalInvokedTotal}, ` +
    `hasRefused=${hasRefused}, hasCanonical=${hasCanonical})`);
  assert.equal(pacingExhaustedCalls, 1,
    "AP10 CORRECTION17 ALGEBRA: budget-exhausted call MUST be counted as exhausted");
  // The dimension check: probe_refused_total describes
  // PROBES; pacing_rescued_calls describes CALLS. For a
  // budget-exhausted call, probe_refused_total can be
  // 32 while pacing_rescued_calls is 0. The CORRECTION16
  // algebra would have made them equal — that was the
  // false-green semantic defect.
  assert.notEqual(probeRefusedTotal, pacingRescuedCalls,
    "AP10 DIMENSION CHECK: probe-level count ≠ call-level rescue count " +
    "(probes are probes; calls are calls)");
});

test("AP11: reaching canonical after a refusal is NOT a rescue if canonical RPC fails (CORRECTION18 result-bound)", async () => {
  // CORRECTION18: the pacing probe socket is destroyed
  // before the canonical RPC opens a NEW connection. A
  // successful probe therefore does NOT reserve admission
  // for the canonical socket; the canonical connection
  // can fail independently. "Reaching canonical" is
  // necessary but not sufficient for "rescued"; rescue
  // also requires the canonical RPC to have succeeded.
  //
  // This is the asymmetric companion to AP10. AP10
  // proves:
  //   did not reach canonical ⇒ not rescued
  // AP11 proves:
  //   reached canonical but failed ⇒ also not rescued
  //
  // Together:
  //   rescued ⇒
  //     refused-beforehand ∧ canonical-reached ∧
  //     logical-success
  //
  // Scenario:
  //   probe 0 = ECONNREFUSED (pacing-recoverable)
  //   probe 1 = success (socket established; pacing
  //             succeeds; canonical is invoked)
  //   appendFn = { ok:false, error:{kind:"connect_failed"} }
  //             (the canonical connection itself fails;
  //              AP03 already establishes that canonical
  //              can return connect_failed)
  //
  // Expected algebra (CORRECTION18):
  //   probe_refused_total                   = 1
  //   canonical_invoked_total               = 1
  //   final_result.ok                       = false
  //   pacing_rescued_calls                  = 0  ← NOT rescued
  //   canonical_failed_after_pacing_calls   = 1
  //
  // CORRECTION17 would have counted this as a rescue
  // (probe_refused>0 ∧ canonical_invoked>0). CORRECTION18
  // binds rescue to result.ok===true.
  let pIdx = 0;
  const probeSeq: ReadonlyArray<{ readonly code: string } | { readonly ok: true }> = [
    { code: "ECONNREFUSED" },
    { ok: true },
  ];
  const probeFn = () => {
    const r = probeSeq[pIdx++] as { readonly code: string } | { readonly ok: true };
    if ("ok" in r) return Promise.resolve({ ok: true as const });
    return Promise.resolve({
      ok: false as const,
      code: r.code,
      message: `probe: ${r.code}`,
    });
  };
  // Canonical client itself returns connect_failed.
  // The adapter must surface this verbatim (CORRECTION15
  // AP03) and MUST NOT reclassify it. The pacing loop
  // already handed off to canonical; the adapter does
  // not know whether the canonical failure is related
  // to pacing or independent.
  const appendFn = (): Promise<LedgerWriterAppendResult> => Promise.resolve({
    ok: false,
    error: { kind: "connect_failed", message: "canonical: connect_failed" },
  });
  const observations: AdmissionPacingObservation[] = [];
  const r = await appendToLedgerWriterWithAdmissionPacing(
    dummyOpts,
    dummyArgs,
    {
      probeFn,
      appendFn,
      sleepFn: () => Promise.resolve(),
      onObservation: (e) => observations.push(e),
    },
  );
  // Probe-level totals:
  let probeRefusedTotal = 0;
  let probeBudgetExhaustedTotal = 0;
  let probeNonRecoverableTotal = 0;
  let canonicalInvokedTotal = 0;
  for (const o of observations) {
    if (o.kind === "probe_refused") probeRefusedTotal++;
    else if (o.kind === "probe_budget_exhausted") probeBudgetExhaustedTotal++;
    else if (o.kind === "probe_nonrecoverable") probeNonRecoverableTotal++;
    else if (o.kind === "canonical_invoked") canonicalInvokedTotal++;
  }
  assert.equal(r.ok, false, "AP11: final result is a connect_failed (canonical RPC failed)");
  assert.equal(probeRefusedTotal, 1, "AP11: exactly one refused probe");
  assert.equal(canonicalInvokedTotal, 1, "AP11: exactly one canonical invocation (the probe succeeded)");
  assert.equal(probeBudgetExhaustedTotal, 0, "AP11: pacing budget NOT exhausted (canonical was reached)");
  assert.equal(probeNonRecoverableTotal, 0, "AP11: no non-recoverable probe");
  // Observation stream shape matches the per-probe pattern
  // for a successful rescue — demonstrates that observation
  // events alone CANNOT distinguish rescue from non-rescue.
  assert.deepEqual(
    observations,
    [
      { kind: "probe_attempted", attempt: 0 },
      { kind: "probe_refused", attempt: 0, code: "ECONNREFUSED" },
      { kind: "probe_attempted", attempt: 1 },
      { kind: "canonical_invoked" },
    ],
    "AP11: observation stream shape matches a successful rescue — rescue MUST be bound to result.ok to distinguish",
  );
  // Call-level derivation (CORRECTION18 algebra):
  const hasRefused = probeRefusedTotal > 0;
  const hasCanonical = canonicalInvokedTotal > 0;
  // Read `r.ok` once as a boolean for the algebra; the
  // earlier assert.equal already pinned it to false,
  // which makes `r.ok === true` a static TS error if
  // re-evaluated here. Use a fresh boolean read.
  const resultOk = !!(r as { ok?: unknown }).ok;
  // CORRECTION17 would compute:
  //   pacing_rescued_calls = hasRefused && hasCanonical = true
  // CORRECTION18 binds:
  //   pacing_rescued_calls = hasRefused && hasCanonical && resultOk
  //                       = false
  const cor17WouldSayRescued = hasRefused && hasCanonical;
  const cor18PacingRescuedCalls =
    (hasRefused && hasCanonical && resultOk) ? 1 : 0;
  const canonicalFailedAfterPacingCalls =
    (hasRefused && hasCanonical && !resultOk) ? 1 : 0;
  assert.equal(cor17WouldSayRescued, true,
    "AP11 PROOF: under CORRECTION17, this call would be counted as rescued (the semantic hole)");
  assert.equal(cor18PacingRescuedCalls, 0,
    "AP11 CORRECTION18 ALGEBRA: pacing_rescued_calls=0 — " +
    "reaching canonical after a refusal is NOT a rescue if canonical RPC failed");
  assert.equal(canonicalFailedAfterPacingCalls, 1,
    "AP11 CORRECTION18 ALGEBRA: canonical_failed_after_pacing_calls=1");
  // AP10+AP11 coverage: among refusal-then-canonical calls,
  // exactly one of {rescued, canonical_failed_after_pacing}
  // holds. Pins the proper implication:
  //   rescued ⇒ refused-beforehand ∧ canonical-reached ∧ logical-success
  assert.equal(
    cor18PacingRescuedCalls + canonicalFailedAfterPacingCalls,
    1,
    "AP11+AP10 COVERAGE: among refusal-then-canonical calls, exactly one of {rescued, canonical_failed_after_pacing} holds",
  );
});
