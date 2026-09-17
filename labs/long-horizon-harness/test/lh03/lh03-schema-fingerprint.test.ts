/**
 * LH-03 §7 — Native schema fingerprint determinism.
 *
 * The fingerprint algorithm MUST be deterministic. Same
 * inputs → same SHA-256 hex. Different inputs (different
 * protocol, different event kinds, different required
 * fields, different version) → different fingerprint.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeSchemaFingerprint,
  canonicaliseFingerprintInput,
  stableStringify,
} from "../../src/adapter-common/schema-fingerprint.js";

test("LH03-FP01: same inputs produce identical fingerprint", () => {
  const a = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["tool_start", "tool_end", "message"],
    required_fields: ["type", "timestamp"],
    version: "0.85.1",
  });
  const b = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["tool_end", "message", "tool_start"],
    required_fields: ["timestamp", "type"],
    version: "0.85.1",
  });
  assert.equal(a, b);
});

test("LH03-FP02: different protocol_mode yields different fingerprint", () => {
  const a = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["tool_start"],
    required_fields: ["type"],
    version: "0.85.1",
  });
  const b = computeSchemaFingerprint({
    protocol_mode: "RPC",
    event_kinds: ["tool_start"],
    required_fields: ["type"],
    version: "0.85.1",
  });
  assert.notEqual(a, b);
});

test("LH03-FP03: different version yields different fingerprint", () => {
  const a = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["tool_start"],
    required_fields: ["type"],
    version: "0.85.1",
  });
  const b = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["tool_start"],
    required_fields: ["type"],
    version: "0.85.2",
  });
  assert.notEqual(a, b);
});

test("LH03-FP04: fingerprint is 64-character lowercase hex", () => {
  const fp = computeSchemaFingerprint({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["session"],
    required_fields: ["type", "version"],
    version: "0.85.1",
  });
  assert.equal(fp.length, 64);
  assert.match(fp, /^[0-9a-f]{64}$/);
});

test("LH03-FP05: stableStringify sorts object keys", () => {
  const a = stableStringify({ b: 2, a: 1 });
  const b = stableStringify({ a: 1, b: 2 });
  assert.equal(a, b);
  assert.equal(a, '{"a":1,"b":2}');
});

test("LH03-FP06: canonicaliseFingerprintInput sorts event_kinds", () => {
  const c = canonicaliseFingerprintInput({
    protocol_mode: "JSONL_EVENTS",
    event_kinds: ["zeta", "alpha", "mu"],
    required_fields: ["timestamp", "type"],
    version: "1.0.0",
  });
  assert.equal(c, '{"event_kinds":["alpha","mu","zeta"],"protocol_mode":"JSONL_EVENTS","required_fields":["timestamp","type"],"version":"1.0.0"}');
});
