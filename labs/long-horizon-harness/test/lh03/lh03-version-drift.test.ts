/**
 * LH-03 §22 — Version drift qualification (HNEG11, HNEG12).
 *
 * CORRECTION01 (H-C02, H-C15):
 *   The Pi matcher compares the actual identity against the
 *   concrete `QUALIFIED_PI_IDENTITY` record (with the captured
 *   executable_path + executable_sha256). The previous
 *   `PI_QUALIFIED_IDENTITY_BASE` (with null paths) is removed.
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
  QUALIFIED_PI_IDENTITY,
  piIdentityMatches,
  piSchemaFingerprint,
  piQualificationIdentity,
  PI_QUALIFIED_EXECUTABLE_PATH,
  PI_QUALIFIED_EXECUTABLE_SHA256,
} from "../../src/adapters/pi/pi-adapter.js";
import {
  qualificationIdentityEquals,
  type HarnessQualificationIdentity,
} from "../../src/protocol/index.js";

function fullQualified(): HarnessQualificationIdentity {
  // Match the concrete qualified record exactly.
  return { ...QUALIFIED_PI_IDENTITY };
}

test("HNEG11: stale / unqualified version is not silently accepted (Pi)", () => {
  const a = fullQualified();
  const differentName: HarnessQualificationIdentity = {
    ...a,
    package_name: "@earendil-works/pi-other",
  };
  assert.equal(qualificationIdentityEquals(a, differentName), false);

  const differentVersion: HarnessQualificationIdentity = {
    ...a,
    package_version: "0.85.2",
  };
  assert.equal(qualificationIdentityEquals(a, differentVersion), false);

  const differentHash: HarnessQualificationIdentity = {
    ...a,
    executable_sha256: "b".repeat(64),
  };
  assert.equal(qualificationIdentityEquals(a, differentHash), false);

  const differentProtocol: HarnessQualificationIdentity = {
    ...a,
    protocol_mode: "RPC",
  };
  assert.equal(qualificationIdentityEquals(a, differentProtocol), false);

  const differentFingerprint: HarnessQualificationIdentity = {
    ...a,
    native_schema_fingerprint: "c".repeat(64),
  };
  assert.equal(qualificationIdentityEquals(a, differentFingerprint), false);
});

test("HNEG12: schema fingerprint drift is detected (modified fingerprint)", () => {
  const before = piSchemaFingerprint("JSONL_EVENTS", "0.85.1");
  const after = piSchemaFingerprint("JSONL_EVENTS", "0.85.2");
  assert.notEqual(before, after);
  // And fingerprint must NOT be derived from invented names;
  // it MUST change when the protocol_mode changes too.
  const rpcFingerprint = piSchemaFingerprint("RPC", "0.85.1");
  assert.notEqual(before, rpcFingerprint);
});

test("Pi: same display version + different other field => NOT_THE_SAME_QUALIFIED_HARNESS", () => {
  const a = fullQualified();
  const sameDisplayDifferentSha: HarnessQualificationIdentity = {
    ...a,
    executable_sha256: "9".repeat(64),
  };
  assert.equal(a.reported_cli_version, sameDisplayDifferentSha.reported_cli_version);
  assert.equal(qualificationIdentityEquals(a, sameDisplayDifferentSha), false);
  assert.equal(piIdentityMatches(sameDisplayDifferentSha), false);
});

test("Pi: piIdentityMatches returns true only for the concrete qualified record", () => {
  // The concrete QUALIFIED_PI_IDENTITY (with executable_path + sha256) is canonical.
  assert.equal(piIdentityMatches(QUALIFIED_PI_IDENTITY), true);
  // Re-deriving from the same captured args must yield the same tuple.
  const derived = piQualificationIdentity({
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: PI_QUALIFIED_EXECUTABLE_PATH,
    executable_sha256: PI_QUALIFIED_EXECUTABLE_SHA256,
    reported_cli_version: "0.85.1",
  });
  assert.equal(piIdentityMatches(derived), true);
  // A null-paths identity is NOT the same as the concrete record.
  const nullPaths = piQualificationIdentity({
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: null,
    executable_sha256: null,
    reported_cli_version: "0.85.1",
  });
  assert.equal(piIdentityMatches(nullPaths), false);
});

test("Pi: a fabricated identity with wrong harness_name is rejected", () => {
  const wrong = { ...fullQualified(), harness_name: "cline" as const };
  assert.equal(piIdentityMatches(wrong), false);
});

test("H-C02: captured Pi 0.85.1 identity matches (positive oracle)", () => {
  // The ACTUAL captured identity, built from the binary on this host.
  const actual = piQualificationIdentity({
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path:
      "/tmp/npm-prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    executable_sha256:
      "e6d7fcf36a239cf3746e67ddf4222081ac01a601b85a3ee688bdfe9c161d754c",
    reported_cli_version: "0.85.1",
  });
  assert.equal(piIdentityMatches(actual), true);
});
