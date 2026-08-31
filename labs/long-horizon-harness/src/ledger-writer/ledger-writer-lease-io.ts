/**
 * FOUNDATION04 — B0-CORR04 — Lease filesystem operations.
 *
 * Pure helpers extracted from ledger-writer-lease.ts to
 * keep that file under the 400-LOC source-size discipline.
 */

import { promises as fs } from "node:fs";
import { leaseDir, leaseTokenPath } from "./ledger-writer-lease.js";

export type LeaseIoError =
  | { readonly kind: "lease_not_held" }
  | { readonly kind: "lease_replaced"; readonly message: string }
  | { readonly kind: "io_error"; readonly message: string };

function ioErrorFrom(e: unknown): LeaseIoError {
  return {
    kind: "io_error",
    message: e instanceof Error ? e.message : String(e),
  };
}

/**
 * Confirm the lease directory still exists and is a directory.
 */
export async function checkLeaseDirExists(
  runDir: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: LeaseIoError }> {
  const dir = leaseDir(runDir);
  try {
    const st = await fs.lstat(dir);
    if (!st.isDirectory()) {
      return { ok: false, error: { kind: "lease_not_held" } };
    }
    return { ok: true };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return { ok: false, error: { kind: "lease_not_held" } };
    }
    return { ok: false, error: ioErrorFrom(e) };
  }
}

/**
 * Verify the on-disk token matches the in-memory token.
 */
export async function verifyLeaseToken(
  runDir: string,
  expectedToken: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: LeaseIoError }> {
  try {
    const onDisk = await fs.readFile(leaseTokenPath(runDir), "utf8");
    if (onDisk.trim() !== expectedToken) {
      return {
        ok: false,
        error: {
          kind: "lease_replaced",
          message:
            "on-disk lease token does not match this handle; refusing to delete replacement lease",
        },
      };
    }
    return { ok: true };
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error: {
          kind: "lease_replaced",
          message: "on-disk lease token missing; refusing to delete",
        },
      };
    }
    return { ok: false, error: ioErrorFrom(e) };
  }
}

/**
 * Remove the lease directory.
 */
export async function rmLeaseDir(
  runDir: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: LeaseIoError }> {
  const dir = leaseDir(runDir);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: ioErrorFrom(e) };
  }
}
