/**
 * FOUNDATION04 — B0-CORR01 — LedgerWriter crash recovery.
 *
 * Reconstructs the dedup index from the authoritative
 * events.jsonl ledger (B0-C01-04: derived-index law).
 *
 * Why this module exists:
 *
 * The previous design made correctness depend on a separate
 * dedup sidecar whose durability could lag the ledger. If
 * the writer fsynced the ledger append, then crashed before
 * fsyncing the sidecar, the sidecar would lose the commitId
 * entry for that append. A retry would not see the original
 * sequence and would create a duplicate line — exactly the
 * hole the durable-ACK law was meant to close.
 *
 * The new design inverts the durability relationship:
 *
 *   - events.jsonl is the AUTHORITATIVE source of commitId
 *     → (sequence, contentHash). Every committed record
 *     carries commit_id + content_hash on disk.
 *   - ledger-writer-state.json is a performance cache. It is
 *     written AFTER the ledger fsync, but losing it is
 *     never a problem: the next writer instance simply
 *     rebuilds the cache from the ledger via this module.
 *
 * `rebuildIndexFromLedger` reads the ledger, parses each
 * line for (sequence, commit_id, content_hash), and produces
 * a complete DedupIndex. The writer calls it at startup,
 * AFTER optionally merging with whatever (possibly stale)
 * sidecar survived, to ensure its in-memory index is
 * authoritative.
 *
 * The scan is defensive: malformed lines are skipped so that
 * a half-written final line never poisons the index. The
 * existing JsonlLedger torn-tail recovery quarantines such
 * tails on open; for the writer's own scan, a skip is
 * sufficient because the writer never writes partial lines
 * (append + fsync is atomic from the writer's POV).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { LEDGER_FILENAME } from "../evidence/jsonl-ledger.js";
import {
  buildIndexFromRecords,
  type DedupIndex,
} from "./ledger-writer-dedup.js";
import { parsePersistedLine } from "./ledger-writer-canonicalize.js";
import type { CommitId } from "./ledger-writer-types.js";

export type RebuildResult =
  | { readonly ok: true; readonly index: DedupIndex; readonly scannedLines: number; readonly parsedLines: number }
  | { readonly ok: false; readonly error: { readonly kind: "io_error"; readonly message: string } };

export async function rebuildIndexFromLedger(
  runDir: string,
): Promise<RebuildResult> {
  const ledgerPath = path.join(runDir, LEDGER_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(ledgerPath, "utf8");
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return { ok: true, index: { byCommitId: {}, maxSequence: 0 }, scannedLines: 0, parsedLines: 0 };
    }
    return {
      ok: false,
      error: { kind: "io_error", message: e instanceof Error ? e.message : String(e) },
    };
  }
  let scannedLines = 0;
  const records: Array<{
    readonly sequence: number;
    readonly commitId: CommitId;
    readonly contentHash: string;
  }> = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    scannedLines++;
    const parsed = parsePersistedLine(line);
    if (parsed.ok) {
      records.push({
        sequence: parsed.sequence,
        commitId: parsed.commitId,
        contentHash: parsed.contentHash,
      });
    }
  }
  return {
    ok: true,
    index: buildIndexFromRecords(records),
    scannedLines,
    parsedLines: records.length,
  };
}
