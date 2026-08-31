/**
 * FOUNDATION04 — CORRECTION01 — LedgerWriter client transport.
 *
 * Used by the supervisor and the witness to submit append
 * requests over UDS to the LedgerWriter.
 *
 * Connection lifecycle (one-shot RPC):
 *   - assert the socket path is a real socket (lstat, not stat)
 *   - open socket
 *   - send framed request
 *   - read framed response
 *   - close socket
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
  LEDGER_WRITER_PROTOCOL_VERSION,
} from "./ledger-writer-protocol.js";
import {
  decodeJsonText,
} from "../witness/witness-codec-decode.js";

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

export async function sendLedgerWriterRequest<
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
  const probe = await assertSocket(opts.socketPath);
  if (!probe.ok) return probe;

  const timeoutMs = opts.timeoutMs ?? 5000;
  return await new Promise<
    LedgerWriterClientResult<
      Extract<LedgerWriterResponse, { readonly kind: R }>
    >
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
        error: { kind: "timeout", message: "no response within timeout" },
      });
    }, timeoutMs);

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      let offset = 0;
      while (true) {
        const decoded = decodeFrame(buf, offset);
        if (!decoded.ok) {
          if (decoded.error.kind === "oversize_frame") {
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve({
              ok: false,
              error: {
                kind: "frame_decode_failed",
                reason: "oversize_frame",
              },
            });
            return;
          }
          if (
            decoded.error.kind === "malformed_json" &&
            decoded.consumed === 0
          ) {
            // need more
            return;
          }
          offset += decoded.consumed;
          if (offset >= buf.length) {
            buf = Buffer.alloc(0);
            return;
          }
          continue;
        }
        clearTimeout(timer);
        settled = true;
        socket.end();
        let parsed: unknown;
        try {
          parsed = decodeJsonText(decoded.json);
        } catch (e: unknown) {
          resolve({
            ok: false,
            error: {
              kind: "frame_decode_failed",
              reason: e instanceof Error ? e.message : String(e),
            },
          });
          return;
        }
        const resp = parsed as LedgerWriterResponse;
        if (resp.kind === "error") {
          resolve({
            ok: false,
            error: { kind: "protocol_error", error: resp.error },
          });
          return;
        }
        if (resp.kind !== expectedKind) {
          resolve({
            ok: false,
            error: {
              kind: "frame_decode_failed",
              reason: `expected kind ${expectedKind}, got ${resp.kind}`,
            },
          });
          return;
        }
        resolve({
          ok: true,
          value: resp as Extract<LedgerWriterResponse, { readonly kind: R }>,
        });
        return;
      }
    });
    socket.on("error", (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: { kind: "connect_failed", message: e.message },
      });
    });
    socket.on("connect", () => {
      const out = frameRequest(request);
      socket.write(out, (err) => {
        if (err !== undefined && err !== null) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            socket.destroy();
          } catch {
            // best-effort
          }
          resolve({
            ok: false,
            error: { kind: "write_failed", message: err.message },
          });
          return;
        }
        socket.end();
      });
    });
  });
}

export type AppendRequest = Extract<
  LedgerWriterRequest,
  { readonly kind: "append" }
>;

export async function appendToLedgerWriter(
  opts: LedgerWriterClientOptions,
  args: {
    readonly commitId: string;
    readonly envelopeBytes: string;
    readonly contentHash: string;
  },
): Promise<
  LedgerWriterClientResult<{
    readonly sequence: number;
    readonly commitId: string;
  }>
> {
  const request: AppendRequest = {
    kind: "append",
    protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
    commitId: args.commitId as AppendRequest["commitId"],
    envelopeBytes: args.envelopeBytes,
    contentHash: args.contentHash,
  };
  return await sendLedgerWriterRequest(opts, request, "appended");
}

export async function pingLedgerWriter(
  opts: LedgerWriterClientOptions,
): Promise<
  LedgerWriterClientResult<{
    readonly instanceId: string;
    readonly maxSequence: number;
  }>
> {
  return await sendLedgerWriterRequest(
    opts,
    { kind: "ping", protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION },
    "pong",
  );
}
