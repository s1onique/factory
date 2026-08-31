/**
 * FOUNDATION04 — B0-CORR01 — LedgerWriter wire protocol.
 *
 * The wire format mirrors the witness protocol: framed JSON
 * with bounded length prefix. Both directions use the same
 * framing (the witness-server framing bug fix is applied
 * here from the start: the server MUST encodeFrame on
 * reply).
 *
 * B0-CORR01 §B0-C01-01: the LedgerWriter is the SOLE
 * authority on the sequence number. The wire protocol
 * therefore never carries a caller-supplied sequence. The
 * caller submits an UNSEQUENCED typed event body (a
 * discriminator + payload) plus a commitId. The writer
 * validates the envelope, allocates the next sequence,
 * constructs the canonical persisted envelope, fsyncs the
 * ledger, and ACKs the sequence it just wrote. The
 * `sequence` field is unrepresentable at the client API
 * boundary.
 *
 * `clientContentHash` is the client's integrity assertion
 * over the canonical envelope bytes the writer is about to
 * construct. It MUST equal the writer-computed contentHash;
 * a mismatch is a tamper signal and is rejected. This lets
 * the caller detect a writer that has been swapped or
 * compromised between request and reply.
 */

import type {
  CommitId,
  LedgerWriterInstanceId,
} from "./ledger-writer-types.js";
import { COMMIT_ID_GRAMMAR } from "./ledger-writer-types.js";

export const LEDGER_WRITER_PROTOCOL_VERSION = 2 as const;

/**
 * Unsequenced typed event body submitted by the client.
 *
 * The writer is responsible for assigning the sequence and
 * for producing the canonical persisted envelope shape. The
 * `kind` discriminator is mirrored from the persisted
 * envelope so the same shape goes through both the wire and
 * the ledger.
 *
 * Per-kind payload:
 *   - lifecycle: a `PersistedLifecycleEvent` discriminated
 *     by `type`. The writer validates the inner event shape
 *     against the existing lifecycle event grammar.
 *   - process_evidence: a `PersistedProcessEvidencePayload`.
 *   - witness_evidence: a `PersistedWitnessEvidence`.
 */
export type WriterEvent =
  | {
      readonly kind: "lifecycle";
      readonly eventId: string;
      readonly observedAt: number;
      readonly event: PersistedLifecycleEvent;
    }
  | {
      readonly kind: "process_evidence";
      readonly eventId: string;
      readonly observedAt: number;
      readonly payload: PersistedProcessEvidencePayload;
    }
  | {
      readonly kind: "witness_evidence";
      readonly eventId: string;
      readonly observedAt: number;
      readonly payload: PersistedWitnessEvidence;
    };

/**
 * Minimal lifecycle event grammar enforced at the wire
 * boundary. Only the variants the supervisor and witness
 * actually emit through this writer are listed. Full
 * grammar lives in the existing evidence codec; this shape
 * is what the writer must see on the wire to construct a
 * valid persisted envelope.
 */
export type PersistedLifecycleEvent =
  | { readonly type: "run_created" }
  | { readonly type: "preparation_started" }
  | { readonly type: "preparation_succeeded" }
  | { readonly type: "review_started" }
  | { readonly type: "review_passed" }
  | { readonly type: "cancelled" }
  | { readonly type: "preparation_failed"; readonly failure: unknown }
  | { readonly type: "attempt_started"; readonly attempt_id: string }
  | {
      readonly type: "agent_reported_completion";
      readonly attempt_id: string;
      readonly summary: string;
    }
  | {
      readonly type: "agent_failed";
      readonly attempt_id: string;
      readonly failure: unknown;
    }
  | {
      readonly type: "gating_started";
      readonly attempt_id: string;
      readonly gate: string;
    }
  | {
      readonly type: "gate_passed";
      readonly attempt_id: string;
      readonly gate: string;
    }
  | {
      readonly type: "gate_failed";
      readonly attempt_id: string;
      readonly gate: string;
      readonly failure: unknown;
    }
  | { readonly type: "repair_started"; readonly reason: unknown }
  | { readonly type: "review_failed"; readonly failure: unknown }
  | { readonly type: "budget_exhausted"; readonly observation: unknown }
  | { readonly type: "blocked"; readonly reason: unknown }
  | { readonly type: "crashed"; readonly reason: unknown };

