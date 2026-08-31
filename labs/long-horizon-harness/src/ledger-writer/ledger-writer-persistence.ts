/**
 * FOUNDATION04 — B0-CORR01 — LedgerWriter persistence helpers.
 *
 * Owns the on-disk persistence of the dedup index and the
 * start-time index load. Extracted from
 * `ledger-writer-server.ts` so that file stays under the
 * 400-LOC source-size discipline (FOUNDATION03 §29).
 *
 * Lifecycle:
 *
 *   loadOrInitIndex(runDir)
 *     - always rebuild an authoritative index from the
 *       ledger (B0-C01-04 derived-index law).
 *     - optionally merge with whatever sidecar survived;
 *       the ledger-rebuilt index always wins on commitId
 *       sequence disputes because it is derived from the
 *       authoritative durable history.
 *     - reconcile with the ledger's max sequence.
 *
 *   persistIndex(runDir, index)
 *     - serialize the new index atomically (tmp + rename).
 *     - attempt a directory fsync with the explicit
 *       unsupported-errno policy (FOUNDATION01 lesson):
 *       ok or unsupported → success; any other error →
 *       fail closed.
 */

import { promises as fs } from "node:fs";
import { open as fsOpen } from "node:fs/promises";
import * as path from "node:path";

import {
  deserializeDedupIndex,
  mergeRecoveredIndex,
  reconcileWithLedger,
  serializeDedupIndex,
  type DedupIndex,
} from "./ledger-writer-dedup.js";
import { rebuildIndexFromLedger } from "./ledger-writer-recovery.js";
import { LEDGER_WRITER_STATE_FILENAME } from "./ledger-writer-process.js";
import { fsyncDir } from "../evidence/ledger-internals.js";

export function statePath(runDir: string): string {
  return path.join(runDir, LEDGER_WRITER_STATE_FILENAME);
}

/**
 * Load (or rebuild) the dedup index at startup.
 *
 * The ledger is the source of truth (B0-C01-04). We always
 * scan it for the authoritative index; we then merge with
 * whatever sidecar survived for a fast-path cache hit. The
 * merged index is then reconciled against the ledger's max
 * sequence.
 */
export async function loadOrInitIndex(runDir: string): Promise<DedupIndex> {
  const rebuiltRes = await rebuildIndexFromLedger(runDir);
  if (!rebuiltRes.ok) {
    throw new Error(
      `cannot rebuild dedup index from ledger: ${rebuiltRes.error.message}`,
    );
  }
  const rebuilt = rebuiltRes.index;

  const p = statePath(runDir);
  let sidecar: DedupIndex | null = null;
  try {
    const raw = await fs.readFile(p, "utf8");
    sidecar = deserializeDedupIndex(raw);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code !== "ENOENT") {
      // Sidecar is present but corrupt. Throw the sidecar
      // away: the rebuilt index wins (B0-C01-04). This is
      // safe precisely because the rebuilt index is
      // derived from the authoritative ledger.
      sidecar = null;
    }
  }

  if (sidecar === null) return rebuilt;
  const merged = mergeRecoveredIndex(rebuilt, sidecar);
  return reconcileWithLedger(merged, rebuilt.maxSequence);
}

/**
 * Persist the dedup index atomically. Writes a temp file
 * alongside the live sidecar, fsyncs, then renames. After
 * success, attempts a directory fsync and fails closed on
 * a non-unsupported error.
 */
export async function persistIndex(
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
  const dirRes = await fsyncDir(path.dirname(p));
  if (dirRes === "error") {
    throw new Error(
      `directory fsync returned a non-unsupported error after index persist at ${path.dirname(p)}`,
    );
  }
}
