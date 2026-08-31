/**
 * FOUNDATION04 — IPC framing.
 *
 * Length-prefixed bounded JSON framing (F04-D24 / D78).
 *
 * Layout (big-endian, 4 bytes length prefix):
 *   bytes 0..3   = message length (uint32, big-endian)
 *   bytes 4..N+3 = UTF-8 JSON message
 *
 * Oversized frames are rejected by callers BEFORE we ever invoke
 * crypto. The supervisor and the witness both enforce this gate.
 */

import type { WitnessProtocolError } from "./witness-protocol.js";
import { WITNESS_MAX_FRAME_BYTES } from "./witness-protocol.js";

export type FrameEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: WitnessProtocolError };

export function encodeFrame(json: string): FrameEncodeResult {
  const encoded = new TextEncoder().encode(json);
  if (encoded.length > WITNESS_MAX_FRAME_BYTES) {
    return {
      ok: false,
      error: {
        kind: "oversize_frame",
        maxBytes: WITNESS_MAX_FRAME_BYTES,
        observedBytes: encoded.length,
      },
    };
  }
  const out = new Uint8Array(4 + encoded.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, encoded.length, false);
  out.set(encoded, 4);
  return { ok: true, bytes: out };
}

export type FrameDecodeResult =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly error: WitnessProtocolError };

/**
 * Decode a length-prefixed frame from a buffer.
 *
 * Returns the decoded JSON and the number of bytes consumed. Caller
 * is responsible for slicing the input buffer to extract subsequent
 * frames.
 */
export function decodeFrame(
  buffer: Uint8Array,
  offset: number,
): FrameDecodeResult & { readonly consumed: number } {
  if (buffer.length - offset < 4) {
    return {
      ok: false,
      consumed: 0,
      error: { kind: "malformed_json", reason: "frame header incomplete" },
    };
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  const len = view.getUint32(0, false);
  if (len > WITNESS_MAX_FRAME_BYTES) {
    return {
      ok: false,
      consumed: 4,
      error: {
        kind: "oversize_frame",
        maxBytes: WITNESS_MAX_FRAME_BYTES,
        observedBytes: len,
      },
    };
  }
  if (buffer.length - offset - 4 < len) {
    return {
      ok: false,
      consumed: 0,
      error: { kind: "malformed_json", reason: "frame body incomplete" },
    };
  }
  const body = buffer.subarray(offset + 4, offset + 4 + len);
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, json, consumed: 4 + len };
  } catch (e: unknown) {
    return {
      ok: false,
      consumed: 4 + len,
      error: {
        kind: "malformed_json",
        reason: `utf-8 decode failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
}
