/**
 * Phase B0 — pure dedup-index tests.
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

test("LW-D01 empty index lookup returns null", () => {
  const idx = emptyDedupIndex();
  assert.equal(dedupLookup(idx, { commitId: cid1, contentHash: ch1 }), null);
});

test("LW-D02 record then lookup by commitId returns sequence", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 1 });
  assert.equal(dedupLookup(idx, { commitId: cid1, contentHash: ch1 }), 1);
});

test("LW-D03 lookup by contentHash only also returns sequence", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 1 });
  assert.equal(dedupLookup(idx, { commitId: cid2, contentHash: ch1 }), 1);
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
  assert.equal(merged.byCommitId["commit-aaa"], 3);
  assert.equal(merged.byCommitId["commit-bbb"], 4);
  assert.equal(merged.maxSequence, 4);
});

test("LW-D07 mergeRecoveredIndex keeps higher sequence on collision", () => {
  let cur = emptyDedupIndex();
  cur = dedupRecord(cur, { commitId: cid1, contentHash: ch1, sequence: 7 });
  let rec = emptyDedupIndex();
  rec = dedupRecord(rec, { commitId: cid1, contentHash: ch1, sequence: 5 });
  const merged = mergeRecoveredIndex(cur, rec);
  assert.equal(merged.byCommitId["commit-aaa"], 7);
  assert.equal(merged.maxSequence, 7);
});

test("LW-D08 reconcileWithLedger advances when ledger has more", () => {
  let idx = emptyDedupIndex();
  idx = dedupRecord(idx, { commitId: cid1, contentHash: ch1, sequence: 2 });
  const reconciled = reconcileWithLedger(idx, 5);
  assert.equal(reconciled.maxSequence, 5);
  assert.equal(reconciled.byCommitId["commit-aaa"], 2);
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
  assert.throws(() => deserializeDedupIndex(JSON.stringify({ version: 2 })));
  assert.throws(() =>
    deserializeDedupIndex(JSON.stringify({ version: 1, maxSequence: "x" })),
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
  // Different commitId AND different contentHash — must NOT match.
  assert.equal(
    dedupLookup(idx, {
      commitId: makeCommitId("commit-other"),
      contentHash: "different-hash",
    }),
    null,
  );
});
