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
import { decodeSubjectManifest } from "../../src/subject/subject-decode.js";

/**
 * Build a structurally valid SubjectManifest whose
 * model.configuration is exactly the given object. Used by
 * SNAP18 to compare SubjectIds across configurations that
 * differ ONLY in their __proto__ key.
 */
function makeConfigurationLikeForDecode(
  configuration: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema_version: "phase-d.subject.v1",
    experiment_id: "exp-001",
    subject_id_hint: "subj-hint-001",
    harness: {
      id: "cline",
      version: "0.1.0",
      source_revision:
        "1111111111111111111111111111111111111111111111111111111111111111",
    },
    model: {
      provider: "factory-lab",
      model_id: "fake-model-v1",
      configuration,
    },
    prompt: {
      prompt_id: "prompt-A",
      content_hash:
        "2222222222222222222222222222222222222222222222222222222222222222",
    },
    task: {
      task_id: "task-001",
      fixture_revision: "fixture-rev-001",
    },
    repository: {
      commit:
        "3333333333333333333333333333333333333333333333333333333333333333",
      dirty_policy: "reject",
    },
    budget: {
      wall_clock_ms: 600_000,
      turns: 50,
      tool_calls: 200,
      token_limit: 1_000_000,
    },
    capabilities: {
      tools: ["read_file", "write_file", "bash"],
      network: false,
      filesystem: true,
      execution_policy: "sandbox",
    },
    repetition: {
      repetition_index: 0,
      seed: "seed-A",
    },
  };
}

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
  if (!r.ok) assert.match(r.reason, /captured indices but declared length/);
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
    // Independent storage: the snapshot is frozen (no
    // post-decode mutation is possible at all), AND the
    // two branches are independent objects (mutating one
    // never affects the other).
    assert.equal(Object.isFrozen(out.left), true);
    assert.equal(Object.isFrozen(out.right), true);
    assert.notEqual(out.left, out.right);
    // The CALLER's input must not have been mutated either.
    assert.equal((shared as { x: number }).x, 1);
    // Attempting to mutate the snapshot must throw in
    // strict mode (TypeError on a frozen object).
    assert.throws(
      () => { (out.left as { x: number }).x = 99; },
      TypeError,
    );
    // The right branch is unchanged (was never written).
    assert.equal((out.right as { x: number }).x, 1);
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

/*
 * SNAP11-SNAP15: array shape closed-world (D-M09).
 * The snapshotter must reject every "extra" own-key on an
 * array, including symbol keys, accessor descriptors on
 * indices, and non-enumerable indices. SNAP15 is a control:
 * an ordinary dense array of primitives passes.
 */

test("SNAP11: array extra string property -> rejected", () => {
  const a: unknown[] = [1, 2];
  (a as unknown as Record<string, unknown>).extra = 42;
  const r = snapshotJsonValue(a);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(
      r.reason,
      /array own-key "extra" is not a permitted index or "length"/,
    );
  }
});

test("SNAP12: array symbol own-key -> rejected", () => {
  const a: unknown[] = [1];
  (a as unknown as Record<symbol, unknown>)[Symbol("secret")] = 42;
  const r = snapshotJsonValue(a);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /array symbol own-key/);
});

test("SNAP13: array accessor index -> rejected, getter never invoked", () => {
  let n = 0;
  const a: unknown[] = [];
  Object.defineProperty(a, "0", {
    enumerable: true,
    configurable: true,
    get() {
      n++;
      return 99;
    },
  });
  a.length = 1;
  const r = snapshotJsonValue(a);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /array accessor element/);
  assert.equal(n, 0, "getter must not have been invoked");
});

test("SNAP14: array non-enumerable index -> rejected", () => {
  const a: unknown[] = [];
  Object.defineProperty(a, "0", {
    value: "x",
    enumerable: false,
    writable: true,
    configurable: true,
  });
  a.length = 1;
  const r = snapshotJsonValue(a);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-enumerable array element/);
});

