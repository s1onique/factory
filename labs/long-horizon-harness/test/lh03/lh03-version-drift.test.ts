/**
 * LH-03 §22 — Version drift qualification (HNEG11, HNEG12).
 *
 * Required probes:
 *   qualified HarnessQualificationIdentity  -> PASS
 *   different package_name                 -> UNQUALIFIED
 *   different package_version              -> UNSUPPORTED_VERSION
 *   different executable_sha256             -> UNQUALIFIED
 *   different protocol_mode                -> UNQUALIFIED
 *   different native_schema_fingerprint    -> UNSUPPORTED_VERSION / HALT_NATIVE_SCHEMA_DRIFT
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PI_QUALIFIED_IDENTITY_BASE,
  piIdentityMatches,
  piSchemaFingerprint,
  piQualificationIdentity,
} from "../../src/adapters/pi/pi-adapter.js";
import {
  qualificationIdentityEquals,
  type HarnessQualificationIdentity,
} from "../../src/protocol/index.js";

function fullQualified(): HarnessQualificationIdentity {
  return {
    harness_name: "pi",
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: "/usr/local/bin/pi",
    executable_sha256: "a".repeat(64),
    reported_cli_version: "0.85.1",
    protocol_mode: "JSONL_EVENTS",
    native_schema_fingerprint: piSchemaFingerprint("JSONL_EVENTS", "0.85.1"),
  };
}

test("HNEG11: stale / unqualified version is not silently accepted (Pi)", () => {
  // Same display version, different package_name -> UNQUALIFIED
  const a = fullQualified();
  const differentName: HarnessQualificationIdentity = {
    ...a,
    package_name: "@earendil-works/pi-other",
  };
  assert.equal(qualificationIdentityEquals(a, differentName), false);

  // Different package_version -> UNSUPPORTED_VERSION
  const differentVersion: HarnessQualificationIdentity = {
    ...a,
    package_version: "0.85.2",
  };
  assert.equal(qualificationIdentityEquals(a, differentVersion), false);

  // Different executable_sha256 -> UNQUALIFIED
  const differentHash: HarnessQualificationIdentity = {
    ...a,
    executable_sha256: "b".repeat(64),
  };
  assert.equal(qualificationIdentityEquals(a, differentHash), false);

  // Different protocol_mode -> UNQUALIFIED
  const differentProtocol: HarnessQualificationIdentity = {
    ...a,
    protocol_mode: "RPC",
  };
  assert.equal(qualificationIdentityEquals(a, differentProtocol), false);

  // Different native_schema_fingerprint -> UNSUPPORTED_VERSION / HALT_NATIVE_SCHEMA_DRIFT
  const differentFingerprint: HarnessQualificationIdentity = {
    ...a,
    native_schema_fingerprint: "c".repeat(64),
  };
  assert.equal(qualificationIdentityEquals(a, differentFingerprint), false);
});

test("HNEG12: schema fingerprint drift is detected (modified fingerprint)", () => {
  const before = piSchemaFingerprint("JSONL_EVENTS", "0.85.1");
  // Simulate an upstream schema change by feeding a
  // different version.
  const after = piSchemaFingerprint("JSONL_EVENTS", "0.85.2");
  assert.notEqual(before, after);
});

test("Pi: same display version + different other field => NOT_THE_SAME_QUALIFIED_HARNESS", () => {
  const a = fullQualified();
  const sameDisplayDifferentSha: HarnessQualificationIdentity = {
    ...a,
    executable_sha256: "9".repeat(64),
  };
  assert.equal(a.reported_cli_version, sameDisplayDifferentSha.reported_cli_version);
  assert.equal(qualificationIdentityEquals(a, sameDisplayDifferentSha), false);
});

test("Pi: piIdentityMatches returns true only for the canonical base", () => {
  const canonical = piQualificationIdentity({
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: null,
    executable_sha256: null,
    reported_cli_version: "0.85.1",
  });
  assert.equal(piIdentityMatches(canonical), true);
  // The qualified base identity (without executable binding)
  // is the canonical subject for V1.
  assert.equal(piIdentityMatches(PI_QUALIFIED_IDENTITY_BASE), true);
});

test("Pi: a fabricated identity with wrong harness_name is rejected", () => {
  const wrong = { ...fullQualified(), harness_name: "cline" as const };
  assert.equal(piIdentityMatches(wrong), false);
});
