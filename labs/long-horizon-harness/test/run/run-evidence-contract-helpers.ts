/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Test helpers for run-evidence-contract.test.ts. Splits out
 * shared fixtures so the test file itself can stay under the
 * SOURCE_SIZE_DISCIPLINE ceiling.
 */

import type {
  CommittedRunEvent,
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
  makeRunId,
} from "../../src/run/run-types.js";
import type { SubjectId } from "../../src/subject/subject-types.js";
import { makeSubjectId } from "../../src/subject/index.js";

export function makeTestSubjectId(label: string = "subj-phase-e"): SubjectId {
  // SubjectId grammar: /^subject:[0-9a-f]{64}$/. Synthesize
  // a deterministic 64-hex-digit tail from the label.
  const onlyHex = label.replace(/[^0-9a-f]/g, "a");
  let hex: string;
  if (onlyHex.length === 64) {
    hex = onlyHex;
  } else if (onlyHex.length > 64) {
    hex = onlyHex.slice(0, 64);
  } else {
    hex = onlyHex.padEnd(64, "0");
  }
  return makeSubjectId(`subject:${hex}`);
}

export function makeTestManifest(args?: {
  readonly subjectId?: SubjectId;
  readonly repetitionIndex?: number;
  readonly seed?: string;
}): RunManifest {
  const subjectId = args?.subjectId ?? makeTestSubjectId();
  const repetition = {
    index: args?.repetitionIndex ?? 0,
    ...(args?.seed !== undefined ? { seed: args.seed } : {}),
  };
  const runId = computeRunId({
    subjectId,
    runSchemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    repetition,
  });
  return {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    subject_id: subjectId,
    run_protocol_version: "phase-e.test.v1",
    runner_revision: "test-runner",
    started_by: "test-runner",
    created_at: 0,
    repetition,
  };
}

export function commitEvent(
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

export function seqEventIds(runId: RunId): ReadonlyArray<RunEventId> {
  return [
    makeRunEventId(`evt:${runId}:1`),
    makeRunEventId(`evt:${runId}:2`),
    makeRunEventId(`evt:${runId}:3`),
    makeRunEventId(`evt:${runId}:4`),
    makeRunEventId(`evt:${runId}:5`),
    makeRunEventId(`evt:${runId}:6`),
    makeRunEventId(`evt:${runId}:7`),
    makeRunEventId(`evt:${runId}:8`),
    makeRunEventId(`evt:${runId}:9`),
    makeRunEventId(`evt:${runId}:10`),
    makeRunEventId(`evt:${runId}:11`),
    makeRunEventId(`evt:${runId}:12`),
    makeRunEventId(`evt:${runId}:13`),
    makeRunEventId(`evt:${runId}:14`),
    makeRunEventId(`evt:${runId}:15`),
    makeRunEventId(`evt:${runId}:16`),
    makeRunEventId(`evt:${runId}:17`),
    makeRunEventId(`evt:${runId}:18`),
    makeRunEventId(`evt:${runId}:19`),
    makeRunEventId(`evt:${runId}:20`),
    makeRunEventId(`evt:${runId}:21`),
    makeRunEventId(`evt:${runId}:22`),
    makeRunEventId(`evt:${runId}:23`),
    makeRunEventId(`evt:${runId}:24`),
    makeRunEventId(`evt:${runId}:25`),
    makeRunEventId(`evt:${runId}:26`),
    makeRunEventId(`evt:${runId}:27`),
    makeRunEventId(`evt:${runId}:28`),
    makeRunEventId(`evt:${runId}:29`),
    makeRunEventId(`evt:${runId}:30`),
    makeRunEventId(`evt:${runId}:31`),
    makeRunEventId(`evt:${runId}:32`),
  ];
}

export const ids = {
  attempt: makeAttemptId("attempt:001"),
  attempt2: makeAttemptId("attempt:002"),
  attempt3: makeAttemptId("attempt:003"),
  gate: makeGateId("gate:001"),
  gate2: makeGateId("gate:002"),
  gate3: makeGateId("gate:003"),
  repair: makeRepairCycleId("repair:001"),
  review: makeReviewCycleId("review:001"),
  review2: makeReviewCycleId("review:002"),
  runId: makeRunId("run:placeholder"),
};

/**
 * Build a minimal SUCCESS run that also satisfies the E-C02
 * authoritative-success predicate. The stream MUST contain:
 *
 *   RUN_STARTED
 *   HARNESS_STARTED
 *   ACTION_STARTED (open attempt)
 *   GATE_STARTED (gate inside the open attempt)
 *   GATE_FINISHED(pass=true)
 *   ACTION_FINISHED (OK) (closes the attempt)
 *   HARNESS_STOPPED
 *   RUN_FINISHED(SUCCESS)
 *
 * GATE_STARTED requires an open attempt; therefore the gate
 * must run BEFORE the closing ACTION_FINISHED.
 */
export function minimalSuccessRun(): {
  readonly manifest: RunManifest;
  readonly events: ReadonlyArray<CommittedRunEvent>;
} {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      { type: "HARNESS_STARTED" },
      2,
      eids[1]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } },
      3,
      eids[2]!,
    ),
    commitEvent(
      manifest,
      {
        type: "GATE_STARTED",
        gate_id: ids.gate,
        attempt_id: ids.attempt,
      },
      4,
      eids[3]!,
    ),
    commitEvent(
      manifest,
      {
        type: "GATE_FINISHED",
        gate_id: ids.gate,
        attempt_id: ids.attempt,
        pass: true,
      },
      5,
      eids[4]!,
    ),
    commitEvent(
      manifest,
      {
        type: "ACTION_FINISHED",
        target: { kind: "attempt", attempt_id: ids.attempt },
        status: "OK",
      },
      6,
      eids[5]!,
    ),
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 7, eids[6]!),
    commitEvent(
      manifest,
      { type: "RUN_FINISHED", semantic: "SUCCESS" },
      8,
      eids[7]!,
    ),
  ];
  return { manifest, events };
}
