/**
 * Phase B0 — pure dedup-index tests (B0-CORR01).
 *
 * Laws (B0-C01-05..07):
 *   - same commitId + same content → replay original seq
 *   - same commitId + different content → CONFLICT
 *   - different commitId + identical content → MISS
 *   - different commitId + different content → MISS
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dedupLookup,
  dedupRecord,
  mergeRecoveredIndex,
  reconcileWithLedger,
  serializeDedupIndex,
  deserializeDedupIndex,
  buildIndexFromRecords,
} from "../../src/ledger-writer/ledger-writer-dedup.js";
import {
  emptyDedupIndex,
  makeCommitId,
  type CommitId,
} from "../../src/ledger-writer/ledger-writer-types.js";

const cid1 = makeCommitId("commit-aaa");
const cid2 = makeCommitId("commit-bbb");
const cid3 = makeCommitId("commit-ccc");
const cid4 = makeCommitId("commit-ddd");
const ch1 = "h0001";
const ch2 = "h0002";

test("LW-D01 empty index lookup returns miss", () => {
  const idx = emptyDedupIndex();
  const r = dedupLookup(idx, { commitId: cid1, contentHash: ch1 });
  assert.equal(r.kind, "miss");
});

test("LW-D02 record then lookup by commitId replays sequence", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 1 });
  const r = dedupLookup(idx, { commitId: cid1, contentHash: ch1 });
  assert.equal(r.kind, "replay");
  if (r.kind !== "replay") return;
  assert.equal(r.sequence, 1);
});

test("LW-D03 different commitId + same contentHash returns MISS (B0-C01-07)", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 1 });
  const r = dedupLookup(idx, { commitId: cid2, contentHash: ch1 });
  assert.equal(r.kind, "miss");
});

test("LW-D04 maxSequence advances monotonically", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 5 });
  idx = dedupRecord(idx, { commitId: cid2, contentHash: ch2, sequence: 6 });
  assert.equal(idx.maxSequence, 6);
});

test("LW-D05 record never shrinks maxSequence", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 10 });
  idx = dedupRecord(idx, { commitId: cid2, contentHash: ch2, sequence: 11 });
  assert.equal(idx.maxSequence, 11);
});

test("LW-D06 mergeRecoveredIndex preserves entries on disjoint keys", () => {
  let cur = emptyDedupIndex();
  cur = dedupRecord(cur, { commitId: cid1, contentHash: ch1, sequence: 3 });
  let rec = emptyDedupIndex();
  rec = dedupRecord(rec, { commitId: cid2, contentHash: ch2, sequence: 4 });
  const merged = mergeRecoveredIndex(cur, rec);
  const a = merged.byCommitId["commit-aaa"];
  const b = merged.byCommitId["commit-bbb"];
  assert.ok(a && a.sequence === 3);
  assert.ok(b && b.sequence === 4);
  assert.equal(merged.maxSequence, 4);
});

test("LW-D07 mergeRecoveredIndex keeps higher sequence on collision", () => {
  let cur = emptyDedupIndex();
  cur = dedupRecord(cur, { commitId: cid1, contentHash: ch1, sequence: 7 });
  let rec = emptyDedupIndex();
  rec = dedupRecord(rec, { commitId: cid1, contentHash: ch1, sequence: 5 });
  const merged = mergeRecoveredIndex(cur, rec);
  const a = merged.byCommitId["commit-aaa"];
  assert.ok(a && a.sequence === 7);
  assert.equal(merged.maxSequence, 7);
});

test("LW-D08 reconcileWithLedger advances max when ledger has more", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 2 });
  const reconciled = reconcileWithLedger(idx, 5);
  assert.equal(reconciled.maxSequence, 5);
  const a = reconciled.byCommitId["commit-aaa"];
  assert.ok(a && a.sequence === 2);
});

test("LW-D09 reconcileWithLedger trims entries beyond ledger max", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 10 });
  idx = dedupRecord(idx, { commitId: cid2, contentHash: ch2, sequence: 11 });
  const reconciled = reconcileWithLedger(idx, 7);
  assert.equal(reconciled.maxSequence, 7);
  assert.equal(reconciled.byCommitId["commit-aaa"], undefined);
  assert.equal(reconciled.byCommitId["commit-bbb"], undefined);
});

test("LW-D10 serialize/deserialize roundtrip preserves structure", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 1 });
  idx = dedupRecord(idx, { commitId: cid2, contentHash: ch2, sequence: 2 });
  idx = dedupRecord(idx, { commitId: cid3, contentHash: "h0003", sequence: 3 });
  const json = serializeDedupIndex(idx);
  const back = deserializeDedupIndex(json);
  assert.deepEqual(back, idx);
});

test("LW-D11 serialize is byte-stable", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid4, contentHash: "h0004", sequence: 1 });
  idx = dedupRecord(idx, { commitId: cid3, contentHash: "h0003", sequence: 2 });
  idx = dedupRecord(idx, { commitId: cid2, contentHash: "h0002", sequence: 3 });
  idx = dedupRecord(idx, { commitId: cid1, contentHash: "h0001", sequence: 4 });
  const a = serializeDedupIndex(idx);
  let idx2 = emptyDedupIndex();
  idx2 = dedupRecord(idx2, { commitId: cid1, contentHash: "h0001", sequence: 4 });
  idx2 = dedupRecord(idx2, { commitId: cid4, contentHash: "h0004", sequence: 1 });
  idx2 = dedupRecord(idx2, { commitId: cid2, contentHash: "h0002", sequence: 3 });
  idx2 = dedupRecord(idx2, { commitId: cid3, contentHash: "h0003", sequence: 2 });
  const b = serializeDedupIndex(idx2);
  assert.equal(a, b);
});

test("LW-D12 deserialize rejects malformed payload", () => {
  assert.throws(() => deserializeDedupIndex("not json"));
  assert.throws(() => deserializeDedupIndex("{}"));
  assert.throws(() => deserializeDedupIndex(JSON.stringify({ version: 1 })));
  assert.throws(() =>
    deserializeDedupIndex(JSON.stringify({ version: 2, maxSequence: "x" })),
  );
});

test("LW-D13 record with non-positive sequence throws", () => {
  const idx = emptyDedupIndex();
  assert.throws(() =>
    dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 0 }),
  );
  assert.throws(() =>
    dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: -1 }),
  );
  assert.throws(() =>
    dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 1.5 }),
  );
});

test("LW-D14 different commitIds with different contentHashes do not collide", () => {
  let idx = emptyDedupIndex();
  const cid: CommitId = makeCommitId("commit-case");
  idx = dedupRecord(idx, { commitId: cid, contentHash: ch1, sequence: 1 });
  const r = dedupLookup(idx, {
    commitId: makeCommitId("commit-other"),
    contentHash: "different-hash",
  });
  assert.equal(r.kind, "miss");
});

// --- B0-CORR01 new laws ----------------------------------------------

test("LW-D15 (DEDUP15) same commitId + same content → original seq (replay)", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, {
    commitId: cid1,
    contentHash: ch1,
    sequence: 7,
  });
  const r = dedupLookup(idx, { commitId: cid1, contentHash: ch1 });
  assert.equal(r.kind, "replay");
  if (r.kind !== "replay") return;
  assert.equal(r.sequence, 7);
});

test("LW-D16 (DEDUP16) same commitId + changed content → CONFLICT", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, {
    commitId: cid1,
    contentHash: ch1,
    sequence: 7,
  });
  const r = dedupLookup(idx, {
    commitId: cid1,
    contentHash: "different-content-hash",
  });
  assert.equal(r.kind, "conflict");
  if (r.kind !== "conflict") return;
  assert.equal(r.existingSequence, 7);
  assert.equal(r.existingContentHash, ch1);
});

test("LW-D17 (DEDUP17) different commitIds + identical content → two distinct", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, {
    commitId: cid1,
    contentHash: ch1,
    sequence: 7,
  });
  const r = dedupLookup(idx, { commitId: cid2, contentHash: ch1 });
  assert.equal(r.kind, "miss");
});

test("LW-D18 buildIndexFromRecords reconstructs a complete index from the ledger", () => {
  const rebuilt = buildIndexFromRecords([
    { sequence: 1, commitId: "c-a", contentHash: "h-a" },
    { sequence: 2, commitId: "c-b", contentHash: "h-b" },
    { sequence: 3, commitId: "c-c", contentHash: "h-c" },
  ]);
  assert.equal(rebuilt.maxSequence, 3);
  const a = rebuilt.byCommitId["c-a"];
  const b = rebuilt.byCommitId["c-b"];
  const c = rebuilt.byCommitId["c-c"];
  assert.ok(a && a.sequence === 1 && a.contentHash === "h-a");
  assert.ok(b && b.sequence === 2 && b.contentHash === "h-b");
  assert.ok(c && c.sequence === 3 && c.contentHash === "h-c");
});

test("LW-D19 buildIndexFromRecords is tolerant to malformed lines", () => {
  const rebuilt = buildIndexFromRecords([
    { sequence: 1, commitId: "c-a", contentHash: "h-a" },
    { sequence: -1, commitId: "c-bad", contentHash: "h-bad" },
    { sequence: 2, commitId: "", contentHash: "h-b" },
    { sequence: 3, commitId: "c-c", contentHash: "" },
    { sequence: 4, commitId: "c-d", contentHash: "h-d" },
  ]);
  assert.equal(rebuilt.maxSequence, 4);
  assert.ok(rebuilt.byCommitId["c-a"]);
  assert.ok(rebuilt.byCommitId["c-d"]);
  assert.equal(rebuilt.byCommitId["c-bad"], undefined);
});
