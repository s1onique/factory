/**
 * FOUNDATION04 — B0-CORR03 — persisted witness-evidence decoder.
 *
 * Single source of truth for runtime-validating a
 * PersistedWitnessEvidence value. Used by:
 *   - the LedgerWriter wire validator (B0-CORR02 §6 +
 *     B0-CORR03 §12) to reject object-shaped nonsense and
 *     semantically-malformed variants;
 *   - any other caller that wants to validate a witness-
 *     evidence payload from untrusted JS bytes.
 *
 * Extracted from `witness-types-persisted.ts` so that file
 * remains a pure-type declaration.
 */

import { ok, err, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type {
  PersistedWitnessEvidence,
} from "./witness-types-persisted.js";
import type {
  WitnessCommandId,
  WitnessId,
  WitnessInstanceId,
} from "./witness-types.js";
import {
  parseWitnessId,
  parseWitnessInstanceId,
} from "./witness-types.js";
import { IDENTIFIER_GRAMMAR } from "../domain/ids.js";
import { validateOutcome } from "./witness-evidence-decode-result.js";

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateId(value: unknown, field: string):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (!isString(value)) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be a string`,
    });
  }
  if (!IDENTIFIER_GRAMMAR.test(value)) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} violates identifier grammar`,
    });
  }
  return ok(value);
}

