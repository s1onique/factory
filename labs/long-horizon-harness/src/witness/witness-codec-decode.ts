/**
 * FOUNDATION04 — typed message DECODE dispatch.
 *
 * Decodes a JSON-decoded value into one of the typed protocol
 * messages. Per-shape decoders live in sibling files.
 */

import { WitnessCodecError, type ClientMessage, type WitnessMessage } from "./witness-codec-messages.js";
import { decodeHello } from "./witness-codec-decode-hello.js";
import { decodeSignedCommand } from "./witness-codec-decode-cmd.js";
import { decodeHandshakeResponse, decodeCommandResponse } from "./witness-codec-decode-resp.js";
import { decodeProtocolError } from "./witness-codec-decode-err.js";

/**
 * Decode a JSON text string at the trust boundary. Used by
 * witness code that has already validated the trust model
 * (e.g. controller.pub loaded by the witness).
 */
export function decodeJsonText(json: string): unknown {
  return JSON.parse(json);
}


export function decodeClientMessage(json: string): ClientMessage {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "client message must be object" });
  }
  const v = (raw as { kind?: unknown }).kind;
  if (v === "hello") {
    return { kind: "hello", hello: decodeHello(raw) };
  }
  if (v === "signed_command") {
    return { kind: "signed_command", cmd: decodeSignedCommand(raw) };
  }
  throw new WitnessCodecError({
    kind: "unknown_command",
    reason: `unknown client message kind ${String(v)}`,
  });
}

export function decodeWitnessMessage(json: string): WitnessMessage {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: "witness message must be object" });
  }
  const v = (raw as { kind?: unknown }).kind;
  if (v === "handshake") {
    return { kind: "handshake", response: decodeHandshakeResponse(raw) };
  }
  if (v === "command_response") {
    return { kind: "command_response", response: decodeCommandResponse(raw) };
  }
  if (v === "error") {
    return { kind: "error", error: decodeProtocolError(raw) };
  }
  throw new WitnessCodecError({
    kind: "unknown_command",
    reason: `unknown witness message kind ${String(v)}`,
  });
}
