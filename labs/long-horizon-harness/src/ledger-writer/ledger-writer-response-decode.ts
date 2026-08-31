/**
 * FOUNDATION04 — B0-CORR04 — LedgerWriter response decoder.
 *
 * B0-CORR04 §14: every response variant MUST validate
 *   protocolVersion === LEDGER_WRITER_PROTOCOL_VERSION
 * Missing, wrong type, or wrong value → reject. Never
 * fabricate protocolVersion 2 from malformed input.
 *
 * B0-CORR04 §17: error responses are dispatched against an
 * enumerated set of valid error kinds. Unknown error kind
 * rejects the whole response.
 *
 * Doctrine (B0-CORR04):
 *   **Decoder non-fabrication law:** a runtime decoder
 *   validates protocol facts; it must never repair or
 *   invent them.
 */

import { ok, err, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import { IDENTIFIER_GRAMMAR } from "../domain/ids.js";
import type { LedgerWriterResponse } from "./ledger-writer-protocol.js";
import { LEDGER_WRITER_PROTOCOL_VERSION } from "./ledger-writer-protocol.js";

export type ResponseDecodeError =
  | InvalidEvidence
  | { readonly kind: "internal_failure"; readonly message: string };

function validateSha256Hex(value: unknown, field: string):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be a 64-char hex sha256`,
    });
  }
  return ok(value);
}

function validateId(value: unknown, field: string):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (typeof value !== "string" || !IDENTIFIER_GRAMMAR.test(value)) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must satisfy identifier grammar`,
    });
  }
  return ok(value);
}

function validatePositiveInt(value: unknown, field: string):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be a positive integer`,
    });
  }
  return ok(value);
}

function validateNonNegativeInt(value: unknown, field: string):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be a non-negative integer`,
    });
  }
  return ok(value);
}

function validateProtocolVersion(
  value: unknown,
  kind: string,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (value === undefined || value === null) {
    return err({
      kind: "invalid_evidence",
      reason: `${kind}.protocolVersion is required`,
    });
  }
  if (value !== LEDGER_WRITER_PROTOCOL_VERSION) {
    return err({
      kind: "invalid_evidence",
      reason: `${kind}.protocolVersion=${String(value)} does not match ${LEDGER_WRITER_PROTOCOL_VERSION}`,
    });
  }
  return ok(undefined);
}

/**
 * B0-CORR04 §17: enumerate the protocol error ADT.
 * Unknown error kind rejects the whole response.
 */
const VALID_ERROR_KINDS = new Set([
  "invalid_envelope",
  "conflicting_commit",
  "content_hash_mismatch",
  "append_failed",
  "writer_busy",
  "protocol_version_mismatch",
  "malformed_message",
]);

function validateErrorObject(
  value: unknown,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: InvalidEvidence } {
  const invalid = (reason: string): { readonly ok: false; readonly error: InvalidEvidence } => ({
    ok: false,
    error: { kind: "invalid_evidence", reason },
  });
  if (typeof value !== "object" || value === null) {
    return invalid("error envelope must contain an error object");
  }
  const e = value as Record<string, unknown>;
  const ek = e["kind"];
  if (typeof ek !== "string") {
    return invalid("error.kind must be a string");
  }
  if (!VALID_ERROR_KINDS.has(ek)) {
    return invalid(`unknown error kind ${ek}`);
  }
  if (ek === "protocol_version_mismatch") {
    if (typeof e["observed"] !== "number" || !Number.isInteger(e["observed"])) {
      return invalid("protocol_version_mismatch.observed must be an integer");
    }
    return ok({
      kind: "protocol_version_mismatch",
      observed: e["observed"],
    });
  }
  const msg = e["message"] ?? e["reason"];
  if (typeof msg !== "string") {
    return invalid(`error.${ek} requires a string message/reason field`);
  }
  return ok({
    kind: ek,
    ...(ek === "invalid_envelope"
      ? { reason: msg }
      : { message: msg }),
  });
}

