/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 * Per-event legality helpers. Each `apply*` helper owns ONE event
 * variant. Pure: no I/O.
 */

import type { CommittedRunEvent, RunEvent, TerminalSemantic } from "./run-types.js";
import type { LegalityTracker, LegalityResult } from "./run-events.js";

export function applyHarnessStarted(tracker: LegalityTracker): LegalityResult {
  if (tracker.harnessStarted) {
    return {
      ok: false,
      failure: {
        kind: "harness_stopped_without_start",
        reason: "HARNESS_STARTED already observed",
      },
    };
  }
  tracker.harnessStarted = true;
  return { ok: true };
}

export function applyHarnessStopped(tracker: LegalityTracker): LegalityResult {
  if (!tracker.harnessStarted) {
    return {
      ok: false,
      failure: {
        kind: "harness_stopped_without_start",
        reason: "HARNESS_STOPPED observed without prior HARNESS_STARTED",
      },
    };
  }
  if (tracker.harnessStopped) {
    return {
      ok: false,
      failure: {
        kind: "harness_stopped_without_start",
        reason: "HARNESS_STOPPED already observed",
      },
    };
  }
  tracker.harnessStopped = true;
  return { ok: true };
}

export function applyActionStarted(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (tracker.openAttemptId !== null) {
    return {
      ok: false,
      failure: {
        kind: "gate_started_without_open_attempt",
        reason: "ACTION_STARTED observed while an attempt is already open",
      },
    };
  }
  if (event.event.type !== "ACTION_STARTED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyActionStarted called on non-ACTION_STARTED event",
      },
    };
  }
  if (event.event.target.kind !== "attempt") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "ACTION_STARTED.target.kind must be 'attempt'",
      },
    };
  }
  tracker.openAttemptId = event.event.target.attempt_id;
  return { ok: true };
}

export function applyActionFinished(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (tracker.openAttemptId === null) {
    return {
      ok: false,
      failure: {
        kind: "action_finished_without_open_attempt",
        reason: "ACTION_FINISHED observed without a matching ACTION_STARTED",
      },
    };
  }
  if (event.event.type !== "ACTION_FINISHED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyActionFinished called on non-ACTION_FINISHED event",
      },
    };
  }
  if (
    event.event.target.kind !== "attempt" ||
    event.event.target.attempt_id !== tracker.openAttemptId
  ) {
    return {
      ok: false,
      failure: {
        kind: "action_finished_without_open_attempt",
        reason: "ACTION_FINISHED.target does not match the open attempt",
      },
    };
  }
  tracker.openAttemptId = null;
  tracker.actionFinishedCount += 1;
  return { ok: true };
}

export function applyGateStarted(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (tracker.openAttemptId === null) {
    return {
      ok: false,
      failure: {
        kind: "gate_started_without_open_attempt",
        reason: "GATE_STARTED observed without an open attempt",
      },
    };
  }
  if (tracker.openGateId !== null) {
    return {
      ok: false,
      failure: {
        kind: "gate_started_without_open_attempt",
        reason: "GATE_STARTED observed while a gate is already open",
      },
    };
  }
  if (event.event.type !== "GATE_STARTED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyGateStarted called on non-GATE_STARTED event",
      },
    };
  }
  if (event.event.attempt_id !== tracker.openAttemptId) {
    return {
      ok: false,
      failure: {
        kind: "gate_started_without_open_attempt",
        reason: "GATE_STARTED.attempt_id does not match the open attempt",
      },
    };
  }
  tracker.openGateId = event.event.gate_id;
  tracker.openGateAttemptId = event.event.attempt_id;
  return { ok: true };
}

export function applyGateFinished(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (
    tracker.openGateId === null ||
    event.event.type !== "GATE_FINISHED" ||
    tracker.openGateId !== event.event.gate_id
  ) {
    return {
      ok: false,
      failure: {
        kind: "gate_finished_without_open_gate",
        reason: "GATE_FINISHED observed without a matching open gate",
      },
    };
  }
  if (
    tracker.openGateAttemptId === null ||
    tracker.openGateAttemptId !== event.event.attempt_id
  ) {
    return {
      ok: false,
      failure: {
        kind: "gate_finished_without_open_gate",
        reason: "GATE_FINISHED.attempt_id does not match the open gate",
      },
    };
  }
  tracker.openGateId = null;
  tracker.openGateAttemptId = null;
  // E-C02: record latest gate-finished for current_gate and
  // for the passing-gate counter.
  tracker.lastGateFinishedId = event.event.gate_id;
  tracker.lastGateFinishedAttemptId = event.event.attempt_id;
  tracker.lastGateFinishedPass = event.event.pass;
  // E-C14: capture (workEpoch, pass) at gate close. The success
  // predicate compares the recorded epoch to the current work
  // epoch; any later REPAIR advances workEpoch and invalidates
  // this record.
  tracker.closureGateEpoch = tracker.workEpoch;
  tracker.closureGatePass = event.event.pass;
  if (event.event.pass === true) {
    tracker.passingGateCount += 1;
  }
  return { ok: true };
}

