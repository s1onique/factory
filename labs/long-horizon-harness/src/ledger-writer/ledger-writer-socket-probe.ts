/**
 * FOUNDATION04 — B0-CORR02 — bind-time socket probe.
 *
 * Splits the bind-time path-collision policy out of
 * `ledger-writer-server.ts` so that file stays under the
 * 400-LOC source-size discipline (FOUNDATION03 §29).
 *
 * The probe decides what kind of object occupies the bind
 * path before the writer attempts to bind:
 *
 *   1. lstat the path.
 *      - missing → ok to bind
 *      - symlink  → reject
 *      - directory → reject
 *      - regular file → reject
 *      - socket → go to step 2
 *
 *   2. Connect to the socket and ask `who_are_you`.
 *      - live writer answers → reject (sole-writer guard,
 *        B0-CORR02 §4)
 *      - no response / error → UNKNOWN (do NOT classify
 *        as stale and do NOT unlink — that is the
 *        unresponsive-is-not-stale law from B0-CORR02 §4.
 *        Unlinking the pathname does not kill a writer that
 *        still holds an open listening socket; the
 *        pathname can subsequently be reused. The lease is
 *        the only authority on stale-socket removal; the
 *        lease holder MAY remove the socket if the
 *        `who_are_you` handshake proves the listener is
 *        not the lease holder, but this module does not
 *        enforce that — the server does, after acquiring
 *        the lease.)
 *
 * The bind-time policy is the only authority on path
 * collisions. Tests that pre-rm the socket path (the
 * previous design) defeat this probe; the test harness
 * MUST NOT pre-rm.
 */

import { promises as fs } from "node:fs";
import { connect } from "node:net";
import {
  decodeFrame,
  encodeFrame,
} from "../witness/witness-codec-framing.js";
import {
  LEDGER_WRITER_PROTOCOL_VERSION,
  type LedgerWriterResponse,
} from "./ledger-writer-protocol.js";

export type WriterServerProbeError =
  | { readonly kind: "bind_failed"; readonly message: string }
  | { readonly kind: "path_collision"; readonly message: string }
  | { readonly kind: "live_writer_present"; readonly message: string };

export type SocketPathProbe =
  | { readonly ok: true; readonly value: "absent" }
  | { readonly ok: true; readonly value: "unknown_socket" }
  | { readonly ok: false; readonly error: WriterServerProbeError };

/**
 * Connect to a writer socket and ask `who_are_you`. Returns
 * the live instanceId on a successful handshake, or
 * `no_response` / `error_response` otherwise.
 */
async function whoAreYou(
  socketPath: string,
): Promise<string | "no_response" | "error_response"> {
  return await new Promise<string | "no_response" | "error_response">(
    (resolve) => {
      const sock = connect(socketPath);
      let buf = Buffer.alloc(0);
      let settled = false;
      const finish = (r: string | "no_response" | "error_response"): void => {
        if (settled) return;
        settled = true;
        try {
          sock.destroy();
        } catch {
          // best-effort
        }
        resolve(r);
      };
      const timer = setTimeout(() => finish("no_response"), 1000);
      sock.on("error", () => {
        clearTimeout(timer);
        finish("no_response");
      });
      sock.on("connect", () => {
        const req = {
          kind: "who_are_you",
          protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        };
        const enc = encodeFrame(JSON.stringify(req));
        if (!enc.ok) {
          clearTimeout(timer);
          finish("error_response");
          return;
        }
        sock.write(Buffer.from(enc.bytes), () => {
          sock.end();
        });
      });
      sock.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const decoded = decodeFrame(buf, 0);
        if (!decoded.ok) {
          if (decoded.error.kind === "oversize_frame") {
            clearTimeout(timer);
            finish("error_response");
            return;
          }
          if (decoded.error.kind === "malformed_json" && decoded.consumed === 0) {
            return;
          }
          clearTimeout(timer);
          finish("error_response");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(decoded.json);
        } catch {
          clearTimeout(timer);
          finish("error_response");
          return;
        }
        const resp = parsed as Partial<LedgerWriterResponse>;
        if (
          resp.kind === "self" &&
          typeof resp.instanceId === "string"
        ) {
          clearTimeout(timer);
          finish(resp.instanceId);
          return;
        }
        clearTimeout(timer);
        finish("error_response");
      });
      sock.on("close", () => {
        clearTimeout(timer);
        if (!settled) finish("no_response");
      });
    },
  );
}

export async function probeSocketPath(p: string): Promise<SocketPathProbe> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(p);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return { ok: true, value: "absent" };
    return {
      ok: false,
      error: {
        kind: "bind_failed",
        message: `lstat failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  if (stat.isSymbolicLink()) {
    return {
      ok: false,
      error: {
        kind: "path_collision",
        message: `path ${p} is a symbolic link; refusing to bind`,
      },
    };
  }
  if (stat.isDirectory()) {
    return {
      ok: false,
      error: {
        kind: "path_collision",
        message: `path ${p} is a directory; refusing to bind`,
      },
    };
  }
  if (!stat.isSocket()) {
    return {
      ok: false,
      error: {
        kind: "path_collision",
        message: `path ${p} is a regular file; refusing to bind`,
      },
    };
  }
  const who = await whoAreYou(p);
  if (who === "no_response" || who === "error_response") {
    // B0-CORR02 §4: unresponsive is NOT stale. The caller
    // must hold the lease to make that determination.
    return { ok: true, value: "unknown_socket" };
  }
  return {
    ok: false,
    error: {
      kind: "live_writer_present",
      message: `socket ${p} is owned by a live writer (instanceId=${who})`,
    },
  };
}
