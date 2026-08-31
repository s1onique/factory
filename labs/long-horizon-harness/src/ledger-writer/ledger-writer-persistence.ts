/**
 * FOUNDATION04 — B0-CORR02 — LedgerWriter persistence helpers.
 *
 * Owns the on-disk persistence of the dedup index and the
 * start-time index load.
 *
 * B0-CORR02 §3: the sidecar is treated as a DERIVED CACHE.
 * The ledger is authoritative; the sidecar is not consulted
 * for correctness. Whatever the sidecar says, the ledger
 * wins. The previous design optionally merged the sidecar
 * into the rebuilt index; that introduced the phantom-replay
 * path (P1-2 in the B0-CORR02 review). The sidecar may
 * accelerate later versions, but for B0 it is rewritten
 * strictly from the authoritative state after every append.
 *
 * B0-CORR02 §2: load failures are fail-closed; the writer
 * refuses to start if the ledger has interior corruption,
 * a torn tail, or is unreadable for any non-ENOENT reason.
 */

import { promises as fs } from "node:fs";
import { open as fsOpen } from "node:fs/promises";
import * as path from "node:path";

import { fsyncDir } from "../evidence/ledger-internals.js";
import {
  serializeDedupIndex,
  deserializeDedupIndex,
  type DedupIndex,
} from "./ledger-writer-dedup.js";
import {
  recoverLedgerWriterState,
} from "./ledger-writer-recovery.js";
import { LEDGER_WRITER_STATE_FILENAME } from "./ledger-writer-process.js";

export function statePath(runDir: string): string {
  return path.join(runDir, LEDGER_WRITER_STATE_FILENAME);
}

/**
 * Load (or rebuild) the dedup index at startup.
 *
 * B0-CORR02 §3: the sidecar is NOT consulted. The recovered
 * authoritative state is the index. Sidecar merging was the
 * phantom-replay source flagged in P1-2.
 *
 * Failure modes propagate as exceptions; the writer's start
 * path fails closed.
 */
export async function loadOrInitIndex(runDir: string): Promise<DedupIndex> {
  const r = await recoverLedgerWriterState(runDir);
  if (r.ok === false) {
    if (r.error.kind === "invalid_evidence") {
      throw new Error(
        `cannot start LedgerWriter: ledger is invalid: ${r.error.reason}. ` +
          `Repair the ledger (FOUNDATION01 torn-tail workflow) before retrying.`,
      );
    }
    throw new Error(
      `cannot recover LedgerWriter state: ${r.error.message ?? "(no message)"}`,
    );
  }
  return r.state;
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

/**
 * Test-only seam: verify that the sidecar on disk (if any)
 * is byte-equivalent to the authoritative index. Used by
 * CACHE01..08 to prove that the sidecar contains no semantic
 * entries absent from the ledger reconstruction.
 */
export type SidecarMatch =
  | { readonly kind: "absent" }
  | { readonly kind: "equal" }
  | { readonly kind: "drifted"; readonly reason: string };

export async function verifySidecarMatch(
  runDir: string,
  index: DedupIndex,
): Promise<SidecarMatch> {
  const p = statePath(runDir);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return { kind: "absent" };
    return {
      kind: "drifted",
      reason: `cannot read sidecar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  let parsed: DedupIndex;
  try {
    parsed = deserializeDedupIndex(raw);
  } catch (e: unknown) {
    return {
      kind: "drifted",
      reason: `sidecar not parseable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const expected = serializeDedupIndex(index);
  const actual = serializeDedupIndex(parsed);
  if (expected === actual) return { kind: "equal" };
  return {
    kind: "drifted",
    reason: "sidecar serialization disagrees with authoritative index",
  };
}
