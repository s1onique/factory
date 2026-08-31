/**
 * FOUNDATION04 — B0-CORR03 — LedgerWriter response decoder.
 *
 * Single source of truth for runtime-validating a
 * LedgerWriterResponse value received over UDS.
 */

import { ok, err, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import { IDENTIFIER_GRAMMAR } from "../domain/ids.js";
import type { LedgerWriterResponse } from "./ledger-writer-protocol.js";

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
        protocolVersion: 2,
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
        protocolVersion: 2,
        commitId: cid.value as LedgerWriterResponse extends { kind: "replay"; commitId: infer C } ? C : never,
        sequence: seq.value,
        contentHash: ch.value,
      });
    }
    case "error": {
      const errorObj = o["error"];
      if (typeof errorObj !== "object" || errorObj === null) {
        return err({
          kind: "invalid_evidence",
          reason: "error envelope must contain an error object",
        });
      }
      const e = errorObj as Record<string, unknown>;
      const ek = e["kind"];
      if (typeof ek !== "string") {
        return err({
          kind: "invalid_evidence",
          reason: "error.kind must be a string",
        });
      }
      const msg = e["message"];
      return ok({
        kind: "error",
        protocolVersion: 2,
        error: {
          kind: ek as LedgerWriterResponse extends { kind: "error"; error: { kind: infer K } } ? K : never,
          ...(typeof msg === "string" ? { message: msg } : {}),
        } as LedgerWriterResponse extends { kind: "error"; error: infer E } ? E : never,
      });
    }
    case "pong": {
      const iid = validateId(o["instanceId"], "pong.instanceId");
      if (!iid.ok) return err(iid.error);
      const ms = validateNonNegativeInt(o["maxSequence"], "pong.maxSequence");
      if (!ms.ok) return err(ms.error);
      return ok({
        kind: "pong",
        protocolVersion: 2,
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
        protocolVersion: 2,
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
