/**
 * Envelope-level decoder.
 *
 * This is the trust boundary for persisted identifier fields. Every
 * branded identifier carried by the envelope is validated by the
 * {@link parseRunId} / family functions in {@link ../domain/ids.ts}.
 * Invalid identifiers are translated into typed `invalid_evidence`
 * errors — no `as` assertion is allowed at the trust boundary.
 */

import type { InvalidEvidence } from "../domain/failure.js";
import type { InvalidId } from "../domain/ids.js";
import {
  parseAttemptId,
  parseEventId,
  parseMissionId,
  parseRunId,
} from "../domain/ids.js";
import { andThen, err, ok, type Result } from "../domain/result.js";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  type EventEnvelope,
} from "./codec-types.js";
import { decodePersistedEvent } from "./codec-decode-internals.js";

/**
 * Translate an {@link InvalidId} into the evidence-layer {@link InvalidEvidence}.
 */
function idToEvidence(e: InvalidId): InvalidEvidence {
  return {
    kind: "invalid_evidence",
    reason: `Invalid persisted identifier on '${e.field}': ${e.reason}`,
  };
}

export function decodeEnvelope(
  value: unknown,
): Result<EventEnvelope, InvalidEvidence> {
  if (typeof value !== "object" || value === null) {
    return err({ kind: "invalid_evidence", reason: "Envelope must be a non-null object." });
  }
  const v = value as Record<string, unknown>;

  // Schema version: integer check.
  const sv = v["schema_version"];
  if (typeof sv !== "number" || !Number.isInteger(sv)) {
    return err({ kind: "invalid_evidence", reason: "schema_version must be an integer." });
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(sv)) {
    return err({
      kind: "invalid_evidence",
      reason: `Unsupported schema_version ${sv}; supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}.`,
    });
  }

  // Sequence + observedAt are numeric, not branded.
  const sequence = v["sequence"];
  if (
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    return err({ kind: "invalid_evidence", reason: "sequence must be a positive integer." });
  }
  const observedAt = v["observed_at"];
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt)) {
    return err({ kind: "invalid_evidence", reason: "observed_at must be a finite number." });
  }

  // Branded identifiers go through the runtime validators.
  const r = parseRunId(v["run_id"]);
  if (r.ok === false) return err(idToEvidence(r.error));
  const m = parseMissionId(v["mission_id"]);
  if (m.ok === false) return err(idToEvidence(m.error));
  const eid = parseEventId(v["event_id"]);
  if (eid.ok === false) return err(idToEvidence(eid.error));

  const rawEvent = v["event"];
  if (typeof rawEvent !== "object" || rawEvent === null) {
    return err({ kind: "invalid_evidence", reason: "event must be a non-null object." });
  }

  // Inner event: also has an attempt_id field on relevant variants.
  const ev = decodePersistedEvent(rawEvent);
  if (ev.ok === false) {
    return err(ev.error);
  }

  return ok({
    schema_version: 1,
    event_id: eid.value,
    run_id: r.value,
    mission_id: m.value,
    sequence,
    observed_at: observedAt,
    event: ev.value,
  });
}

export function decodeEnvelopeFromJson(
  text: string,
): Result<EventEnvelope, InvalidEvidence> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ kind: "invalid_evidence", reason: `Malformed JSON: ${msg}` });
  }
  return decodeEnvelope(raw);
}

// Suppress unused-import warning for andThen (kept available for future
// chaining helpers); `andThen` and `parseAttemptId` are used by other
// sibling decoders.
void andThen;
void parseAttemptId;