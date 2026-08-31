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
        // Half-close: stop writing but keep reading for the
        // server's reply. We MUST NOT call socket.end() with
        // no data because that fully closes the socket and
        // races with the server's reply write on UDS.
        // socket.shutdown() is not available on net.Socket;
        // use socket.end() with no payload only after the
        // server's reply has been received.
      });
    });
  });
}

export type AppendRequest = Extract<
  LedgerWriterRequest,
  { readonly kind: "append" }
>;

/**
 * Append an unsequenced typed event to the LedgerWriter
 * (B0-C01-01..02).
 *
 * The caller supplies the typed event body plus the
 * pre-computed `clientContentHash` (computed via
 * `canonicalContentHash` from the same module). The writer
 * is the SOLE authority on the sequence number; this API
 * does NOT accept a sequence field at all (B0-C01-01).
 *
 * The writer either:
 *   - allocates a fresh sequence, persists the canonical
 *     envelope, and ACKs `appended` with that sequence;
 *   - recognises a prior commitId + matching contentHash and
 *     ACKs `replay` with the original sequence
 *     (B0-C01-05);
 *   - rejects a commitId reuse with different contentHash as
 *     `conflicting_commit` (B0-C01-06);
 *   - rejects a tampered clientContentHash as
 *     `content_hash_mismatch`.
 *
 * Both `appended` and `replay` carry the durable
 * (sequence, contentHash) for the commitId. Callers MUST
 * treat them as equivalent: the commitId is durably
 * committed at that sequence.
 */
export async function appendToLedgerWriter(
  opts: LedgerWriterClientOptions,
  args: {
    readonly commitId: string;
    readonly clientContentHash: string;
    readonly event: import("./ledger-writer-protocol.js").WriterEvent;
  },
): Promise<
  LedgerWriterClientResult<{
    readonly sequence: number;
    readonly commitId: string;
    readonly contentHash: string;
    readonly committed: "appended" | "replay";
  }>
> {
  const request: AppendRequest = {
    kind: "append",
    protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
    commitId: args.commitId as AppendRequest["commitId"],
    clientContentHash: args.clientContentHash,
    event: args.event,
  };
  // The writer is single-flight per connection (one append
  // at a time). Concurrent client requests can therefore
  // receive `writer_busy` if the writer is mid-fsync. We
  // retry writer_busy up to 256 times with a small linear
  // backoff and per-attempt jitter, so that concurrent
  // callers naturally desynchronise and the queue drains
  // without a thundering-herd retry storm. After 256
  // retries the writer is genuinely stuck and we fail closed.
  const MAX_BUSY_RETRIES = 256;
  for (let attempt = 0; attempt < MAX_BUSY_RETRIES; attempt++) {
    // Either "appended" or "replay" may come back; both carry
    // the durable (sequence, contentHash) for the commitId.
    const appendedRes = await sendLedgerWriterRequest(
      opts,
      request,
      "appended",
    );
    if (appendedRes.ok) {
      return {
        ok: true,
        value: {
          sequence: appendedRes.value.sequence,
          commitId: appendedRes.value.commitId,
          contentHash: appendedRes.value.contentHash,
          committed: "appended",
        },
      };
    }
    // If the writer reported "replay" we get a frame_decode_failed
    // error on the appended probe; try the replay probe.
    if (
      appendedRes.error.kind === "frame_decode_failed" &&
      appendedRes.error.reason.startsWith("expected kind appended, got replay")
    ) {
      const replayRes = await sendLedgerWriterRequest(
        opts,
        request,
        "replay",
      );
      if (replayRes.ok) {
        return {
          ok: true,
          value: {
            sequence: replayRes.value.sequence,
            commitId: replayRes.value.commitId,
            contentHash: replayRes.value.contentHash,
            committed: "replay",
          },
        };
      }
      return replayRes;
    }
    // Retry on writer_busy.
    if (appendedRes.error.kind === "protocol_error") {
      const inner = appendedRes.error.error as { kind?: string };
      if (inner.kind === "writer_busy") {
        // Linear backoff with per-attempt jitter: 0..5ms,
        // 0..10ms, ..., 0..315ms. The jitter spreads
        // concurrent retriers so the writer's single-flight
        // queue drains at a sustainable rate.
        if (attempt < MAX_BUSY_RETRIES - 1) {
          const baseMs = attempt * 5;
          const jitter = Math.floor(Math.random() * baseMs);
          await new Promise((r) => setTimeout(r, jitter));
          continue;
        }
      }
    }
    return appendedRes;
  }
  // Should not reach here, but TypeScript needs it.
  return {
    ok: false,
    error: { kind: "timeout", message: "writer_busy retries exhausted" },
  };
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

/**
 * Ask a writer socket `who_are_you`. Returns the writer's
 * instance identity if a live writer responds, or a typed
 * failure otherwise. Used by:
 *   - startLedgerWriter() to verify a freshly-bound writer
 *     matches the expected instanceId/runId/missionId.
 *   - Stale-socket recovery probes (B0-C01-09, B0-C01-10).
 *   - Tests that exercise the identity handshake.
 */
export type WhoAreYouClientResult =
  | {
      readonly ok: true;
      readonly instanceId: string;
      readonly runId: string;
      readonly missionId: string;
      readonly socketPath: string;
      readonly startedAt: number;
      readonly maxSequence: number;
    }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "no_response"; readonly message: string }
        | { readonly kind: "protocol_error"; readonly message: string };
    };

export async function whoAreYouLedgerWriter(
  opts: LedgerWriterClientOptions,
): Promise<WhoAreYouClientResult> {
  const r = await sendLedgerWriterRequest(
    opts,
    { kind: "who_are_you", protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION },
    "self",
  );
  if (!r.ok) {
    if (r.error.kind === "connect_failed") {
      return {
        ok: false,
        error: { kind: "no_response", message: r.error.message },
      };
    }
    if (r.error.kind === "frame_decode_failed") {
      return {
        ok: false,
        error: { kind: "protocol_error", message: r.error.reason },
      };
    }
    return {
      ok: false,
      error: { kind: "protocol_error", message: r.error.kind },
    };
  }
  return {
    ok: true,
    instanceId: r.value.instanceId,
    runId: r.value.runId,
    missionId: r.value.missionId,
    socketPath: r.value.socketPath,
    startedAt: r.value.startedAt,
    maxSequence: r.value.maxSequence,
  };
}
