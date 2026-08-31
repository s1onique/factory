/**
 * FOUNDATION04 — CORRECTION01 — LedgerWriter per-connection handler.
 *
 * Runs inside the writer child process. Holds:
 *   - the open JsonlLedger file handle (single writer)
 *   - the dedup index in memory, fsync'd to the sidecar
 *     after every successful append
 *   - the writer's own instanceId / runId / missionId
 *
 * Connection lifecycle:
 *   - framed request in
 *   - validate
 *   - if append: dedup-check, allocate sequence, fsync
 *     ledger, fsync dedup index, reply appended
 *   - if ping: reply pong
 *   - if who_are_you: reply self
 *   - the socket is closed after one reply (one-shot RPC)
 *
 * The serializer is a per-writer single-flight queue: only
 * one append runs at a time. New requests arriving during
 * an append receive `writer_busy`. This is simpler and safer
 * than maintaining a request queue with re-entrancy bugs.
 */

import { promises as fs } from "node:fs";
import { open as fsOpen } from "node:fs/promises";
import * as path from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { createHash } from "node:crypto";

import { LEDGER_FILENAME } from "../evidence/jsonl-ledger.js";
import { appendCommittedLineToFile } from "../evidence/ledger-internals.js";
import { readAndValidate } from "../evidence/ledger-read-validate.js";
import {
  decodeFrame,
  encodeFrame,
} from "../witness/witness-codec-framing.js";
import {
  deserializeDedupIndex,
  dedupLookup,
  dedupRecord,
  mergeRecoveredIndex,
  reconcileWithLedger,
  serializeDedupIndex,
} from "./ledger-writer-dedup.js";
import type { DedupIndex, LedgerWriterInstanceId } from "./ledger-writer-types.js";
import { emptyDedupIndex } from "./ledger-writer-types.js";
import {
  type LedgerWriterRequest,
  type LedgerWriterResponse,
  parseLedgerWriterRequest,
  LEDGER_WRITER_PROTOCOL_VERSION,
} from "./ledger-writer-protocol.js";
import { LEDGER_WRITER_STATE_FILENAME } from "./ledger-writer-process.js";

/**
 * Conservative portable UDS path length budget. Matches
 * MAX_UDS_PATH_BYTES in witness-server.ts (100 bytes —
 * sun_path on most POSIX systems is 104 or 108 bytes; we
 * stay well under to keep the path portable across
 * filesystems and container mounts).
 */
const MAX_UDS_PATH_BYTES = 100;

export type WriterServerArgs = {
  readonly runDir: string;
  readonly runId: string;
  readonly missionId: string;
  readonly socketPath: string;
  readonly instanceId: string;
};

export type WriterServerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly kind: string; readonly message: string } };

function statePath(runDir: string): string {
  return path.join(runDir, LEDGER_WRITER_STATE_FILENAME);
}

async function loadOrInitIndex(runDir: string): Promise<DedupIndex> {
  const p = statePath(runDir);
  let recovered: DedupIndex = emptyDedupIndex();
  try {
    const raw = await fs.readFile(p, "utf8");
    recovered = deserializeDedupIndex(raw);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code !== "ENOENT") throw e;
  }
  const ledgerPath = path.join(runDir, LEDGER_FILENAME);
  let ledgerMax = 0;
  try {
    const v = await readAndValidate(ledgerPath);
    if (v.ok) ledgerMax = v.value.lastSeq;
  } catch {
    // ledger missing or unreadable — fine on first run
  }
  return reconcileWithLedger(
    mergeRecoveredIndex(emptyDedupIndex(), recovered),
    ledgerMax,
  );
}

