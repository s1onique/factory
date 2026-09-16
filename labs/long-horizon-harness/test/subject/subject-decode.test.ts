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
 *
 * And: the decoder NEVER throws. Every failure is a typed
 * SubjectDecodeFailure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeSubjectManifest } from "../../src/subject/subject-decode.js";
import {
  SUBJECT_SCHEMA_VERSION,
  validateSubjectManifest,
} from "../../src/subject/subject-types.js";

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
    assert.match(r.failure.reason, /unknown top-level key/);
    assert.match(r.failure.reason, /secret_admin_field/);
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
      commit: "3333333333333333333333333333333333333333333333333333333333333333",
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

});


test("DEC06: validateSubjectManifest agrees with the decoder on simple cases", () => {
  const m = makeValidManifest();
  const v = validateSubjectManifest(m);
  assert.equal(v.ok, true);

  const broken = { ...m, schema_version: "wrong" };
  const r = decodeSubjectManifest(broken);
  assert.equal(r.ok, false);
});

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

import { makeValidManifest } from "./_subject_helpers.js";
