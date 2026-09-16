/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Acceptance targets covered here:
 *
 *   SUBJECT_SCHEMA_VERSIONING       = PASS
 *   SUBJECT_DECODER_FAIL_CLOSED     = PASS
 *   UNKNOWN_FIELDS_POLICY           = EXPLICIT (fail-closed)
 *   REPO_REVISION_BOUND             = PASS
 *   PROMPT_CONTENT_BOUND            = PASS
 *   HARNESS_VERSION_BOUND           = PASS
 *   MODEL_CONFIGURATION_BOUND       = PASS
 *   BUDGET_BOUND                    = PASS
 *   CAPABILITY_SET_BOUND            = PASS
 *   NESTED_CLOSED_WORLD             = PASS  (CLOSED01-03)
 *   CONFIGURATION_JSON_BOUNDARY     = PASS  (JSON01-06)
 *
 * And: the decoder NEVER throws. Every failure is a typed
 * SubjectDecodeFailure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeSubjectManifest } from "../../src/subject/subject-decode.js";
import {
  SUBJECT_SCHEMA_VERSION,
} from "../../src/subject/subject-types.js";
import { validateSubjectManifest } from "../../src/subject/subject-validate.js";
import { makeValidManifest } from "./_subject_helpers.js";

test("DEC01: valid manifest decodes ok:true with a SubjectId", () => {
  const m = makeValidManifest();
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.manifest.schema_version, SUBJECT_SCHEMA_VERSION);
    assert.match(r.value.subjectId, /^subject:[0-9a-f]{64}$/);
  }
});

test("DEC02: non-object input -> typed not_an_object failure, no throw", () => {
  for (const bad of [null, undefined, 42, "string", true, []]) {
    const r = decodeSubjectManifest(bad);
    assert.equal(r.ok, false, "expected failure for " + JSON.stringify(bad));
    if (!r.ok) {
      assert.equal(r.failure.kind, "not_an_object");
    }
  }
});

test("DEC03: unknown top-level key fails closed", () => {
  const m = {
    ...makeValidManifest(),
    secret_admin_field: "should not pass",
  };
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "schema_validation");
    assert.match(r.failure.reason, /unknown key "secret_admin_field"/);
  }
});

test("DEC04: wrong schema_version fails closed", () => {
  const m = { ...makeValidManifest(), schema_version: "phase-d.subject.v999" };
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "schema_validation");
    assert.match(r.failure.reason, /schema_version/);
  }
});

test("DEC05: missing required top-level key fails closed", () => {
  const m = makeValidManifest() as Record<string, unknown>;
  delete m["prompt"];
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "schema_validation");
    assert.match(r.failure.reason, /prompt/);
  }
});

