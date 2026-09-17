/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Property / metamorphic / replay / hash / serialization
 * tests (M2, M17, M19, M20, M22, M23).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { projectRun } from "../../src/run/run-projector.js";
import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  METRIC_REPORT_SCHEMA_VERSION,
  computeRunMetrics,
  serializeMetricReport,
  deriveRunEvidenceHash,
} from "../../src/metrics/index.js";
import { makeSuccessRunMinimal } from "./_metric_helpers.js";

function computeFor(input: ReturnType<typeof makeSuccessRunMinimal>) {
  const projection = projectRun(input.manifest, input.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  return computeRunMetrics({
    subject: input.manifest.subject_id,
    manifest: input.manifest,
    orderedEvents: input.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
}

test("METRIC17/M19: replay twice -> byte-identical MetricReport", () => {
  const r = makeSuccessRunMinimal({ seed: "replay-canonical" });
  const m1 = computeFor(r);
  const m2 = computeFor(r);
  assert.equal(m1.ok, true);
  assert.equal(m2.ok, true);
  if (!m1.ok || !m2.ok) throw new Error("ok");
  const s1 = serializeMetricReport(m1.report);
  const s2 = serializeMetricReport(m2.report);
  assert.equal(s1, s2);
  assert.equal(typeof m1.report.provenance.run_evidence_hash, "string");
  assert.equal(m1.report.provenance.run_evidence_hash.length, 64);
});

test("METRIC20: changing one event changes run_evidence_hash", () => {
  const r = makeSuccessRunMinimal({ seed: "hash-A" });
  const m1 = computeFor(r);
  assert.equal(m1.ok, true);
  if (!m1.ok) throw new Error("ok");
  const h1 = m1.report.provenance.run_evidence_hash;
  const r2 = makeSuccessRunMinimal({ seed: "hash-B" });
  const m2 = computeFor(r2);
  assert.equal(m2.ok, true);
  if (!m2.ok) throw new Error("ok");
  const h2 = m2.report.provenance.run_evidence_hash;
  assert.notEqual(h1, h2);
  // Direct oracle: hash on the same evidence matches.
  const direct = deriveRunEvidenceHash(r.events);
  assert.equal(direct, h1);
});

test("METRIC19: deterministic serialization is insertion-order independent", () => {
  const r = makeSuccessRunMinimal({ seed: "det-json" });
  const m = computeFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const canonical1 = serializeMetricReport(m.report);
  const canonical2 = serializeMetricReport(m.report);
  assert.equal(canonical1, canonical2);
  const parsed = JSON.parse(canonical1) as Record<string, unknown>;
  assert.equal(
    (parsed["provenance"] as Record<string, unknown>)["metric_contract_version"],
    CONVERGENCE_METRIC_CONTRACT_V1,
  );
});

test("METRIC20: contract version contributes to report identity (provenance)", () => {
  const r = makeSuccessRunMinimal({ seed: "identity-test" });
  const m = computeFor(r);
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
  const mA = computeFor(a);
  const mB = computeFor(b);
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
  const m = computeFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.trustworthy_success, true);
  assert.equal(m.report.convergence.terminal_outcome, "SUCCESS");
});

test("METRIC23 (negative oracle): unknown contract version is rejected", () => {
  const r = makeSuccessRunMinimal({ seed: "contract-reject" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: "convergence.metric.contract.v99",
  });
  assert.equal(m.ok, false);
  if (m.ok) throw new Error("expected rejection");
  assert.match(m.reason, /not recognized/);
});

test("METRIC23 (negative oracle): identity mismatch on subject is rejected", () => {
  const r = makeSuccessRunMinimal({ seed: "identity-reject" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject:
      "subject:not-the-manifest-subject-00000000000000000000000000000000000000000000aaa",
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, false);
  if (m.ok) throw new Error("expected rejection");
  assert.match(m.reason, /subject.*does not match/);
});