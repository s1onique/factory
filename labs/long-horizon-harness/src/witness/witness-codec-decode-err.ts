/**
 * FOUNDATION04 — typed protocol-error decoder.
 */

import type { WitnessProtocolError } from "./witness-protocol.js";
import { WitnessCodecError } from "./witness-codec-messages.js";
import { requireInt, requireString } from "./witness-codec-field.js";

export function decodeProtocolError(raw: unknown): WitnessProtocolError {
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "error must be object" });
  }
  const o = raw as Record<string, unknown>;
  const kind = requireString(o["kind"], "error.kind");
  switch (kind) {
    case "protocol_version_mismatch":
      return {
        kind: "protocol_version_mismatch",
        expected: requireInt(o["expected"], "expected"),
        received: requireInt(o["received"], "received"),
      };
    case "oversize_frame":
      return {
        kind: "oversize_frame",
        maxBytes: requireInt(o["max_bytes"], "max_bytes"),
        observedBytes: requireInt(o["observed_bytes"], "observed_bytes"),
      };
    case "malformed_json":
      return { kind: "malformed_json", reason: requireString(o["reason"], "reason") };
    case "invalid_signature":
      return { kind: "invalid_signature", reason: requireString(o["reason"], "reason") };
    case "identity_mismatch":
      return { kind: "identity_mismatch", reason: requireString(o["reason"], "reason") };
    case "unknown_command":
      return { kind: "unknown_command", reason: requireString(o["reason"], "reason") };
    case "session_closed":
      return { kind: "session_closed", reason: requireString(o["reason"], "reason") };
    default:
      throw new WitnessCodecError({ kind: "malformed_json", reason: `unknown error kind ${kind}` });
  }
}