test("SNAP15: ordinary dense array -> accepted", () => {
  const r = snapshotJsonValue([1, 2, "three", null, true, { x: 1 }]);
  assert.equal(r.ok, true);
  if (r.ok) {
    // The snapshot array is frozen and contains the
    // expected elements in order.
    assert.equal(Object.isFrozen(r.value), true);
    // Element [5] is a snapshot record (null prototype);
    // compare via key/value rather than deepEqual.
    const arr = r.value as ReadonlyArray<unknown>;
    assert.equal(arr.length, 6);
    assert.equal(arr[0], 1);
    assert.equal(arr[1], 2);
    assert.equal(arr[2], "three");
    assert.equal(arr[3], null);
    assert.equal(arr[4], true);
    const rec = arr[5] as Record<string, unknown>;
    assert.equal(rec.x, 1);
    assert.equal(Object.getPrototypeOf(rec), null);
  }
});

/*
 * SNAP16-SNAP18: __proto__ is preserved as DATA on a
 * null-prototype record (D-M10). The reviewer's
 * identity-oracle: a configuration with an own __proto__
 * key has a DIFFERENT SubjectId from the same content
 * without that key.
 */

test("SNAP16: own __proto__ key preserved in snapshot", () => {
  const input = JSON.parse('{"__proto__":{"admin":true},"normal":1}');
  const r = snapshotJsonValue(input);
  assert.equal(r.ok, true);
  if (r.ok) {
    const out = r.value as Record<string, unknown>;
    // The captured __proto__ MUST be an own data
    // property of the snapshot, not a prototype mutation.
    assert.equal(
      Object.prototype.hasOwnProperty.call(out, "__proto__"),
      true,
      "__proto__ must be an own data property of the snapshot",
    );
    // Its value is the cloned admin record.
    const protoVal = out.__proto__ as Record<string, unknown>;
    assert.equal(protoVal.admin, true);
  }
});

test("SNAP17: snapshot record prototype is null", () => {
  const r = snapshotJsonValue({ a: 1 });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(Object.getPrototypeOf(r.value), null);
  }
});

/*
 * SNAP19-SNAP23: Proxy TOCTOU hardening for array snapshot
 * (D-M09 MICROFIX04). The previous implementation had three
 * windows in which a legal Proxy could:
 *   - report virtual indices before "length" and have them
 *     silently dropped from the rebuild
 *   - return different compatible descriptors on the second
 *     descriptor read
 *   - be touched via `get` traps for "length" or src[i]
 *
 * Each test below targets one of those windows directly.
 */

