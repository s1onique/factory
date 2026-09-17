/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Shared test helpers for the LH-02 metric contract test
 * suite. The helpers are intentionally independent of the
 * production code so test expected values do not entangle
 * with the implementation helpers.
 *
 * Phase E surfaces are imported here only for the typed
 * shape (`CommittedRunEvent`, `RunManifest`, ...). The
 * fixture builders below construct events / manifests / etc.
 * directly, without going through the production projector.
 */

import type {
  AttemptId,
  CommittedRunEvent,
  GateId,
  RepairCycleId,
  ReviewCycleId,
  RunEvent,
  RunEventId,
  RunId,
  RunManifest,
} from "../../src/run/run-types.js";
import {
  RUN_EVENT_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  computeRunId,
  makeAttemptId,
  makeGateId,
  makeRepairCycleId,
  makeReviewCycleId,
  makeRunEventId,
} from "../../src/run/run-types.js";
import type { SubjectId } from "../../src/subject/subject-types.js";
import { makeSubjectId } from "../../src/subject/index.js";

/** Fixed set of test ids used across the corpus. */
export const FIXTURE_IDS = {
  attemptA: makeAttemptId("attempt:metric-a"),
  attemptB: makeAttemptId("attempt:metric-b"),
  attemptC: makeAttemptId("attempt:metric-c"),
  attemptD: makeAttemptId("attempt:metric-d"),
  attemptE: makeAttemptId("attempt:metric-e"),
  gate1: makeGateId("gate:metric-1"),
  gate2: makeGateId("gate:metric-2"),
  gate3: makeGateId("gate:metric-3"),
  gate4: makeGateId("gate:metric-4"),
  repair1: makeRepairCycleId("repair:metric-1"),
  repair2: makeRepairCycleId("repair:metric-2"),
  review1: makeReviewCycleId("review:metric-1"),
  review2: makeReviewCycleId("review:metric-2"),
  review3: makeReviewCycleId("review:metric-3"),
};

/** A canonical test subject (hand-rolled deterministic hex). */
export function makeTestSubject(label: string = "lh02"): SubjectId {
  let hex = label.replace(/[^0-9a-f]/g, "a").toLowerCase();
  if (hex.length > 64) hex = hex.slice(0, 64);
  else hex = hex.padEnd(64, "0");
  return makeSubjectId(`subject:${hex}`);
}

/**
 * Compute a deterministic test RunId. We pin `seed = label`
 * so two helpers computing the RunId for the same label get
 * the same value.
 */
export function makeTestRunId(
  subject: SubjectId,
  seed: string = "lh02-corpus",
): RunId {
  return computeRunId({
    subjectId: subject,
    runSchemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    repetition: { index: 0, seed },
  });
}

export function makeTestManifest(args: {
  readonly subject?: SubjectId;
  readonly seed?: string;
}): RunManifest {
  const subject = args.subject ?? makeTestSubject();
  const seed = args.seed ?? "lh02-corpus";
  return {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: makeTestRunId(subject, seed),
    subject_id: subject,
    run_protocol_version: "phase-e.test.v1",
    runner_revision: "test-runner",
    started_by: "test-runner",
    created_at: 0,
    repetition: { index: 0, seed },
  };
}

export function commit(
  manifest: RunManifest,
  event: RunEvent,
  sequence: number,
  eventId: RunEventId,
  observedAt: number = sequence * 1000,
): CommittedRunEvent {
  return {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: eventId,
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    sequence,
    event,
    observed_at: observedAt,
  };
}

/**
 * Build the next RunEventId for a position in the stream.
 * Tests pass the underlying RunId so this helper stays
 * deterministic without going through the production
 * EventIdSource machinery.
 */
export function eidAt(runId: RunId, n: number): RunEventId {
  return makeRunEventId(`evt:${runId}:${n}`);
}

// ---------------------------------------------------------------------------
// Synthetic event constructors. Tests compose streams from
// these primitives.
// ---------------------------------------------------------------------------

