/**
 * FOUNDATION04 — B0-CORR03 — Response decoder tests.
 *
 * RESP01..RESP06 (B0-CORR03 §21): reject malformed
 * response variants; accept valid full matrix.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeLedgerWriterResponse } from "../../src/ledger-writer/ledger-writer-response-decode.js";

test("RESP01 missing kind reject", () => {
  const r = decodeLedgerWriterResponse({ sequence: 1, commitId: "c", contentHash: "f".repeat(64) });
  assert.equal(r.ok, false);
});

test("RESP02 unknown kind reject", () => {
  const r = decodeLedgerWriterResponse({ kind: "made_up_kind" });
  assert.equal(r.ok, false);
});

test("RESP03 appended sequence=-1 reject", () => {
  const r = decodeLedgerWriterResponse({
    kind: "appended",
    protocolVersion: 2,
    commitId: "cid-1",
    sequence: -1,
    contentHash: "f".repeat(64),
  });
  assert.equal(r.ok, false);
});

test("RESP03b wrong commitId type reject", () => {
  const r = decodeLedgerWriterResponse({
    kind: "appended",
    protocolVersion: 2,
    commitId: 12345,
    sequence: 1,
    contentHash: "f".repeat(64),
  });
  assert.equal(r.ok, false);
});

test("RESP04 malformed contentHash reject", () => {
  const r = decodeLedgerWriterResponse({
    kind: "appended",
    protocolVersion: 2,
    commitId: "cid-1",
    sequence: 1,
    contentHash: "not-hex",
  });
  assert.equal(r.ok, false);
});

test("RESP05 self missing instanceId reject", () => {
  const r = decodeLedgerWriterResponse({
    kind: "self",
    protocolVersion: 2,
    socketPath: "/tmp/s",
    runId: "r",
    missionId: "m",
    startedAt: 1000,
    maxSequence: 0,
  });
  assert.equal(r.ok, false);
});

test("RESP06 valid full matrix accepted", () => {
  const r1 = decodeLedgerWriterResponse({
    kind: "appended",
    protocolVersion: 2,
    commitId: "cid-1",
    sequence: 1,
    contentHash: "f".repeat(64),
  });
  assert.equal(r1.ok, true);

  const r2 = decodeLedgerWriterResponse({
    kind: "replay",
    protocolVersion: 2,
    commitId: "cid-1",
    sequence: 1,
    contentHash: "f".repeat(64),
  });
  assert.equal(r2.ok, true);

  const r3 = decodeLedgerWriterResponse({
    kind: "pong",
    protocolVersion: 2,
    instanceId: "lw-1",
    maxSequence: 0,
  });
  assert.equal(r3.ok, true);

  const r4 = decodeLedgerWriterResponse({
    kind: "self",
    protocolVersion: 2,
    instanceId: "lw-1",
    socketPath: "/tmp/s",
    runId: "r",
    missionId: "m",
    startedAt: 1000,
    maxSequence: 5,
  });
  assert.equal(r4.ok, true);

  const r5 = decodeLedgerWriterResponse({
    kind: "error",
    protocolVersion: 2,
    error: { kind: "writer_busy", message: "busy" },
  });
  assert.equal(r5.ok, true);
});
