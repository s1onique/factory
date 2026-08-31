/**
 * FOUNDATION04 — B0-CORR06 — Per-connection handler.
 *
 * Installs socket listeners for one incoming UDS
 * connection. The actual request lifecycle is dispatched
 * from the "data" callback below.
 *
 * B0-CORR06: in-flight accounting is bound to the
 * request lifecycle, not the connection lifecycle.
 * handleConnection() returns as soon as listeners are
 * installed; the in-flight counter increments and
 * decrements only when a parsed request enters the
 * dispatch path.
 */

import type { Socket } from "node:net";

import {
  decodeFrame,
  encodeFrame,
} from "../witness/witness-codec-framing.js";
import {
  type LedgerWriterResponse,
  parseLedgerWriterRequest,
  LEDGER_WRITER_PROTOCOL_VERSION,
} from "./ledger-writer-protocol.js";
import {
  handleRequest,
  type WriterServerArgs,
  type WriterState,
  type WriterError,
} from "./ledger-writer-request-handler.js";

export async function handleConnection(
  socket: Socket,
  args: WriterServerArgs,
  state: WriterState,
): Promise<void> {
  let buf: Buffer = Buffer.alloc(0);
  const reply = async (r: LedgerWriterResponse): Promise<void> => {
    const frame = encodeFrame(JSON.stringify(r));
    if (!frame.ok) {
      socket.destroy();
      return;
    }
    // Write frame bytes THEN end the socket. Combining
    // write+end into a single call (socket.end(buffer))
    // races with the client's half-close on UDS —
    // reply bytes are silently dropped under contention.
    // Separating the write and the close makes the
    // delivery observable in the test harness.
    socket.write(Buffer.from(frame.bytes), () => {
      socket.end();
    });
  };
  const replyErr = async (error: WriterError): Promise<void> => {
    await reply({
      kind: "error",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      error,
    });
  };

  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    let offset = 0;
    while (true) {
      const decoded = decodeFrame(buf, offset);
      if (!decoded.ok) {
        if (decoded.error.kind === "oversize_frame") {
          socket.destroy();
          return;
        }
        if (
          decoded.error.kind === "malformed_json" &&
          decoded.consumed === 0
        ) {
          return; // need more — wait for next chunk
        }
        offset += decoded.consumed;
        if (offset >= buf.length) {
          buf = Buffer.alloc(0);
          return;
        }
        continue;
      }
      const json = decoded.json;
      buf = buf.subarray(offset + decoded.consumed);
      offset = 0;

      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        void replyErr({ kind: "malformed_message", reason: m });
        return;
      }

      const req = parseLedgerWriterRequest(parsed);
      if (!req.ok) {
        void replyErr({ kind: "malformed_message", reason: req.reason });
        return;
      }

      // B0-CORR06: increment exactly once here, before
      // dispatching the durable request handler.
      // Decrement in finally so the counter settles when
      // the request fully completes.
      state.inFlight++;
      handleRequest(req.request, args, state, reply, replyErr)
        .catch((e: unknown) => {
          const m = e instanceof Error ? e.message : String(e);
          process.stderr.write(`[writer] handler error: ${m}\n`);
          try { socket.destroy(); } catch { /* */ }
        })
        .finally(() => {
          state.inFlight--;
        });
      return; // one-shot per connection
    }
  });
  socket.on("error", () => {
    socket.destroy();
  });
}
