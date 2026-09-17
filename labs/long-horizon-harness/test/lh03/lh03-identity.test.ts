/**
 * LH-03 §1.4 / §4.1 — HarnessQualificationIdentity contract.
 *
 * Required negative oracle:
 *
 *   SAME_DISPLAY_VERSION
 *     !=
 *   SAME_QUALIFIED_HARNESS
 *
 * unless the COMPLETE qualification identity agrees.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  qualificationIdentityEquals,
  isFullyQualifiedIdentity,
  type HarnessQualificationIdentity,
} from "../../src/protocol/index.js";

function base(): HarnessQualificationIdentity {
  return {
    harness_name: "pi",
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: "/usr/local/bin/pi",
    executable_sha256: "a".repeat(64),
    reported_cli_version: "0.85.1",
    protocol_mode: "JSONL_EVENTS",
    native_schema_fingerprint: "b".repeat(64),
  };
}

test("LH03-ID01: structurally identical identities are equal", () => {
  const a = base();
  const b = base();
  assert.equal(qualificationIdentityEquals(a, b), true);
});

test("LH03-ID02: different package_version => NOT the same qualified harness", () => {
  const a = base();
  const b = base();
  assert.notEqual(qualificationIdentityEquals(a, { ...b, package_version: "0.85.2" }), true);
});

test("LH03-ID03: different executable_sha256 => NOT the same qualified harness", () => {
  const a = base();
  const b = base();
  assert.notEqual(
    qualificationIdentityEquals(a, { ...b, executable_sha256: "c".repeat(64) }),
    true,
  );
});

test("LH03-ID04: different native_schema_fingerprint => NOT the same qualified harness", () => {
  const a = base();
  const b = base();
  assert.notEqual(
    qualificationIdentityEquals(a, { ...b, native_schema_fingerprint: "d".repeat(64) }),
    true,
  );
});

test("LH03-ID05: same display version, different other field => NOT the same qualified harness", () => {
  const a = base();
  const b = base();
  assert.equal(a.reported_cli_version, b.reported_cli_version);
  assert.equal(qualificationIdentityEquals(a, { ...b, executable_path: "/opt/pi" }), false);
});

test("LH03-ID06: fully-qualified identity check passes when no field is null", () => {
  assert.equal(isFullyQualifiedIdentity(base()), true);
});

test("LH03-ID07: missing package_name => not fully qualified", () => {
  assert.equal(isFullyQualifiedIdentity({ ...base(), package_name: null }), false);
});

test("LH03-ID08: missing native_schema_fingerprint => not fully qualified", () => {
  assert.equal(
    isFullyQualifiedIdentity({ ...base(), native_schema_fingerprint: null }),
    false,
  );
});
