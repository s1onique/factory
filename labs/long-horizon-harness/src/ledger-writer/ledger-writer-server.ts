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

import { createServer, type Server } from "node:net";

import { probeSocketPath } from "./ledger-writer-socket-probe.js";
import { loadOrInitIndex } from "./ledger-writer-persistence.js";
import {
  type WriterServerArgs,
  type WriterState,
} from "./ledger-writer-request-handler.js";
import { handleConnection } from "./ledger-writer-connection.js";
import {
  acquireLedgerWriterLease,
  type LeaseHandle,
  LEDGER_WRITER_LEASE_DIRNAME,
} from "./ledger-writer-lease.js";
import type { LedgerWriterInstanceId } from "./ledger-writer-types.js";
import { asShutdownServerPort, type ShutdownServerPort } from "./ledger-writer-shutdown.js";

/**
 * Conservative portable UDS path length budget. Matches
 * MAX_UDS_PATH_BYTES in witness-server.ts (100 bytes —
 * sun_path on most POSIX systems is 104 or 108 bytes; we
 * stay well under to keep the path portable across
 * filesystems and container mounts).
 */
const MAX_UDS_PATH_BYTES = 100;

export type WriterServerError =
  | { readonly kind: "socket_path_too_long"; readonly message: string }
  | {
      readonly kind: "path_collision";
      readonly message: string;
    }
  | {
      readonly kind: "live_writer_present";
      readonly message: string;
    }
  | {
      readonly kind: "bind_failed";
      readonly message: string;
    }
  | {
      readonly kind: "permission_denied";
      readonly message: string;
    }
  | {
      readonly kind: "directory_wrong_mode";
      readonly observed: number;
    };

export type WriterServerHandle = {
  readonly server: Server;
  readonly leaseHandle: LeaseHandle;
  readonly waitForInFlight: () => Promise<void>;
  /**
   * Current count of in-flight request handlers (durable
   * append/replay/path). Connection lifecycle does not
   * contribute; only the request dispatch path does.
   *
   * B0-CORR06: in-flight accounting is bound to the
   * request lifecycle, not the connection lifecycle.
   */
  readonly inFlightCount: () => number;
  /**
   * B0-CORR07: returns a ShutdownServerPort whose
   * requestClose() synchronously closes the
   * request-admission gate before calling
   * server.close(). This makes the graceful-shutdown
   * "no new work enters" law literally true for both
   * new connections AND already-accepted sockets.
   */
  readonly shutdownPort: ShutdownServerPort;
};

export type WriterServerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WriterServerError };

