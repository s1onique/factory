/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Acceptance targets covered here:
 *
 *   CONFIGURATION_JSON_BOUNDARY    = PASS  (JSON-BOUND-*)
 *
 * `validateJsonValue` is the recursive JsonValue contract.
 * These tests pin its public surface directly so that the
 * D-C01 decoder-totality property does not depend solely on
 * black-box testing through decodeSubjectManifest.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateJsonValue } from "../../src/subject/subject-json.js";

test("JSON-BOUND-01: primitives pass", () => {
  for (const v of [null, true, false, 0, -1, 3.14, "", "hello"]) {
    const r = validateJsonValue(v);
    assert.equal(r.ok, true, "expected ok for " + JSON.stringify(v));
  }
});

test("JSON-BOUND-02: arrays of primitives pass", () => {
  const r = validateJsonValue([1, 2, "three", null, true]);
  assert.equal(r.ok, true);
});

test("JSON-BOUND-03: nested plain objects pass", () => {
  const r = validateJsonValue({ a: { b: { c: [1, 2, 3] } } });
  assert.equal(r.ok, true);
});

test("JSON-BOUND-04: undefined is rejected", () => {
  const r = validateJsonValue({ nested: undefined });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /\$.nested/);
});

test("JSON-BOUND-05: non-finite numbers are rejected", () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    const r = validateJsonValue({ x: v });
    assert.equal(r.ok, false, "expected rejection for " + String(v));
    if (!r.ok) assert.match(r.reason, /non-finite/);
  }
});

test("JSON-BOUND-06: BigInt is rejected", () => {
  const r = validateJsonValue({ x: BigInt(1) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /unsupported JSON-value type/);
});

test("JSON-BOUND-07: Symbol is rejected", () => {
  const r = validateJsonValue({ x: Symbol("s") });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /unsupported JSON-value type/);
});

test("JSON-BOUND-08: function is rejected", () => {
  const r = validateJsonValue({ x: () => 1 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /unsupported JSON-value type/);
});

test("JSON-BOUND-09: Date is rejected (non-plain object)", () => {
  const r = validateJsonValue({ x: new Date() });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-plain object/);
});

test("JSON-BOUND-10: Map is rejected", () => {
  const r = validateJsonValue({ x: new Map() });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-plain object/);
});

test("JSON-BOUND-11: Set is rejected", () => {
  const r = validateJsonValue({ x: new Set() });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-plain object/);
});

test("JSON-BOUND-12: Promise is rejected", () => {
  const r = validateJsonValue({ x: Promise.resolve(1) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-plain object/);
});

test("JSON-BOUND-13: cycle is rejected", () => {
  const v: Record<string, unknown> = { a: 1 };
  v["self"] = v;
  const r = validateJsonValue(v);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /cyclic/);
});

test("JSON-BOUND-14: nested cycle is rejected at the cycle path", () => {
  const inner: Record<string, unknown> = { x: 1 };
  inner["back"] = inner;
  const outer = { a: { b: inner } };
  const r = validateJsonValue(outer);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /\$.a\.b\.back/);
});

test("JSON-BOUND-15: validateJsonValue never throws", () => {
  const cases: ReadonlyArray<unknown> = [
    undefined,
    null,
    NaN,
    Infinity,
    Symbol("s"),
    BigInt(1),
    new Date(),
    new Map(),
    new Set(),
    Promise.resolve(1),
    () => 1,
    /regex/,
    new ArrayBuffer(0),
    new Uint8Array(),
  ];
  for (const v of cases) {
    let threw = false;
    try {
      validateJsonValue(v);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "threw on " + String(v));
  }
});

/**
 * D-M02: path-cycle semantics.
 *
 * `ancestors` is a recursion-stack set, not a flat
 * visited-set. Acyclic shared substructure must be
 * ACCEPTED; only true recursive back-edges must be
 * rejected.
 */
test("JSON-BOUND-16: shared child in sibling branches is accepted (DAG)", () => {
  const shared = { x: 1 };
  const cfg = { left: shared, right: shared };
  const r = validateJsonValue(cfg);
  assert.equal(r.ok, true, "expected ok, got: " + (r.ok ? "" : r.reason));
});

test("JSON-BOUND-17: true recursive back-edge is rejected (cycle)", () => {
  const v: Record<string, unknown> = { a: 1 };
  v["self"] = v;
  const r = validateJsonValue(v);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /cyclic/);
});

test("JSON-BOUND-18: deeply-shared DAG is accepted", () => {
  const leaf = { value: 42 };
  const mid = { l1: leaf, l2: leaf };
  const root = { m1: mid, m2: mid, m3: mid };
  const r = validateJsonValue(root);
  assert.equal(r.ok, true, "expected ok, got: " + (r.ok ? "" : r.reason));
});

test("JSON-BOUND-19: cycle inside a sibling-shared DAG is still rejected", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic["self"] = cyclic;
  const root = { left: cyclic, right: cyclic };
  const r = validateJsonValue(root);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /cyclic/);
});

/**
 * D-M01: Proxy / hostile-input defense on
 * validateJsonValue directly. The outer try/catch in
 * validateJsonValue converts any Proxy-trap throw into a
 * typed boundary_exception.
 */
test("JSON-BOUND-20: Proxy ownKeys throw -> boundary_exception", () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error("boom-ownKeys");
    },
  });
  const r = validateJsonValue(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /boundary_exception/);
});

test("JSON-BOUND-21: Proxy getPrototypeOf throw -> boundary_exception", () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("boom-proto");
    },
  });
  const r = validateJsonValue(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /boundary_exception/);
});

test("JSON-BOUND-22: throwing getter -> boundary_exception", () => {
  // A proxy whose getPrototypeOf + get + ownKeys all throw
  // on the operations validateJsonValue performs. We need
  // at least one property for Object.keys to enumerate, so
  // ownKeys returns one key and get throws when it's read.
  const hostile = new Proxy({}, {
    ownKeys() {
      return ["prop"];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
    get(_t, k) {
      throw new Error("boom-get-" + String(k));
    },
  });
  const r = validateJsonValue(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /boundary_exception/);
});
