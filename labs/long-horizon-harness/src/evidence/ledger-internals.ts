/**
 * Internal helpers for {@link JsonlLedger}: torn-tail recovery, error
 * mapping, JSON-line parsing, fsync.
 *
 * Kept in a sibling file so the public ledger class remains small.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { err, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import { decodeEnvelope } from "./codec.js";
import type { EventEnvelope } from "./codec.js";

export type InternalLedgerError = {
  readonly kind: "internal_failure";
  readonly message: string;
};

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
 * Quarantine torn-tail bytes into a content-addressed side file. If a
 * file with the same content hash already exists, do nothing (no
 * duplication).
 */
export async function quarantineTornTail(
  dir: string,
  tornBytes: Buffer,
  sha: string,
): Promise<string> {
  const target = path.join(dir, `events.jsonl.torn-tail.${sha}.bin`);
  try {
    await fs.access(target);
    // already quarantined; no duplication
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e;
    await fs.writeFile(target, tornBytes);
  }
  return `events.jsonl.torn-tail.${sha}.bin`;
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