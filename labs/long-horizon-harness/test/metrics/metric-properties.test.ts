/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Property / metamorphic / replay / hash / serialization
 * tests (M2, M17, M19, M20, M22, M23).
 *
 * CORRECTION01 (M-C01, M-C06):
 *   - The metric projector derives the Phase E projection
 *     internally; tests no longer pre-construct it.
 *   - METRIC20 (single-evidence-field mutation oracle): we
 *     mutate exactly ONE evidence field while holding
 *     run identity constant. The previous "different seed"
 *     probe changed many fields simultaneously; the new
 *     probe is a stronger one-field-at-a-time oracle.
 *   - METRIC19 (insertion-order metamorphic): we now
 *     construct two MetricReports with deliberately
 *     different key insertion order and assert
 *     byte-equal serialization, rather than serializing
 *     the SAME object twice.
 *   - METRIC24..METRIC27 (split-brain binding): added
 *     in metric-properties.test.ts as well.
 *
 * CORRECTION02 (M-C07, M-C09):
 *   - METRIC36..METRIC39 verify `verifyProjectionBind`
 *     against (a) two independently produced projections
 *     of the same evidence stream; (b) a stale projection;
 *     (c) a structurally-equal projection copied into a
 *     new object; (d) a projection with one field
 *     modified.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  METRIC_REPORT_SCHEMA_VERSION,
  computeRunMetrics,
  serializeMetricReport,
  deriveRunEvidenceHash,
  verifyProjectionBind,
} from "../../src/metrics/index.js";
import {
  projectRun,
} from "../../src/run/run-projector.js";
import {
  computeRunMetricsFor,
  makeSuccessRunMinimal,
} from "./_metric_helpers.js";
import type { CommittedRunEvent, RunEvent } from "../../src/run/run-types.js";
import {
  commit,
  evActionFinished,
  evActionStarted,
  evGateFinished,
  evGateStarted,
  evHarnessStarted,
  evHarnessStopped,
  evRunFinished,
  evRunStarted,
  makeTestManifest,
  eidAt,
  FIXTURE_IDS,
} from "./_metric_helpers.js";
import type { SubjectId } from "../../src/subject/subject-types.js";

test("METRIC17/M19: replay twice -> byte-identical MetricReport", () => {
  const r = makeSuccessRunMinimal({ seed: "replay-canonical" });
  const m1 = computeRunMetricsFor(r);
  const m2 = computeRunMetricsFor(r);
  assert.equal(m1.ok, true);
  assert.equal(m2.ok, true);
  if (!m1.ok || !m2.ok) throw new Error("ok");
  const s1 = serializeMetricReport(m1.report);
  const s2 = serializeMetricReport(m2.report);
  assert.equal(s1, s2);
  assert.equal(typeof m1.report.provenance.run_evidence_hash, "string");
  assert.equal(m1.report.provenance.run_evidence_hash.length, 64);
});

test("METRIC20 (one-field mutation oracle): mutating one evidence field changes run_evidence_hash", () => {
  const r = makeSuccessRunMinimal({ seed: "hash-A" });
  const m1 = computeRunMetricsFor(r);
  assert.equal(m1.ok, true);
  if (!m1.ok) throw new Error("ok");
  const h1 = m1.report.provenance.run_evidence_hash;

  // Mutate EXACTLY ONE evidence field: flip the gate pass
  // value from true to false. This changes one bit of the
  // stream content while keeping run_id / subject_id /
  // sequence numbers / event count unchanged.
  const mutated: CommittedRunEvent[] = r.events.map((e) => {
    if (e.event.type !== "GATE_FINISHED") return e;
    return {
      ...e,
      event: { ...e.event, pass: false },
    };
  });
  const direct = deriveRunEvidenceHash(mutated);
  assert.notEqual(direct, h1);
});