test("SNAP19: Proxy virtual index reported before length -> rejected", () => {
  // Target: a real length-1 Array. Proxy reports virtual "1"
  // BEFORE "length" in ownKeys, so a hostile Proxy can attempt
  // to slip a virtual index into the rebuild. The hardened
  // implementation MUST capture length FIRST, then see that
  // declaredLen=1 means index "1" is out of range, and reject.
  const target: unknown[] = [42];
  const proxy = new Proxy(target, {
    ownKeys() {
      return ["0", "1", "length"];
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop === "length") {
        // Must match the underlying target's descriptor
        // (Array.length is non-configurable).
        return {
          value: 1,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      if (prop === "0") {
        return {
          value: 42,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      if (prop === "1") {
        // Virtual index: not in the underlying target.
        return {
          value: 999,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  });
  assert.equal(Array.isArray(proxy), true);
  const r = snapshotJsonValue(proxy);
  assert.equal(r.ok, false, "proxy with virtual out-of-range index must be rejected");
  if (!r.ok) {
    assert.ok(
      r.reason.includes("beyond declared length"),
      `reason should mention beyond declared length, got: ${r.reason}`,
    );
  }
});

test("SNAP20: ownKeys ordering is irrelevant", () => {
  // Permutations of ["length","0"] vs ["0","length"] must
  // produce identical accepted snapshots of a one-element
  // array. The hardened implementation captures length FIRST
  // and is therefore order-independent.
  const makeProxy = (keys: (string | symbol)[]) =>
    new Proxy([7], {
      ownKeys() {
        return keys;
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (prop === "length") {
          // Match underlying target's non-configurable length.
          return {
            value: 1,
            writable: true,
            enumerable: false,
            configurable: false,
          };
        }
        if (prop === "0") {
          return {
            value: 7,
            writable: true,
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      },
    });

  const r1 = snapshotJsonValue(makeProxy(["length", "0"]));
  const r2 = snapshotJsonValue(makeProxy(["0", "length"]));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.deepEqual(Array.from(r1.value as ReadonlyArray<unknown>), [7]);
    assert.deepEqual(Array.from(r2.value as ReadonlyArray<unknown>), [7]);
  }
});

test("SNAP18: __proto__ content contributes to SubjectId", () => {
  // Identity oracle: an attacker-controlled __proto__ key
  // changes the SubjectId. If the snapshotter silently
  // dropped __proto__ or mutated the prototype instead,
  // the two configurations would hash identically.
  //
  // We use Object.defineProperty to install __proto__ as
  // an OWN data property; direct assignment via
  // `config.__proto__ = ...` would invoke the inherited
  // setter (mutating the prototype) rather than creating
  // an own property — exactly the attack we are guarding
  // against.
  function makeWithProto(): Record<string, unknown> {
    const cfg: Record<string, unknown> = { normal: 1 };
    Object.defineProperty(cfg, "__proto__", {
      value: { admin: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return cfg;
  }
  const withProto = makeConfigurationLikeForDecode(makeWithProto());
  const withoutProto = makeConfigurationLikeForDecode({ normal: 1 });
  // Sanity: withProto's __proto__ is an own data property.
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      (withProto.model as Record<string, unknown>).configuration,
      "__proto__",
    ),
    true,
  );
  const r1 = decodeSubjectManifest(withProto);
  const r2 = decodeSubjectManifest(withoutProto);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.notEqual(
      r1.value.subjectId,
      r2.value.subjectId,
      "__proto__ must contribute to the SubjectId",
    );
  }
});

test("SNAP21: index descriptor is observed exactly once", () => {
  // The hardened implementation MUST call
  // getOwnPropertyDescriptor(src, "0") EXACTLY once during
  // a successful snapshot. If the implementation called it
  // twice, a hostile Proxy could legally return a different
  // compatible descriptor on the second call and corrupt
  // identity.
  let descCallsFor0 = 0;
  const proxy = new Proxy([11], {
    ownKeys() {
      return ["0", "length"];
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop === "0") {
        descCallsFor0 += 1;
        return {
          value: 11,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      if (prop === "length") {
        return {
          value: 1,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      return undefined;
    },
  });
  const r = snapshotJsonValue(proxy);
  assert.equal(r.ok, true);
  assert.equal(descCallsFor0, 1, "index descriptor must be observed exactly once");
});

test("SNAP22: descriptor drift cannot bypass enumerability policy", () => {
  // The first descriptor is enumerable. A hypothetical second
  // call would have returned non-enumerable. The hardened
  // implementation MUST NOT make the second call. Therefore:
  //   - call count for "0" === 1
  //   - captured value === 11 (not 999)
  let descCallsFor0 = 0;
  const proxy = new Proxy([11], {
    ownKeys() {
      return ["0", "length"];
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop === "0") {
        descCallsFor0 += 1;
        // First call: legitimate enumerable data descriptor.
        // The hardened implementation must STOP here.
        return {
          value: 11,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      if (prop === "length") {
        return {
          value: 1,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      return undefined;
    },
  });
  const r = snapshotJsonValue(proxy);
  assert.equal(r.ok, true);
  assert.equal(descCallsFor0, 1, "no second descriptor observation is allowed");
  if (r.ok) {
    assert.deepEqual(Array.from(r.value as ReadonlyArray<unknown>), [11]);
  }
});

test("SNAP23: snapshot does not invoke get traps for length or indices", () => {
  // A successful snapshot MUST NOT trigger any `get` traps
  // for "length" or numeric indices. The hardened
  // implementation captures `length` via
  // getOwnPropertyDescriptor and never reads src.length or
  // src[i] directly.
  let getCallsForLength = 0;
  let getCallsForIndex = 0;
  const proxy = new Proxy([5], {
    get(_t, prop) {
      if (prop === "length") getCallsForLength += 1;
      if (prop === "0") getCallsForIndex += 1;
      return undefined;
    },
    ownKeys() {
      return ["0", "length"];
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop === "length") {
        return {
          value: 1,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      if (prop === "0") {
        return {
          value: 5,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  });
  const r = snapshotJsonValue(proxy);
  assert.equal(r.ok, true);
  assert.equal(
    getCallsForLength,
    0,
    "snapshot must not invoke get trap for 'length'",
  );
  assert.equal(
    getCallsForIndex,
    0,
    "snapshot must not invoke get trap for index 0",
  );
});
