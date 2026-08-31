/**
 * FOUNDATION04 — Unix-domain stream socket client transport.
 *
 * The supervisor side of the UDS channel. Connects, sends one
 * framed request, awaits one framed reply, closes.
 */

import { connect, type Socket } from "node:net";
import { encodeFrame, decodeFrame } from "./witness-codec-framing.js";
import { WITNESS_MAX_FRAME_BYTES } from "./witness-protocol.js";

export type ClientError =
  | { readonly kind: "oversize_response"; readonly observed: number }
  | { readonly kind: "connect_failed"; readonly message: string }
  | { readonly kind: "timeout"; readonly which: "connect" | "response" }
  | { readonly kind: "malformed_response"; readonly reason: string }
  | { readonly kind: "socket_closed_before_response" };

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ClientError };

export type ClientOptions = {
  readonly socketPath: string;
  readonly requestJson: string;
  readonly connectTimeoutMs: number;
  readonly responseTimeoutMs: number;
};

/**
 * Send one framed request to the witness and read one framed reply.
 *
 * Returns the raw JSON reply. Decoding is the caller's job (it
 * requires the typed protocol decoder).
 */
export async function sendOneFrame(opts: ClientOptions): Promise<ClientResult<string>> {
  const encoded = encodeFrame(opts.requestJson);
  if (!encoded.ok) {
    return {
      ok: false,
      error: { kind: "oversize_response", observed: WITNESS_MAX_FRAME_BYTES },
    };
  }
  return await new Promise<ClientResult<string>>((resolve) => {
    const socket: Socket = connect(opts.socketPath);
    let resolved = false;
    let buf: Buffer = Buffer.alloc(0);

    const finish = (r: ClientResult<string>): void => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(r);
    };

    const connectTimer = setTimeout(() => {
      finish({ ok: false, error: { kind: "timeout", which: "connect" } });
    }, opts.connectTimeoutMs);
    const responseTimer = setTimeout(() => {
      finish({ ok: false, error: { kind: "timeout", which: "response" } });
    }, opts.responseTimeoutMs);

    socket.on("error", (e: Error) => {
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      finish({ ok: false, error: { kind: "connect_failed", message: e.message } });
    });

    socket.on("connect", () => {
      clearTimeout(connectTimer);
      const frame = encodeFrame(opts.requestJson);
      if (!frame.ok) {
        clearTimeout(responseTimer);
        finish({ ok: false, error: { kind: "oversize_response", observed: WITNESS_MAX_FRAME_BYTES } });
        return;
      }
      socket.write(frame.bytes);
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const decoded = decodeFrame(buf, 0);
      if (decoded.ok) {
        clearTimeout(responseTimer);
        finish({ ok: true, value: decoded.json });
      } else if (decoded.error.kind === "oversize_frame") {
        clearTimeout(responseTimer);
        finish({ ok: false, error: { kind: "oversize_response", observed: decoded.error.observedBytes } });
      } else if (decoded.error.kind === "malformed_json" && decoded.consumed === 0) {
        // incomplete; wait for more data
      } else {
        clearTimeout(responseTimer);
        finish({ ok: false, error: { kind: "malformed_response", reason: decoded.error.kind } });
      }
    });

    socket.on("close", () => {
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      if (!resolved) {
        finish({ ok: false, error: { kind: "socket_closed_before_response" } });
      }
    });
  });
}