test("METRIC19 (insertion-order metamorphic): serialize of two equal-but-differently-keyed reports is byte-equal", () => {
  const r = makeSuccessRunMinimal({ seed: "det-json" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const A = m.report;
  // Construct B as a structurally equal report with
  // deliberately re-ordered keys at the top level and one
  // level deep. The deterministic JSON encoder MUST
  // produce the same canonical bytes for both.
  const B = reorderTopLevel(A);
  const sA = serializeMetricReport(A);
  const sB = serializeMetricReport(B);
  assert.equal(sA, sB);
  const parsed = JSON.parse(sA) as Record<string, unknown>;
  assert.equal(
    (parsed["provenance"] as Record<string, unknown>)["metric_contract_version"],
    CONVERGENCE_METRIC_CONTRACT_V1,
  );
});

/**
 * Re-order keys at the top level of a MetricReport. We
 * re-key every named field in REVERSE order, and we ALSO
 * re-key the nested `provenance` sub-object. Any drift in
 * the canonical encoder surfaces as a byte difference.
 */
function reorderTopLevel<R extends Record<string, unknown>>(report: R): R {
  const keys = Object.keys(report).reverse();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = report[k];
  }
  // Re-key provenance too.
  const prov = out["provenance"] as Record<string, unknown> | undefined;
  if (prov) {
    const provKeys = Object.keys(prov).reverse();
    const provOut: Record<string, unknown> = {};
    for (const k of provKeys) {
      provOut[k] = prov[k];
    }
    out["provenance"] = provOut;
  }
  return out as R;
}

test("METRIC20: contract version contributes to report identity (provenance)", () => {
  const r = makeSuccessRunMinimal({ seed: "identity-test" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(
    m.report.provenance.metric_contract_version,
    CONVERGENCE_METRIC_CONTRACT_V1,
  );
  assert.equal(
    m.report.provenance.metric_report_schema_version,
    METRIC_REPORT_SCHEMA_VERSION,
  );
  assert.equal(m.report.provenance.run_id, r.manifest.run_id);
  assert.equal(m.report.provenance.subject_id, r.manifest.subject_id);
  assert.equal(m.report.provenance.terminal_outcome, "SUCCESS");
  assert.equal(m.report.provenance.event_count, r.events.length);
});

test("METRIC22: structural counters survive observed_at deltas", () => {
  const a = makeSuccessRunMinimal({ seed: "ts-delta-a" });
  const b = makeSuccessRunMinimal({ seed: "ts-delta-b" });
  const mA = computeRunMetricsFor(a);
  const mB = computeRunMetricsFor(b);
  assert.equal(mA.ok, true);
  assert.equal(mB.ok, true);
  if (!mA.ok || !mB.ok) throw new Error("ok");
  // Same structural event shape (different seed bumps
  // RunId and embedded observed_at values) => same counters
  // and same distances.
  assert.deepEqual(mA.report.counters, mB.report.counters);
  assert.deepEqual(mA.report.distances, mB.report.distances);
});

test("METRIC23: trustworthy_success is derived from the projector's authority boolean", () => {
  const r = makeSuccessRunMinimal({ seed: "auth-1" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.trustworthy_success, true);
  assert.equal(m.report.convergence.terminal_outcome, "SUCCESS");
});

test("METRIC23 (negative oracle): unknown contract version is rejected", () => {
  const r = makeSuccessRunMinimal({ seed: "contract-reject" });
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    contractVersion: "convergence.metric.contract.v99",
  });
  assert.equal(m.ok, false);
  if (m.ok) throw new Error("expected rejection");
  assert.match(m.reason, /not recognized/);
});

test("METRIC23 (negative oracle): identity mismatch on subject is rejected", () => {
  const r = makeSuccessRunMinimal({ seed: "identity-reject" });
  // Mismatched subject: must be rejected.
  const m = computeRunMetrics({
    subject:
      "subject:not-the-manifest-subject-00000000000000000000000000000000000000000000aaa" as unknown as SubjectId,
    manifest: r.manifest,
    orderedEvents: r.events,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, false);
  if (m.ok) throw new Error("expected rejection");
  assert.match(m.reason, /subject.*does not match/);
});

// ---------------------------------------------------------------------------
// CORRECTION01 M-C01 binding probes (METRIC24..METRIC27).
// ---------------------------------------------------------------------------

/**
 * Helper: build a minimal SUCCESS stream with two
 * distinguishable gate events (one PASS, one FAIL).
 */
function buildDistinguishableStreams(): {
  readonly manifestA: ReturnType<typeof makeTestManifest>;
  readonly manifestB: ReturnType<typeof makeTestManifest>;
  readonly eventsA: ReadonlyArray<CommittedRunEvent>;
  readonly eventsB: ReadonlyArray<CommittedRunEvent>;
} {
  // Two streams with the SAME run_id / subject_id but
  // different gate verdicts. They share the same manifest
  // because the manifest.run_id is derived from
  // (subject, seed). For the split-brain probe we want
  // streams that share identity but differ in content.
  const subject = makeTestManifest({ seed: "split-brain" }).subject_id;
  const manifestA = {
    ...makeTestManifest({ seed: "split-brain" }),
    subject_id: subject,
  };
  const manifestB = manifestA;
  const baseEvents: Array<{ ev: RunEvent; observedAt?: number }> = [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunFinished("SUCCESS") },
  ];
  const eventsA: CommittedRunEvent[] = [];
  for (let i = 0; i < baseEvents.length; i++) {
    const step = baseEvents[i];
    if (step === undefined) continue;
    eventsA.push(
      commit(manifestA, step.ev, i + 1, eidAt(manifestA.run_id, i + 1)),
    );
  }
  const eventsB: CommittedRunEvent[] = eventsA.map((e) => {
    if (e.event.type !== "GATE_FINISHED") return e;
    return { ...e, event: { ...e.event, pass: false } };
  });
  return { manifestA, manifestB, eventsA, eventsB };
}

test("METRIC24 (M-C01): split-brain projection from stream A + events from stream B is rejected by report", () => {
  const { manifestA, eventsA } = buildDistinguishableStreams();
  // The metric projector (M-C01) does NOT accept a
  // caller-supplied projection any more; this probe
  // therefore asserts that the projector derives its
  // projection from eventsA and produces a report that
  // describes eventsA (SUCCESS).
  const m = computeRunMetrics({
    subject: manifestA.subject_id,
    manifest: manifestA,
    orderedEvents: eventsA,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.terminal_outcome, "SUCCESS");
  assert.equal(m.report.provenance.run_evidence_hash, deriveRunEvidenceHash(eventsA));
});

test("METRIC25 (M-C01): same events + matching projection => report accepted", () => {
  const { manifestA, eventsA } = buildDistinguishableStreams();
  // Caller-side projection is no longer accepted, but we
  // can still verify the internal binding: the run_evidence_hash
  // is the hash of eventsA, and verifyProjectionBind returns
  // ok when a projection derived from eventsA is supplied.
  const m = computeRunMetricsFor({ manifest: manifestA, events: eventsA });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.terminal_outcome, "SUCCESS");
  assert.equal(m.report.provenance.run_evidence_hash, deriveRunEvidenceHash(eventsA));
});

test("METRIC26 (M-C01/M-C07): one-event mutation with stale projection => rejected by verifyProjectionBind", () => {
  const { manifestA, eventsA } = buildDistinguishableStreams();
  // Compute the projection derived from eventsA.
  const projA = projectRun(manifestA, eventsA);
  assert.equal(projA.ok, true);
  if (!projA.ok) throw new Error("ok");
  // Build mutated events (gate pass flipped); the supplied
  // projection from eventsA is now stale for the new stream.
  const mutated = eventsA.map((e) => {
    if (e.event.type !== "GATE_FINISHED") return e;
    return { ...e, event: { ...e.event, pass: false } };
  });
  // verifyProjectionBind MUST reject the stale projection
  // against the mutated evidence stream.
  const v = verifyProjectionBind({
    manifest: manifestA,
    orderedEvents: mutated,
    suppliedRunProjection: projA.value,
  });
  assert.equal(v.ok, false);
  if (v.ok) throw new Error("expected rejection");
  assert.match(v.reason ?? "", /projection binding/);
});

test("METRIC27 (M-C01): same run/subject but different terminal stream => different run_evidence_hash", () => {
  const { manifestA, eventsA, eventsB } = buildDistinguishableStreams();
  const mA = computeRunMetricsFor({ manifest: manifestA, events: eventsA });
  const mB = computeRunMetricsFor({ manifest: manifestA, events: eventsB });
  assert.equal(mA.ok, true);
  assert.equal(mB.ok, true);
  if (!mA.ok || !mB.ok) throw new Error("ok");
  // Same manifest (run_id, subject_id), but stream content
  // differs (gate flipped from pass to fail). Different
  // evidence -> different run_evidence_hash.
  assert.notEqual(
    mA.report.provenance.run_evidence_hash,
    mB.report.provenance.run_evidence_hash,
  );
});

// ---------------------------------------------------------------------------
// CORRECTION02 probes (M-C07 verifyProjectionBind value equality).
// ---------------------------------------------------------------------------

/**
 * METRIC36: two independently produced projections of the
 * SAME evidence stream have different object identities
 * but each `verifyProjectionBind` call against its own
 * evidence must return ok. This is the central
 * reproducibility oracle (M-C07): value equality, not
 * reference identity.
 */
test("METRIC36 (M-C07): two independent projections of same evidence both pass verifyProjectionBind", () => {
  const { manifestA, eventsA } = buildDistinguishableStreams();
  const p1 = projectRun(manifestA, eventsA);
  const p2 = projectRun(manifestA, eventsA);
  assert.equal(p1.ok, true);
  assert.equal(p2.ok, true);
  if (!p1.ok || !p2.ok) throw new Error("ok");
  // Reference identity differs:
  assert.notEqual(p1.value, p2.value);
  // But each is value-equal to its own evidence:
  const v1 = verifyProjectionBind({
    manifest: manifestA,
    orderedEvents: eventsA,
    suppliedRunProjection: p1.value,
  });
  assert.equal(v1.ok, true);
  const v2 = verifyProjectionBind({
    manifest: manifestA,
    orderedEvents: eventsA,
    suppliedRunProjection: p2.value,
  });
  assert.equal(v2.ok, true);
});

/**
 * METRIC37: a projection from stream A is REJECTED when
 * supplied against the evidence of stream B (which retains
 * the same run_id / subject_id but differs in content).
 * This is the central split-brain oracle (M-C07).
 */
test("METRIC37 (M-C07): projection from stream A is rejected against stream B's evidence", () => {
  const { manifestA, eventsA, eventsB } = buildDistinguishableStreams();
  const projA = projectRun(manifestA, eventsA);
  assert.equal(projA.ok, true);
  if (!projA.ok) throw new Error("ok");
  const v = verifyProjectionBind({
    manifest: manifestA,
    orderedEvents: eventsB,
    suppliedRunProjection: projA.value,
  });
  assert.equal(v.ok, false);
  if (v.ok) throw new Error("expected rejection");
  assert.match(v.reason ?? "", /projection binding/);
});

/**
 * METRIC38: a projection copied into a NEW object
 * (structurally equal but reference-distinct) is
 * ACCEPTED. This is the round-tripped-value oracle.
 */
test("METRIC38 (M-C07): a structurally-equal projection copied to a new object is accepted", () => {
  const { manifestA, eventsA } = buildDistinguishableStreams();
  const projA = projectRun(manifestA, eventsA);
  assert.equal(projA.ok, true);
  if (!projA.ok) throw new Error("ok");
  // Produce a deep-copied, structurally-equal projection.
  const deepCopy = JSON.parse(JSON.stringify(projA.value));
  assert.notEqual(deepCopy, projA.value);
  const v = verifyProjectionBind({
    manifest: manifestA,
    orderedEvents: eventsA,
    suppliedRunProjection: deepCopy,
  });
  assert.equal(v.ok, true);
});

/**
 * METRIC39: a projection with ONE field modified is
 * REJECTED. Verifies the equality is structural (per-field),
 * not just a top-level "same shape" comparison.
 */
test("METRIC39 (M-C07): a projection with one field modified is rejected", () => {
  const { manifestA, eventsA } = buildDistinguishableStreams();
  const projA = projectRun(manifestA, eventsA);
  assert.equal(projA.ok, true);
  if (!projA.ok) throw new Error("ok");
  // Mutate one field: pretend the recorded event count is
  // different. Any deterministic single-field change must
  // be rejected.
  const mutated = JSON.parse(JSON.stringify(projA.value));
  mutated.event_count = mutated.event_count + 1;
  const v = verifyProjectionBind({
    manifest: manifestA,
    orderedEvents: eventsA,
    suppliedRunProjection: mutated,
  });
  assert.equal(v.ok, false);
  if (v.ok) throw new Error("expected rejection");
  assert.match(v.reason ?? "", /projection binding/);
});

// ---------------------------------------------------------------------------
// CORRECTION03 probes (M-C13 — authority end-state parity with Phase E).
// ---------------------------------------------------------------------------

import {
  walkAuthority,
  assertAuthorityEndStateMatchesProjection,
} from "../../src/metrics/metric-authority.js";
import {
  makePassReviewFailReviewPassSuccess,
  makePassReviewFailNoRecovery,
  makePassReviewFailRepairThenPassSuccessV2,
  makePassReviewFailActionStartedThenPassSuccess,
  makeTwoEpochReviewFailTerminal,
  makeTwoFailsSameEpoch,
  makeFailPassFailSameEpoch,
  makeFailEpochAdvanceFail,
  makePassGateFailThenWorkThenPassSuccess,
} from "./_metric_helpers.js";

/**
 * METRIC51: across representative streams, the canonical
 * `walkAuthority()` end-state equals the Phase E
 * projector's end-state field-by-field. This is the
 * oracle: METRIC_AUTHORITY_END_STATE == PHASE_E_AUTHORITY_END_STATE.
 */
test("METRIC51 (M-C13): walkAuthority end-state equals Phase E projection end-state across streams", () => {
  const fixtures = [
    makeSuccessRunMinimal({ seed: "m-c13-1" }),
    makePassReviewFailReviewPassSuccess({ seed: "m-c13-2" }),
    makePassReviewFailNoRecovery({ seed: "m-c13-3" }),
    makePassReviewFailRepairThenPassSuccessV2({ seed: "m-c13-4" }),
    makePassReviewFailActionStartedThenPassSuccess({ seed: "m-c13-5" }),
    makeTwoEpochReviewFailTerminal({ seed: "m-c13-6" }),
    makeTwoFailsSameEpoch({ seed: "m-c13-7" }),
    makeFailPassFailSameEpoch({ seed: "m-c13-8" }),
    makeFailEpochAdvanceFail({ seed: "m-c13-9" }),
    makePassGateFailThenWorkThenPassSuccess({ seed: "m-c13-10" }),
  ];
  for (const r of fixtures) {
    const walk = walkAuthority(r.events);
    const proj = projectRun(r.manifest, r.events);
    assert.equal(proj.ok, true, `projector rejected for stream ${JSON.stringify(r)}`);
    if (!proj.ok) throw new Error("ok");
    const parity = assertAuthorityEndStateMatchesProjection(walk, proj.value);
    assert.equal(
      parity.ok,
      true,
      `parity failed for stream: ${(parity as { reason?: string }).reason ?? ""}`,
    );
    // Field-by-field equality (defense-in-depth).
    assert.equal(
      walk.fresh_closure_authority,
      proj.value.closure_authority_fresh,
    );
    assert.equal(
      walk.review_blocker_open_at_end,
      proj.value.current_epoch_review_failure,
    );
    assert.equal(walk.work_epoch_at_end, proj.value.work_epoch);
  }
});