function validateNumber(
  value: unknown,
  field: string,
  domain: { readonly min: number; readonly max?: number },
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (typeof value !== "number") {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be a number`,
    });
  }
  if (!Number.isInteger(value)) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be an integer`,
    });
  }
  if (value < domain.min) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be >= ${domain.min}`,
    });
  }
  if (domain.max !== undefined && value > domain.max) {
    return err({
      kind: "invalid_evidence",
      reason: `${field} must be <= ${domain.max}`,
    });
  }
  return ok(value);
}

function validateAttestationHash(value: unknown):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (typeof value !== "string") {
    return err({
      kind: "invalid_evidence",
      reason: "attestation_hash must be string",
    });
  }
  // attestation_hash is a hex string of length 32..128.
  if (!/^[0-9a-f]{32,128}$/.test(value)) {
    return err({
      kind: "invalid_evidence",
      reason: "attestation_hash must be hex (32..128 chars)",
    });
  }
  return ok(value);
}

function validateAction(value: unknown):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (!isRecord(value)) {
    return err({
      kind: "invalid_evidence",
      reason: "action must be an object",
    });
  }
  const kind = value["kind"];
  if (
    kind === "send_signal" ||
    kind === "request_cancellation" ||
    kind === "ping"
  ) {
    if (kind === "send_signal") {
      const sig = value["signal"];
      if (sig !== "SIGTERM" && sig !== "SIGKILL") {
        return err({
          kind: "invalid_evidence",
          reason: "send_signal.signal must be SIGTERM or SIGKILL",
        });
      }
    }
    return ok(value);
  }
  return err({
    kind: "invalid_evidence",
    reason: `unknown action kind ${String(kind)}`,
  });
}

/**
 * Single runtime validator for PersistedWitnessEvidence.
 *
 * Doctrine (B0-CORR03 §12): this is the authoritative
 * witness-evidence trust boundary. The LedgerWriter MUST
 * NOT locally approximate the schema — it MUST dispatch to
 * this decoder.
 */
export function decodePersistedWitnessEvidence(
  value: unknown,
): Result<PersistedWitnessEvidence, InvalidEvidence> {
  if (!isRecord(value)) {
    return err({
      kind: "invalid_evidence",
      reason: "witness_evidence must be an object",
    });
  }
  const k = value["kind"];

  // Common mandatory fields: witness_id and witness_instance_id.
  // parseWitnessId / parseWitnessInstanceId already enforce the
  // IDENTIFIER_GRAMMAR; we surface their typed `invalid_id` error
  // as an `invalid_evidence` error at the witness-evidence
  // trust boundary.
  const cidRes = parseWitnessId(value["witness_id"]);
  if (cidRes.ok === false) {
    return err({
      kind: "invalid_evidence",
      reason: `witness_id: ${cidRes.error.reason}`,
    });
  }
  const widRes = parseWitnessInstanceId(value["witness_instance_id"]);
  if (widRes.ok === false) {
    return err({
      kind: "invalid_evidence",
      reason: `witness_instance_id: ${widRes.error.reason}`,
    });
  }
  const cid = cidRes.value as WitnessId;
  const wid = widRes.value as WitnessInstanceId;

  switch (k) {
    case "witness_start_requested":
      return ok({
        kind: "witness_start_requested",
        witness_id: cid,
        witness_instance_id: wid,
      });
    case "witness_ready": {
      const pidRes = validateNumber(value["historical_witness_pid"], "historical_witness_pid", { min: 1 });
      if (!pidRes.ok) return err(pidRes.error);
      const sock = value["socket_path"];
      if (typeof sock !== "string" || sock.length === 0) {
        return err({
          kind: "invalid_evidence",
          reason: "socket_path must be non-empty string",
        });
      }
      for (const f of [
        "witness_public_key",
        "witness_public_key_fingerprint",
        "controller_public_key_fingerprint",
      ]) {
        const v = value[f];
        if (typeof v !== "string" || v.length === 0) {
          return err({
            kind: "invalid_evidence",
            reason: `${f} must be non-empty string`,
          });
        }
      }
      const protoRes = validateNumber(value["protocol_version"], "protocol_version", { min: 1, max: 1000 });
      if (!protoRes.ok) return err(protoRes.error);
      return ok({
        kind: "witness_ready",
        witness_id: cid,
        witness_instance_id: wid,
        historical_witness_pid: pidRes.value,
        socket_path: sock,
        witness_public_key: value["witness_public_key"] as string,
        witness_public_key_fingerprint: value["witness_public_key_fingerprint"] as string,
        controller_public_key_fingerprint: value["controller_public_key_fingerprint"] as string,
        protocol_version: protoRes.value,
      });
    }
    case "witness_activation_requested": {
      const cmdRes = validateId(value["command_id"], "command_id");
      if (!cmdRes.ok) return err(cmdRes.error);
      return ok({
        kind: "witness_activation_requested",
        witness_id: cid,
        witness_instance_id: wid,
        command_id: cmdRes.value as unknown as WitnessCommandId,
      });
    }
    case "witness_activated": {
      const wsRes = validateNumber(value["witness_sequence"], "witness_sequence", { min: 1 });
      if (!wsRes.ok) return err(wsRes.error);
      return ok({
        kind: "witness_activated",
        witness_id: cid,
        witness_instance_id: wid,
        witness_sequence: wsRes.value,
      });
    }
    case "witness_execution_recovered": {
      const procRes = validateId(value["process_id"], "process_id");
      if (!procRes.ok) return err(procRes.error);
      const pidRes = validateNumber(value["pid"], "pid", { min: 1 });
      if (!pidRes.ok) return err(pidRes.error);
      const pgidRes = validateNumber(value["pgid"], "pgid", { min: 2 });
      if (!pgidRes.ok) return err(pgidRes.error);
      const wsRes = validateNumber(value["witness_sequence"], "witness_sequence", { min: 1 });
      if (!wsRes.ok) return err(wsRes.error);
      const ahRes = validateAttestationHash(value["attestation_hash"]);
      if (!ahRes.ok) return err(ahRes.error);
      return ok({
        kind: "witness_execution_recovered",
        witness_id: cid,
        witness_instance_id: wid,
        process_id: procRes.value as unknown as PersistedWitnessEvidence extends {
          kind: "witness_execution_recovered";
          process_id: infer P;
        }
          ? P
          : never,
        pid: pidRes.value,
        pgid: pgidRes.value,
        witness_sequence: wsRes.value,
        attestation_hash: ahRes.value,
      });
    }
    case "witness_command_requested": {
      const cmdRes = validateId(value["command_id"], "command_id");
      if (!cmdRes.ok) return err(cmdRes.error);
      const actRes = validateAction(value["action"]);
      if (!actRes.ok) return err(actRes.error);
      return ok({
        kind: "witness_command_requested",
        witness_id: cid,
        witness_instance_id: wid,
        command_id: cmdRes.value as WitnessCommandId,
        action: actRes.value as Extract<
          PersistedWitnessEvidence,
          { kind: "witness_command_requested" }
        >["action"],
      });
    }
    case "witness_command_result": {
      const cmdRes = validateId(value["command_id"], "command_id");
      if (!cmdRes.ok) return err(cmdRes.error);
      const outRes = validateOutcome(value["outcome"]);
      if (!outRes.ok) return err(outRes.error);
      const wsRes = validateNumber(value["witness_sequence"], "witness_sequence", { min: 1 });
      if (!wsRes.ok) return err(wsRes.error);
      return ok({
        kind: "witness_command_result",
        witness_id: cid,
        witness_instance_id: wid,
        command_id: cmdRes.value as WitnessCommandId,
        outcome: outRes.value,
        witness_sequence: wsRes.value,
      });
    }
    case "witness_lost": {
      if (typeof value["reason"] !== "string" || value["reason"].length === 0) {
        return err({
          kind: "invalid_evidence",
          reason: "witness_lost.reason must be non-empty string",
        });
      }
      return ok({
        kind: "witness_lost",
        witness_id: cid,
        witness_instance_id: wid,
        reason: value["reason"] as string,
      });
    }
    default:
      return err({
        kind: "invalid_evidence",
        reason: `unknown witness_evidence kind ${String(k)}`,
      });
  }
}

