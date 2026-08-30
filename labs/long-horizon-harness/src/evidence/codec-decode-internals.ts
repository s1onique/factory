/**
 * Internal decoders for nested structures of an envelope.
 *
 * Kept in a sibling file so `codec-decode-envelope.ts` stays small.
 *
 * All persisted branded identifiers (including nested `attempt_id`) are
 * validated through the {@link ../domain/ids.ts} parsers and any failure
 * is translated into typed `invalid_evidence` — no `as` assertion at the
 * trust boundary.
 *
 * CORRECTION02: `decodeAttemptIdField` returns `AttemptId` (not `string`)
 * so call-sites can construct PersistedEvent variants without an
 * avoidable type assertion.
 *
 * FOUNDATION03: process-evidence records are decoded by
 * {@link decodePersistedProcessEvidence}. They share the same trust
 * boundary rules.
 */

import { isRunEventType, RUN_EVENT_TYPES } from "../domain/run-event.js";
import {
  andThen,
  err,
  map,
  ok,
  type Result,
} from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type { AttemptId, InvalidId } from "../domain/ids.js";
import { parseAttemptId } from "../domain/ids.js";
import type { PersistedEvent } from "./codec-types.js";
import { decodeBudgetObservation, decodeFailure } from "./codec-decode-failure.js";
import { decodePersistedProcessEvidence } from "./codec-decode-process-evidence.js";

// Re-export so the envelope-level decoder can pull everything from
// a single sibling module.
export { decodePersistedProcessEvidence };

function idToEvidence(field: string, e: InvalidId): InvalidEvidence {
  return {
    kind: "invalid_evidence",
    reason: `Invalid persisted identifier on '${field}': ${e.reason}`,
  };
}

export function decodePersistedEvent(
  value: unknown,
): Result<PersistedEvent, InvalidEvidence> {
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
      return map(decodeAttemptIdField(v), (attempt_id) => ({
        type: t,
        attempt_id,
      }));
    case "agent_reported_completion":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        map(decodeStringField(v, "summary"), (summary) => ({
          type: t,
          attempt_id,
          summary,
        })),
      );
    case "agent_failed":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        map(decodeFailure(v, "failure"), (failure) => ({
          type: t,
          attempt_id,
          failure,
        })),
      );
    case "gating_started":
    case "gate_passed":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        map(decodeStringField(v, "gate"), (gate) => ({
          type: t,
          attempt_id,
          gate,
        })),
      );
    case "gate_failed":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeStringField(v, "gate"), (gate) =>
          map(decodeFailure(v, "failure"), (failure) => ({
            type: t,
            attempt_id,
            gate,
            failure,
          })),
        ),
      );
    case "preparation_failed":
      return map(decodeFailure(v, "failure"), (failure) => ({
        type: t,
        failure,
      }));
    case "repair_started":
    case "blocked":
    case "crashed":
      return map(decodeFailure(v, "reason"), (reason) => ({
        type: t,
        reason,
      }));
    case "review_failed":
      return map(decodeFailure(v, "failure"), (failure) => ({
        type: t,
        failure,
      }));
    case "budget_exhausted":
      return map(decodeBudgetObservation(v, "observation"), (observation) => ({
        type: t,
        observation,
      }));
  }
}

/**
 * Decode the nested `attempt_id` field, validate it against the
 * identifier grammar, and return a typed {@link AttemptId}.
 *
 * Translates any `InvalidId` into `InvalidEvidence`. The returned brand
 * is preserved through the decoder so callers can compose PersistedEvent
 * variants without an avoidable `as PersistedEvent` cast.
 */
export function decodeAttemptIdField(
  v: Record<string, unknown>,
): Result<AttemptId, InvalidEvidence> {
  const r = parseAttemptId(v["attempt_id"]);
  if (r.ok === false) {
    return err(idToEvidence("attempt_id", r.error));
  }
  return ok(r.value);
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
