/**
 * Internal decoders for nested structures of an envelope.
 *
 * Kept in a sibling file to keep `codec-decode.ts` short enough to read.
 */

import { isRunEventType } from "../domain/run-event.js";
import { RUN_EVENT_TYPES } from "../domain/run-event.js";
import { andThen, err, map, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type {
  PersistedEvent,
} from "./codec-types.js";
import { decodeFailure } from "./codec-decode-failure.js";
import { decodeBudgetObservation } from "./codec-decode-failure.js";

export function decodePersistedEvent(value: unknown): Result<PersistedEvent, InvalidEvidence> {
  if (typeof value !== "object" || value === null) {
    return err({ kind: "invalid_evidence", reason: "Persisted event must be a non-null object." });
  }
  const v = value as Record<string, unknown>;
  const t = v["type"];
  if (typeof t !== "string") {
    return err({ kind: "invalid_evidence", reason: "Persisted event missing string 'type'." });
  }
  if (!isRunEventType(t)) {
    return err({
      kind: "invalid_evidence",
      reason: `Unknown event type '${t}'. Expected one of: ${RUN_EVENT_TYPES.join(", ")}.`,
    });
  }
  switch (t) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return ok({ type: t });
    case "attempt_started":
      return map(decodeStringField(v, "attempt_id"), (attempt_id) =>
        ({ type: t, attempt_id } as PersistedEvent),
      );
    case "agent_reported_completion":
      return andThen(decodeStringField(v, "attempt_id"), (attempt_id) =>
        map(decodeStringField(v, "summary"), (summary) =>
          ({ type: t, attempt_id, summary } as PersistedEvent),
        ),
      );
    case "agent_failed":
      return andThen(decodeStringField(v, "attempt_id"), (attempt_id) =>
        map(decodeFailure(v, "failure"), (failure) =>
          ({ type: t, attempt_id, failure } as PersistedEvent),
        ),
      );
    case "gating_started":
    case "gate_passed":
      return andThen(decodeStringField(v, "attempt_id"), (attempt_id) =>
        map(decodeStringField(v, "gate"), (gate) =>
          ({ type: t, attempt_id, gate } as PersistedEvent),
        ),
      );
    case "gate_failed":
      return andThen(decodeStringField(v, "attempt_id"), (attempt_id) =>
        andThen(decodeStringField(v, "gate"), (gate) =>
          map(decodeFailure(v, "failure"), (failure) =>
            ({ type: t, attempt_id, gate, failure } as PersistedEvent),
          ),
        ),
      );
    case "preparation_failed":
      return map(decodeFailure(v, "failure"), (failure) =>
        ({ type: t, failure } as PersistedEvent),
      );
    case "repair_started":
    case "blocked":
    case "crashed":
      return map(decodeFailure(v, "reason"), (reason) =>
        ({ type: t, reason } as PersistedEvent),
      );
    case "review_failed":
      return map(decodeFailure(v, "failure"), (failure) =>
        ({ type: t, failure } as PersistedEvent),
      );
    case "budget_exhausted":
      return map(decodeBudgetObservation(v, "observation"), (observation) =>
        ({ type: t, observation } as PersistedEvent),
      );
  }
}

export function decodeStringField(
  v: Record<string, unknown>,
  field: string,
): Result<string, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "string" || x.length === 0) {
    return err({ kind: "invalid_evidence", reason: `Field '${field}' must be a non-empty string.` });
  }
  return ok(x);
}
