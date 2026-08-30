/**
 * Lift a typed {@link EventEnvelope} into a {@link CommittedRunEvent}.
 *
 * All branded identifiers were validated by the codec; the inner
 * `attempt_id` (when present) was also a runtime-validated string by
 * the inner decoder. The lift is mechanical.
 *
 * FOUNDATION03: process-evidence envelopes are NOT lifecycle
 * envelopes. Use {@link envelopeToCommittedProcessEvidence} for those.
 */

import type { EventMetadata, CommittedRunEvent } from "../domain/run-event.js";
import {
  envelopeToRunEvent,
  isLifecycleEnvelope,
  isProcessEvidenceEnvelope,
} from "./codec.js";
import type { EventEnvelope } from "./codec.js";
import type { CommittedProcessEvidence } from "./committed-process-evidence.js";

export function envelopeToCommitted(
  envelope: EventEnvelope,
): CommittedRunEvent {
  if (!isLifecycleEnvelope(envelope)) {
    throw new Error(
      "envelopeToCommitted: not a lifecycle envelope; use envelopeToCommittedProcessEvidence for process_evidence.",
    );
  }
  const inner = envelopeToRunEvent(envelope);
  const base: EventMetadata = {
    eventId: envelope.event_id,
    runId: envelope.run_id,
    missionId: envelope.mission_id,
    seq: envelope.sequence,
    observedAt: envelope.observed_at,
  };
  switch (inner.type) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return { ...base, type: inner.type };
    case "preparation_failed":
      return { ...base, type: inner.type, failure: inner.failure };
    case "attempt_started":
      return { ...base, type: inner.type, attemptId: inner.attemptId };
    case "agent_reported_completion":
      return {
        ...base,
        type: inner.type,
        attemptId: inner.attemptId,
        summary: inner.summary,
      };
    case "agent_failed":
      return {
        ...base,
        type: inner.type,
        attemptId: inner.attemptId,
        failure: inner.failure,
      };
    case "gating_started":
    case "gate_passed":
      return {
        ...base,
        type: inner.type,
        attemptId: inner.attemptId,
        gate: inner.gate,
      };
    case "gate_failed":
      return {
        ...base,
        type: inner.type,
        attemptId: inner.attemptId,
        gate: inner.gate,
        failure: inner.failure,
      };
    case "repair_started":
    case "blocked":
    case "crashed":
      return { ...base, type: inner.type, reason: inner.reason };
    case "review_failed":
      return { ...base, type: inner.type, failure: inner.failure };
    case "budget_exhausted":
      return {
        ...base,
        type: inner.type,
        observation: inner.observation,
      };
  }
}

/**
 * Lift a v2 process_evidence envelope into a
 * {@link CommittedProcessEvidence}.
 *
 * The envelope has already been validated by the codec; the inner
 * process_evidence payload is guaranteed to satisfy
 * {@link PersistedProcessEvidencePayload}.
 */
export function envelopeToCommittedProcessEvidence(
  envelope: EventEnvelope,
): CommittedProcessEvidence {
  if (!isProcessEvidenceEnvelope(envelope)) {
    throw new Error(
      "envelopeToCommittedProcessEvidence: not a process_evidence envelope.",
    );
  }
  return {
    eventId: envelope.event_id,
    runId: envelope.run_id,
    missionId: envelope.mission_id,
    seq: envelope.sequence,
    observedAt: envelope.observed_at,
    payload: envelope.process_evidence,
  };
}
