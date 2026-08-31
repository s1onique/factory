/**
 * FOUNDATION04 — B0-CORR02 — run-scoped LedgerWriter lease.
 *
 * The pathname UNIX socket is NOT sole-writer authority
 * (B0-CORR02 P1-3, man7 unix(7)). Unlinking the pathname
 * while an existing process retains an open listening
 * socket does not kill the process; the writer can continue
 * serving. The pathname can subsequently be reused by a
 * second writer, leading to two live writers and only one
 * discoverable by pathname.
 *
 * Sole-writer authority MUST be a separate, atomically
 * acquired, filesystem-resident artifact whose existence
 * can be proven WITHOUT communicating with the holder. The
 * portable primitive is `mkdir(2)`: mkdir is atomic; if the
 * directory already exists, mkdir fails with EEXIST.
 *
 * The lease directory lives at:
 *
 *     <runDir>/ledger-writer-owner/
 *
 * Acquired exclusively by mkdir. The directory contains a
 * descriptive `owner.json` (instanceId, pid, startedAt) but
 * the directory ITSELF is the authority; the JSON is for
 * humans.
 *
 * Required invariant (B0-CORR02 §4):
 *
 *   "successful exclusive lease acquisition causally
 *    precedes socket cleanup/bind. Only the lease holder
 *    may classify/remove stale writer socket, bind
 *    LedgerWriter socket, or allocate sequences."
 *
 * Recovery: the lease is fail-closed manual. If a previous
 * writer dies and leaves the lease behind, the operator
 * MUST explicitly release it (releaseLedgerWriterLease) or
 * remove the directory before a new writer can start.
 * Automatic lease reclamation based on PID absence is
 * UNSAFE: PID reuse means a fresh unrelated process could
 * inherit the lease.
 *
 * This module is pure fs and is the only authority on the
 * lease. The server calls it at startup; the spawn-side
 * handshake calls it before binding the socket.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import type { LedgerWriterInstanceId } from "./ledger-writer-types.js";
import {
  checkLeaseDirExists,
  verifyLeaseToken,
  rmLeaseDir,
} from "./ledger-writer-lease-io.js";

/**
 * Generate a fresh, unguessable 32-byte hex token. Used
 * to bind a LeaseHandle to its specific acquisition.
 */
export function generateLeaseToken(): string {
  return randomBytes(32).toString("hex");
}

export const LEDGER_WRITER_LEASE_DIRNAME = "ledger-writer-owner";
export const LEDGER_WRITER_LEASE_FILENAME = "owner.json";
// B0-CORR04 §23: a per-acquisition random token written
// alongside owner.json. The LeaseHandle carries the same
// token and verifies it before rm. A stale handle cannot
// delete a replacement lease.
export const LEDGER_WRITER_LEASE_TOKEN_FILENAME = "token";

export function leaseDir(runDir: string): string {
  return path.join(runDir, LEDGER_WRITER_LEASE_DIRNAME);
}

export function leasePath(runDir: string): string {
  return path.join(leaseDir(runDir), LEDGER_WRITER_LEASE_FILENAME);
}

export function leaseTokenPath(runDir: string): string {
  return path.join(leaseDir(runDir), LEDGER_WRITER_LEASE_TOKEN_FILENAME);
}

export type LeaseMetadata = {
  readonly instanceId: LedgerWriterInstanceId;
  readonly runId: string;
  readonly missionId: string;
  readonly pid: number;
  readonly startedAt: number;
};

export type LeaseAcquireResult =
  | { readonly ok: true; readonly leaseDir: string; readonly handle: LeaseHandle }
  | { readonly ok: false; readonly error:
      | { readonly kind: "lease_held"; readonly existing: LeaseMetadata | null; readonly leaseDir: string }
      | { readonly kind: "io_error"; readonly message: string }
      | { readonly kind: "invalid_run_dir"; readonly message: string }
    };

/**
 * Capability-style handle returned by a successful
 * acquisition. The holder may release the lease WITHOUT
 * needing to provide the instanceId again — the handle
 * carries the in-memory capability.
 *
 * B0-CORR03 §25: release safety MUST NOT depend solely on
 * mutable owner.json metadata after acquisition.
 */
export class LeaseHandle {
  private released = false;
  // The instanceId is retained as a class field for
  // diagnostic logging; the release path uses the
  // in-memory capability and does not consult mutable
  // metadata (B0-CORR03 §25).
  // @ts-expect-error - field retained for diagnostics
  private readonly instanceId: LedgerWriterInstanceId;
  private readonly runDir: string;
  // B0-CORR04 §23: per-acquisition token. Release verifies
  // the on-disk token matches before rm. ABA-safe.
  private readonly token: string;
  constructor(
    runDir: string,
    instanceId: LedgerWriterInstanceId,
    token: string,
  ) {
    this.runDir = runDir;
    this.instanceId = instanceId;
    this.token = token;
  }

  /**
   * Release the lease via the in-memory capability, NOT via
   * the mutable owner.json metadata.
   *
   * B0-CORR04 §23: the on-disk token MUST match the
   * in-memory token. If the operator/test removed the lease
   * and a fresh lease at the same pathname now carries a
   * different token, the capability is stale and release
   * MUST fail closed (lease_replaced).
   *
   * The I/O is delegated to ledger-writer-lease-io.ts to
   * keep this file under the 400-LOC discipline.
   */
  async release(): Promise<LeaseReleaseResult> {
    if (this.released) {
      return { ok: false, error: { kind: "lease_not_held" } };
    }
    this.released = true;
    const dirCheck = await checkLeaseDirExists(this.runDir);
    if (!dirCheck.ok) {
      return { ok: false, error: dirCheck.error };
    }
    const tokenCheck = await verifyLeaseToken(this.runDir, this.token);
    if (!tokenCheck.ok) {
      return { ok: false, error: tokenCheck.error };
    }
    const rmResult = await rmLeaseDir(this.runDir);
    if (!rmResult.ok) {
      return { ok: false, error: rmResult.error };
    }
    return { ok: true };
  }