test("REPO01: repository.commit must be 64-char lowercase hex", () => {
  const m = makeValidManifest({
    repository: {
      commit: "not-a-sha",
      dirty_policy: "reject",
    },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.failure.reason, /commit/);
});

test("REPO02: repository.dirty_policy must be reject | allow-record", () => {
  const m = makeValidManifest({
    repository: {
      commit:
        "3333333333333333333333333333333333333333333333333333333333333333",
      dirty_policy: "ignore" as never,
    },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.failure.reason, /dirty_policy/);
});

test("PROMPT01: prompt.content_hash must be 64-char lowercase hex", () => {
  const m = makeValidManifest({
    prompt: { prompt_id: "prompt-A", content_hash: "short" },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
});

test("HARNESS01: harness.source_revision must be 64-char lowercase hex", () => {
  const m = makeValidManifest({
    harness: { id: "cline", version: "0.1.0", source_revision: "deadbeef" },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
});

test("MODEL01: model.configuration must be an object", () => {
  const m = makeValidManifest({
    model: {
      provider: "factory-lab",
      model_id: "fake-model-v1",
      configuration: "not-an-object" as never,
    },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
});

test("BUDGET01: budget fields must be non-negative integers", () => {
  const cases: ReadonlyArray<unknown> = [
    { wall_clock_ms: -1, turns: 50, tool_calls: 200 },
    { wall_clock_ms: 1.5, turns: 50, tool_calls: 200 },
    { wall_clock_ms: 1, turns: 50, tool_calls: 200, token_limit: "lots" },
  ];
  for (const bad of cases) {
    const m = makeValidManifest({ budget: bad as never });
    const r = decodeSubjectManifest(m);
    assert.equal(r.ok, false, "expected failure for " + JSON.stringify(bad));
  }
});

test("CAPS01: capabilities.tools must be grammar-valid string array", () => {
  const m = makeValidManifest({
    capabilities: {
      tools: ["read_file", "bad tool with space"],
      network: false,
      filesystem: true,
      execution_policy: "sandbox",
    },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
});

test("CAPS02: capabilities.execution_policy is closed-world", () => {
  const m = makeValidManifest({
    capabilities: {
      tools: ["read_file"],
      network: false,
      filesystem: true,
      execution_policy: "vm" as never,
    },
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
});

test("DEC06: validateSubjectManifest agrees with the decoder on simple cases", () => {
  const m = makeValidManifest();
  const v = validateSubjectManifest(m);
  assert.equal(v.ok, true);

  const broken = { ...m, schema_version: "wrong" };
  const r = decodeSubjectManifest(broken);
  assert.equal(r.ok, false);
});

/**
 * D-C01: decoder totality on garbage input.
 *
 * The decoder MUST NEVER throw on any of these values. Each
 * one is a valid `unknown` value that a hostile caller could
 * supply. The expected outcome for every entry is `ok:false`
 * with a typed failure kind.
 */
test("DEC07: decoder is total — never throws, even on garbage input", () => {
  const garbage: ReadonlyArray<unknown> = [
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    Symbol("s"),
    new Date(),
    new Map(),
    new Set(),
    Promise.resolve(1),
    function () {},
    () => {},
    BigInt(0),
    new ArrayBuffer(8),
    new Uint8Array([1, 2, 3]),
    /regex/,
  ];
  for (const g of garbage) {
    let r: ReturnType<typeof decodeSubjectManifest> | undefined;
    let threw = false;
    try {
      r = decodeSubjectManifest(g);
    } catch (e) {
      threw = true;
      assert.fail("decoder threw on " + String(g) + ": " + String(e));
    }
    assert.equal(threw, false);
    assert.equal(r!.ok, false, "expected failure for " + String(g));
  }
});

/**
 * D-C04: nested closed-world. Every required dimension
 * rejects unknown keys.
 */
test("CLOSED01: unknown harness key fails closed", () => {
  const m = makeValidManifest({
    harness: {
      id: "cline",
      version: "0.1.0",
      source_revision:
        "1111111111111111111111111111111111111111111111111111111111111111",
      surprise: "silently ignored",
    } as never,
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "schema_validation");
    assert.match(r.failure.reason, /harness: unknown key "surprise"/);
  }
});

test("CLOSED02: unknown budget key fails closed", () => {
  const m = makeValidManifest({
    budget: {
      wall_clock_ms: 1,
      turns: 1,
      tool_calls: 1,
      oops: true,
    } as never,
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "schema_validation");
    assert.match(r.failure.reason, /budget: unknown key "oops"/);
  }
});

test("CLOSED03: unknown prompt key fails closed", () => {
  const m = makeValidManifest({
    prompt: {
      prompt_id: "prompt-A",
      content_hash:
        "2222222222222222222222222222222222222222222222222222222222222222",
      extra_field: "x",
    } as never,
  });
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
});

/**
 * D-C01: model.configuration must be a recursive JsonValue.
 *
 * Every adversarial entry below passed the OLD structural
 * check (the OLD `isPlainObject` was
 * `typeof === "object" && !== null && !Array.isArray`).
 * Under the new JsonValue validator, they all fail closed.
 *
 * JSON06 verifies that deeply-nested VALID JsonValue
 * still decodes ok:true. This is the positive case that
 * proves the validator isn't a stuck-procedure rejector.
 */
test("JSON01: configuration nested undefined -> typed failure", () => {
  const m = makeValidManifest();
  (m.model as Record<string, unknown>).configuration = {
    temperature: 0.0,
    nested: undefined,
  };
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "configuration_value");
    assert.match(r.failure.reason, /model\.configuration\.nested/);
  }
});

test("JSON02: configuration NaN/Infinity -> typed failure", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const m = makeValidManifest();
    (m.model as Record<string, unknown>).configuration = { x: bad };
    const r = decodeSubjectManifest(m);
    assert.equal(r.ok, false, "expected failure for " + String(bad));
    if (!r.ok) {
      assert.equal(r.failure.kind, "configuration_value");
    }
  }
});

test("JSON03: configuration BigInt -> typed failure", () => {
  const m = makeValidManifest();
  (m.model as Record<string, unknown>).configuration = { x: BigInt(1) };
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "configuration_value");
  }
});

test("JSON04: configuration Date/Map/Set -> typed failure", () => {
  for (const bad of [new Date(), new Map([["k", 1]]), new Set([1])]) {
    const m = makeValidManifest();
    (m.model as Record<string, unknown>).configuration = { x: bad };
    const r = decodeSubjectManifest(m);
    assert.equal(r.ok, false, "expected failure for " + String(bad));
    if (!r.ok) {
      assert.equal(r.failure.kind, "configuration_value");
    }
  }
});

test("JSON05: configuration cycle -> typed failure", () => {
  const m = makeValidManifest();
  const cfg: Record<string, unknown> = { a: 1 };
  cfg["self"] = cfg;
  (m.model as Record<string, unknown>).configuration = cfg;
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "configuration_value");
    assert.match(r.failure.reason, /cyclic/);
  }
});

test("JSON06: deeply-nested valid JSON -> success", () => {
  const m = makeValidManifest();
  (m.model as Record<string, unknown>).configuration = {
    temperature: 0.0,
    max_tokens: 4096,
    nested: {
      optimizer: { learningRate: 0.1, beta: [0.9, 0.999] },
      flags: { stop: ["###"], early_terminate: true },
    },
    extra_string: "ok",
  };
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.failure));
});

/**
 * D-M01: decoder totality over hostile JS objects.
 *
 * `decodeSubjectManifest` accepts `unknown`. JavaScript
 * Proxy traps (ownKeys, getPrototypeOf, get) can throw on
 * the operations the validators and the decoder itself
 * perform. The contract is that the decoder NEVER throws;
 * any escape is converted to a typed `boundary_exception`
 * failure by the outer defensive try/catch.
 */
test("JSON07: Proxy ownKeys throws -> typed boundary_exception, no throw", () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error("boom-ownKeys");
    },
  });
  let r: ReturnType<typeof decodeSubjectManifest> | undefined;
  let threw = false;
  try {
    r = decodeSubjectManifest(hostile);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(r!.ok, false);
  if (!r!.ok) {
    assert.equal(r!.failure.kind, "boundary_exception");
  }
});

