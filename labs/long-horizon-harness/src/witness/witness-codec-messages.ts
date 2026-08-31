/**
 * FOUNDATION04 — typed message encode/decode (JSON).
 *
 * Runtime validators. No structural cast at the trust boundary.
 */

import type {
  WitnessHello,
  WitnessSignedCommand,
  WitnessSignedCommandResponse,
  WitnessHandshakeResponse,
  ControllerCommandPayload,
  WitnessCommandResponsePayload,
  WitnessProtocolError,
} from "./witness-protocol.js";
import type { WitnessPersistedResult } from "./witness-types.js";

export type ClientMessage =
  | { readonly kind: "hello"; readonly hello: WitnessHello }
  | { readonly kind: "signed_command"; readonly cmd: WitnessSignedCommand };

export type WitnessMessage =
  | { readonly kind: "handshake"; readonly response: WitnessHandshakeResponse }
  | { readonly kind: "command_response"; readonly response: WitnessSignedCommandResponse }
  | { readonly kind: "error"; readonly error: WitnessProtocolError };

/**
 * Thrown by typed decode helpers. Carries the typed protocol error.
 */
export class WitnessCodecError extends Error {
  readonly error: WitnessProtocolError;
  constructor(error: WitnessProtocolError) {
    super(`witness codec: ${error.kind}`);
    this.error = error;
  }
}

// --------------------------------------------------------------------------
// Encode helpers (caller must pre-validate)
// --------------------------------------------------------------------------

export function encodeHello(h: WitnessHello): string {
  return JSON.stringify({
    kind: "hello",
    protocol_version: h.protocolVersion,
    run_id: h.runId,
    attempt_id: h.attemptId,
    process_id: h.processId,
    witness_id: h.witnessId,
    witness_instance_id: h.witnessInstanceId,
    client_nonce: h.clientNonce,
  });
}

export function encodeSignedCommand(c: WitnessSignedCommand): string {
  return JSON.stringify({
    kind: "signed_command",
    protocol_version: c.protocolVersion,
    payload: serializeControllerCommandPayload(c.payload),
    signature: c.signature,
  });
}

export function encodeHandshakeResponse(r: WitnessHandshakeResponse): string {
  return JSON.stringify({
    kind: "handshake",
    protocol_version: r.protocolVersion,
    witness_state: {
      run_id: r.witnessState.runId,
      attempt_id: r.witnessState.attemptId,
      process_id: r.witnessState.processId,
      witness_id: r.witnessState.witnessId,
      witness_instance_id: r.witnessState.witnessInstanceId,
      witness_pid: r.witnessState.witnessPid,
      witness_public_key_fingerprint: r.witnessState.witnessPublicKeyFingerprint,
      controller_public_key_fingerprint: r.witnessState.controllerPublicKeyFingerprint,
      client_nonce: r.witnessState.clientNonce,
      state_kind: r.witnessState.stateKind,
      candidate_pid: r.witnessState.candidatePid,
      candidate_pgid: r.witnessState.candidatePgid,
      witness_sequence: r.witnessState.witnessSequence,
    },
    signature: r.signature,
  });
}

export function encodeCommandResponse(r: WitnessSignedCommandResponse): string {
  return JSON.stringify({
    kind: "command_response",
    protocol_version: r.protocolVersion,
    payload: {
      command_id: r.payload.commandId,
      witness_id: r.payload.witnessId,
      witness_instance_id: r.payload.witnessInstanceId,
      witness_sequence: r.payload.witnessSequence,
      result: serializeCommandResultBody(r.payload.result),
    },
    signature: r.signature,
  });
}

export function encodeProtocolError(e: WitnessProtocolError): string {
  return JSON.stringify({ kind: "error", error: serializeError(e) });
}

function serializeControllerCommandPayload(p: ControllerCommandPayload): Record<string, unknown> {
  return {
    command_id: p.commandId,
    run_id: p.runId,
    attempt_id: p.attemptId,
    process_id: p.processId,
    witness_id: p.witnessId,
    witness_instance_id: p.witnessInstanceId,
    action: p.action,
    nonce: p.nonce,
  };
}

function serializeCommandResultBody(body: WitnessCommandResponsePayload["result"]): Record<string, unknown> {
  switch (body.kind) {
    case "ok":
      return {
        kind: "ok",
        execution_status: {
          kind: body.executionStatus.kind,
          pid: body.executionStatus.pid,
          pgid: body.executionStatus.pgid,
        },
        result: body.result === null ? null : serializePersistedResult(body.result),
      };
    case "cancelled":
    case "terminated":
    case "already_settled":
    case "cleanup_failed":
      return { kind: body.kind, result: serializePersistedResult(body.result) };
    case "authority_unavailable":
      return { kind: "authority_unavailable", reason: body.reason };
    case "rejected":
      return { kind: "rejected", reason: body.reason };
    case "pong":
      return { kind: "pong" };
  }
}

function serializePersistedResult(r: WitnessPersistedResult): Record<string, unknown> {
  switch (r.outcome_kind) {
    case "exited":
      return { outcome_kind: "exited", exit_code: r.exit_code };
    case "signaled":
      return { outcome_kind: "signaled", signal: r.signal, exit_code: r.exit_code };
    case "deadline":
      return { outcome_kind: "deadline" };
    case "cancelled":
      return { outcome_kind: "cancelled" };
    case "spawn_failed":
      return { outcome_kind: "spawn_failed", message: r.message };
    case "cleanup_failed":
      return { outcome_kind: "cleanup_failed", message: r.message };
    case "still_running":
      return { outcome_kind: "still_running" };
  }
}

function serializeError(e: WitnessProtocolError): Record<string, unknown> {
  switch (e.kind) {
    case "protocol_version_mismatch":
      return { kind: e.kind, expected: e.expected, received: e.received };
    case "oversize_frame":
      return { kind: e.kind, max_bytes: e.maxBytes, observed_bytes: e.observedBytes };
    case "malformed_json":
    case "invalid_signature":
    case "identity_mismatch":
    case "unknown_command":
    case "session_closed":
      return { kind: e.kind, reason: e.reason };
  }
}
