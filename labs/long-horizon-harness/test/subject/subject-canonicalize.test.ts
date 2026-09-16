/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Acceptance targets covered here:
 *
 *   CANONICAL_HASH_DETERMINISTIC   = PASS
 *   REPLAY_SAME_MANIFEST_SAME_ID   = PASS
 *   ONE_FIELD_CHANGE_DIFFERENT_ID  = PASS
 *   SUBJECT_ID_CONTENT_BOUND       = PASS
 *   DOMAIN_TAG_SEPARATION          = PASS
 *
 * Plus the foundation property that key insertion order does
 * not affect the canonical bytes (which is what makes
 * REPLAY_SAME_MANIFEST_SAME_ID work in the presence of
 * structurally-equivalent-but-differently-constructed
 * manifests).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  SUBJECT_ID_V1_TAG,
  canonicalize,
} from "../../src/subject/subject-canonicalize.js";
import { computeSubjectId } from "../../src/subject/subject-id.js";
import { SUBJECT_ID_GRAMMAR } from "../../src/subject/subject-types.js";
import { makeValidManifest } from "./_subject_helpers.js";

test("CANON01: canonicalize is deterministic for the same value", () => {
  const v = { b: 2, a: 1, nested: { y: "y", x: "x" } };
  const c1 = canonicalize(v);
  const c2 = canonicalize(v);
  assert.equal(c1, c2);
});

test("CANON02: canonicalize sorts object keys lexically", () => {
  // Construct two objects with the same logical content but
  // different key insertion orders. They MUST canonicalize
  // to identical bytes.
  const a = { beta: 1, alpha: 2 };
  const b = { alpha: 2, beta: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
});

test("CANON03: canonicalize handles nested objects and arrays", () => {
  const a = {
    arr: [1, { y: 2, x: 1 }, "z"],
    nested: { b: 1, a: 2 },
  };
  const b = {
    nested: { a: 2, b: 1 },
    arr: [1, { x: 1, y: 2 }, "z"],
  };
  assert.equal(canonicalize(a), canonicalize(b));
});

test("CANON04: canonicalize distinguishes primitive types", () => {
  assert.notEqual(canonicalize(1), canonicalize("1"));
  assert.notEqual(canonicalize(true), canonicalize("true"));
  assert.notEqual(canonicalize(null), canonicalize({}));
});

test("SID01: SubjectId matches SUBJECT_ID_GRAMMAR and length <= 72", () => {
  const m = makeValidManifest();
  const id = computeSubjectId(m);
  assert.match(id, SUBJECT_ID_GRAMMAR);
  assert.ok(id.length <= 72, `SubjectId too long: ${id.length}`);
});

test("SID02: same manifest yields the same SubjectId (replay)", () => {
  const m1 = makeValidManifest();
  const m2 = makeValidManifest();
  assert.equal(computeSubjectId(m1), computeSubjectId(m2));
});

test("SID03: one-field change -> different SubjectId (content-bound)", () => {
  const baseline = computeSubjectId(makeValidManifest());

  // change experiment_id
  const a = makeValidManifest({
    experiment_id: "exp-002" as never,
  });
  assert.notEqual(computeSubjectId(a), baseline);

  // change harness.id
  const b = makeValidManifest({
    harness: {
      id: "qwen-code",
      version: "0.1.0",
      source_revision:
        "1111111111111111111111111111111111111111111111111111111111111111",
    },
  });
  assert.notEqual(computeSubjectId(b), baseline);

  // change model_id
  const c = makeValidManifest({
    model: {
      provider: "factory-lab",
      model_id: "fake-model-v2",
      configuration: {},
    },
  });
  assert.notEqual(computeSubjectId(c), baseline);

  // change prompt.content_hash
  const d = makeValidManifest({
    prompt: {
      prompt_id: "prompt-A",
      content_hash:
        "4444444444444444444444444444444444444444444444444444444444444444",
    },
  });
  assert.notEqual(computeSubjectId(d), baseline);

  // change repository.commit
  const e = makeValidManifest({
    repository: {
      commit:
        "5555555555555555555555555555555555555555555555555555555555555555",
      dirty_policy: "reject",
    },
  });
  assert.notEqual(computeSubjectId(e), baseline);

  // change budget.wall_clock_ms
  const f = makeValidManifest({
    budget: { wall_clock_ms: 1_000_000, turns: 50, tool_calls: 200 },
  });
  assert.notEqual(computeSubjectId(f), baseline);

  // change capabilities.execution_policy
  const g = makeValidManifest({
    capabilities: {
      tools: ["read_file", "write_file", "bash"],
      network: false,
      filesystem: true,
      execution_policy: "container",
    },
  });
  assert.notEqual(computeSubjectId(g), baseline);

  // change repetition_index
  const h = makeValidManifest({
    repetition: { repetition_index: 7, seed: "seed-A" },
  });
  assert.notEqual(computeSubjectId(h), baseline);

  // change model.configuration.temperature
  const i = makeValidManifest({
    model: {
      provider: "factory-lab",
      model_id: "fake-model-v1",
      configuration: { temperature: 0.7, max_tokens: 4096 },
    },
  });
  assert.notEqual(computeSubjectId(i), baseline);
});

/**
 * D-C05: real domain-separation oracle.
 *
 * Computes the expected SHA-256 over (tag || NUL || canonical)
 * directly with node:crypto and asserts:
 *
 *   1. computeSubjectId(manifest) equals "subject:" + that hex.
 *   2. A wrong domain tag would produce a DIFFERENT hex.
 *
 * This replaces the earlier false-green `slice(0, 0)` smoke.
 */
test("HASH01: computeSubjectId matches the canonical SHA-256 construction", () => {
  const m = makeValidManifest();
  const canonical = canonicalize(m);

  const expectedHex = createHash("sha256")
    .update(SUBJECT_ID_V1_TAG + "\u0000", "utf8")
    .update(canonical, "utf8")
    .digest("hex");

  assert.equal(computeSubjectId(m), "subject:" + expectedHex);
});

test("HASH02: a wrong domain tag would yield a different digest", () => {
  const m = makeValidManifest();
  const canonical = canonicalize(m);

  const wrongTagHex = createHash("sha256")
    .update("factory:wrong-domain" + "\u0000", "utf8")
    .update(canonical, "utf8")
    .digest("hex");

  const goodHex = createHash("sha256")
    .update(SUBJECT_ID_V1_TAG + "\u0000", "utf8")
    .update(canonical, "utf8")
    .digest("hex");

  assert.notEqual(wrongTagHex, goodHex);
  assert.equal(computeSubjectId(m), "subject:" + goodHex);
});

test("SID05: SubjectId tag is the literal v1 tag", () => {
  // Pin the tag value to keep the domain-separation
  // discipline honest. If anyone bumps the tag, every
  // persisted SubjectId is invalidated.
  assert.equal(SUBJECT_ID_V1_TAG, "factory:phase-d:subject:id:v1");
});