  isReleased(): boolean {
    return this.released;
  }
}

export type LeaseReleaseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error:
      | { readonly kind: "lease_not_held" }
      | { readonly kind: "lease_held_by_other"; readonly existing: LeaseMetadata | null }
      | { readonly kind: "lease_replaced"; readonly message: string }
      | { readonly kind: "io_error"; readonly message: string }
    };

/**
 * Atomically acquire the writer lease for `runDir`.
 *
 * mkdir(2) is atomic on POSIX filesystems: if the directory
 * already exists, the call fails with EEXIST. We treat any
 * EEXIST as "lease held" — the existence of the directory
 * is the authority. We do NOT consult the owner.json
 * contents (the metadata is descriptive, not authoritative).
 */
export async function acquireLedgerWriterLease(args: {
  readonly runDir: string;
  readonly instanceId: LedgerWriterInstanceId;
  readonly runId: string;
  readonly missionId: string;
}): Promise<LeaseAcquireResult> {
  const dir = leaseDir(args.runDir);
  try {
    await fs.mkdir(dir, { recursive: false, mode: 0o700 });
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "EEXIST") {
      const existing = await readLeaseMetadata(args.runDir).catch(() => null);
      return {
        ok: false,
        error: { kind: "lease_held", existing, leaseDir: dir },
      };
    }
    return {
      ok: false,
      error: {
        kind: "io_error",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  const meta: LeaseMetadata = {
    instanceId: args.instanceId,
    runId: args.runId,
    missionId: args.missionId,
    pid: process.pid,
    startedAt: Date.now(),
  };
  try {
    await fs.writeFile(
      leasePath(args.runDir),
      JSON.stringify(meta, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (e: unknown) {
    // Roll back the directory so the next caller can try again.
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    return {
      ok: false,
      error: {
        kind: "io_error",
        message: `cannot write lease metadata: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  // B0-CORR04 §23: write a fresh per-acquisition token.
  // The LeaseHandle carries the same token; release
  // verifies it before rm.
  const token = generateLeaseToken();
  try {
    await fs.writeFile(leaseTokenPath(args.runDir), token, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (e: unknown) {
    // Roll back the directory so the next caller can try again.
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    return {
      ok: false,
      error: {
        kind: "io_error",
        message: `cannot write lease token: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  return {
    ok: true,
    leaseDir: dir,
    handle: new LeaseHandle(args.runDir, args.instanceId, token),
  };
}

/**
 * Read the descriptive lease metadata, if any. Returns null
 * if the lease is unheld or the metadata is missing /
 * unreadable. This is human information only; never use
 * the return value to decide authority.
 */
export async function readLeaseMetadata(
  runDir: string,
): Promise<LeaseMetadata | null> {
  try {
    const raw = await fs.readFile(leasePath(runDir), "utf8");
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof o["instanceId"] === "string" &&
      typeof o["runId"] === "string" &&
      typeof o["missionId"] === "string" &&
      typeof o["pid"] === "number" &&
      typeof o["startedAt"] === "number"
    ) {
      return {
        instanceId: o["instanceId"] as LedgerWriterInstanceId,
        runId: o["runId"],
        missionId: o["missionId"],
        pid: o["pid"],
        startedAt: o["startedAt"],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Release the lease by removing the directory.
 *
 * This MUST only be called by the lease holder. To prevent
 * accidental cross-process release, the caller passes the
 * expected instanceId; if the on-disk metadata disagrees,
 * the release is rejected.
 */
export async function releaseLedgerWriterLease(args: {
  readonly runDir: string;
  readonly expectedInstanceId: LedgerWriterInstanceId;
}): Promise<LeaseReleaseResult> {
  const dir = leaseDir(args.runDir);
  try {
    const st = await fs.lstat(dir);
    if (!st.isDirectory()) {
      return { ok: false, error: { kind: "lease_not_held" } };
    }
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return { ok: false, error: { kind: "lease_not_held" } };
    }
    return {
      ok: false,
      error: {
        kind: "io_error",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  const meta = await readLeaseMetadata(args.runDir);
  if (meta === null || meta.instanceId !== args.expectedInstanceId) {
    return {
      ok: false,
      error: {
        kind: "lease_held_by_other",
        existing: meta,
      },
    };
  }
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        kind: "io_error",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

/**
 * Check whether the lease is currently held. Returns true
 * if the directory exists (regardless of contents).
 *
 * The descriptive metadata is returned alongside for
 * diagnostics; callers MUST NOT use it for authority.
 */
export async function isLeaseHeld(
  runDir: string,
): Promise<{ readonly held: boolean; readonly metadata: LeaseMetadata | null }> {
  const dir = leaseDir(runDir);
  try {
    const st = await fs.lstat(dir);
    if (!st.isDirectory()) return { held: false, metadata: null };
    const meta = await readLeaseMetadata(runDir);
    return { held: true, metadata: meta };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return { held: false, metadata: null };
    return { held: true, metadata: null };
  }
}