export async function startWriterServer(
  args: WriterServerArgs,
): Promise<WriterServerResult<WriterServerHandle>> {
  // B0-CORR03 §1..2: declare the in-flight counter here so
  // handleConnection can mutate it.
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
    crashCutHook: process.env["FACTORY_LEDGER_WRITER_CRASH_CUT"] === "1"
      ? { onCommit: () => "crash" }
      : null,
    inFlight: 0,
    // B0-CORR07: admission gate starts open; requestClose()
    // flips it closed.
    admission: { accepting: true },
  };

  const server = createServer((socket) => {
    // B0-CORR06: handleConnection returns as soon as the
    // socket listeners are installed. The actual request
    // handler is dispatched from the "data" callback. We
    // therefore bind the in-flight accounting to the
    // request lifecycle, not the connection lifecycle.
    //
    // handleConnection() handles listener-registration
    // errors and socket teardown. It does NOT participate
    // in the drain count.
    handleConnection(socket, args, state).catch(() => {
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
    });
  });

  // B0-CORR02 §4: bind-time path-collision policy.
  //
  // The pathname UNIX socket is NOT sole-writer authority.
  // The lease IS. We acquire the lease first; only after
  // we hold the lease do we have the right to inspect and
  // (if necessary) remove the socket path.
  //
  //   1. Acquire the run-scoped lease. If it is held by
  //      another process, fail closed — we MUST NOT displace
  //      an unknown lease holder based on socket liveness
  //      alone.
  //
  //   2. Probe the socket path (purely informational).
  //      - missing → bind.
  //      - symlink / directory / regular file → reject.
  //      - socket + who_are_you returns live instanceId →
  //        reject (the only acceptable occupant is the
  //        lease holder, and if a live writer is answering
  //        it cannot be us since we are not yet bound).
  //      - socket + who_are_you returns no_response /
  //        error_response → unknown; as lease holder we
  //        MAY unlink the path. We do so only after the
  //        probe concludes.
  //
  // The recovery from unlink to bind is not atomic. Two
  // writers who both hold the lease (which cannot happen
  // because mkdir is atomic) cannot race here.
  const lease = await acquireLedgerWriterLease({
    runDir: args.runDir,
    instanceId: args.instanceId as LedgerWriterInstanceId,
    runId: args.runId,
    missionId: args.missionId,
  });
  if (!lease.ok) {
    server.close();
    if (lease.error.kind === "lease_held") {
      return {
        ok: false,
        error: {
          kind: "path_collision",
          message:
            `cannot bind LedgerWriter: lease at ` +
            `${args.runDir}/${LEDGER_WRITER_LEASE_DIRNAME} is held by ` +
            `instanceId=${lease.error.existing?.instanceId ?? "?"}; ` +
            `refusing to displace unknown holder`,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "bind_failed",
        message:
          lease.error.kind === "io_error"
            ? lease.error.message
            : `cannot acquire lease`,
      },
    };
  }

  const probe = await probeSocketPath(args.socketPath);
  if (!probe.ok) {
    server.close();
    await lease.handle.release().catch(() => undefined);
    return probe;
  }
  if (probe.value === "unknown_socket") {
    // B0-CORR05 §8: unknown_socket means we could not
    // establish WHO the listener is. Possession of the
    // filesystem lease does NOT prove the previously-bound
    // socket's listener is dead — pathname lifecycle and
    // socket lifetime are distinct. The safe policy is to
    // fail closed and refuse to bind.
    //
    // Doctrine:
    //   **Endpoint-uncertainty law:** possession of
    //   filesystem authority does not prove death of an
    //   independently live kernel endpoint.
    //
    // Explicit operator recovery may remove a stale socket
    // only after an independent proof that the old writer
    // is gone.
    server.close();
    await lease.handle.release().catch(() => undefined);
    return {
      ok: false,
      error: {
        kind: "path_collision",
        message:
          `unknown socket at ${args.socketPath}; WHO did not respond; refusing to unlink or bind (operator recovery required)`,
      },
    };
  }

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
    if (err.code === "EADDRINUSE") {
      await lease.handle.release().catch(() => undefined);
      return {
        ok: false,
        error: {
          kind: "path_collision",
          message: `path ${args.socketPath} became bound by another writer while we were probing`,
        },
      };
    }
    await lease.handle.release().catch(() => undefined);
    return {
      ok: false,
      error: {
        kind: "bind_failed",
        message: err.message ?? String(e),
      },
    };
  }

  // B0-CORR03 §1..2 — lease lifetime law. The lease handle
  // is returned alongside the server so the entry can drive
  // the orderly shutdown sequence:
  //
  //   shutdown requested
  //   → stop accepting new connections (server.close)
  //   → wait for in-flight handlers to settle (in-flight
  //     counter, awaited via `waitForInFlight`)
  //   → observe net.Server `close` event
  //   → ONLY THEN release lease
  //   → exit
  //
  // If the bounded shutdown timeout expires, the lease is
  // RETAINED (fail closed) — an external SIGKILL is required
  // to remove the writer. The lease directory being held is
  // the authoritative signal that the previous writer did
  // not exit cleanly.
  return {
    ok: true,
    value: {
      server,
      leaseHandle: lease.handle,
      waitForInFlight: async (): Promise<void> => {
        while (state.inFlight > 0) {
          await new Promise((r) => setTimeout(r, 10));
        }
      },
      inFlightCount: (): number => state.inFlight,
      shutdownPort: asShutdownServerPort(server, {
        closeAdmission: (): void => {
          state.admission.accepting = false;
        },
        isAcceptingRequests: (): boolean => state.admission.accepting,
      }),
    },
  };
}

