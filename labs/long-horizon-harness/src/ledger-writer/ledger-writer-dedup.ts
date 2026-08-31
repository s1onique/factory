/**
 * FOUNDATION04 — B0-CORR01 — pure dedup-index logic.
 *
 * The dedup index is a durable boundary that closes the
 * ACK-loss hole. It is a CACHE over the authoritative ledger:
 * the events.jsonl file is the source of truth for
 * commitId → (sequence, contentHash). Losing the sidecar
 * must never destroy semantic information required for correct
 * recovery (B0-C01-04: derived-index law).
 *
 * This module is pure: no I/O, no side effects. It exists so
 * the writer's durability logic can be tested without spinning
 * up a real process.
 *
 * Laws enforced (B0-C01-05..07):
 *   - dedupLookup: looks up the EXISTING commitId entry
 *     (sequence + contentHash). There is NO contentHash-only
 *     shortcut.
 *     - same commitId + same contentHash → replay original seq
 *     - same commitId + different contentHash → CONFLICT
 *     - different commitId → miss (new logical commit even if
 *       the bytes happen to match another commit's bytes).
 *   - dedupRecord: sequence committed iff commitId entry is
 *     set AND its contentHash matches. maxSequence is the
 *     monotonic high water mark.
 *   - mergeRecoveredIndex / reconcileWithLedger: a recovered
 *     index from disk can be merged into an in-memory index
 *     without losing entries.
 *
 * Bump the sidecar version: the old layout
 *   { version: 1, byCommitId: {k: number}, byContentHash: {k: number}, maxSequence }
 * is structurally incompatible with the new layout
 *   { version: 2, byCommitId: {k: {sequence, contentHash}}, maxSequence }
 * so we explicitly raise the version. The writer treats an
 * old-version sidecar as corrupt and rebuilds from the ledger
 * (B0-C01-04).
 */

import type {
  CommitId,
  DedupEntry,
  DedupIndex,
} from "./ledger-writer-types.js";

export type { DedupEntry, DedupIndex };

export const DEDUP_INDEX_VERSION = 2 as const;

export type DedupLookup =
  | { readonly kind: "miss" }
  | { readonly kind: "replay"; readonly sequence: number }
  | {
      readonly kind: "conflict";
      readonly existingSequence: number;
      readonly existingContentHash: string;
    };

/**
 * Look up a (commitId, contentHash) pair in the dedup index.
 *
 * - miss: commitId is unknown; caller may allocate a new
 *   sequence and record it.
 * - replay: commitId is known and its committed contentHash
 *   equals the caller's contentHash. The caller MUST reuse
 *   the existing sequence and MUST NOT append a new line.
 * - conflict: commitId is known but the recorded contentHash
 *   differs from the caller's. The same logical identity has
 *   been reused with different bytes — reject as
 *   conflicting_commit (B0-C01-06).
 */
export function dedupLookup(
  index: DedupIndex,
  args: { readonly commitId: CommitId; readonly contentHash: string },
): DedupLookup {
  const entry = index.byCommitId[args.commitId as unknown as string];
  if (entry === undefined) return { kind: "miss" };
  if (entry.contentHash === args.contentHash) {
    return { kind: "replay", sequence: entry.sequence };
  }
  return {
    kind: "conflict",
    existingSequence: entry.sequence,
    existingContentHash: entry.contentHash,
  };
}

export function dedupRecord(
  index: DedupIndex,
  args: {
    readonly commitId: CommitId;
    readonly contentHash: string;
    readonly sequence: number;
  },
): DedupIndex {
  if (!Number.isInteger(args.sequence) || args.sequence < 1) {
    throw new Error(
      `dedupRecord: sequence must be a positive integer, got ${args.sequence}`,
    );
  }
  if (typeof args.contentHash !== "string" || args.contentHash.length === 0) {
    throw new Error(
      `dedupRecord: contentHash must be a non-empty string, got ${typeof args.contentHash}`,
    );
  }
  const newEntry: DedupEntry = {
    sequence: args.sequence,
    contentHash: args.contentHash,
  };
  return {
    byCommitId: {
      ...index.byCommitId,
      [args.commitId as unknown as string]: newEntry,
    },
    maxSequence: Math.max(index.maxSequence, args.sequence),
  };
}

/**
 * Merge a recovered index into the current index. Used at
 * writer startup when both a sidecar and a rebuilt-from-ledger
 * index are available. On key collision the entry with the
 * higher sequence wins; ties resolve to the FIRST observed
 * entry (current over recovered).
 *
 * `maxSequence` is the max of both.
 */
export function mergeRecoveredIndex(
  current: DedupIndex,
  recovered: DedupIndex,
): DedupIndex {
  const mergedByCid: Record<string, DedupEntry> = {};
  for (const [k, v] of Object.entries(current.byCommitId)) {
    mergedByCid[k] = v;
  }
  for (const [k, v] of Object.entries(recovered.byCommitId)) {
    const existing = mergedByCid[k];
    if (existing === undefined) {
      mergedByCid[k] = v;
      continue;
    }
    if (v.sequence > existing.sequence) {
      mergedByCid[k] = v;
    }
  }
  const maxSeq = Math.max(current.maxSequence, recovered.maxSequence);
  for (const [k, v] of Object.entries(mergedByCid)) {
    if (v.sequence > maxSeq) delete mergedByCid[k];
  }
  return {
    byCommitId: mergedByCid,
    maxSequence: maxSeq,
  };
}

