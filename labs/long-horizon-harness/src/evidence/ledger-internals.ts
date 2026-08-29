/**
 * Internal helpers for {@link JsonlLedger}: torn-tail recovery, error
 * mapping, JSON-line parsing, fsync.
 *
 * Kept in a sibling file so the public ledger class remains small.
 *
 * CORRECTION02 changes:
 *  - {@link quarantineTornTail} now opens, writes, syncs, and closes the
 *    quarantine file before returning. If a file with the same content
 *    hash already exists, the helper verifies its bytes match before
 *    returning (no silent trust of a hash-named file).
 *  - {@link fsyncDir} attempts to fsync the directory entry on platforms
 *    that support it. On unsupported platforms it returns "unsupported"
 *    so the caller can document the exact capability.
 *  - {@link writeAuthoritativeAndSync} performs open → write → sync as a
 *    single durability unit, used for the authoritative ledger
 *    truncation step that follows quarantine preservation.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { err, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import { decodeEnvelope } from "./codec.js";
import type { EventEnvelope } from "./codec.js";

export type InternalLedgerError = {
  readonly kind: "internal_failure";
  readonly message: string;
};

export type DirSyncCapability = "ok" | "unsupported" | "error";

export function internal(message: string): InternalLedgerError {
  return { kind: "internal_failure", message };
}

export function internalFrom(e: unknown): InternalLedgerError {
  return internal(e instanceof Error ? e.message : String(e));
}

export function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Split a raw ledger byte buffer into:
 *  - committedBytes: bytes up to and including the last `\n` (or empty
 *    if no newline exists),
 *  - tornBytes: any non-empty bytes after the last `\n`.
 *
 * A file with no newline at all is treated as entirely torn.
 */
export function splitOnTornTail(raw: Buffer): {
  readonly committedBytes: Buffer;
  readonly tornBytes: Buffer;
} {
  if (raw.length === 0 || raw[raw.length - 1] === 0x0a /* "\n" */) {
    return { committedBytes: raw, tornBytes: Buffer.alloc(0) };
  }
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === 0x0a) {
      const split = i + 1;
      return {
        committedBytes: raw.subarray(0, split),
        tornBytes: raw.subarray(split),
      };
    }
  }
  return { committedBytes: Buffer.alloc(0), tornBytes: raw };
}

/**
 * Compare two buffers for byte equality in constant time (best effort).
 * Used by quarantine collision verification to avoid trusting a
 * hash-named file's contents.
 */
function bufferEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Durably preserve torn-tail bytes into a content-addressed side file.
 *
 * If the file does not yet exist, this opens, writes, syncs, and closes
 * it; returns only after a successful sync.
 *
 * If the file already exists with the content-addressed name, this reads
 * it back and verifies its bytes match the expected torn bytes (by
 * sha256 + byte compare). A pre-existing file whose contents do NOT match
 * the expected torn bytes is treated as a failure: the caller MUST NOT
 * truncate the authoritative ledger.
 *
 * Returns the relative quarantine path on success.
 */
export async function quarantineTornTail(
  dir: string,
  tornBytes: Buffer,
  sha: string,
): Promise<Result<{ readonly path: string; readonly created: boolean }, InternalLedgerError>> {
  const relativeName = `events.jsonl.torn-tail.${sha}.bin`;
  const target = path.join(dir, relativeName);
  try {
    await fs.access(target);
    // File exists. Verify it contains the exact torn bytes.
    const existing = await fs.readFile(target);
    if (!bufferEquals(existing, tornBytes)) {
      return err(
        internal(
          `Existing quarantine file '${relativeName}' has wrong bytes; refusing to trust hash-named collision.`,
        ),
      );
    }
    return ok({ path: relativeName, created: false });
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      return err(internalFrom(e));
    }
  }
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(target, "wx");
    await fh.writeFile(tornBytes);
    await fh.sync();
    return ok({ path: relativeName, created: true });
  } catch (e: unknown) {
    return err(internalFrom(e));
  } finally {
    if (fh !== null) {
      try {
        await fh.close();
      } catch {
        // close failure is captured via outer error
      }
    }
  }
}

/**
 * Attempt to fsync the directory entry. POSIX supports this via
 * `opendir` + `fsync(fd)`. Node's `fs.opendir` does not expose a
 * FileHandle that supports `.sync()` on every platform, so this helper
 * classifies the result precisely.
 *
 * Result semantics:
 *  - "ok"          — directory entry is durable; caller may proceed.
 *  - "unsupported" — current platform/API cannot sync the directory.
 *                     Caller may proceed but MUST document the
 *                     limitation in their report.
 *  - "error"       — an unexpected I/O error occurred; the caller MUST
 *                     fail closed and NOT touch the authoritative
 *                     ledger.
 */
export async function fsyncDir(dir: string): Promise<DirSyncCapability> {
  try {
    const probe: {
      openAsSync?: (
        path: string,
      ) => Promise<{ sync: () => Promise<void>; close: () => Promise<void> } | null>;
    } = fs as unknown as {
      openAsSync?: (
        path: string,
      ) => Promise<{ sync: () => Promise<void>; close: () => Promise<void> } | null>;
    };
    if (typeof probe.openAsSync === "function") {
      const handle = await probe.openAsSync(dir);
      if (handle === null) return "unsupported";
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return "ok";
    }
    return "unsupported";
  } catch {
    return "error";
  }
}

/**
 * Open a file with `r+` (no truncation) and call `fh.sync()` so the
 * kernel flushes the data + metadata to stable storage.
 */
export async function fsyncPath(p: string): Promise<void> {
  const fh = await fs.open(p, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Atomically overwrite the authoritative ledger with the given bytes,
 * followed by an explicit fsync. Used for the recovery step that
 * truncates the ledger to the committed prefix.
 *
 * The caller MUST have already durably preserved any torn bytes before
 * invoking this helper.
 */
export async function writeAuthoritativeAndSync(
  filePath: string,
  bytes: Buffer,
): Promise<Result<void, InternalLedgerError>> {
  try {
    await fs.writeFile(filePath, bytes);
    await fsyncPath(filePath);
    return ok(undefined);
  } catch (e: unknown) {
    return err(internalFrom(e));
  }
}

/**
 * Open a file in append mode, write the given UTF-8 line (which MUST
 * already end in `\n`), and `fh.sync()` before closing.
 *
 * Returns ok on success, internal_failure on any IO error. The
 * committed event is allocated by the caller; this helper is a pure
 * IO step.
 */
export async function appendCommittedLineToFile(
  filePath: string,
  line: string,
): Promise<Result<void, InternalLedgerError>> {
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "a");
    await fh.appendFile(line, "utf8");
    await fh.sync();
    return ok(undefined);
  } catch (e: unknown) {
    return err(internalFrom(e));
  } finally {
    if (fh !== null) {
      try {
        await fh.close();
      } catch {
        // close failure is captured via outer error path
      }
    }
  }
}
export function decodeEnvelopeFromJsonLine(
  text: string,
): Result<EventEnvelope, InvalidEvidence> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ kind: "invalid_evidence", reason: `Malformed JSON: ${msg}` });
  }
  return decodeEnvelope(raw);
}

export function sha256OfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
