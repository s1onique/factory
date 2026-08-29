/**
 * Encoder: lift typed domain events into the persisted envelope shape.
 */

import type { RunEvent } from "../domain/run-event.js";
import type { Failure } from "../domain/failure.js";
import type { BudgetObservation } from "../domain/budget.js";
import type {
  EventEnvelope,
  PersistedBudgetObservation,
  PersistedEvent,
  PersistedFailure,
} from "./codec-types.js";
import type { EventId, MissionId, RunId } from "../domain/ids.js";

export function encodeEnvelope(args: {
  readonly eventId: string;
  readonly runId: string;
  readonly missionId: string;
  readonly sequence: number;
  readonly observedAt: number;
  readonly event: RunEvent;
}): EventEnvelope {
  return {
    schema_version: 1,
    event_id: args.eventId as EventId,
    run_id: args.runId as RunId,
    mission_id: args.missionId as MissionId,
    sequence: args.sequence,
    observed_at: args.observedAt,
    event: encodePersistedEvent(args.event),
  };
}

export function encodePersistedEvent(e: RunEvent): PersistedEvent {
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