export function applyRepairStarted(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (event.event.type !== "REPAIR_STARTED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyRepairStarted called on non-REPAIR_STARTED event",
      },
    };
  }
  if (tracker.openRepairId !== null) {
    return {
      ok: false,
      failure: {
        kind: "repair_finished_without_open_repair",
        reason: "REPAIR_STARTED observed while a repair is already open",
      },
    };
  }
  tracker.openRepairId = event.event.repair_id;
  tracker.repair_count += 1;
  // E-C14: REPAIR mutates the artifact under qualification.
  // Advance workEpoch so any prior closure-authority gate is
  // stale; the success predicate will require a fresh closing
  // gate at the new epoch.
  tracker.workEpoch += 1;
  return { ok: true };
}

export function applyRepairFinished(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (event.event.type !== "REPAIR_FINISHED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyRepairFinished called on non-REPAIR_FINISHED event",
      },
    };
  }
  if (
    tracker.openRepairId === null ||
    tracker.openRepairId !== event.event.repair_id
  ) {
    return {
      ok: false,
      failure: {
        kind: "repair_finished_without_open_repair",
        reason: "REPAIR_FINISHED observed without a matching REPAIR_STARTED",
      },
    };
  }
  tracker.openRepairId = null;
  return { ok: true };
}

export function applyReviewStarted(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (event.event.type !== "REVIEW_STARTED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyReviewStarted called on non-REVIEW_STARTED event",
      },
    };
  }
  if (tracker.openReviewId !== null) {
    return {
      ok: false,
      failure: {
        kind: "review_finished_without_open_review",
        reason: "REVIEW_STARTED observed while a review is already open",
      },
    };
  }
  tracker.openReviewId = event.event.review_id;
  tracker.review_count += 1;
  return { ok: true };
}

export function applyReviewFinished(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  if (event.event.type !== "REVIEW_FINISHED") {
    return {
      ok: false,
      failure: {
        kind: "illegal_sequence",
        reason: "applyReviewFinished called on non-REVIEW_FINISHED event",
      },
    };
  }
  if (
    tracker.openReviewId === null ||
    tracker.openReviewId !== event.event.review_id
  ) {
    return {
      ok: false,
      failure: {
        kind: "review_finished_without_open_review",
        reason: "REVIEW_FINISHED observed without a matching REVIEW_STARTED",
      },
    };
  }
  tracker.openReviewId = null;
  return { ok: true };
}

/**
 * Terminal-claim dispatcher. Per E-C03, only events that COMPLETE
 * the run participate in closure: RUN_TIMEOUT, RUN_FINISHED,
 * RUN_ABORTED. `RUN_CANCEL_REQUESTED` is NOT terminal — it is a
 * request; only the subsequent terminal event (typically
 * RUN_ABORTED(CANCELLED)) closes the run.
 */
export function applyTerminal(
  tracker: LegalityTracker,
  event: CommittedRunEvent,
): LegalityResult {
  const semantic = terminalSemanticOf(event.event);
  if (semantic === null) {
    return {
      ok: false,
      failure: {
        kind: "conflicting_terminal",
        reason:
          `terminal event '${event.event.type}' has no terminal_semantic`,
      },
    };
  }
  if (!tracker.seenTerminal) {
    tracker.seenTerminal = true;
    tracker.terminalSemantic = semantic;
    return { ok: true };
  }
  if (tracker.terminalSemantic !== semantic) {
    return {
      ok: false,
      failure: {
        kind: "conflicting_terminal",
        reason:
          `terminal event '${event.event.type}' carries semantic '${semantic}' which conflicts with prior '${tracker.terminalSemantic}'`,
      },
    };
  }
  return { ok: true };
}

/**
 * Map a RunEvent to its terminal-semantic claim.
 *
 * RUN_CANCEL_REQUESTED returns null: cancellation REQUESTED
 * is observation only; the actual closure must come from a
 * subsequent RUN_ABORTED(CANCELLED) or RUN_TIMEOUT(CANCELLED).
 *
 * RUN_TIMEOUT / RUN_FINISHED / RUN_ABORTED return the
 * declared terminal_semantic.
 */
export function terminalSemanticOf(event: RunEvent): TerminalSemantic | null {
  switch (event.type) {
    case "RUN_TIMEOUT":
    case "RUN_FINISHED":
    case "RUN_ABORTED":
      return event.semantic;
    default:
      return null;
  }
}
