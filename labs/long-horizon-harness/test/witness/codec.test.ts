/**
 * FOUNDATION04 — codec and projector additional tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalCommandResponse,
  encodeFrame,
  decodeFrame,
  WITNESS_MAX_FRAME_BYTES,
  projectAuthority,
  pendingCommands,
  makeWitnessId,
  makeWitnessInstanceId,
  makeWitnessCommandId,
  type WitnessPersistedResult,
} from "../../src/witness/index.js";

test("canonical signing payload is deterministic", () => {
  const payload = {
    commandId: makeWitnessCommandId("c-1"),
    witnessId: makeWitnessId("w-1"),
    witnessInstanceId: makeWitnessInstanceId("wi-1"),
    witnessSequence: 0,
    result: { kind: "cancelled" as const, result: { outcome_kind: "cancelled" } as WitnessPersistedResult },
  };
  const a = canonicalCommandResponse(payload);
  const b = canonicalCommandResponse(payload);
  assert.equal(Buffer.from(a).equals(Buffer.from(b)), true);
});

test("frame encode + decode round-trip", () => {
  const json = JSON.stringify({ kind: "hello", payload: "ok" });
  const enc = encodeFrame(json);
  assert.equal(enc.ok, true);
  if (!enc.ok) return;
  const dec = decodeFrame(enc.bytes, 0);
  assert.equal(dec.ok, true);
  if (!dec.ok) return;
  assert.equal(dec.json, json);
});

test("oversize frame is rejected", () => {
  const huge = "x".repeat(WITNESS_MAX_FRAME_BYTES + 10);
  const enc = encodeFrame(huge);
  assert.equal(enc.ok, false);
  if (enc.ok) return;
  assert.equal(enc.error.kind, "oversize_frame");
});

test("pendingCommands tracks outstanding intents", () => {
  const w = makeWitnessId("w");
  const wi = makeWitnessInstanceId("wi");
  const stream = [
    {
      payload: { kind: "witness_start_requested" as const, witness_id: w, witness_instance_id: wi },
      observedAt: 0,
      seq: 1,
    },
    {
      payload: {
        kind: "witness_activation_requested" as const,
        witness_id: w,
        witness_instance_id: wi,
        command_id: makeWitnessCommandId("cmd-1"),
      },
      observedAt: 0,
      seq: 2,
    },
    {
      payload: {
        kind: "witness_command_requested" as const,
        witness_id: w,
        witness_instance_id: wi,
        command_id: makeWitnessCommandId("cmd-2"),
        action: "CANCEL" as const,
      },
      observedAt: 0,
      seq: 3,
    },
    {
      payload: {
        kind: "witness_command_result" as const,
        witness_id: w,
        witness_instance_id: wi,
        command_id: makeWitnessCommandId("cmd-1"),
        outcome: { kind: "cancelled" as const, result: { outcome_kind: "cancelled" as const } },
        witness_sequence: 1,
      },
      observedAt: 0,
      seq: 4,
    },
  ];
  const p = pendingCommands(stream);
  assert.deepEqual([...p].sort(), ["cmd-2"]);
});

test("projectAuthority returns no_witness for no_witness recovery", () => {
  const r = projectAuthority({
    recovery: { kind: "no_witness" },
    authentication: "authenticated",
    queryExecutionStatus: null,
  });
  assert.equal(r.kind, "no_witness");
});

test("projectAuthority returns execution_authority_recovered for running witness", () => {
  const r = projectAuthority({
    recovery: {
      kind: "witness_ready",
      witnessId: makeWitnessId("w"),
      witnessInstanceId: makeWitnessInstanceId("wi"),
      historicalWitnessPid: 100,
      socketPath: "/tmp/x",
      witnessPublicKey: "pk",
      witnessPublicKeyFingerprint: "fp",
      controllerPublicKeyFingerprint: "c",
      protocolVersion: 1,
    },
    authentication: "authenticated",
    queryExecutionStatus: { kind: "running", pid: 1234, pgid: 1234 },
  });
  assert.equal(r.kind, "execution_authority_recovered");
  if (r.kind === "execution_authority_recovered") {
    assert.equal(r.historicalPid, 1234);
    assert.equal(r.historicalPgid, 1234);
  }
});

test("projectAuthority returns witness_endpoint_unreachable when no listener", () => {
  const r = projectAuthority({
    recovery: {
      kind: "witness_ready",
      witnessId: makeWitnessId("w"),
      witnessInstanceId: makeWitnessInstanceId("wi"),
      historicalWitnessPid: 100,
      socketPath: "/tmp/x",
      witnessPublicKey: "pk",
      witnessPublicKeyFingerprint: "fp",
      controllerPublicKeyFingerprint: "c",
      protocolVersion: 1,
    },
    authentication: "endpoint_unreachable",
    queryExecutionStatus: null,
  });
  assert.equal(r.kind, "witness_endpoint_unreachable");
});