async function persistIndex(
  runDir: string,
  index: DedupIndex,
): Promise<void> {
  const p = statePath(runDir);
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  const fh = await fsOpen(tmp, "wx", 0o600);
  try {
    await fh.writeFile(serializeDedupIndex(index), "utf8");
    await fh.sync();
    await fh.close();
    await fs.rename(tmp, p);
  } catch (e) {
    try {
      await fh.close();
    } catch {
      // best-effort
    }
    await fs.rm(tmp, { force: true });
    throw e;
  }
  try {
    const dirFh = await fsOpen(path.dirname(p), "r");
    try {
      await dirFh.sync();
    } finally {
      await dirFh.close();
    }
  } catch {
    // best-effort: directory fsync not supported everywhere
  }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

type WriterState = {
  index: DedupIndex;
  busy: boolean;
};

export async function startWriterServer(
  args: WriterServerArgs,
): Promise<WriterServerResult<Server>> {
  // Refuse to start with an over-long socket path. Node's
  // bind would otherwise fail with EINVAL.
  const pathByteLen = Buffer.byteLength(args.socketPath, "utf8");
  if (pathByteLen > MAX_UDS_PATH_BYTES) {
    return {
      ok: false,
      error: {
        kind: "socket_path_too_long",
        message: `socket path is ${pathByteLen} bytes; max ${MAX_UDS_PATH_BYTES}`,
      },
    };
  }
  const state: WriterState = {
    index: await loadOrInitIndex(args.runDir),
    busy: false,
  };

  const server = createServer((socket: Socket) => {
    handleConnection(socket, args, state).catch(() => {
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
    });
  });

  try {
    await fs.rm(args.socketPath, { force: true });
  } catch {
    // best-effort
  }

  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Error): void => {
      server.removeListener("listening", onListen);
      reject(e);
    };
    const onListen = (): void => {
      server.removeListener("error", onErr);
      resolve();
    };
    server.once("error", onErr);
    server.once("listening", onListen);
    server.listen(args.socketPath);
  });

  return { ok: true, value: server };
}

type WriterError =
  | { readonly kind: "invalid_envelope"; readonly reason: string }
  | { readonly kind: "append_failed"; readonly message: string }
  | { readonly kind: "writer_busy"; readonly message: string }
  | { readonly kind: "protocol_version_mismatch"; readonly observed: number }
  | { readonly kind: "malformed_message"; readonly reason: string };

async function handleConnection(
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
    socket.end(Buffer.from(frame.bytes));
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
          // "need more" — wait for next chunk
          return;
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

      void handleRequest(req.request, args, state, reply, replyErr);
      return; // one-shot per connection
    }
  });
  socket.on("error", () => {
    socket.destroy();
  });
}

async function handleRequest(
  req: LedgerWriterRequest,
  args: WriterServerArgs,
  state: WriterState,
  reply: (r: LedgerWriterResponse) => Promise<void>,
  replyErr: (e: WriterError) => Promise<void>,
): Promise<void> {
  if (req.kind === "ping") {
    await reply({
      kind: "pong",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      instanceId: args.instanceId as LedgerWriterInstanceId,
      maxSequence: state.index.maxSequence,
    });
    return;
  }
  if (req.kind === "who_are_you") {
    await reply({
      kind: "self",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      instanceId: args.instanceId as LedgerWriterInstanceId,
      socketPath: args.socketPath,
      runId: args.runId,
      missionId: args.missionId,
      startedAt: Date.now(),
      maxSequence: state.index.maxSequence,
    });
    return;
  }

  if (state.busy) {
    await replyErr({
      kind: "writer_busy",
      message: "writer is busy with another append",
    });
    return;
  }
  state.busy = true;
  try {
    const contentHash = sha256Hex(req.envelopeBytes);
    const existing = dedupLookup(state.index, {
      commitId: req.commitId,
      contentHash,
    });
    if (existing !== null) {
      await reply({
        kind: "appended",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        commitId: req.commitId,
        sequence: existing,
      });
      return;
    }

    const nextSeq = state.index.maxSequence + 1;
    const line = req.envelopeBytes.endsWith("\n")
      ? req.envelopeBytes
      : req.envelopeBytes + "\n";
    const io = await appendCommittedLineToFile(
      path.join(args.runDir, LEDGER_FILENAME),
      line,
    );
    if (!io.ok) {
      await replyErr({ kind: "append_failed", message: io.error.message });
      return;
    }

    const newIndex = dedupRecord(state.index, {
      commitId: req.commitId,
      contentHash,
      sequence: nextSeq,
    });
    await persistIndex(args.runDir, newIndex);
    state.index = newIndex;

    await reply({
      kind: "appended",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      commitId: req.commitId,
      sequence: nextSeq,
    });
  } finally {
    state.busy = false;
  }
}

// LedgerWriterInstanceId is imported above from
// ledger-writer-types.ts. The brand is enforced at the
// writer-process layer via makeLedgerWriterInstanceId.
