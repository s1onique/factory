/**
 * Encoder: lift a typed {@link CommittedRunEvent} into the persisted
 * envelope shape.
 *
 * The encoder accepts a single committed event (payload + metadata)
 * and derives the envelope identity from that event's branded fields.
 * No `as` assertions are used.
 *
 * FOUNDATION03 schema evolution:
 *   - lifecycle records continue to be encoded as schema_version 2
 *     envelopes with an explicit `kind: "lifecycle"` discriminator.
 *   - process evidence records are encoded as schema_version 2
 *     envelopes with `kind: "process_evidence"` and a
 *     `process_evidence` payload.
 *   - v1 lifecycle records are still decodable (see codec-decode-
 *     envelope.ts) but are not emitted by this encoder.
 */

import type { CommittedRunEvent } from "../domain/run-event.js";
import type { Failure } from "../domain/failure.js";
import type { BudgetObservation } from "../domain/budget.js";
import type { CommittedProcessEvidence } from "./committed-process-evidence.js";
import type {
  EventEnvelope,
  PersistedBudgetObservation,
  PersistedEvent,
  PersistedFailure,
  PersistedProcessEvidencePayload,
} from "./codec-types.js";

export function encodeEnvelope(event: CommittedRunEvent): EventEnvelope {
  return {
    schema_version: 2,
    event_id: event.eventId,
    run_id: event.runId,
    mission_id: event.missionId,
    sequence: event.seq,
    observed_at: event.observedAt,
    kind: "lifecycle",
    event: encodePersistedEvent(event),
  };
}

/**
 * Encode a committed process-evidence record into a v2 envelope.
 */
export function encodeProcessEvidenceEnvelope(
  evidence: CommittedProcessEvidence,
): EventEnvelope {
  return {
    schema_version: 2,
    event_id: evidence.eventId,
    run_id: evidence.runId,
    mission_id: evidence.missionId,
    sequence: evidence.seq,
    observed_at: evidence.observedAt,
    kind: "process_evidence",
    process_evidence: encodePersistedProcessEvidence(evidence.payload),
  };
}

export function encodePersistedProcessEvidence(
  p: import("./codec-types.js").PersistedProcessEvidencePayload,
): PersistedProcessEvidencePayload {
  // Identity function for now (persisted shape == typed shape).
  // Kept as a named function so any future normalisation lives
  // in one place.
  return p;
}

export function encodePersistedEvent(e: CommittedRunEvent): PersistedEvent {
  switch (e.type) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return { type: e.type };
    case "preparation_failed":
      return { type: e.type, failure: encodeFailure(e.failure) };
    case "attempt_started":
      return { type: e.type, attempt_id: e.attemptId };
    case "agent_reported_completion":
      return { type: e.type, attempt_id: e.attemptId, summary: e.summary };
    case "agent_failed":
      return { type: e.type, attempt_id: e.attemptId, failure: encodeFailure(e.failure) };
    case "gating_started":
      return { type: e.type, attempt_id: e.attemptId, gate: e.gate };
    case "gate_passed":
      return { type: e.type, attempt_id: e.attemptId, gate: e.gate };
    case "gate_failed":
      return {
        type: e.type,
        attempt_id: e.attemptId,
        gate: e.gate,
        failure: encodeFailure(e.failure),
      };
    case "repair_started":
      return { type: e.type, reason: encodeFailure(e.reason) };
    case "review_failed":
      return { type: e.type, failure: encodeFailure(e.failure) };
    case "budget_exhausted":
      return { type: e.type, observation: encodeBudgetObservation(e.observation) };
    case "blocked":
      return { type: e.type, reason: encodeFailure(e.reason) };
    case "crashed":
      return { type: e.type, reason: encodeFailure(e.reason) };
  }
}

export function encodeFailure(f: Failure): PersistedFailure {
  switch (f.kind) {
    case "candidate_failure":
      return { kind: f.kind, code: f.code, message: f.message };
    case "tool_failure":
      return { kind: f.kind, tool: f.tool, message: f.message };
    case "gate_failure":
      return { kind: f.kind, gate: f.gate, message: f.message };
    case "policy_denied":
      return { kind: f.kind, policy: f.policy, message: f.message };
    case "timeout":
      return { kind: f.kind, subject: f.subject, message: f.message };
    case "budget_exhausted":
      return {
        kind: f.kind,
        budget: f.budget,
        limit: f.limit,
        observed: f.observed,
        message: f.message,
      };
    case "invalid_evidence":
      return { kind: f.kind, reason: f.reason };
    case "invalid_transition":
      return {
        kind: f.kind,
        from: f.from,
        event: f.event,
        message: f.message,
      };
    case "internal_failure":
      return { kind: f.kind, message: f.message };
  }
}

export function encodeBudgetObservation(
  o: BudgetObservation,
): PersistedBudgetObservation {
  return { kind: o.kind, limit: o.limit, observed: o.observed };
}