/**
 * Build a dedup index from the authoritative events.jsonl
 * (B0-C01-04: derived-index law).
 *
 * The ledger is the source of truth for commitId →
 * (sequence, contentHash). This scan is the SAFETY NET for
 * crash recovery: even if the sidecar is entirely absent,
 * the writer can rebuild a complete dedup index from the
 * ledger alone. The sidecar is then optional: it is a
 * performance cache, never a load-bearing source of
 * semantic information.
 *
 * The scan reads each line in order, parses out
 * (sequence, commit_id, content_hash), and constructs the
 * byCommitId map. Malformed lines are ignored (the existing
 * JsonlLedger torn-tail recovery quarantines them on open;
 * for the writer's scan we treat any unparseable line as a
 * no-op so a half-written final line never poisons the
 * index).
 *
 * `maxSequence` is the maximum observed.
 *
 * If two lines share a commitId, the LATER sequence wins
 * (the writer would have rejected the second in production;
 * this is a defensive tiebreak for malformed ledgers).
 */
export function buildIndexFromRecords(
  records: ReadonlyArray<{
    readonly sequence: number;
    readonly commitId: string;
    readonly contentHash: string;
  }>,
): DedupIndex {
  const byCommitId: Record<string, DedupEntry> = {};
  let maxSequence = 0;
  for (const rec of records) {
    if (!Number.isInteger(rec.sequence) || rec.sequence < 1) continue;
    if (typeof rec.commitId !== "string" || rec.commitId.length === 0) continue;
    if (typeof rec.contentHash !== "string" || rec.contentHash.length === 0) continue;
    const existing = byCommitId[rec.commitId];
    if (existing === undefined || rec.sequence > existing.sequence) {
      byCommitId[rec.commitId] = {
        sequence: rec.sequence,
        contentHash: rec.contentHash,
      };
    }
    if (rec.sequence > maxSequence) maxSequence = rec.sequence;
  }
  return { byCommitId, maxSequence };
}

/**
 * Cross-check the dedup index against the actual ledger.
 *
 * `ledgerMaxSequence` is the maximum sequence observed in
 * the authoritative events.jsonl. Entries in the dedup index
 * whose sequence exceeds the ledger max are pruned: they
 * would never replay. The resulting `maxSequence` is the
 * ledger max (since the ledger is authoritative).
 */
export function reconcileWithLedger(
  index: DedupIndex,
  ledgerMaxSequence: number,
): DedupIndex {
  if (ledgerMaxSequence < 0 || !Number.isInteger(ledgerMaxSequence)) {
    throw new Error(
      `reconcileWithLedger: ledgerMaxSequence must be a non-negative integer, got ${ledgerMaxSequence}`,
    );
  }
  const trimmedByCid: Record<string, DedupEntry> = {};
  for (const [k, v] of Object.entries(index.byCommitId)) {
    if (v.sequence <= ledgerMaxSequence) trimmedByCid[k] = v;
  }
  return {
    byCommitId: trimmedByCid,
    maxSequence: ledgerMaxSequence,
  };
}

export function serializeDedupIndex(index: DedupIndex): string {
  const sortedByCid: Record<string, DedupEntry> = {};
  for (const k of Object.keys(index.byCommitId).sort()) {
    sortedByCid[k] = (index.byCommitId as Record<string, DedupEntry>)[k]!;
  }
  return JSON.stringify({
    version: DEDUP_INDEX_VERSION,
    byCommitId: sortedByCid,
    maxSequence: index.maxSequence,
  });
}

export function deserializeDedupIndex(raw: string): DedupIndex {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("dedup index: not an object");
  }
  const o = parsed as Record<string, unknown>;
  if (o["version"] !== DEDUP_INDEX_VERSION) {
    throw new Error(
      `dedup index: unsupported version ${String(o["version"])} (expected ${DEDUP_INDEX_VERSION})`,
    );
  }
  const byCid = o["byCommitId"];
  const maxSeq = o["maxSequence"];
  if (typeof byCid !== "object" || byCid === null) {
    throw new Error("dedup index: byCommitId not an object");
  }
  if (typeof maxSeq !== "number" || !Number.isInteger(maxSeq) || maxSeq < 0) {
    throw new Error("dedup index: maxSequence invalid");
  }
  const cidOut: Record<string, DedupEntry> = {};
  for (const [k, v] of Object.entries(byCid as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) {
      throw new Error(`dedup index: byCommitId.${k} not an object`);
    }
    const entry = v as Record<string, unknown>;
    const seq = entry["sequence"];
    const ch = entry["contentHash"];
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      throw new Error(`dedup index: byCommitId.${k}.sequence invalid`);
    }
    if (typeof ch !== "string" || ch.length === 0) {
      throw new Error(`dedup index: byCommitId.${k}.contentHash invalid`);
    }
    cidOut[k] = { sequence: seq, contentHash: ch };
  }
  return {
    byCommitId: cidOut,
    maxSequence: maxSeq,
  };
}
