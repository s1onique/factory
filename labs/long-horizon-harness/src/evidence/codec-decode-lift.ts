/**
 * Lift a typed envelope into a {@link RunEvent}.
 *
 * The envelope has already been validated by {@link decodeEnvelope}; this
 * file is a mechanical translation from the persisted shape to the in-memory
 * domain shape.
 *
 * Process-evidence envelopes are NOT lifecycle envelopes. The caller
 * is responsible for branching on `envelope.kind` before calling this
 * function.
 */

import type { BudgetObservation } from "../domain/budget.js";
import type { Failure } from "../domain/failure.js";
import type { RunEvent } from "../domain/run-event.js";
import type { EventEnvelope, PersistedEvent } from "./codec-types.js";

/**
 * Type guard: returns true iff the envelope carries a lifecycle payload
 * (either schema_version 1 or schema_version 2 with kind "lifecycle").
 */
export function isLifecycleEnvelope(
  envelope: EventEnvelope,
): envelope is Extract<EventEnvelope, { event: PersistedEvent }> {
  return "event" in envelope;
}

/**
 * Type guard: returns true iff the envelope carries a process_evidence
 * payload (schema_version 2 with kind "process_evidence").
 */
export function isProcessEvidenceEnvelope(
  envelope: EventEnvelope,
): envelope is Extract<EventEnvelope, { kind: "process_evidence" }> {
  return (
    envelope.schema_version === 2 &&
    "process_evidence" in envelope &&
    envelope.kind === "process_evidence"
  );
}

export function envelopeToRunEvent(envelope: EventEnvelope): RunEvent {
  if (!isLifecycleEnvelope(envelope)) {
    throw new Error(
      "envelopeToRunEvent: not a lifecycle envelope (process_evidence?); caller must branch on kind first.",
    );
  }
  const common = {
    eventId: envelope.event_id,
    runId: envelope.run_id,
    missionId: envelope.mission_id,
    seq: envelope.sequence,
    observedAt: envelope.observed_at,
  } as const;
  const e = envelope.event;
  switch (e.type) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return { type: e.type, ...common };
    case "preparation_failed":
      return { type: e.type, ...common, failure: persistedFailureToFailure(e.failure) };
    case "attempt_started":
      return { type: e.type, ...common, attemptId: e.attempt_id };
    case "agent_reported_completion":
      return { type: e.type, ...common, attemptId: e.attempt_id, summary: e.summary };
    case "agent_failed":
      return { type: e.type, ...common, attemptId: e.attempt_id, failure: persistedFailureToFailure(e.failure) };
    case "gating_started":
    case "gate_passed":
      return { type: e.type, ...common, attemptId: e.attempt_id, gate: e.gate };
    case "gate_failed":
      return {
        type: e.type,
        ...common,
        attemptId: e.attempt_id,
        gate: e.gate,
        failure: persistedFailureToFailure(e.failure),
      };
    case "repair_started":
    case "blocked":
    case "crashed":
      return { type: e.type, ...common, reason: persistedFailureToFailure(e.reason) };
    case "review_failed":
      return { type: e.type, ...common, failure: persistedFailureToFailure(e.failure) };
    case "budget_exhausted":
      return {
        type: e.type,
        ...common,
        observation: persistedBudgetObservationToObservation(e.observation),
      };
  }
}

function persistedFailureToFailure(p: import("./codec-types.js").PersistedFailure): Failure {
  switch (p.kind) {
    case "candidate_failure":
      return { kind: p.kind, code: p.code, message: p.message };
    case "tool_failure":
      return { kind: p.kind, tool: p.tool, message: p.message };
    case "gate_failure":
      return { kind: p.kind, gate: p.gate, message: p.message };
    case "policy_denied":
      return { kind: p.kind, policy: p.policy, message: p.message };
    case "timeout":
      return { kind: p.kind, subject: p.subject, message: p.message };
    case "budget_exhausted":
      return {
        kind: p.kind,
        budget: p.budget,
        limit: p.limit,
        observed: p.observed,
        message: p.message,
      };
    case "invalid_evidence":
      return { kind: p.kind, reason: p.reason };
    case "invalid_transition":
      return { kind: p.kind, from: p.from, event: p.event, message: p.message };
    case "internal_failure":
      return { kind: p.kind, message: p.message };
  }
}

function persistedBudgetObservationToObservation(
  p: import("./codec-types.js").PersistedBudgetObservation,
): BudgetObservation {
  return { kind: p.kind, limit: p.limit, observed: p.observed };
}
