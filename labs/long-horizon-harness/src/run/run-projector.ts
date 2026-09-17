/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * The canonical pure projector (E11, E12).
 *
 * `projectRun(manifest, orderedEvents)` folds the ordered evidence
 * stream through the lifecycle legality checker (run-events.ts)
 * and produces a RunProjection.
 *
 * Doctrine:
 *
 *   - The projector is PURE: no I/O, no clock, no randomness.
 *   - The projector is the SINGLE authority for run-state
 *     derivation. No competing logic is allowed in runner / UI /
 *     test code.
 *   - Given the same (manifest, orderedEvents), the projector
 *     ALWAYS produces structurally identical output. This is the
 *     LIVE_PROJECTION == REPLAY_PROJECTION oracle (E12).
 *   - An empty event list yields `lifecycle_state = INCOMPLETE`.
 *   - A non-empty stream ending without a terminal event yields
 *     `lifecycle_state = ACTIVE`.
 *   - A stream with one or more compatible terminal events yields
 *     `lifecycle_state = TERMINAL` and the derived terminal_outcome.
 *   - A stream with sequence / identity violations or
 *     incompatible terminal claims yields
 *     `lifecycle_state = INVALID_EVIDENCE`.
 *
 * This module is pure: no I/O.
 */

import type {
  CommittedRunEvent,
  RunManifest,
  RunProjection,
  RunEventId,
  AttemptId,
  GateId,
} from "./run-types.js";
import type { ProjectionFailure, ProjectionResult } from "./run-types.js";
import {
  applyLegality,
  emptyTracker,
  type LegalityTracker,
} from "./run-events.js";

/**
 * Build the initial RunProjection for an empty stream.
 *
 * Per E14, an empty stream is INCOMPLETE: no terminal evidence
 * is present, but nothing is necessarily wrong. The projector
 * MUST distinguish this case from a stream that has not yet
 * observed a terminal event but is still actively appending.
 */
function initialProjection(manifest: RunManifest): RunProjection {
  return {
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    lifecycle_state: "INCOMPLETE",
    terminal_outcome: null,
    current_attempt: { kind: "none" },
    current_gate: { kind: "none" },
    repair_count: 0,
    review_count: 0,
    last_sequence: 0,
    event_count: 0,
  };
}

/**
 * Authoritative-success predicate (E-C02).
 *
 * The projector is the single authority joining two worlds:
 *
 *   - what the run CLAIMED happened (terminal_semantic)
 *   - what independently captured evidence PROVES happened
 *
 * The model/harness self-report is NEVER authoritative about
 * success (E7). A RUN_FINISHED(SUCCESS) event is necessary but
 * NOT sufficient; the run must also carry mechanical evidence
 * that the harness actually completed work and reached a
 * passing closure authority.
 *
 * V1 minimum authoritative-success evidence:
 *
 *   1. RUN_STARTED                       (run was initiated)
 *   2. HARNESS_STARTED                   (harness actually ran)
 *   3. HARNESS_STOPPED                   (harness actually stopped)
 *   4. at least one ACTION_FINISHED      (work was performed)
 *   5. at least one GATE_FINISHED(pass=true)
 *                                       (an independent passing
 *                                        closure authority was
 *                                        exercised)
 *   6. no open attempt / gate / repair / review at close
 *
 * If any of these is missing while terminal_semantic claims
 * SUCCESS, the projection is INVALID_EVIDENCE — not a tainted
 * SUCCESS. The state-machine integrity is preserved; the
 * evidence, not the assertion, governs the outcome.
 */
export function successEvidencePredicateSatisfied(
  tracker: LegalityTracker,
): boolean {
  if (!tracker.seenRunStarted) return false;
  if (!tracker.harnessStarted) return false;
  if (!tracker.harnessStopped) return false;
  if (tracker.actionFinishedCount < 1) return false;
  if (tracker.passingGateCount < 1) return false;
  if (tracker.openAttemptId !== null) return false;
  if (tracker.openGateId !== null) return false;
  if (tracker.openRepairId !== null) return false;
  if (tracker.openReviewId !== null) return false;
  return true;
}

/**
 * Build the projector-state from the tracker after a successful
 * fold. The projector is the single owner of this derivation.
 */
