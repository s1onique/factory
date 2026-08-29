/**
 * Envelope-level decoder.
 */

import type { InvalidEvidence } from "../domain/failure.js";
import { err, ok, type Result } from "../domain/result.js";
import type { EventId, MissionId, RunId } from "../domain/ids.js";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  type EventEnvelope,
} from "./codec-types.js";
import { decodePersistedEvent } from "./codec-decode-internals.js";

export function decodeEnvelope(value: unknown): Result<EventEnvelope, InvalidEvidence> {
  if (typeof value !== "object" || value === null) {
    return err({ kind: "invalid_evidence", reason: "Envelope must be a non-null object." });
  }
  const v = value as Record<string, unknown>;
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
  const eventId = v["event_id"];
  const runId = v["run_id"];
  const missionId = v["mission_id"];
  if (typeof eventId !== "string") {
    return err({ kind: "invalid_evidence", reason: "event_id must be a string." });
  }
  if (typeof runId !== "string") {
    return err({ kind: "invalid_evidence", reason: "run_id must be a string." });
  }
  if (typeof missionId !== "string") {
    return err({ kind: "invalid_evidence", reason: "mission_id must be a string." });
  }
  const sequence = v["sequence"];
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
    return err({ kind: "invalid_evidence", reason: "sequence must be a positive integer." });
  }
  const observedAt = v["observed_at"];
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt)) {
    return err({ kind: "invalid_evidence", reason: "observed_at must be a finite number." });
  }
  const rawEvent = v["event"];
  if (typeof rawEvent !== "object" || rawEvent === null) {
    return err({ kind: "invalid_evidence", reason: "event must be a non-null object." });
  }
  const ev = decodePersistedEvent(rawEvent);
  if (ev.ok === false) {
    return err(ev.error);
  }
  return ok({
    schema_version: 1,
    event_id: eventId as EventId,
    run_id: runId as RunId,
    mission_id: missionId as MissionId,
    sequence,
    observed_at: observedAt,
    event: ev.value,
  });
}

export function decodeEnvelopeFromJson(text: string): Result<EventEnvelope, InvalidEvidence> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ kind: "invalid_evidence", reason: `Malformed JSON: ${msg}` });
  }
  return decodeEnvelope(raw);
}
