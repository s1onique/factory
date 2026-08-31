/**
 * FOUNDATION04 — CORRECTION01 — pure dedup index logic.
 *
 * The dedup index is the durable boundary that closes the
 * ACK-loss hole. This module is pure: no I/O, no side effects.
 * It exists so that the writer's durability logic can be
 * tested without spinning up a real process.
 *
 * Laws enforced:
 *   - dedupLookup: identical commitId OR identical contentHash
 *     returns the previously-allocated sequence, never a new one.
 *   - dedupRecord: a sequence is committed only after both
 *     commitId and contentHash entries are updated, and the
 *     maxSequence invariant is preserved.
 *   - mergeRecoveredIndex / reconcileWithLedger: a recovered
 *     index from disk can be merged into an in-memory index
 *     without losing entries.
 */

import type { DedupIndex, CommitId } from "./ledger-writer-types.js";

export function dedupLookup(
  index: DedupIndex,
  args: { readonly commitId: CommitId; readonly contentHash: string },
): number | null {
  const byCid = index.byCommitId[args.commitId as unknown as string];
  if (typeof byCid === "number") return byCid;
  const byCh = index.byContentHash[args.contentHash];
  if (typeof byCh === "number") return byCh;
  return null;
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
  return {
    byCommitId: {
      ...index.byCommitId,
      [args.commitId as unknown as string]: args.sequence,
    },
    byContentHash: {
      ...index.byContentHash,
      [args.contentHash]: args.sequence,
    },
    maxSequence: Math.max(index.maxSequence, args.sequence),
  };
}

/**
 * Merge a recovered index into the current index. Used at
 * writer startup. On key collision the higher sequence wins.
 * maxSequence is the max of both.
 */
export function mergeRecoveredIndex(
  current: DedupIndex,
  recovered: DedupIndex,
): DedupIndex {
  const mergedByCid: Record<string, number> = { ...current.byCommitId };
  for (const [k, v] of Object.entries(recovered.byCommitId)) {
    const existing = mergedByCid[k];
    if (existing === undefined || v > existing) mergedByCid[k] = v;
  }
  const mergedByCh: Record<string, number> = { ...current.byContentHash };
  for (const [k, v] of Object.entries(recovered.byContentHash)) {
    const existing = mergedByCh[k];
    if (existing === undefined || v > existing) mergedByCh[k] = v;
  }
  const maxSeq = Math.max(current.maxSequence, recovered.maxSequence);
  for (const [k, v] of Object.entries(mergedByCid)) {
    if (v > maxSeq) delete mergedByCid[k];
  }
  for (const [k, v] of Object.entries(mergedByCh)) {
    if (v > maxSeq) delete mergedByCh[k];
  }
  return {
    byCommitId: mergedByCid,
    byContentHash: mergedByCh,
    maxSequence: maxSeq,
  };
}

/**
 * Cross-check the dedup index against the actual ledger.
 * Returns a new index whose maxSequence is
 * `max(index.maxSequence, ledgerMaxSequence)`. Entries
 * pointing past the ledger max are pruned.
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
  if (ledgerMaxSequence >= index.maxSequence) {
    return {
      byCommitId: index.byCommitId,
      byContentHash: index.byContentHash,
      maxSequence: ledgerMaxSequence,
    };
  }
  const trimmedByCid: Record<string, number> = {};
  for (const [k, v] of Object.entries(index.byCommitId)) {
    if (v <= ledgerMaxSequence) trimmedByCid[k] = v;
  }
  const trimmedByCh: Record<string, number> = {};
  for (const [k, v] of Object.entries(index.byContentHash)) {
    if (v <= ledgerMaxSequence) trimmedByCh[k] = v;
  }
  return {
    byCommitId: trimmedByCid,
    byContentHash: trimmedByCh,
    maxSequence: ledgerMaxSequence,
  };
}

export function serializeDedupIndex(index: DedupIndex): string {
  const sortedByCid: Record<string, number> = {};
  for (const k of Object.keys(index.byCommitId).sort()) {
    sortedByCid[k] = (index.byCommitId as Record<string, number>)[k]!;
  }
  const sortedByCh: Record<string, number> = {};
  for (const k of Object.keys(index.byContentHash).sort()) {
    sortedByCh[k] = (index.byContentHash as Record<string, number>)[k]!;
  }
  return JSON.stringify({
    version: 1,
    byCommitId: sortedByCid,
    byContentHash: sortedByCh,
    maxSequence: index.maxSequence,
  });
}

export function deserializeDedupIndex(raw: string): DedupIndex {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("dedup index: not an object");
  }
  const o = parsed as Record<string, unknown>;
  if (o["version"] !== 1) {
    throw new Error(`dedup index: unsupported version ${String(o["version"])}`);
  }
  const byCid = o["byCommitId"];
  const byCh = o["byContentHash"];
  const maxSeq = o["maxSequence"];
  if (typeof byCid !== "object" || byCid === null) {
    throw new Error("dedup index: byCommitId not an object");
  }
  if (typeof byCh !== "object" || byCh === null) {
    throw new Error("dedup index: byContentHash not an object");
  }
  if (typeof maxSeq !== "number" || !Number.isInteger(maxSeq) || maxSeq < 0) {
    throw new Error("dedup index: maxSequence invalid");
  }
  const cidOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(byCid as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      throw new Error(`dedup index: byCommitId.${k} not integer`);
    }
    cidOut[k] = v;
  }
  const chOut: Record<string, number> = {};
  for (const [k, v] of Object.entries(byCh as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      throw new Error(`dedup index: byContentHash.${k} not integer`);
    }
    chOut[k] = v;
  }
  return {
    byCommitId: cidOut,
    byContentHash: chOut,
    maxSequence: maxSeq,
  };
}