export function evRunStarted(): RunEvent {
  return { type: "RUN_STARTED" };
}
export function evHarnessStarted(): RunEvent {
  return { type: "HARNESS_STARTED" };
}
export function evHarnessStopped(): RunEvent {
  return { type: "HARNESS_STOPPED" };
}
export function evActionStarted(attemptId: AttemptId): RunEvent {
  return {
    type: "ACTION_STARTED",
    target: { kind: "attempt", attempt_id: attemptId },
  };
}
export function evActionFinished(
  attemptId: AttemptId,
  status: "OK" | "ERROR",
): RunEvent {
  return {
    type: "ACTION_FINISHED",
    target: { kind: "attempt", attempt_id: attemptId },
    status,
  };
}
export function evGateStarted(
  gateId: GateId,
  attemptId: AttemptId,
): RunEvent {
  return { type: "GATE_STARTED", gate_id: gateId, attempt_id: attemptId };
}
export function evGateFinished(
  gateId: GateId,
  attemptId: AttemptId,
  pass: boolean,
): RunEvent {
  return {
    type: "GATE_FINISHED",
    gate_id: gateId,
    attempt_id: attemptId,
    pass,
  };
}
export function evRepairStarted(
  repairId: RepairCycleId,
  reason: string,
): RunEvent {
  return { type: "REPAIR_STARTED", repair_id: repairId, reason };
}
export function evRepairFinished(repairId: RepairCycleId): RunEvent {
  return { type: "REPAIR_FINISHED", repair_id: repairId };
}
export function evReviewStarted(reviewId: ReviewCycleId): RunEvent {
  return { type: "REVIEW_STARTED", review_id: reviewId };
}
export function evReviewFinished(
  reviewId: ReviewCycleId,
  pass: boolean,
): RunEvent {
  return { type: "REVIEW_FINISHED", review_id: reviewId, pass };
}
export function evRunFinished(
  semantic: "SUCCESS" | "VALID_FAILURE",
): RunEvent {
  return { type: "RUN_FINISHED", semantic };
}
export function evRunTimeout(
  semantic: "TIMEOUT" | "BUDGET_EXHAUSTED",
  observationKind:
    | "wall_clock_ms"
    | "tokens"
    | "tool_calls"
    | "process_count",
  observationValue: number,
): RunEvent {
  return {
    type: "RUN_TIMEOUT",
    semantic,
    observation: { kind: observationKind, observed: observationValue },
  };
}
export function evRunAborted(
  semantic:
    | "CANCELLED"
    | "HARNESS_FAILURE"
    | "MODEL_FAILURE"
    | "ENVIRONMENT_FAILURE"
    | "EVIDENCE_FAILURE",
  reason: string,
): RunEvent {
  return { type: "RUN_ABORTED", semantic, reason };
}
export function evRunCancelRequested(reason?: string): RunEvent {
  return reason !== undefined
    ? { type: "RUN_CANCEL_REQUESTED", reason }
    : { type: "RUN_CANCEL_REQUESTED" };
}

// ---------------------------------------------------------------------------
// Stream builders: assemble a CommittedRunEvent[] for each
// canonical case. Tests should prefer these builders over
// hand-rolling events so the test corpus stays focused on
// the metric semantics rather than on Phase E legality.
// ---------------------------------------------------------------------------

type StreamBuilder = (args?: {
  readonly seed?: string;
}) => {
  readonly manifest: RunManifest;
  readonly events: ReadonlyArray<CommittedRunEvent>;
};

/**
 * Internal helper: build a stream by pushing events in
 * order, with monotonically increasing `observed_at`
 * defaulting to `sequence * 1000` unless overridden.
 */
function buildStream(
  manifest: RunManifest,
  steps: ReadonlyArray<
    { readonly ev: RunEvent; readonly observedAt?: number }
  >,
): ReadonlyArray<CommittedRunEvent> {
  const events: CommittedRunEvent[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) continue;
    const seq = i + 1;
    const eid = eidAt(manifest.run_id, seq);
    const observedAt = step.observedAt ?? seq * 1000;
    events.push(commit(manifest, step.ev, seq, eid, observedAt));
  }
  return events;
}

/**
 * METRIC01: minimal SUCCESS run.
 *
 * Expected golden counters:
 *   action_count = 1; successful_action_count = 1;
 *   failed_action_count = 0; gate_count = 1;
 *   passing_gate_count = 1; failing_gate_count = 0;
 *   repair_cycle_count = 0; review_count = 0;
 *   work_epoch_count = 1.
 */
export const makeSuccessRunMinimal: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunFinished("SUCCESS") },
  ]);
  return { manifest, events };
};

/**
 * METRIC02: successful run with one repair.
 *
 * Expected golden counters:
 *   action_count = 2; gate_count = 2;
 *   passing_gate_count = 1; failing_gate_count = 1;
 *   repair_cycle_count = 1; review_count = 0;
 *   work_epoch_count = 2.
 */
export const makeSuccessRunOneRepair: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, false) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evRepairStarted(FIXTURE_IDS.repair1, "gate failed") },
    { ev: evRepairFinished(FIXTURE_IDS.repair1) },
    { ev: evActionStarted(FIXTURE_IDS.attemptB) },
    { ev: evGateStarted(FIXTURE_IDS.gate2, FIXTURE_IDS.attemptB) },
    { ev: evGateFinished(FIXTURE_IDS.gate2, FIXTURE_IDS.attemptB, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptB, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunFinished("SUCCESS") },
  ]);
  return { manifest, events };
};

/**
 * METRIC04: action failure -> recovery -> success.
 *
 * Expected golden counters:
 *   action_count = 2; failed_action_count = 1;
 *   successful_action_count = 1; gate_count = 2;
 *   passing_gate_count = 2; failing_gate_count = 0;
 *   repair_cycle_count = 0; work_epoch_count = 2.
 *
 * (Phase E V2 E-C18: ACTION_FINISHED(ERROR) invalidates
 * the prior positive gate; a later ACTION_STARTED +
 * GATE_FINISHED(pass=true) re-establishes authority.)
 */