function projectionFromTracker(
  manifest: RunManifest,
  tracker: LegalityTracker,
): RunProjection {
  // E-C02: enforce authoritative-success predicate before
  // promoting a SUCCESS claim to the terminal outcome. The
  // model/harness self-report is NEVER authoritative; success
  // requires independently captured passing closure evidence.
  if (
    tracker.seenTerminal &&
    tracker.terminalSemantic === "SUCCESS" &&
    !successEvidencePredicateSatisfied(tracker)
  ) {
    return {
      run_id: manifest.run_id,
      subject_id: manifest.subject_id,
      lifecycle_state: "INVALID_EVIDENCE",
      terminal_outcome: null,
      current_attempt: projectionAttemptView(tracker),
      current_gate: projectionGateView(tracker),
      repair_count: tracker.repair_count,
      review_count: tracker.review_count,
      last_sequence: tracker.lastSeq,
      event_count: tracker.eventIdToContent.size,
    };
  }

  const lifecycle: RunProjection["lifecycle_state"] = tracker.seenTerminal
    ? "TERMINAL"
    : tracker.seenRunStarted
      ? "ACTIVE"
      : "INCOMPLETE";
  const currentAttempt: RunProjection["current_attempt"] =
    projectionAttemptView(tracker);
  const currentGate: RunProjection["current_gate"] = projectionGateView(tracker);

  return {
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    lifecycle_state: lifecycle,
    terminal_outcome: tracker.terminalSemantic,
    current_attempt: currentAttempt,
    current_gate: currentGate,
    repair_count: tracker.repair_count,
    review_count: tracker.review_count,
    last_sequence: tracker.lastSeq,
    event_count: tracker.eventIdToContent.size,
  };
}

function projectionAttemptView(
  tracker: LegalityTracker,
): RunProjection["current_attempt"] {
  if (tracker.openAttemptId !== null) {
    return { kind: "open", attempt_id: tracker.openAttemptId as AttemptId };
  }
  return tracker.seenRunStarted ? { kind: "closed" } : { kind: "none" };
}

function projectionGateView(
  tracker: LegalityTracker,
): RunProjection["current_gate"] {
  if (tracker.openGateId !== null) {
    return {
      kind: "running",
      gate_id: tracker.openGateId as GateId,
      attempt_id: tracker.openGateAttemptId as AttemptId,
    };
  }
  if (tracker.lastGateFinishedPass !== null) {
    return {
      kind: "finished",
      gate_id: tracker.lastGateFinishedId as GateId,
      attempt_id: tracker.lastGateFinishedAttemptId as AttemptId,
      pass: tracker.lastGateFinishedPass,
    };
  }
  return { kind: "none" };
}

/**
 * The canonical pure projector. See module header for the doctrine.
 */
export function projectRun(
  manifest: RunManifest,
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): ProjectionResult {
  // Defense in depth: the projector itself is total. We do NOT
  // call any Reflect / Object method that might trap; the only
  // throwable operation is constructing an Error, which we route
  // through an outer try/catch that returns a typed failure.
  try {
    const tracker = emptyTracker();
    for (const event of orderedEvents) {
      // Identity binding (E13): every event MUST name the same
      // run + subject the manifest declares.
      if (event.run_id !== manifest.run_id) {
        return projectionFailure({
          kind: "identity_mismatch",
          field: "run_id",
          reason:
            `event run_id '${event.run_id}' does not match manifest run_id '${manifest.run_id}'`,
        });
      }
      if (event.subject_id !== manifest.subject_id) {
        return projectionFailure({
          kind: "identity_mismatch",
          field: "subject_id",
          reason:
            `event subject_id '${event.subject_id}' does not match manifest subject_id '${manifest.subject_id}'`,
        });
      }
      const r = applyLegality(tracker, event);
      if (!r.ok) {
        return projectionFailure({
          kind: "illegal_event",
          reason: r.failure.reason,
        });
      }
    }
    return {
      ok: true,
      value: projectionFromTracker(manifest, tracker),
    };
  } catch {
    return projectionFailure({
      kind: "evidence_failure",
      reason: "boundary_exception during projection: opaque thrown value",
    });
  }
}

/**
 * Convenience: project an empty stream. Always returns the
 * initial INCOMPLETE projection. Used by tests and by the
 * store implementation to surface the absence of evidence.
 */
export function projectEmptyRun(manifest: RunManifest): RunProjection {
  return initialProjection(manifest);
}

function projectionFailure(f: ProjectionFailure): ProjectionResult {
  return { ok: false, failure: f };
}

/**
 * Re-export of the RunEventId brand constructor for the
 * projector / store. Used to stamp sequence-bound event_ids in
 * the test corpus.
 */
export type { RunEventId };
