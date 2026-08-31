/**
 * FOUNDATION04 — canonical signing payload.
 *
 * Pure functions only. No imports of fs, net, crypto, child_process,
 * timers, or signals.
 *
 * Doctrine F04-D29: do not sign arbitrary JSON.stringify. Field
 * order is fixed. Tests assert byte-for-byte determinism.
 */

import type { WitnessStateSummary } from "./witness-protocol.js";
import type { ControllerCommandPayload } from "./witness-protocol.js";
import type { WitnessCommandResponsePayload } from "./witness-protocol.js";
import type { WitnessPersistedResult } from "./witness-types.js";

/**
 * Produce the canonical bytes for a witness handshake summary.
 *
 * Format: a stable byte sequence with `\n` separators. No JSON
 * parsing is required to extract a single field.
 */
export function canonicalHandshakePayload(s: WitnessStateSummary): Uint8Array {
  const lines = [
    "witness_handshake",
    String(s.witnessPid),
    s.witnessPublicKeyFingerprint,
    s.controllerPublicKeyFingerprint,
    s.clientNonce,
    s.stateKind,
    s.candidatePid === null ? "null" : String(s.candidatePid),
    s.candidatePgid === null ? "null" : String(s.candidatePgid),
    String(s.witnessSequence),
  ];
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

/**
 * Produce the canonical bytes for a controller command payload.
 * Field order is FIXED.
 */
export function canonicalControllerCommand(p: ControllerCommandPayload): Uint8Array {
  const lines = [
    "witness_command",
    p.commandId,
    p.runId,
    p.attemptId,
    p.processId,
    p.witnessId,
    p.witnessInstanceId,
    p.action,
    p.nonce,
  ];
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

/**
 * Produce the canonical bytes for a witness command response payload.
 * Field order is FIXED.
 */
export function canonicalCommandResponse(p: WitnessCommandResponsePayload): Uint8Array {
  const lines = [
    "witness_command_response",
    p.commandId,
    p.witnessId,
    p.witnessInstanceId,
    String(p.witnessSequence),
    serializeCommandResultBody(p.result),
  ];
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

function serializeCommandResultBody(body: WitnessCommandResponsePayload["result"]): string {
  switch (body.kind) {
    case "ok":
      return [
        "ok",
        body.executionStatus.kind,
        body.executionStatus.pid === null ? "null" : String(body.executionStatus.pid),
        body.executionStatus.pgid === null ? "null" : String(body.executionStatus.pgid),
        body.result === null ? "null" : serializePersistedResult(body.result),
      ].join("\n");
    case "cancelled":
    case "terminated":
    case "already_settled":
    case "cleanup_failed":
      return [body.kind, serializePersistedResult(body.result)].join("\n");
    case "authority_unavailable":
      return ["authority_unavailable", body.reason].join("\n");
    case "rejected":
      return ["rejected", body.reason].join("\n");
    case "pong":
      return "pong";
  }
}

function serializePersistedResult(r: WitnessPersistedResult): string {
  switch (r.outcome_kind) {
    case "exited":
      return ["exited", r.exit_code === null ? "null" : String(r.exit_code)].join("\n");
    case "signaled":
      return ["signaled", r.signal === null ? "null" : r.signal, r.exit_code === null ? "null" : String(r.exit_code)].join("\n");
    case "deadline":
      return "deadline";
    case "cancelled":
      return "cancelled";
    case "spawn_failed":
      return ["spawn_failed", r.message].join("\n");
    case "cleanup_failed":
      return ["cleanup_failed", r.message].join("\n");
    case "still_running":
      return "still_running";
  }
}