// Re-export the persisted-payload types from the existing
// evidence codec so the writer can construct the canonical
// envelope without re-importing the codec modules itself.
// The persistence shape is the existing one (see
// evidence/codec-types.ts); this type alias is a soft
// re-assertion at the trust boundary, not a re-definition.
export type PersistedProcessEvidencePayload = import("../evidence/codec-types.js").PersistedProcessEvidencePayload;
export type PersistedWitnessEvidence = import("../witness/witness-types-persisted.js").PersistedWitnessEvidence;

/**
 * Client → writer messages.
 */
export type LedgerWriterRequest =
  | {
      readonly kind: "append";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly commitId: CommitId;
      readonly clientContentHash: string;
      readonly event: WriterEvent;
    }
  | {
      readonly kind: "ping";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
    }
  | {
      readonly kind: "who_are_you";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
    };

/**
 * Writer → client responses.
 *
 * `appended` is returned when a brand-new sequence was just
 * allocated and committed (B0-C01-01). `replay` is returned
 * when the same commitId + same contentHash was previously
 * committed (B0-C01-05): the caller MUST treat both
 * responses as "this commitId is durably committed at this
 * sequence" — the wire distinction exists so the caller
 * can prove the durable-ACK-law behaviour.
 */
export type LedgerWriterResponse =
  | {
      readonly kind: "appended";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly commitId: CommitId;
      readonly sequence: number;
      readonly contentHash: string;
    }
  | {
      readonly kind: "replay";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly commitId: CommitId;
      readonly sequence: number;
      readonly contentHash: string;
    }
  | {
      readonly kind: "error";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly error:
        | { readonly kind: "invalid_envelope"; readonly reason: string }
        | { readonly kind: "conflicting_commit"; readonly message: string }
        | { readonly kind: "content_hash_mismatch"; readonly message: string }
        | { readonly kind: "append_failed"; readonly message: string }
        | { readonly kind: "writer_busy"; readonly message: string }
        | { readonly kind: "protocol_version_mismatch"; readonly observed: number }
        | { readonly kind: "malformed_message"; readonly reason: string };
    }
  | {
      readonly kind: "pong";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly instanceId: LedgerWriterInstanceId;
      readonly maxSequence: number;
    }
  | {
      readonly kind: "self";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly instanceId: LedgerWriterInstanceId;
      readonly socketPath: string;
      readonly runId: string;
      readonly missionId: string;
      readonly startedAt: number;
      readonly maxSequence: number;
    };

/**
 * Wire-format constants. Both request and response frames
 * share the same shape: 4-byte big-endian length prefix
 * followed by UTF-8 JSON. The framing is implemented in
 * ../witness/witness-codec-framing.ts and reused here.
 */