export function decodeLedgerWriterResponse(
  value: unknown,
): Result<LedgerWriterResponse, ResponseDecodeError> {
  if (typeof value !== "object" || value === null) {
    return err({
      kind: "invalid_evidence",
      reason: "response must be an object",
    });
  }
  const o = value as Record<string, unknown>;
  const kind = o["kind"];
  if (typeof kind !== "string") {
    return err({
      kind: "invalid_evidence",
      reason: "response.kind must be a string",
    });
  }
  const pv = validateProtocolVersion(o["protocolVersion"], kind);
  if (!pv.ok) return err(pv.error);
  switch (kind) {
    case "appended": {
      const seq = validatePositiveInt(o["sequence"], "appended.sequence");
      if (!seq.ok) return err(seq.error);
      const cid = validateId(o["commitId"], "appended.commitId");
      if (!cid.ok) return err(cid.error);
      const ch = validateSha256Hex(o["contentHash"], "appended.contentHash");
      if (!ch.ok) return err(ch.error);
      return ok({
        kind: "appended",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        commitId: cid.value as LedgerWriterResponse extends { kind: "appended"; commitId: infer C } ? C : never,
        sequence: seq.value,
        contentHash: ch.value,
      });
    }
    case "replay": {
      const seq = validatePositiveInt(o["sequence"], "replay.sequence");
      if (!seq.ok) return err(seq.error);
      const cid = validateId(o["commitId"], "replay.commitId");
      if (!cid.ok) return err(cid.error);
      const ch = validateSha256Hex(o["contentHash"], "replay.contentHash");
      if (!ch.ok) return err(ch.error);
      return ok({
        kind: "replay",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        commitId: cid.value as LedgerWriterResponse extends { kind: "replay"; commitId: infer C } ? C : never,
        sequence: seq.value,
        contentHash: ch.value,
      });
    }
    case "error": {
      const errorRes = validateErrorObject(o["error"]);
      if (!errorRes.ok) return err(errorRes.error);
      return ok({
        kind: "error",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        error: errorRes.value as LedgerWriterResponse extends { kind: "error"; error: infer E } ? E : never,
      });
    }
    case "pong": {
      const iid = validateId(o["instanceId"], "pong.instanceId");
      if (!iid.ok) return err(iid.error);
      const ms = validateNonNegativeInt(o["maxSequence"], "pong.maxSequence");
      if (!ms.ok) return err(ms.error);
      return ok({
        kind: "pong",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        instanceId: iid.value as LedgerWriterResponse extends { kind: "pong"; instanceId: infer I } ? I : never,
        maxSequence: ms.value,
      });
    }
    case "self": {
      const iid = validateId(o["instanceId"], "self.instanceId");
      if (!iid.ok) return err(iid.error);
      const sp = o["socketPath"];
      if (typeof sp !== "string" || sp.length === 0) {
        return err({
          kind: "invalid_evidence",
          reason: "self.socketPath must be non-empty string",
        });
      }
      const rid = validateId(o["runId"], "self.runId");
      if (!rid.ok) return err(rid.error);
      const mid = validateId(o["missionId"], "self.missionId");
      if (!mid.ok) return err(mid.error);
      const sa = validateNonNegativeInt(o["startedAt"], "self.startedAt");
      if (!sa.ok) return err(sa.error);
      const ms = validateNonNegativeInt(o["maxSequence"], "self.maxSequence");
      if (!ms.ok) return err(ms.error);
      return ok({
        kind: "self",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        instanceId: iid.value as LedgerWriterResponse extends { kind: "self"; instanceId: infer I } ? I : never,
        socketPath: sp,
        runId: rid.value,
        missionId: mid.value,
        startedAt: sa.value,
        maxSequence: ms.value,
      });
    }
    default:
      return err({
        kind: "invalid_evidence",
        reason: `unknown response kind ${String(kind)}`,
      });
  }
}
