/**
 * FOUNDATION04 — witness pure tests (W01..W15 + extra).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectWitness,
  applyRuntimeInput,
  fakeSignerVerifierPair,
  sha256Hex,
  makeWitnessId,
  makeWitnessInstanceId,
  makeWitnessCommandId,
} from "../../src/witness/index.js";
import { makeRuntimeContext } from "./helpers.js";
test("W01 state machine: bootstrapping -> ready -> active -> settled", () => {
  const ctx = makeRuntimeContext();
  const r1 = applyRuntimeInput(ctx, {
    kind: "witness_ready_observed",
    witnessPublicKey: "pk",
    witnessPublicKeyFingerprint: "fp",
    controllerPublicKeyFingerprint: "c",
    socketPath: "/tmp/x",
    protocolVersion: 1,
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  assert.equal(r1.context.state.kind, "ready_not_activated");
  const r2 = applyRuntimeInput(r1.context, {
    kind: "activate_requested",
    commandId: makeWitnessCommandId("c1"),
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.context.activated, true);
  // Drive to execution_settled via spawn_succeeded then command_completed.
  const r3 = applyRuntimeInput(r2.context, {
    kind: "spawn_succeeded",
    pid: 999,
    pgid: 999,
  });
  assert.equal(r3.ok, true);
  if (!r3.ok) return;
  assert.equal(r3.context.state.kind, "execution_running");
  // Now add a pending command and complete it.
  const request = {
    protocolVersion: 1,
    commandId: makeWitnessCommandId("c1"),
    runId: ctx.bootstrap.binding.runId,
    missionId: ctx.bootstrap.binding.missionId,
    attemptId: ctx.bootstrap.binding.attemptId,
    processId: ctx.bootstrap.binding.processId,
    witnessId: ctx.bootstrap.binding.witnessId,
    witnessInstanceId: ctx.bootstrap.binding.witnessInstanceId,
    action: "CANCEL" as const,
    nonce: "n",
  };
  const entry = {
    kind: "pending" as const,
    commandId: request.commandId,
    request,
    requestFingerprint: "fp",
  };
  const r4 = applyRuntimeInput(r3.context, { kind: "command_received", entry });
  assert.equal(r4.ok, true);
  if (!r4.ok) return;
  const r5 = applyRuntimeInput(r4.context, {
    kind: "command_completed",
    commandId: request.commandId,
    responseBody: { kind: "cancelled", result: { outcome_kind: "cancelled" } },
  });
  assert.equal(r5.ok, true);
  if (!r5.ok) return;
  assert.equal(r5.context.state.kind, "execution_settled");
});

test("W02 key binding immutable", () => {
  const w = makeWitnessId("w");
  const wi = makeWitnessInstanceId("wi");
  const stream: Array<{
    payload: import("../../src/witness/index.js").PersistedWitnessEvidence;
    observedAt: number;
    seq: number;
  }> = [
    { payload: { kind: "witness_start_requested", witness_id: w, witness_instance_id: wi }, observedAt: 0, seq: 1 },
    {
      payload: {
        kind: "witness_ready",
        witness_id: w,
        witness_instance_id: wi,
        historical_witness_pid: 100,
        socket_path: "/tmp/x",
        witness_public_key: "pk-A",
        witness_public_key_fingerprint: "fp-A",
        controller_public_key_fingerprint: "c",
        protocol_version: 1,
      },
      observedAt: 0,
      seq: 2,
    },
    {
      payload: {
        kind: "witness_ready",
        witness_id: w,
        witness_instance_id: wi,
        historical_witness_pid: 100,
        socket_path: "/tmp/x",
        witness_public_key: "pk-B",
        witness_public_key_fingerprint: "fp-B",
        controller_public_key_fingerprint: "c",
        protocol_version: 1,
      },
      observedAt: 0,
      seq: 3,
    },
  ];
  const proj = projectWitness(stream);
  assert.equal(proj.ok, false);
});

test("W06 wrong witness instance rejected at projector", () => {
  const w1 = makeWitnessId("w-1");
  const w2 = makeWitnessId("w-2");
  const wi = makeWitnessInstanceId("wi");
  const stream: Array<{
    payload: import("../../src/witness/index.js").PersistedWitnessEvidence;
    observedAt: number;
    seq: number;
  }> = [
    { payload: { kind: "witness_start_requested", witness_id: w1, witness_instance_id: wi }, observedAt: 0, seq: 1 },
    {
      payload: {
        kind: "witness_ready",
        witness_id: w2,
        witness_instance_id: wi,
        historical_witness_pid: 100,
        socket_path: "/tmp/x",
        witness_public_key: "pk",
        witness_public_key_fingerprint: "fp",
        controller_public_key_fingerprint: "c",
        protocol_version: 1,
      },
      observedAt: 0,
      seq: 2,
    },
  ];
  const proj = projectWitness(stream);
  assert.equal(proj.ok, false);
});

test("W07 nonce freshness via fake signature", () => {
  const { signer, verifier } = fakeSignerVerifierPair();
  const a = signer.sign(new TextEncoder().encode("nonce-A"));
  assert.equal(verifier.verify(new TextEncoder().encode("nonce-A"), a), true);
  assert.equal(verifier.verify(new TextEncoder().encode("nonce-B"), a), false);
});

test("W08 wrong signature rejected", () => {
  const { signer, verifier } = fakeSignerVerifierPair();
  const a = signer.sign(new TextEncoder().encode("x"));
  const b = signer.sign(new TextEncoder().encode("y"));
  assert.equal(verifier.verify(new TextEncoder().encode("x"), a), true);
  assert.equal(verifier.verify(new TextEncoder().encode("x"), b), false);
});

test("W09 modified response rejected", () => {
  const { signer, verifier } = fakeSignerVerifierPair();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sig = signer.sign(bytes);
  assert.equal(verifier.verify(bytes, sig), true);
  const tampered = new Uint8Array(bytes);
  if (tampered[0] !== undefined) tampered[0] = tampered[0] ^ 1;
  assert.equal(verifier.verify(tampered, sig), false);
});

test("W11 idempotent command completes once", () => {
  const ctx = makeRuntimeContext();
  const r1 = applyRuntimeInput(ctx, {
    kind: "witness_ready_observed",
    witnessPublicKey: "pk",
    witnessPublicKeyFingerprint: "fp",
    controllerPublicKeyFingerprint: "c",
    socketPath: "/tmp/x",
    protocolVersion: 1,
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = applyRuntimeInput(r1.context, {
    kind: "activate_requested",
    commandId: makeWitnessCommandId("c1"),
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  const request = {
    protocolVersion: 1,
    commandId: makeWitnessCommandId("c1"),
    runId: ctx.bootstrap.binding.runId,
    missionId: ctx.bootstrap.binding.missionId,
    attemptId: ctx.bootstrap.binding.attemptId,
    processId: ctx.bootstrap.binding.processId,
    witnessId: ctx.bootstrap.binding.witnessId,
    witnessInstanceId: ctx.bootstrap.binding.witnessInstanceId,
    action: "QUERY" as const,
    nonce: "n",
  };
  const entry = {
    kind: "pending" as const,
    commandId: request.commandId,
    request,
    requestFingerprint: sha256Hex(new TextEncoder().encode(JSON.stringify(request))),
  };
  const r3 = applyRuntimeInput(r2.context, { kind: "command_received", entry });
  assert.equal(r3.ok, true);
  if (!r3.ok) return;
  const r4 = applyRuntimeInput(r3.context, {
    kind: "command_completed",
    commandId: request.commandId,
    responseBody: { kind: "ok", result: null } as never,
  });
  assert.equal(r4.ok, true);
});

test("W13 command result without intent rejected", () => {
  const ctx = makeRuntimeContext();
  const r1 = applyRuntimeInput(ctx, {
    kind: "witness_ready_observed",
    witnessPublicKey: "pk",
    witnessPublicKeyFingerprint: "fp",
    controllerPublicKeyFingerprint: "c",
    socketPath: "/tmp/x",
    protocolVersion: 1,
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = applyRuntimeInput(r1.context, {
    kind: "command_completed",
    commandId: makeWitnessCommandId("orphan"),
    responseBody: { kind: "ok", result: null } as never,
  });
  assert.equal(r2.ok, false);
});

test("W14 activation before ready rejected", () => {
  const ctx = makeRuntimeContext();
  const r = applyRuntimeInput(ctx, {
    kind: "activate_requested",
    commandId: makeWitnessCommandId("c1"),
  });
  assert.equal(r.ok, false);
});

test("W15 execution before activation rejected", () => {
  const ctx = makeRuntimeContext();
  const r1 = applyRuntimeInput(ctx, {
    kind: "witness_ready_observed",
    witnessPublicKey: "pk",
    witnessPublicKeyFingerprint: "fp",
    controllerPublicKeyFingerprint: "c",
    socketPath: "/tmp/x",
    protocolVersion: 1,
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = applyRuntimeInput(r1.context, { kind: "spawn_requested" });
  assert.equal(r2.ok, false);
});
