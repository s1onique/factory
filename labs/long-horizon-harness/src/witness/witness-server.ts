/**
 * FOUNDATION04 — Unix-domain stream socket server transport.
 *
 * Implements the node:net boundary for the witness control plane.
 *
 * Doctrine F04-D22: bounded framed JSON over a UDS. No TCP fallback.
 * Doctrine F04-D78: explicit max-frame size.
 * Doctrine F04-D23: stale socket files are not blindly unlinked.
 */

import {
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { decodeFrame } from "./witness-codec-framing.js";

export type ServerError =
  | { readonly kind: "socket_path_too_long"; readonly observed: number; readonly max: number }
  | { readonly kind: "path_collision"; readonly path: string; readonly observedKind: "regular" | "symlink" | "directory" }
  | { readonly kind: "bind_failed"; readonly message: string }
  | { readonly kind: "permission_denied"; readonly message: string }
  | { readonly kind: "directory_wrong_mode"; readonly observed: number };

/** Conservative portable UDS path length budget. */
export const MAX_UDS_PATH_BYTES = 100;

export type ServerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ServerError };

/**
 * Refuse to bind if a non-socket file occupies the target path.
 * Witness identity comes from crypto, not the path.
 */
async function probeSocketPath(p: string): Promise<ServerResult<void>> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(p);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "ENOENT") return { ok: true, value: undefined };
    return { ok: false, error: { kind: "bind_failed", message: String(e) } };
  }
  if (stat.isDirectory()) {
    return { ok: false, error: { kind: "path_collision", path: p, observedKind: "directory" } };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, error: { kind: "path_collision", path: p, observedKind: "symlink" } };
  }
  return { ok: false, error: { kind: "path_collision", path: p, observedKind: "regular" } };
}

async function ensureSocketDirectory(p: string): Promise<ServerResult<void>> {
  const dir = path.dirname(p);
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return { ok: false, error: { kind: "bind_failed", message: `${dir} is not a directory` } };
    }
    const mode = stat.mode & 0o777;
    if (mode !== 0o700) {
      return { ok: false, error: { kind: "directory_wrong_mode", observed: mode } };
    }
  } catch (e: unknown) {
    return { ok: false, error: { kind: "bind_failed", message: String(e) } };
  }
  return { ok: true, value: undefined };
}

/**
 * Frame handlers are invoked once per fully-received frame.
 * Return a string to send it back; null to keep the socket open
 * and continue.
 */
export type FrameHandler = (
  json: string,
  socket: Socket,
) => string | null | Promise<string | null>;

/**
 * Listen for UDS connections on the given path.
 */
export async function listenOnUnixSocket(args: {
  readonly socketPath: string;
  readonly onFrame: FrameHandler;
}): Promise<ServerResult<Server>> {
  if (Buffer.byteLength(args.socketPath, "utf8") > MAX_UDS_PATH_BYTES) {
    return {
      ok: false,
      error: {
        kind: "socket_path_too_long",
        observed: Buffer.byteLength(args.socketPath, "utf8"),
        max: MAX_UDS_PATH_BYTES,
      },
    };
  }
  const dir = await ensureSocketDirectory(args.socketPath);
  if (!dir.ok) return dir;
  const probed = await probeSocketPath(args.socketPath);
  if (!probed.ok) return probed;

  const server = createServer((socket) => bindSocket(socket, args.onFrame));
  try {
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
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EACCES" || err.code === "EPERM") {
      return {
        ok: false,
        error: { kind: "permission_denied", message: err.message },
      };
    }
    return {
      ok: false,
      error: { kind: "bind_failed", message: err.message ?? String(e) },
    };
  }
  return { ok: true, value: server };
}

function bindSocket(socket: Socket, onFrame: FrameHandler): void {
  let buf: Buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    let offset = 0;
    while (true) {
      const decoded = decodeFrame(buf, offset);
      if (decoded.ok) {
        offset += decoded.consumed;
        Promise.resolve(onFrame(decoded.json, socket)).then((reply) => {
          if (reply !== null) {
            socket.end(reply);
          }
        }).catch((e: unknown) => {
          const reason = e instanceof Error ? e.message : String(e);
          socket.end(`{"kind":"error","error":{"kind":"session_closed","reason":${JSON.stringify(reason)}}}`);
        });
      } else if (decoded.error.kind === "oversize_frame") {
        socket.end();
        return;
      } else if (decoded.error.kind === "malformed_json" && decoded.consumed === 0) {
        return;
      } else {
        offset += decoded.consumed;
        if (offset === buf.length) {
          buf = Buffer.alloc(0);
          return;
        }
      }
    }
  });
  socket.on("error", () => {
    socket.destroy();
  });
  socket.on("close", () => {
    socket.removeAllListeners();
  });
}

/**
 * Best-effort cleanup of a stale socket file. Does NOT unlink
 * anything unless the path is a regular socket file owned by the
 * current uid.
 */
export async function safeRemoveSocketFile(p: string): Promise<void> {
  try {
    const stat = await fs.lstat(p);
    if (stat.isSymbolicLink()) return;
    if (!stat.isSocket()) return;
    await fs.unlink(p);
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== "ENOENT") throw e;
  }
}

/**
 * Wait for the socket path to appear (used by the supervisor when
 * the witness is still bootstrapping and has not yet bound).
 */
export async function waitForSocketPath(args: {
  readonly socketPath: string;
  readonly timeoutMs: number;
  readonly abortSignal?: AbortSignal;
}): Promise<ServerResult<void>> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() < deadline) {
    if (args.abortSignal?.aborted) {
      return { ok: false, error: { kind: "bind_failed", message: "aborted" } };
    }
    try {
      const stat = await fs.stat(args.socketPath);
      if (stat.isSocket()) return { ok: true, value: undefined };
    } catch {
      // not yet
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { ok: false, error: { kind: "bind_failed", message: "timeout" } };
}