export const MAX_LEDGER_WRITER_FRAME_BYTES = 1024 * 1024;

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateWriterEvent(o: Record<string, unknown>):
  | { readonly ok: true; readonly event: WriterEvent }
  | { readonly ok: false; readonly reason: string } {
  // B0-CORR02 §6: at the wire boundary, all required
  // fields of WriterEvent are enforced — eventId must be
  // a present string with the IDENTIFIER_GRAMMAR,
  // observedAt must be a present finite integer inside the
  // legal timestamp domain, and the payload must be a
  // recorded object.
  const kind = o["kind"];
  if (kind !== "lifecycle" && kind !== "process_evidence" && kind !== "witness_evidence") {
    return { ok: false, reason: `unknown event kind ${String(kind)}` };
  }
  const eventId = o["eventId"];
  if (typeof eventId !== "string" || eventId.length === 0) {
    return { ok: false, reason: "event.eventId must be a present string" };
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(eventId)) {
    return { ok: false, reason: "event.eventId violates identifier grammar" };
  }
  const observedAt = o["observedAt"];
  if (typeof observedAt !== "number") {
    return { ok: false, reason: "event.observedAt must be a number" };
  }
  if (!Number.isInteger(observedAt)) {
    return { ok: false, reason: "event.observedAt must be an integer" };
  }
  if (!Number.isFinite(observedAt)) {
    return { ok: false, reason: "event.observedAt must be finite" };
  }
  // Legal timestamp domain: positive, not absurdly large.
  // We use 1e15 (≈ year 33658 in ms) as the upper bound.
  if (observedAt < 0 || observedAt > 1e15) {
    return { ok: false, reason: "event.observedAt outside legal domain" };
  }
  if (kind === "lifecycle") {
    const event = o["event"];
    if (!isRecord(event)) return { ok: false, reason: "lifecycle event.event must be an object" };
    if (!isString(event["type"])) {
      return { ok: false, reason: "lifecycle event.type must be a string" };
    }
    return {
      ok: true,
      event: {
        kind: "lifecycle",
        eventId,
        observedAt,
        event: event as unknown as Extract<WriterEvent, { readonly kind: "lifecycle" }>["event"],
      },
    };
  }
  if (kind === "process_evidence") {
    if (!isRecord(o["payload"])) {
      return { ok: false, reason: "process_evidence payload must be an object" };
    }
    return {
      ok: true,
      event: {
        kind: "process_evidence",
        eventId,
        observedAt,
        payload: o["payload"] as unknown as Extract<WriterEvent, { readonly kind: "process_evidence" }>["payload"],
      },
    };
  }
  // witness_evidence
  if (!isRecord(o["payload"])) {
    return { ok: false, reason: "witness_evidence payload must be an object" };
  }
  return {
    ok: true,
    event: {
      kind: "witness_evidence",
      eventId,
      observedAt,
      payload: o["payload"] as unknown as Extract<WriterEvent, { readonly kind: "witness_evidence" }>["payload"],
    },
  };
}

export function parseLedgerWriterRequest(
  raw: unknown,
):
  | { readonly ok: true; readonly request: LedgerWriterRequest }
  | { readonly ok: false; readonly reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: "request must be an object" };
  }
  const o = raw;
  if (o["protocolVersion"] !== LEDGER_WRITER_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: `unsupported protocol version ${String(o["protocolVersion"])}`,
    };
  }
  const kind = o["kind"];
  if (kind === "append") {
    const cid = o["commitId"];
    if (!isString(cid)) {
      return { ok: false, reason: "append.commitId must be a string" };
    }
    if (!COMMIT_ID_GRAMMAR.test(cid)) {
      return { ok: false, reason: `append.commitId grammar violation` };
    }
    if (!isString(o["clientContentHash"])) {
      return { ok: false, reason: "append.clientContentHash must be a string" };
    }
    const eventRaw = o["event"];
    if (!isRecord(eventRaw)) {
      return { ok: false, reason: "append.event must be an object" };
    }
    const eventResult = validateWriterEvent(eventRaw);
    if (!eventResult.ok) {
      return { ok: false, reason: `append.${eventResult.reason}` };
    }
    return {
      ok: true,
      request: {
        kind: "append",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        commitId: cid as CommitId,
        clientContentHash: o["clientContentHash"] as string,
        event: eventResult.event,
      },
    };
  }
  if (kind === "ping") {
    return {
      ok: true,
      request: {
        kind: "ping",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      },
    };
  }
  if (kind === "who_are_you") {
    return {
      ok: true,
      request: {
        kind: "who_are_you",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      },
    };
  }
  return { ok: false, reason: `unknown request kind ${String(kind)}` };
}
