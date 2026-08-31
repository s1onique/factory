/**
 * FOUNDATION04 — typed HELLO decoder.
 */

import type { WitnessHello } from "./witness-protocol.js";
import { WitnessCodecError } from "./witness-codec-messages.js";
import { requireProtocolVersion, requireString } from "./witness-codec-field.js";

export function decodeHello(raw: unknown): WitnessHello {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "hello must be object" });
  }
  const o = raw as Record<string, unknown>;
  if (o["kind"] !== "hello") {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "hello.kind must be 'hello'" });
  }
  return {
    protocolVersion: requireProtocolVersion(o["protocol_version"], "hello"),
    runId: requireString(o["run_id"], "hello.run_id") as WitnessHello["runId"],
    attemptId: requireString(o["attempt_id"], "hello.attempt_id") as WitnessHello["attemptId"],
    processId: requireString(o["process_id"], "hello.process_id") as WitnessHello["processId"],
    witnessId: requireString(o["witness_id"], "hello.witness_id") as WitnessHello["witnessId"],
    witnessInstanceId: requireString(
      o["witness_instance_id"],
      "hello.witness_instance_id",
    ) as WitnessHello["witnessInstanceId"],
    clientNonce: requireString(o["client_nonce"], "hello.client_nonce"),
  };
}