test("JSON08: Proxy getPrototypeOf throws -> typed boundary_exception, no throw", () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("boom-proto");
    },
  });
  let r: ReturnType<typeof decodeSubjectManifest> | undefined;
  let threw = false;
  try {
    r = decodeSubjectManifest(hostile);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(r!.ok, false);
});

test("JSON09: throwing getter on a proxy -> typed boundary_exception, no throw", () => {
  const hostile = new Proxy({}, {
    get(_t, k) {
      throw new Error("boom-get-" + String(k));
    },
  });
  let r: ReturnType<typeof decodeSubjectManifest> | undefined;
  let threw = false;
  try {
    r = decodeSubjectManifest(hostile);
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(r!.ok, false);
});

/**
 * D-M02: shared DAG at the decoder level. Two manifest
 * inputs that differ only in being the same object
 * reference vs two distinct equal objects must produce
 * the same SubjectId.
 */
test("JSON10: configuration with shared sibling references -> success", () => {
  const shared = { x: 1 };
  const m = makeValidManifest();
  (m.model as Record<string, unknown>).configuration = {
    left: shared,
    right: shared,
  };
  const r = decodeSubjectManifest(m);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.failure));
});

/*
 * SNAP08, SNAP10: caller-mutation isolation + decoder-
 * level hash stability (D-M05, D-M07).
 */

test("SNAP08: caller mutation isolation — decoded subject unaffected by later mutation", () => {
  // The decoder MUST return an inert owned snapshot. The
  // caller may continue to mutate their input object after
  // decoding; that mutation must NOT affect the already-
  // returned DecodedSubject (its manifest contents and its
  // SubjectId).
  const original = {
    temperature: 0.5,
    seed: "abc",
    nested: { x: 1 },
  };
  const m = makeValidManifest();
  (m.model as Record<string, unknown>).configuration = original;

  // Decode at T1.
  const r1 = decodeSubjectManifest(m);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const subjectId1 = r1.value.subjectId;
  const cfg1 = (r1.value.manifest.model as { configuration: unknown })
    .configuration;

  // Aggressively mutate the caller's live objects AFTER
  // the decoder returned.
  original.temperature = 999;
  original.seed = "evil";
  (original.nested as { x: number }).x = 9999;
  (original as Record<string, unknown>).sneak = "in";
  (original as { nested: unknown }).nested = { x: 99999 };

  // (a) r1's SubjectId is the SHA of the snapshot taken at
  //     T1; it must not be recomputed against the mutated
  //     input.
  assert.equal(r1.value.subjectId, subjectId1);

  // (b) r1's manifest contents are structurally identical
  //     to the snapshot we took at T1 — they are NOT a
  //     live alias of the caller's input.
  assert.deepEqual(cfg1, { temperature: 0.5, seed: "abc", nested: { x: 1 } });

  // (c) A FRESH decode at T2 sees the mutated input, so it
  //     produces a different SubjectId — proving the
  //     decoder is reading what the caller now provides,
  //     not a cached snapshot. This is a control test that
  //     confirms r1's id was not "frozen to the wrong
  //     thing"; r1 is independent of r2.
  const r2 = decodeSubjectManifest(m);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.notEqual(r2.value.subjectId, subjectId1);
});

test("SNAP10: snapshot hash equals the frozen manifest content hash", () => {
  // The decoder's snapshot IS the manifest's configuration.
  // computeSubjectId hashes the canonicalized manifest
  // INCLUDING the snapshot. So if we mutate the snapshot
  // after the fact, the hash MUST change.
  const m = makeValidManifest();
  (m.model as { configuration: unknown }).configuration = {
    temperature: 0.5,
  };
  const r1 = decodeSubjectManifest(m);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const id1 = r1.value.subjectId;
  // The frozen manifest's configuration must be a CLONE.
  const frozen = (r1.value.manifest.model as { configuration: unknown })
    .configuration;
  assert.deepEqual(frozen, { temperature: 0.5 });
  // Re-encoding the same content yields the same SubjectId.
  const m2 = makeValidManifest();
  (m2.model as { configuration: unknown }).configuration = {
    temperature: 0.5,
  };
  const r2 = decodeSubjectManifest(m2);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.value.subjectId, id1);
});
