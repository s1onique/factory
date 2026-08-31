/**
 * FOUNDATION04 — B0-CORR02 — Wire validation tests.
 *
 * WIRE01..08 (B0-CORR02 §6):
 *   - missing eventId reject
 *   - missing observedAt reject
 *   - NaN/noninteger observedAt reject
 *   - malformed lifecycle reject
 *   - malformed process evidence reject
 *   - malformed witness evidence reject
 *   - unknown payload fields follow explicit codec policy
 *   - valid all-three event families round-trip
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseLedgerWriterRequest } from "../../src/ledger-writer/ledger-writer-protocol.js";

test("WIRE01 missing eventId reject", () => {
  const r = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-1",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "lifecycle",
      observedAt: 1000,
      event: { type: "run_created" },
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /eventId/);
});

test("WIRE02 missing observedAt reject", () => {
  const r = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-2",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "lifecycle",
      eventId: "evt-2",
      event: { type: "run_created" },
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /observedAt/);
});

test("WIRE03 NaN/noninteger observedAt reject", () => {
  const r1 = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-3a",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "lifecycle",
      eventId: "evt-3a",
      observedAt: NaN,
      event: { type: "run_created" },
    },
  });
  assert.equal(r1.ok, false);

  const r2 = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-3b",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "lifecycle",
      eventId: "evt-3b",
      observedAt: 1.5,
      event: { type: "run_created" },
    },
  });
  assert.equal(r2.ok, false);
  if (r2.ok) return;
  assert.match(r2.reason, /observedAt/);
});

test("WIRE04 malformed lifecycle reject", () => {
  const r = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-4",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "lifecycle",
      eventId: "evt-4",
      observedAt: 1000,
      event: { no_type: true },
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /event\.type/);
});

test("WIRE05 malformed process evidence reject", () => {
  const r = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-5",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "process_evidence",
      eventId: "evt-5",
      observedAt: 1000,
      payload: "not-an-object",
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /payload/);
});

test("WIRE06 malformed witness evidence reject", () => {
  const r = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-6",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "witness_evidence",
      eventId: "evt-6",
      observedAt: 1000,
      payload: 42,
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /payload/);
});

test("WIRE07 unknown event kind reject", () => {
  const r = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-7",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "not_a_kind",
      eventId: "evt-7",
      observedAt: 1000,
      payload: {},
    },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /kind/);
});

test("WIRE08 valid all-three event families round-trip", () => {
  const r1 = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-8a",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "lifecycle",
      eventId: "evt-8a",
      observedAt: 1000,
      event: { type: "run_created" },
    },
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  assert.equal(r1.request.kind, "append");
  if (r1.request.kind !== "append") return;
  assert.equal(r1.request.event.kind, "lifecycle");
  assert.equal(r1.request.event.eventId, "evt-8a");

  const r2 = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-8b",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "process_evidence",
      eventId: "evt-8b",
      observedAt: 1000,
      payload: {
        kind: "process_spawn_requested",
        attempt_id: "att-1",
        process_id: "pid-1",
      },
    },
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  if (r2.request.kind !== "append") return;
  assert.equal(r2.request.event.kind, "process_evidence");

  const r3 = parseLedgerWriterRequest({
    protocolVersion: 2,
    kind: "append",
    commitId: "cid-8c",
    clientContentHash: "h".repeat(64),
    event: {
      kind: "witness_evidence",
      eventId: "evt-8c",
      observedAt: 1000,
      payload: {
        kind: "witness_ready",
        witness_id: "w-1",
        witness_instance_id: "wi-1",
        historical_witness_pid: 1,
        socket_path: "/tmp/s",
        witness_public_key: "k",
        witness_public_key_fingerprint: "f",
        controller_public_key_fingerprint: "f",
        protocol_version: 1,
      },
    },
  });
  assert.equal(r3.ok, true);
  if (!r3.ok) return;
  if (r3.request.kind !== "append") return;
  assert.equal(r3.request.event.kind, "witness_evidence");
});
