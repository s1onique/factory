/**
 * Envelope-level decoder.
 *
 * This is the trust boundary for persisted identifier fields. Every
 * branded identifier carried by the envelope is validated by the
 * {@link parseRunId} / family functions in {@link ../domain/ids.ts}.
 * Invalid identifiers are translated into typed `invalid_evidence`
 * errors — no `as` assertion is allowed at the trust boundary.
 *
 * FOUNDATION03: this decoder accepts both schema_version 1
 * (lifecycle-only, FOUNDATION01/F02) and schema_version 2
 * (discriminated lifecycle | process_evidence). Mixed versions
 * in the same ledger are permitted because the new ledger will
 * start emitting v2 while existing v1 records continue to replay
 * unchanged.
 */

import type { InvalidEvidence } from "../domain/failure.js";
import type { InvalidId } from "../domain/ids.js";
import {
  parseEventId,
  parseMissionId,
  parseRunId,
} from "../domain/ids.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  SUPPORTED_SCHEMA_VERSIONS,
  type EventEnvelope,
} from "./codec-types.js";
import {
  decodePersistedEvent,
  decodePersistedProcessEvidence,
} from "./codec-decode-internals.js";
import { decodePersistedWitnessEvidence } from "../witness/witness-evidence-decode.js";

/**
 * Translate an {@link InvalidId} into the evidence-layer {@link InvalidEvidence}.
 */
function idToEvidence(e: InvalidId): InvalidEvidence {
  return {
    kind: "invalid_evidence",
    reason: `Invalid persisted identifier on '${e.field}': ${e.reason}`,
  };
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

  // Process-evidence envelopes do NOT carry `event`. Defer the
  // `event` presence check to the v1 / v2-lifecycle branches below
  // so process-evidence envelopes (which carry `process_evidence`)
  // do not fail with a misleading "event must be a non-null object".
  // Persisted-process-evidence envelopes are decoded only after we
  // detect kind === "process_evidence".

  if (sv === 1) {
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
      event_id: eid.value,
      run_id: r.value,
      mission_id: m.value,
      sequence,
      observed_at: observedAt,
      event: ev.value,
    });
  }

  // sv === 2: pick the branch on the kind discriminator.
  const kindRaw = v["kind"];
  if (typeof kindRaw !== "string") {
    return err({
      kind: "invalid_evidence",
      reason: "schema_version 2 envelope MUST carry a string 'kind' discriminator.",
    });
  }
  if (kindRaw === "lifecycle") {
    if (v["process_evidence"] !== undefined) {
      return err({
        kind: "invalid_evidence",
        reason: "lifecycle envelope MUST NOT carry a 'process_evidence' field.",
      });
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
      schema_version: 2,
      event_id: eid.value,
      run_id: r.value,
      mission_id: m.value,
      sequence,
      observed_at: observedAt,
      kind: "lifecycle",
      event: ev.value,
    });
  }
  if (kindRaw === "process_evidence") {
    const pe = v["process_evidence"];
    if (typeof pe !== "object" || pe === null) {
      return err({
        kind: "invalid_evidence",
        reason: "process_evidence envelope MUST carry a non-null 'process_evidence' payload.",
      });
    }
    const pev = decodePersistedProcessEvidence(pe);
    if (pev.ok === false) {
      return err(pev.error);
    }
    return ok({
      schema_version: 2,
      event_id: eid.value,
      run_id: r.value,
      mission_id: m.value,
      sequence,
      observed_at: observedAt,
      kind: "process_evidence",
      process_evidence: pev.value,
    });
  }
  if (kindRaw === "witness_evidence") {
    // FOUNDATION01_CODEC_COMPATIBILITY_CORRECTION (CORRECTION03,
    // recorded CORRECTION04): the decoder previously REJECTED
    // 'witness_evidence' envelopes as "Unknown v2 envelope
    // kind", even though `codec-types.ts` and `codec-encode.ts`
    // already defined the kind and emitted it. That asymmetry
    // meant the readiness read path had to JSON.parse the line
    // and trust the writer. Witness-evidence envelopes are now
    // first-class on both encode and decode sides (see
    // encodeWitnessEvidenceEnvelope in codec-encode.ts and
    // decodePersistedWitnessEvidence in
    // witness-evidence-decode.ts). The payload is dispatched to
    // the AUTHORITATIVE witness decoder; this decoder never
    // approximates that schema.
    const we = v["witness_evidence"];
    if (typeof we !== "object" || we === null) {
      return err({
        kind: "invalid_evidence",
        reason: "witness_evidence envelope MUST carry a non-null 'witness_evidence' payload.",
      });
    }
    const wev = decodePersistedWitnessEvidence(we);
    if (wev.ok === false) {
      return err(wev.error);
    }
    return ok({
      schema_version: 2,
      event_id: eid.value,
      run_id: r.value,
      mission_id: m.value,
      sequence,
      observed_at: observedAt,
      kind: "witness_evidence",
      witness_evidence: wev.value,
    });
  }
  return err({
    kind: "invalid_evidence",
    reason: `Unknown v2 envelope 'kind' '${kindRaw}'. Expected 'lifecycle', 'process_evidence' or 'witness_evidence'.`,
  });
}
