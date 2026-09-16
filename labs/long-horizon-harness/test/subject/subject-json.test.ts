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

import { validateJsonValue, snapshotJsonValue } from "../../src/subject/subject-json.js";

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

test("JSON-BOUND-22: throwing getter -> no throw + reject", () => {
  // A proxy whose `get` trap throws. Under the OLD validator
  // (which did `record[k]`), this would propagate and the
  // outer try/catch converted it to `boundary_exception`.
  //
  // Under the NEW snapshotter (D-M05/D-M06), validation
  // does NOT invoke the `get` trap at all. It walks
  // Reflect.ownKeys + Object.getOwnPropertyDescriptor,
  // which Node normalizes through ToPropertyDescriptor —
  // turning the trap's `{enumerable:true, configurable:true}`
  // return into `{value: undefined, writable: false, ...}`.
  //
  // The security-relevant property is:
  //   1. validateJsonValue does NOT throw.
  //   2. The input is REJECTED with ok:false (the hostile
  //      trap cannot smuggle a getter-fired value past the
  //      trust boundary).
  //   3. The reason may be either `boundary_exception` (if
  //      the trap escaped one of the operations we DO call,
  //      like ownKeys / getOwnPropertyDescriptor /
  //      getPrototypeOf) or a closed-world JsonValue
  //      rejection (`undefined is not a JsonValue`,
  //      `non-plain object`, etc.) — depending on which
  //      trap fired. The new design STRONGLY prefers the
  //      closed-world rejection because the `get` trap
  //      is never executed.
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
  // The reason is closed-world: the `get` trap was bypassed;
  // Node normalized the descriptor into `value: undefined`,
  // which the snapshotter rejects as not a JsonValue. The
  // trap did NOT execute and did NOT escape.
  if (!r.ok) {
    assert.match(
      r.reason,
      /(undefined is not a JsonValue|boundary_exception)/,
    );
  }
});

/*
 * SNAP01-SNAP07, SNAP09: snapshot rejection / acceptance
 * (D-M05, D-M06).
 *
 * SNAP08 (caller-mutation isolation) and SNAP10 (decoder-
 * level hash stability) live in subject-decode.test.ts where
 * they have access to decodeSubjectManifest.
 */

test("SNAP01: getter property -> rejected", () => {
  let n = 0;
  const cfg = { get temperature() { return n++; } } as Record<string, unknown>;
  const r = snapshotJsonValue(cfg);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /accessor property/);
});

test("SNAP02: setter property -> rejected", () => {
  const cfg = {} as Record<string, unknown>;
  Object.defineProperty(cfg, "x", {
    set(_v) { /* no-op */ },
    enumerable: true,
    configurable: true,
  });
  const r = snapshotJsonValue(cfg);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /accessor property/);
});

test("SNAP03: symbol own-key -> rejected", () => {
  const sym = Symbol("secret");
  const cfg = { normal: 1, [sym]: 2 } as Record<string | symbol, unknown>;
  const r = snapshotJsonValue(cfg);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /symbol own-key/);
});

test("SNAP04: non-enumerable own-key -> rejected", () => {
  const cfg = { visible: 1 } as Record<string, unknown>;
  Object.defineProperty(cfg, "hidden", {
    value: 2,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  const r = snapshotJsonValue(cfg);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-enumerable own-key/);
});

test("SNAP05: sparse array -> rejected", () => {
  const a: unknown[] = [];
  a[2] = "x";
  const r = snapshotJsonValue(a);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /sparse array hole/);
});

test("SNAP06: Proxy throws -> typed boundary_exception", () => {
  const hostile = new Proxy({}, {
    ownKeys() { throw new Error("boom"); },
  });
  const r = snapshotJsonValue(hostile);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /boundary_exception/);
});

test("SNAP07: shared DAG -> accepted; snapshot has independent storage", () => {
  const shared = { x: 1 };
  const input = { left: shared, right: shared };
  const r = snapshotJsonValue(input);
  assert.equal(r.ok, true);
  if (r.ok) {
    const out = r.value as { left: { x: number }; right: { x: number } };
    // Independent storage: mutating one branch must not
    // affect the other.
    (out.left as { x: number }).x = 99;
    assert.equal((out.right as { x: number }).x, 1);
    // The CALLER's input must not have been mutated either.
    assert.equal((shared as { x: number }).x, 1);
  }
});

test("SNAP09: source getter counter -> rejected, getter never executed", () => {
  let callCount = 0;
  const cfg = Object.create(Object.prototype);
  Object.defineProperty(cfg, "temperature", {
    get() {
      callCount++;
      return 0.5;
    },
    enumerable: true,
    configurable: true,
  });
  const r = snapshotJsonValue(cfg);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /accessor property/);
  assert.equal(callCount, 0, "getter must not be executed");
});

/*
 * JSON11-JSON13: hostile thrown value escapes.
 * The reviewer's P1: the catch in the snapshotter / decoder
 * must NOT inspect the caught value via `instanceof Error`
 * or `String(e)`. Both can themselves throw on a Proxy whose
 * getPrototypeOf / toString traps escape during
 * introspection.
 */

test("JSON11: Proxy trap throws hostile Proxy -> no throw", () => {
  // An attacker-controlled Proxy whose getPrototypeOf trap
  // throws. When the snapshotter's catch block tries to
  // inspect `e` (e.g. via `instanceof Error`), the
  // engine reads the prototype chain, which may itself
  // call into the hostile Proxy — recursive escape.
  const evilThrown = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("second-order boom");
    },
  });
  // Build a Proxy whose `ownKeys` trap throws the
  // hostile Proxy as the thrown value.
  const input = new Proxy({}, {
    ownKeys() {
      throw evilThrown;
    },
  });
  let threw = false;
  let r;
  try {
    r = snapshotJsonValue(input);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "snapshotJsonValue must NEVER throw");
  if (!threw && r !== undefined) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /boundary_exception/);
  }
});

test("JSON12: getter returns object with bad toString -> no throw", () => {
  // An attacker Proxy whose `get` trap returns an object
  // whose `toString()` throws. After Node normalizes the
  // descriptor (filling in value: undefined), our
  // snapshotter rejects it as `undefined is not a
  // JsonValue` — without ever calling toString on the
  // hostile returned object.
  const hostile = new Proxy({}, {
    ownKeys() {
      return ["prop"];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
    get() {
      // This return value's toString throws — but we never
      // reach it because the descriptor was normalized to
      // value:undefined, and the snapshotter rejects on
      // undefined before any stringification.
      return {
        toString() {
          throw new Error("boom-toString");
        },
      };
    },
  });
  let threw = false;
  try {
    const r = snapshotJsonValue(hostile);
    assert.equal(r.ok, false);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "snapshotJsonValue must NEVER throw");
});

test("JSON13: trap throws Proxy whose getPrototypeOf throws -> no throw", () => {
  // Three layers deep: a Proxy whose trap throws a Proxy
  // whose trap throws. The snapshotter's bare catch {}
  // discards the caught value entirely; there is no
  // recursion into the throw site.
  const inner = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("third-order boom");
    },
  });
  const mid = new Proxy({}, {
    getPrototypeOf() {
      throw inner;
    },
  });
  const input = new Proxy({}, {
    ownKeys() {
      throw mid;
    },
  });
  let threw = false;
  try {
    const r = snapshotJsonValue(input);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /boundary_exception/);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});
