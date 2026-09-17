/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Tests M1 (versioned contract identity), M2 (pure
 * projection), M3 (terminal outcome imported, never
 * recomputed), M11 (RESOURCE_METRICS namespace), and the
 * M14 / M15 fail-classification semantics.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { projectRun } from "../../src/run/run-projector.js";
import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  computeRunMetrics,
  isMetricContractVersion,
  guardContractVersion,
  isUnavailableWith,
} from "../../src/metrics/index.js";
import {
  makeSuccessRunMinimal,
  makeValidTerminalFailure,
  makeCancelledRun,
  makeIncompleteRun,
} from "./_metric_helpers.js";

test("LH-02 M01: contract version is the single canonical identity", () => {
  assert.equal(
    CONVERGENCE_METRIC_CONTRACT_V1,
    "convergence.metric.contract.v1",
  );
  assert.equal(isMetricContractVersion(CONVERGENCE_METRIC_CONTRACT_V1), true);
  assert.equal(isMetricContractVersion("convergence.metric.contract.v2"), false);
  assert.equal(isMetricContractVersion("nonsense"), false);
  assert.equal(isMetricContractVersion(42), false);
  assert.equal(isMetricContractVersion(null), false);
});

test("LH-02 M01: guard rejects unknown / wrong-type versions", () => {
  const r1 = guardContractVersion("v9.contract.unknown");
  assert.equal(r1.ok, false);
  if (r1.ok) throw new Error("expected rejection");
  assert.match(r1.reason, /not recognized/);
  const r2 = guardContractVersion(42);
  assert.equal(r2.ok, false);
  if (r2.ok) throw new Error("expected rejection");
  assert.match(r2.reason, /MUST be a string/);
  const r3 = guardContractVersion(null);
  assert.equal(r3.ok, false);
  const r4 = guardContractVersion(undefined);
  assert.equal(r4.ok, false);
});

test("LH-02 M01: guard accepts only the V1 constant", () => {
  const r = guardContractVersion(CONVERGENCE_METRIC_CONTRACT_V1);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("expected acceptance");
  assert.equal(r.version, CONVERGENCE_METRIC_CONTRACT_V1);
});

test("LH-02 M02: same inputs -> structurally equal reports", () => {
  const a = makeSuccessRunMinimal({ seed: "replay-A" });
  const b = makeSuccessRunMinimal({ seed: "replay-A" });
  const projectionA = projectRun(a.manifest, a.events);
  const projectionB = projectRun(b.manifest, b.events);
  assert.equal(projectionA.ok, true);
  assert.equal(projectionB.ok, true);
  if (!projectionA.ok || !projectionB.ok) throw new Error("ok");
  const mA = computeRunMetrics({
    subject: a.manifest.subject_id,
    manifest: a.manifest,
    orderedEvents: a.events,
    runProjection: projectionA.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  const mB = computeRunMetrics({
    subject: b.manifest.subject_id,
    manifest: b.manifest,
    orderedEvents: b.events,
    runProjection: projectionB.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(mA.ok, true);
  assert.equal(mB.ok, true);
  if (!mA.ok || !mB.ok) throw new Error("ok");
  assert.deepEqual(mA.report, mB.report);
});

test("LH-02 M03: terminal outcome is imported from the projector (METRIC == PHASE_E)", () => {
  const r = makeValidTerminalFailure({ seed: "lh02-imported-terminal" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.provenance.terminal_outcome, "VALID_FAILURE");
  assert.equal(m.report.convergence.terminal_outcome, "VALID_FAILURE");
  assert.equal(m.report.convergence.trustworthy_success, false);
  assert.equal(projection.value.terminal_outcome, "VALID_FAILURE");
});

test("LH-02 M03: cancelled run surfaces CANCELLED via orthogonal booleans", () => {
  const r = makeCancelledRun({ seed: "lh02-cancel" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.convergence.cancelled, true);
  assert.equal(m.report.convergence.budget_exhausted, false);
  assert.equal(m.report.convergence.timed_out, false);
  assert.equal(m.report.convergence.trustworthy_success, false);
});

test("LH-02 M11: resource namespace exposes typed unavailable values", () => {
  const r = makeSuccessRunMinimal({ seed: "lh02-no-resources" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const res = m.report.resources;
  assert.equal(isUnavailableWith(res.tool_calls_total, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.total_tokens, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.input_tokens, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.output_tokens, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.peak_process_count, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.observed_wall_clock_ms, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.token_source, "UNSUPPORTED_BY_CONTRACT"), true);
});

test("LH-02 M14: failure shape exposes observed fact; no causal inference", () => {
  const r = makeCancelledRun({ seed: "lh02-failure-shape" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.failure_shape.observed_failure, true);
  assert.equal(
    isUnavailableWith(
      m.report.failure_shape.attributed_cause,
      "UNSUPPORTED_BY_CONTRACT",
    ),
    true,
  );
});

test("LH-02 M15: convergence facts are orthogonal booleans, not a single converged flag", () => {
  const r = makeIncompleteRun({ seed: "lh02-incomplete" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const f = m.report.convergence;
  assert.equal(f.terminal, false);
  assert.equal(f.terminal_outcome, null);
  assert.equal(f.trustworthy_success, false);
  assert.equal(f.budget_exhausted, false);
  assert.equal(f.timed_out, false);
  assert.equal(f.cancelled, false);
  assert.equal(f.incomplete, true);
  assert.equal(f.invalid_evidence, false);
  const keys = Object.keys(f).sort();
  assert.deepEqual(keys, [
    "budget_exhausted",
    "cancelled",
    "incomplete",
    "invalid_evidence",
    "terminal",
    "terminal_outcome",
    "timed_out",
    "trustworthy_success",
  ]);
});

test("LH-02 M16: available/unavailable algebra — no silent zero substitution", () => {
  const r = makeIncompleteRun({ seed: "lh02-availability" });
  const projection = projectRun(r.manifest, r.events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: r.manifest.subject_id,
    manifest: r.manifest,
    orderedEvents: r.events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const timeToTerminal = m.report.time.time_to_terminal_ms;
  assert.equal(timeToTerminal.available, false);
  assert.equal(timeToTerminal.reason, "INCOMPLETE_RUN");
});
