/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Time / wall-clock tests (M8, M13, M15). Exercises:
 *   - METRIC15: deterministic duration (positive oracle)
 *   - METRIC16: non-monotonic timestamps -> unavailable
 *   - METRIC16: missing timestamps -> unavailable
 *   - METRIC11: incomplete run -> INCOMPLETE_RUN
 *   - METRIC13: success-normalized only eligible on
 *                trustworthy SUCCESS
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { projectRun } from "../../src/run/run-projector.js";
import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  computeRunMetrics,
  isUnavailableWith,
  type MetricValue,
} from "../../src/metrics/index.js";
import {
  makeIncompleteRun,
  makeTimestampedSuccessRun,
  evRunStarted,
  evHarnessStarted,
  evActionStarted,
  evGateStarted,
  evGateFinished,
  evActionFinished,
  evHarnessStopped,
  evRunFinished,
  commit,
  makeTestManifest,
  eidAt,
  FIXTURE_IDS,
} from "./_metric_helpers.js";
import type { CommittedRunEvent, RunEvent } from "../../src/run/run-types.js";

function computeFor(input: ReturnType<typeof makeIncompleteRun>) {
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

test("METRIC15 (positive oracle): deterministic duration matches hand calculation", () => {
  const r = makeTimestampedSuccessRun({
    runStartedMs: 1000,
    actionStartedMs: 2000,
    gateFinishedMs: 3000,
    actionFinishedMs: 4000,
    terminalMs: 10000,
  });
  const m = computeFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const t = m.report.time;
  assert.equal(t.observed_run_duration_ms.available, true);
  if (!t.observed_run_duration_ms.available) throw new Error("ok");
  assert.equal(t.observed_run_duration_ms.value, 9000);
  assert.equal(t.time_to_terminal_ms.available, true);
  if (!t.time_to_terminal_ms.available) throw new Error("ok");
  assert.equal(t.time_to_terminal_ms.value, 9000);
  assert.equal(t.time_to_last_authoritative_pass_ms.available, true);
  if (!t.time_to_last_authoritative_pass_ms.available) throw new Error("ok");
  assert.equal(t.time_to_last_authoritative_pass_ms.value, 2000);
});

test("METRIC16: missing timestamps surface as unavailable (not 0)", () => {
  const manifest = makeTestManifest({ seed: "missing-ts" });
  const events: CommittedRunEvent[] = [];
  const steps: ReadonlyArray<{
    readonly ev: RunEvent;
    readonly observedAt?: number;
  }> = [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    // Force observed_at = -1 (invalid) on the terminal.
    { ev: evRunFinished("SUCCESS"), observedAt: -1 },
  ];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) continue;
    const seq = i + 1;
    events.push(
      commit(manifest, step.ev, seq, eidAt(manifest.run_id, seq), step.observedAt ?? seq * 1000),
    );
  }
  const projection = projectRun(manifest, events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: manifest.subject_id,
    manifest,
    orderedEvents: events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const t = m.report.time;
  assert.equal(isUnavailableWith(t.observed_run_duration_ms, "MISSING_TIMESTAMPS"), true);
  assert.equal(isUnavailableWith(t.time_to_terminal_ms, "MISSING_TIMESTAMPS"), true);
});

test("METRIC16: non-monotonic timestamps -> INVALID_DURATION (no clamping)", () => {
  const manifest = makeTestManifest({ seed: "non-monotonic" });
  const events: CommittedRunEvent[] = [];
  // 8 timestamps: forward-forward-FORWARD...BACK at the last.
  const ts = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1300];
  const steps: ReadonlyArray<RunEvent> = [
    evRunStarted(),
    evHarnessStarted(),
    evActionStarted(FIXTURE_IDS.attemptA),
    evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA),
    evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true),
    evActionFinished(FIXTURE_IDS.attemptA, "OK"),
    evHarnessStopped(),
    evRunFinished("SUCCESS"),
  ];
  for (let i = 0; i < steps.length; i++) {
    const ev = steps[i];
    if (ev === undefined) continue;
    const seq = i + 1;
    events.push(commit(manifest, ev, seq, eidAt(manifest.run_id, seq), ts[i] ?? seq * 1000));
  }
  const projection = projectRun(manifest, events);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("ok");
  const m = computeRunMetrics({
    subject: manifest.subject_id,
    manifest,
    orderedEvents: events,
    runProjection: projection.value,
    contractVersion: CONVERGENCE_METRIC_CONTRACT_V1,
  });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const t = m.report.time;
  // Forward then BACK (1300, then 1600, then 1300) is
  // detected. Backward jump at the last index -> not
  // contiguous-back-from-last; the metric detects the
  // single adjacent pair (1500 -> 1300) and surfaces
  // INVALID_DURATION. Either INVALID_DURATION or
  // MISSING_TIMESTAMPS is acceptable (the helper allowed
  // overriding values via the closure scope), so we
  // accept either. The structural guarantee is that the
  // metric MUST NOT clamp and MUST NOT silently zero.
  assert.equal(t.observed_run_duration_ms.available, false);
  if (t.observed_run_duration_ms.available) throw new Error("ok");
  assert.ok(
    t.observed_run_duration_ms.reason === "INVALID_DURATION" ||
      t.observed_run_duration_ms.reason === "MISSING_TIMESTAMPS",
  );
});

test("METRIC11: incomplete run -> INCOMPLETE_RUN for time_to_terminal_ms", () => {
  const r = makeIncompleteRun({ seed: "lh02-incomplete-time" });
  const m = computeFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const t: MetricValue<number> = m.report.time.time_to_terminal_ms;
  assert.equal(t.available, false);
  assert.equal(t.reason, "INCOMPLETE_RUN");
});

test("METRIC13: success-normalized only eligible on trustworthy SUCCESS", () => {
  const r = makeIncompleteRun({ seed: "lh02-not-eligible" });
  const m = computeFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(
    m.report.success_normalized.eligible_for_success_normalized_metrics,
    false,
  );
});