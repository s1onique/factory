/**
 * FOUNDATION04 — typed SIGNED_COMMAND decoder.
 */

import type { ControllerCommandPayload, WitnessSignedCommand } from "./witness-protocol.js";
import { WitnessCodecError } from "./witness-codec-messages.js";
import { requireProtocolVersion, requireString } from "./witness-codec-field.js";

export function decodeSignedCommand(raw: unknown): WitnessSignedCommand {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "signed_command must be object" });
  }
  const o = raw as Record<string, unknown>;
  if (o["kind"] !== "signed_command") {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "signed_command.kind must be 'signed_command'" });
  }
  return {
    protocolVersion: requireProtocolVersion(o["protocol_version"], "signed_command"),
    payload: decodeControllerCommandPayload(o["payload"]),
    signature: requireString(o["signature"], "signed_command.signature"),
  };
}

function decodeControllerCommandPayload(raw: unknown): ControllerCommandPayload {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "controller payload must be object" });
  }
  const o = raw as Record<string, unknown>;
  const action = requireString(o["action"], "payload.action");
  if (action !== "QUERY" && action !== "PING" && action !== "CANCEL" && action !== "TERMINATE") {
    throw new WitnessCodecError({
      kind: "malformed_json",
      reason: `payload.action must be QUERY|PING|CANCEL|TERMINATE; got ${action}`,
    });
  }
  return {
    commandId: requireString(o["command_id"], "payload.command_id") as ControllerCommandPayload["commandId"],
    runId: requireString(o["run_id"], "payload.run_id") as ControllerCommandPayload["runId"],
    attemptId: requireString(o["attempt_id"], "payload.attempt_id") as ControllerCommandPayload["attemptId"],
    processId: requireString(o["process_id"], "payload.process_id") as ControllerCommandPayload["processId"],
    witnessId: requireString(o["witness_id"], "payload.witness_id") as ControllerCommandPayload["witnessId"],
    witnessInstanceId: requireString(
      o["witness_instance_id"],
      "payload.witness_instance_id",
    ) as ControllerCommandPayload["witnessInstanceId"],
    action,
    nonce: requireString(o["nonce"], "payload.nonce"),
  };
}