export const makeActionErrorRecoverySuccess: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "ERROR") },
    { ev: evActionStarted(FIXTURE_IDS.attemptB) },
    { ev: evGateStarted(FIXTURE_IDS.gate2, FIXTURE_IDS.attemptB) },
    { ev: evGateFinished(FIXTURE_IDS.gate2, FIXTURE_IDS.attemptB, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptB, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunFinished("SUCCESS") },
  ]);
  return { manifest, events };
};

/**
 * METRIC05: review failure -> recovery -> success.
 * Expected: action_count = 1; review_count = 2;
 *   passing_review_count = 1; failing_review_count = 1.
 */
export const makeReviewFailureRecoverySuccess: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evReviewStarted(FIXTURE_IDS.review1) },
    { ev: evReviewFinished(FIXTURE_IDS.review1, false) },
    { ev: evReviewStarted(FIXTURE_IDS.review2) },
    { ev: evReviewFinished(FIXTURE_IDS.review2, true) },
    { ev: evHarnessStopped() },
    { ev: evRunFinished("SUCCESS") },
  ]);
  return { manifest, events };
};

/** METRIC06: VALID_FAILURE terminal. */
export const makeValidTerminalFailure: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunFinished("VALID_FAILURE") },
  ]);
  return { manifest, events };
};

/**
 * METRIC07: TIMEOUT run. `RUN_TIMEOUT.observation`
 * carries a `wall_clock_ms` value that the metric module
 * lifts into `resources.observed_wall_clock_ms`.
 */
export const makeTimeoutRun: (args?: {
  readonly seed?: string;
  readonly observedWallClockMs?: number;
}) => {
  readonly manifest: RunManifest;
  readonly events: ReadonlyArray<CommittedRunEvent>;
} = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA) },
    { ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    {
      ev: evRunTimeout(
        "TIMEOUT",
        "wall_clock_ms",
        args?.observedWallClockMs ?? 15000,
      ),
    },
  ]);
  return { manifest, events };
};

/**
 * METRIC08: BUDGET_EXHAUSTED run with `tokens` observation.
 */
export const makeBudgetExhaustedRun: (args?: {
  readonly seed?: string;
  readonly tokens?: number;
}) => {
  readonly manifest: RunManifest;
  readonly events: ReadonlyArray<CommittedRunEvent>;
} = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    {
      ev: evRunTimeout("BUDGET_EXHAUSTED", "tokens", args?.tokens ?? 12345),
    },
  ]);
  return { manifest, events };
};

/** METRIC09: cancelled run. */
export const makeCancelledRun: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunAborted("CANCELLED", "user") },
  ]);
  return { manifest, events };
};

/** METRIC10: incomplete / truncated run (no terminal). */
export const makeIncompleteRun: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
  ]);
  return { manifest, events };
};

/**
 * METRIC13: explicit zero tool calls. Surfaces
 * `tool_calls_total = available(0)`, NOT unavailable,
 * because zero is a legitimate observed value.
 */
export const makeZeroToolCallsRun: StreamBuilder = (args) => {
  const manifest = makeTestManifest({ seed: args?.seed ?? "lh02-corpus" });
  const events = buildStream(manifest, [
    { ev: evRunStarted() },
    { ev: evHarnessStarted() },
    { ev: evActionStarted(FIXTURE_IDS.attemptA) },
    { ev: evActionFinished(FIXTURE_IDS.attemptA, "OK") },
    { ev: evHarnessStopped() },
    { ev: evRunTimeout("TIMEOUT", "tool_calls", 0) },
  ]);
  return { manifest, events };
};

/**
 * METRIC15: deterministic duration. Caller supplies
 * observed_at values explicitly so duration derivations
 * can be checked by hand calculation.
 */
export const makeTimestampedSuccessRun = (args: {
  readonly runStartedMs: number;
  readonly actionStartedMs: number;
  readonly gateFinishedMs: number;
  readonly actionFinishedMs: number;
  readonly terminalMs: number;
}) => {
  const manifest = makeTestManifest({ seed: "lh02-timestamps" });
  const events = buildStream(manifest, [
    { ev: evRunStarted(), observedAt: args.runStartedMs },
    { ev: evHarnessStarted(), observedAt: args.runStartedMs + 10 },
    {
      ev: evActionStarted(FIXTURE_IDS.attemptA),
      observedAt: args.actionStartedMs,
    },
    {
      ev: evGateStarted(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA),
      observedAt: args.actionStartedMs + 10,
    },
    {
      ev: evGateFinished(FIXTURE_IDS.gate1, FIXTURE_IDS.attemptA, true),
      observedAt: args.gateFinishedMs,
    },
    {
      ev: evActionFinished(FIXTURE_IDS.attemptA, "OK"),
      observedAt: args.actionFinishedMs,
    },
    { ev: evHarnessStopped(), observedAt: args.actionFinishedMs + 5 },
    { ev: evRunFinished("SUCCESS"), observedAt: args.terminalMs },
  ]);
  return { manifest, events };
};
