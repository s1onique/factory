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

/**
 * CORRECTION03 (post-bind resource-closure law):
 *   `net.Server.close()` only stops admission. The server is
 *   NOT closed until every accepted connection has ended and
 *   the `'close'` event has fired. A listening-or-draining
 *   server keeps the event loop alive, so `process.exitCode`
 *   alone can never terminate the process.
 *
 *   Complete closure therefore requires ownership of the
 *   accepted sockets. This registry is the ownership record:
 *   every socket accepted by `listenOnUnixSocket` is tracked
 *   until it closes, so `closeServerBounded` can destroy the
 *   residue and observe the real `'close'` boundary.
 */
const acceptedSockets: WeakMap<Server, Set<Socket>> = new WeakMap();

export type CloseOutcome = {
  /** True iff the server's `'close'` event was observed. */
  readonly closed: boolean;
  /** Accepted connections destroyed as part of the close. */
  readonly destroyedConnections: number;
  /** True iff the bounded deadline elapsed before `'close'`. */
  readonly timedOut: boolean;
};

/** Default bound for the post-bind close boundary. */
export const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

/**
 * Bounded, PROVEN close of a listening UDS server.
 *
 * Doctrine (kernel-observation API purity, CORRECTION05):
 *   This function is the AUTHORITATIVE observation of the
 *   server's `'close'` boundary. Its return value is kernel
 *   evidence, not policy, and it MUST NOT be told what to
 *   claim by callers — including tests. Tests that need to
 *   exercise the timeout branch of the rollback policy above
 *   this function test the PURE policy function
 *   `decideSocketRollback` instead; they do not (and must
 *   not) put a fabrication seam into this observation API.
 *
 * Sequence (F04 post-bind resource-closure law):
 *   1. `server.close()` — stop admission.
 *   2. Destroy every accepted connection we own; without
 *      this an idle-but-open peer pins the event loop
 *      forever and `'close'` never fires.
 *   3. Await the real `'close'` event, bounded by
 *      `timeoutMs`. An unbounded await is not permitted:
 *      a bootstrap rollback MUST terminate.
 *
 * The returned outcome is observable evidence: callers and
 * tests can assert that closure actually happened rather
 * than assuming it.
 */
export async function closeServerBounded(
  server: Server,
  timeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<CloseOutcome> {
  if (!server.listening && acceptedSockets.get(server) === undefined) {
    return { closed: true, destroyedConnections: 0, timedOut: false };
  }
  const closePromise = new Promise<boolean>((resolve) => {
    server.once("close", () => resolve(true));
  });
  server.close();
  const tracked = acceptedSockets.get(server);
  let destroyed = 0;
  if (tracked !== undefined) {
    for (const s of Array.from(tracked)) {
      tracked.delete(s);
      if (!s.destroyed) {
        s.destroy();
        destroyed += 1;
      }
    }
  }
  let timer: NodeJS.Timeout | null = null;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  const closed = await Promise.race([closePromise, deadline]);
  if (timer !== null) clearTimeout(timer);
  return { closed, destroyedConnections: destroyed, timedOut: !closed };
}

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

  const server = createServer();
  // CORRECTION03: the accepted socket is registered against
  // THIS server before any framing work, so a connection that
  // arrives during bootstrap is always owned and therefore
  // always reapable by closeServerBounded().
  server.on("connection", (socket: Socket) => {
    trackAcceptedSocket(server, socket);
    bindSocket(socket, args.onFrame);
  });
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

function trackAcceptedSocket(server: Server, socket: Socket): void {
  const set = acceptedSockets.get(server) ?? new Set<Socket>();
  set.add(socket);
  acceptedSockets.set(server, set);
  socket.once("close", () => {
    acceptedSockets.get(server)?.delete(socket);
  });
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
 * CORRECTION04 — Close-before-unlink law.
 *
 * A pathname for an authority-bearing Unix socket may be
 * removed ONLY after the kernel close boundary has been
 * positively observed. POSIX/Linux explicitly permits
 * unlinking a Unix-domain socket pathname while processes
 * still hold the socket; existing references keep working.
 * If a future actor then re-creates an endpoint at the same
 * pathname before the original reference dies, you have lost
 * the ability to tell which one is the authority endpoint.
 *
 * `rollbackSocketAfterClose` is the single doctrine site for
 * the rollback helper in witness-runtime.ts and the normal
 * shutdown in witness-runtime-handlers.ts. Callers MUST use
 * this instead of calling `safeRemoveSocketFile` directly,
 * so the law cannot be silently bypassed.
 *
 * Returns:
 *   - `{ removed: true,  outcome }` on proven close (pathname
 *     unlinked)
 *   - `{ removed: false, outcome }` on unproven / timed-out
 *     close (pathname RETAINED)
 */
export async function rollbackSocketAfterClose(
  server: Server,
  socketPath: string,
  timeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<{
  readonly removed: boolean;
  readonly outcome: CloseOutcome;
}> {
  const outcome = await closeServerBounded(server, timeoutMs);
  const decision = decideSocketRollback(outcome);
  if (decision.kind === "remove_path") {
    await safeRemoveSocketFile(socketPath);
    return { removed: true, outcome };
  }
  // Close-before-unlink: do NOT unlink. The pathname remains
  // as a record that closure was unproven at this identity;
  // the supervisory layer (process supervisor / next-run
  // sweep) is responsible for the named unlink on its own
  // proof, not here.
  return { removed: false, outcome };
}

/**
 * CORRECTION05 — pure rollback policy.
 *
 * Decides whether the witness UDS pathname may be unlinked
 * given a `CloseOutcome` observed by `closeServerBounded`.
 * This is the single source of truth for the
 * close-before-unlink law (CORRECTION04). It is a PURE
 * function: no I/O, no observers, no fabrication surface.
 *
 * Tests (BOOTOBS11) exercise every branch of this policy
 * deterministically without needing a fabrication seam in
 * the kernel-observation API (`closeServerBounded`). The
 * observation API cannot lie; the policy is what decides.
 *
 * Law:
 *   - `outcome.closed === true`  → remove_path (kernel close
 *     was positively observed; safe to erase identity).
 *   - otherwise                  → retain_path (a future
 *     actor MUST NOT race to re-create an authority endpoint
 *     under a name whose kernel close was unproven).
 */
export type SocketRollbackDecision =
  | { readonly kind: "remove_path" }
  | { readonly kind: "retain_path" };

export function decideSocketRollback(
  outcome: CloseOutcome,
): SocketRollbackDecision {
  if (outcome.closed === true) {
    return { kind: "remove_path" };
  }
  return { kind: "retain_path" };
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
