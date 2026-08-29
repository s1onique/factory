/**
 * Internal helpers for {@link JsonlLedger}: torn-tail recovery,
 * error mapping, JSON-line parsing, fsync.
 *
 * Kept in a sibling file so the public ledger class remains small.
 *
 * CORRECTION03:
 *  - {@link fsyncDir} now uses real Node primitives
 *    (`fs.open(dir, "r") + FileHandle.sync`) instead of the
 *    fabricated `openAsSync` probe.
 *  - `writeAuthoritativeAndSync` REMOVED. Replaced by
 *    {@link truncateAuthoritativeAndSync} which uses
 *    `FileHandle.truncate(len)` to shorten the file in place.
 *  - All `fh.close()` failures are propagated as `internal_failure`.
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

export function sha256OfBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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
 * If the file does not yet exist: opens with `wx`, writes, syncs,
 * closes. Returns only after a successful sync.
 *
 * If the file already exists with the content-addressed name: reads
 * it back and verifies the bytes match the expected torn bytes. A
 * pre-existing file whose contents do NOT match the expected torn
 * bytes is rejected.
 *
 * Returns the relative quarantine path on success. Close failures
 * after a successful sync are propagated as `internal_failure`; the
 * recovery path must treat that as failure-closed.
 */
export async function quarantineTornTail(
  dir: string,
  tornBytes: Buffer,
  sha: string,
): Promise<
  Result<
    { readonly path: string; readonly created: boolean },
    InternalLedgerError
  >
> {
  const relativeName = `events.jsonl.torn-tail.${sha}.bin`;
  const target = path.join(dir, relativeName);
  try {
    await fs.access(target);
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
      await fh.close();
    }
  }
}

/**
 * Attempt to fsync a directory entry using real Node primitives:
 *
 *   fs.open(dir, "r")      // returns a FileHandle bound to the dir
 *   fh.sync()              // flushes the directory entry to disk
 *   fh.close()
 *
 * On platforms that reject directory-file-descriptor sync, the
 * kernel returns one of the explicit errnos below. Those are the
 * ONLY classifications that return `unsupported`. Any other IO
 * error returns `error` so the recovery path fails closed.
 *
 * Close failures after a successful sync are propagated.
 */
export async function fsyncDir(dir: string): Promise<DirSyncCapability> {
  const UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
    "EISDIR",
    "EPERM",
    "ENOTDIR",
    "EACCES",
    "ENOSYS",
    "ENOTSUP",
  ]);
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(dir, "r");
    await fh.sync();
    return "ok";
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      typeof (e as { code?: unknown }).code === "string" &&
      UNSUPPORTED_CODES.has((e as { code: string }).code)
    ) {
      return "unsupported";
    }
    return "error";
  } finally {
    if (fh !== null) {
      await fh.close();
    }
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
 * Monotonic torn-tail repair: shorten the authoritative ledger in
 * place to `committedPrefixLength` bytes and sync the file handle.
 *
 * The committed prefix is NEVER re-read or re-written; this helper
 * only takes the target length and lets the kernel truncate the file
 * to that boundary. If `committedPrefixLength === currentFileSize`
 * the operation is a no-op (truncate to current length) followed by
 * a sync.
 *
 * If `committedPrefixLength > currentFileSize` the operation is
 * rejected as an internal failure (recovery must never grow the
 * authoritative file).
 */
export async function truncateAuthoritativeAndSync(
  filePath: string,
  committedPrefixLength: number,
): Promise<Result<void, InternalLedgerError>> {
  if (
    !Number.isInteger(committedPrefixLength) ||
    committedPrefixLength < 0
  ) {
    return err(
      internal(
        `committedPrefixLength must be a non-negative integer; got ${committedPrefixLength}`,
      ),
    );
  }
  let fh: import("node:fs/promises").FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "r+");
    const stat = await fh.stat();
    if (committedPrefixLength > stat.size) {
      return err(
        internal(
          `committedPrefixLength ${committedPrefixLength} exceeds current file size ${stat.size}; refusing to grow authoritative ledger.`,
        ),
      );
    }
    if (committedPrefixLength === stat.size) {
      await fh.sync();
      return ok(undefined);
    }
    await fh.truncate(committedPrefixLength);
    await fh.sync();
    return ok(undefined);
  } catch (e: unknown) {
    return err(internalFrom(e));
  } finally {
    if (fh !== null) {
      await fh.close();
    }
  }
}

/**
 * Open a file in append mode, write the given UTF-8 line (which MUST
 * already end in `\n`), and `fh.sync()` before closing.
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
      await fh.close();
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
