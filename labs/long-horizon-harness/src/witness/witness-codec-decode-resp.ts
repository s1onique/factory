/**
 * FOUNDATION04 — typed handshake + command-response decoders.
 */

import type {
  WitnessCommandResponsePayload,
  WitnessHandshakeResponse,
  WitnessSignedCommandResponse,
  WitnessStateSummary,
} from "./witness-protocol.js";
import type { WitnessPersistedResult } from "./witness-types.js";
import { WitnessCodecError } from "./witness-codec-messages.js";
import {
  requireInt,
  requireNullableInt,
  requirePositiveInt,
  requireProtocolVersion,
  requireString,
} from "./witness-codec-field.js";

export function decodeHandshakeResponse(raw: unknown): WitnessHandshakeResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "handshake must be object" });
  }
  const o = raw as Record<string, unknown>;
  if (o["kind"] !== "handshake") {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "handshake.kind must be 'handshake'" });
  }
  const ws = o["witness_state"];
  if (typeof ws !== "object" || ws === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "handshake.witness_state must be object" });
  }
  const w = ws as Record<string, unknown>;
  return {
    protocolVersion: requireProtocolVersion(o["protocol_version"], "handshake"),
    witnessState: {
      runId: requireString(w["run_id"], "witness_state.run_id") as WitnessStateSummary["runId"],
      attemptId: requireString(w["attempt_id"], "witness_state.attempt_id") as WitnessStateSummary["attemptId"],
      processId: requireString(w["process_id"], "witness_state.process_id") as WitnessStateSummary["processId"],
      witnessId: requireString(w["witness_id"], "witness_state.witness_id") as WitnessStateSummary["witnessId"],
      witnessInstanceId: requireString(
        w["witness_instance_id"],
        "witness_state.witness_instance_id",
      ) as WitnessStateSummary["witnessInstanceId"],
      witnessPid: requirePositiveInt(w["witness_pid"], "witness_state.witness_pid"),
      witnessPublicKeyFingerprint: requireString(
        w["witness_public_key_fingerprint"],
        "witness_state.witness_public_key_fingerprint",
      ),
      controllerPublicKeyFingerprint: requireString(
        w["controller_public_key_fingerprint"],
        "witness_state.controller_public_key_fingerprint",
      ),
      clientNonce: requireString(w["client_nonce"], "witness_state.client_nonce"),
      stateKind: requireString(w["state_kind"], "witness_state.state_kind"),
      candidatePid: requireNullableInt(w["candidate_pid"], "witness_state.candidate_pid"),
      candidatePgid: requireNullableInt(w["candidate_pgid"], "witness_state.candidate_pgid"),
      witnessSequence: requireInt(w["witness_sequence"], "witness_state.witness_sequence"),
    },
    signature: requireString(o["signature"], "handshake.signature"),
  };
}

export function decodeCommandResponse(raw: unknown): WitnessSignedCommandResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "command_response must be object" });
  }
  const o = raw as Record<string, unknown>;
  if (o["kind"] !== "command_response") {
    throw new WitnessCodecError({
      kind: "malformed_json",
      reason: "command_response.kind must be 'command_response'",
    });
  }
  return {
    protocolVersion: requireProtocolVersion(o["protocol_version"], "command_response"),
    payload: decodeCommandResponsePayload(o["payload"]),
    signature: requireString(o["signature"], "command_response.signature"),
  };
}

function decodeCommandResponsePayload(raw: unknown): WitnessCommandResponsePayload {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "command response payload must be object" });
  }
  const o = raw as Record<string, unknown>;
  const result = o["result"];
  if (typeof result !== "object" || result === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "command response result must be object" });
  }
  const r = result as Record<string, unknown>;
  const kind = requireString(r["kind"], "result.kind");
  let body: WitnessCommandResponsePayload["result"];
  switch (kind) {
    case "ok": {
      const es = r["execution_status"];
      if (typeof es !== "object" || es === null) {
        throw new WitnessCodecError({ kind: "malformed_json", reason: "ok.execution_status must be object" });
      }
      const e = es as Record<string, unknown>;
      body = {
        kind: "ok",
        executionStatus: {
          kind: requireString(e["kind"], "execution_status.kind"),
          pid: requireNullableInt(e["pid"], "execution_status.pid"),
          pgid: requireNullableInt(e["pgid"], "execution_status.pgid"),
        },
        result: r["result"] === null ? null : decodePersistedResult(r["result"]),
      };
      break;
    }
    case "cancelled":
    case "terminated":
    case "already_settled":
    case "cleanup_failed":
      body = { kind, result: decodePersistedResult(r["result"]) } as WitnessCommandResponsePayload["result"];
      break;
    case "authority_unavailable":
      body = { kind: "authority_unavailable", reason: requireString(r["reason"], "authority_unavailable.reason") };
      break;
    case "rejected":
      body = { kind: "rejected", reason: requireString(r["reason"], "rejected.reason") };
      break;
    case "pong":
      body = { kind: "pong" };
      break;
    default:
      throw new WitnessCodecError({ kind: "malformed_json", reason: `unknown result kind ${kind}` });
  }
  return {
    commandId: requireString(o["command_id"], "payload.command_id") as WitnessCommandResponsePayload["commandId"],
    witnessId: requireString(o["witness_id"], "payload.witness_id") as WitnessCommandResponsePayload["witnessId"],
    witnessInstanceId: requireString(
      o["witness_instance_id"],
      "payload.witness_instance_id",
    ) as WitnessCommandResponsePayload["witnessInstanceId"],
    witnessSequence: requireInt(o["witness_sequence"], "payload.witness_sequence"),
    result: body,
  };
}

function decodePersistedResult(raw: unknown): WitnessPersistedResult {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "persisted result must be object" });
  }
  const o = raw as Record<string, unknown>;
  const kind = requireString(o["outcome_kind"], "outcome_kind");
  switch (kind) {
    case "exited":
      return { outcome_kind: "exited", exit_code: requireNullableInt(o["exit_code"], "exit_code") };
    case "signaled":
      return {
        outcome_kind: "signaled",
        signal: o["signal"] === null ? null : requireString(o["signal"], "signal"),
        exit_code: requireNullableInt(o["exit_code"], "exit_code"),
      };
    case "deadline":
      return { outcome_kind: "deadline" };
    case "cancelled":
      return { outcome_kind: "cancelled" };
    case "spawn_failed":
      return { outcome_kind: "spawn_failed", message: requireString(o["message"], "message") };
    case "cleanup_failed":
      return { outcome_kind: "cleanup_failed", message: requireString(o["message"], "message") };
    case "still_running":
      return { outcome_kind: "still_running" };
    default:
      throw new WitnessCodecError({ kind: "malformed_json", reason: `unknown outcome_kind ${kind}` });
  }
}
