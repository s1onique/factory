/**
 * FOUNDATION04 — B0-CORR02 — LedgerWriter client transport.
 *
 * Lowest layer: open a UDS connection, send a framed
 * request, receive a framed response, return the parsed
 * response. The transport does not know about append
 * retry semantics; callers compose retries on top.
 *
 * Extracted from `ledger-writer-client.ts` to keep each
 * production file under the 400-LOC source-size discipline
 * (FOUNDATION03 §29).
 *
 * Trust-boundary: this is the SINGLE JSON.parse site for
 * the client module. The framing layer (decodeFrame)
 * already verified the framing; this layer verifies that
 * the framed JSON parses and has the expected `kind`.
 */

import { connect, type Socket } from "node:net";
import { promises as fs } from "node:fs";

import {
  decodeFrame,
  encodeFrame,
} from "../witness/witness-codec-framing.js";
import {
  type LedgerWriterRequest,
  type LedgerWriterResponse,
} from "./ledger-writer-protocol.js";
import {
  decodeLedgerWriterResponse,
} from "./ledger-writer-response-decode.js";

export type LedgerWriterClientError =
  | { readonly kind: "socket_missing"; readonly socketPath: string }
  | { readonly kind: "socket_wrong_type"; readonly socketPath: string }
  | { readonly kind: "connect_failed"; readonly message: string }
  | { readonly kind: "write_failed"; readonly message: string }
  | { readonly kind: "frame_decode_failed"; readonly reason: string }
  | { readonly kind: "protocol_error"; readonly error: unknown }
  | { readonly kind: "timeout"; readonly message: string };

export type LedgerWriterClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: LedgerWriterClientError };

async function assertSocket(socketPath: string): Promise<
  LedgerWriterClientResult<void>
> {
  try {
    const st = await fs.lstat(socketPath);
    if (st.isSymbolicLink() || !st.isSocket()) {
      return {
        ok: false,
        error: { kind: "socket_wrong_type", socketPath },
      };
    }
    return { ok: true, value: undefined };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return { ok: false, error: { kind: "socket_missing", socketPath } };
    }
    return {
      ok: false,
      error: {
        kind: "connect_failed",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

function frameRequest(req: LedgerWriterRequest): Buffer {
  const encoded = encodeFrame(JSON.stringify(req));
  if (!encoded.ok) {
    throw new Error(
      `cannot encode frame: ${(encoded.error as { readonly kind: string }).kind}`,
    );
  }
  return Buffer.from(encoded.bytes);
}

export type LedgerWriterClientOptions = {
  readonly socketPath: string;
  readonly timeoutMs?: number;
};

/**
 * Send a single framed request over UDS and return the
 * raw response. The transport does NOT validate the
 * response kind against an expectation; the single-RPC
 * contract (B0-CORR02 §7) requires that the response
 * object's `kind` discriminator be observed by the
 * caller. The transport validates framing + JSON only.
 *
 * For higher-level callers that DO want to assert a
 * specific kind, see `sendLedgerWriterRequestOfKind` below.
 */
export async function sendLedgerWriterRequest(
  opts: LedgerWriterClientOptions,
  request: LedgerWriterRequest,
): Promise<LedgerWriterClientResult<LedgerWriterResponse>> {
  const probe = await assertSocket(opts.socketPath);
  if (!probe.ok) return probe;

  const timeoutMs = opts.timeoutMs ?? 5000;
  return await new Promise<
    LedgerWriterClientResult<LedgerWriterResponse>
  >((resolve) => {
    const socket: Socket = connect(opts.socketPath);
    let buf: Buffer = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
      resolve({
        ok: false,
        error: {
          kind: "timeout",
          message: `client timed out after ${timeoutMs}ms`,
        },
      });
    }, timeoutMs);

    const finalize = (
      r: LedgerWriterClientResult<LedgerWriterResponse>,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
      resolve(r);
    };

    socket.on("error", (e: Error) => {
      finalize({
        ok: false,
        error: { kind: "connect_failed", message: e.message },
      });
    });

    socket.on("connect", () => {
      const out = frameRequest(request);
      socket.write(out, (err) => {
        if (err !== undefined && err !== null) {
          finalize({
            ok: false,
            error: { kind: "write_failed", message: err.message },
          });
          return;
        }
        // Half-close: stop writing but keep reading for the
        // server's reply. We MUST NOT call socket.end() with
        // no data because that fully closes the socket and
        // races with the server's reply write on UDS.
      });
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      let offset = 0;
      while (true) {
        const decoded = decodeFrame(buf, offset);
        if (!decoded.ok) {
          if (decoded.error.kind === "oversize_frame") {
            finalize({
              ok: false,
              error: {
                kind: "frame_decode_failed",
                reason: `oversize frame`,
              },
            });
            return;
          }
          if (
            decoded.error.kind === "malformed_json" &&
            decoded.consumed === 0
          ) {
            return; // need more data
          }
          offset += decoded.consumed;
          if (offset >= buf.length) {
            buf = Buffer.alloc(0);
            return;
          }
          continue;
        }
        const json = decoded.json;
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (e: unknown) {
          finalize({
            ok: false,
            error: {
              kind: "frame_decode_failed",
              reason: `malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
            },
          });
          return;
        }
        if (typeof parsed !== "object" || parsed === null) {
          finalize({
            ok: false,
            error: {
              kind: "frame_decode_failed",
              reason: "response is not an object",
            },
          });
          return;
        }
        const decodedResp = decodeLedgerWriterResponse(parsed);
        if (decodedResp.ok === false) {
          const errObj = decodedResp.error as unknown as { readonly reason?: unknown; readonly message?: unknown };
          const reason =
            typeof errObj.reason === "string"
              ? errObj.reason
              : typeof errObj.message === "string"
              ? errObj.message
              : "unknown";
          finalize({
            ok: false,
            error: {
              kind: "frame_decode_failed",
              reason: `response decode failed: ${reason}`,
            },
          });
          return;
        }
        finalize({
          ok: true,
          value: decodedResp.value,
        });
        return;
      }
    });
  });
}

/**
 * Convenience wrapper: assert the response kind matches
 * `expectedKind`. Used by ping/who_are_you where the
 * response kind is fixed.
 */
export async function sendLedgerWriterRequestOfKind<
  R extends LedgerWriterResponse["kind"],
>(
  opts: LedgerWriterClientOptions,
  request: LedgerWriterRequest,
  expectedKind: R,
): Promise<
  LedgerWriterClientResult<
    Extract<LedgerWriterResponse, { readonly kind: R }>
  >
> {
  const r = await sendLedgerWriterRequest(opts, request);
  if (!r.ok) return r;
  if (r.value.kind !== expectedKind) {
    return {
      ok: false,
      error: {
        kind: "frame_decode_failed",
        reason: `expected kind ${expectedKind}, got ${String(r.value.kind)}`,
      },
    };
  }
  return {
    ok: true,
    value: r.value as Extract<LedgerWriterResponse, { readonly kind: R }>,
  };
}
