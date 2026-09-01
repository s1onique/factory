/**
 * FOUNDATION04 — PHASE A FINAL CLOSURE — BOOTFAIL01..02.
 *
 *   H1 hypothesis: an empty `controller_public_key_fingerprint`
 *   in `witness_ready` is rejected at the trust boundary
 *   (B0-CORR03 §12 — the authoritative witness-evidence
 *   decoder). If the writer's decoder accepts an empty
 *   fingerprint, the bound is meaningless.
 *
 *   These tests prove the trust boundary's typed rejection
 *   so the runtime's `controller_binding_failed` exit can
 *   be classified, not just generically labelled "exit 1".
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  decodePersistedWitnessEvidence,
} from "../../src/witness/witness-evidence-decode.js";

const VALID_FP = "f".repeat(64);

function mkReady(fingerprint: string): Record<string, unknown> {
  return {
    kind: "witness_ready",
    witness_id: "w-1",
    witness_instance_id: "wi-1",
    historical_witness_pid: 12345,
    socket_path: "/tmp/sock",
    witness_public_key: "a".repeat(64),
    witness_public_key_fingerprint: VALID_FP,
    controller_public_key_fingerprint: fingerprint,
    protocol_version: 1,
  };
}

test("BOOTFAIL01: witness_ready with empty controller fingerprint is rejected at the trust boundary", () => {
  const r = decodePersistedWitnessEvidence(mkReady(""));
  assert.equal(r.ok, false,
    "BOOTFAIL01: empty controller_public_key_fingerprint must be REJECTED");
  if (r.ok) return;
  // The decoder's typed error MUST identify the field
  // and the specific failure: empty string is invalid.
  assert.equal(r.error.kind, "invalid_evidence",
    "BOOTFAIL01: error.kind must be 'invalid_evidence'");
  assert.ok(r.error.reason.includes("controller_public_key_fingerprint"),
    "BOOTFAIL01: error.reason must identify the field " +
    "(got: " + r.error.reason + ")");
});

test("BOOTFAIL02: witness_ready with non-empty controller fingerprint is accepted", () => {
  const r = decodePersistedWitnessEvidence(mkReady(VALID_FP));
  assert.equal(r.ok, true,
    "BOOTFAIL02: non-empty controller_public_key_fingerprint must be ACCEPTED");
  if (!r.ok) return;
  assert.equal(r.value.kind, "witness_ready",
    "BOOTFAIL02: must yield a typed witness_ready record");
  if (r.value.kind !== "witness_ready") return;
  assert.equal(r.value.controller_public_key_fingerprint, VALID_FP,
    "BOOTFAIL02: fingerprint must round-trip");
});
