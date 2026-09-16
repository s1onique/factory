/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Acceptance targets covered here:
 *
 *   MUTATION_AFTER_CREATION         = REJECTED (TypeError)
 *   DEEP_IMMUTABILITY               = PASS  (FRZ11-12)
 *   MANIFEST_ID_BINDING             = PASS  (BIND01)
 *
 * Doctrine (D-C07): mutation is rejected by JavaScript's
 * runtime freeze semantics (TypeError in strict mode). There
 * is NO custom typed-error class — see subject-frozen.ts
 * for the rationale.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeSubjectManifest } from "../../src/subject/subject-decode.js";
import {
  freezeSubject,
  type FrozenSubject,
} from "../../src/subject/subject-frozen.js";
import { makeValidManifest } from "./_subject_helpers.js";

function freeze(): FrozenSubject {
  const r = decodeSubjectManifest(makeValidManifest());
  if (!r.ok) {
    throw new Error("setup failure: decode should succeed");
  }
  const f = freezeSubject(r.value);
  if (!f.ok) {
    throw new Error("setup failure: freeze should succeed: " +
      JSON.stringify(f.failure));
  }
  return f.value;
}

test("FRZ01: wrapper itself is frozen (Object.isFrozen)", () => {
  const f = freeze();
  assert.equal(Object.isFrozen(f), true);
});

test("FRZ02: manifest root is frozen", () => {
  const f = freeze();
  assert.equal(Object.isFrozen(f.manifest), true);
});

test("FRZ03: nested objects/arrays are frozen", () => {
  const f = freeze();
  assert.equal(Object.isFrozen(f.manifest.harness), true);
  assert.equal(Object.isFrozen(f.manifest.model), true);
  assert.equal(Object.isFrozen(f.manifest.model.configuration), true);
  assert.equal(Object.isFrozen(f.manifest.capabilities), true);
  assert.equal(Object.isFrozen(f.manifest.capabilities.tools), true);
});

test("FRZ04: assigning a top-level property throws in strict mode", () => {
  const f = freeze();
  assert.throws(
    () => {
      (f.manifest as unknown as Record<string, unknown>)["experiment_id"] =
        "exp-999";
    },
    TypeError,
  );
});

test("FRZ05: defining a new top-level property throws in strict mode", () => {
  const f = freeze();
  assert.throws(
    () => {
      Object.defineProperty(f.manifest, "sneaky", {
        value: 1,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    TypeError,
  );
});

test("FRZ06: deleting a property throws in strict mode", () => {
  const f = freeze();
  assert.throws(
    () => {
      delete (f.manifest as unknown as Record<string, unknown>)["harness"];
    },
    TypeError,
  );
});

test("FRZ07: mutating a nested object is rejected", () => {
  const f = freeze();
  assert.throws(
    () => {
      (f.manifest.harness as unknown as Record<string, unknown>)["id"] =
        "tampered";
    },
    TypeError,
  );
});

test("FRZ08: mutating a frozen array is rejected", () => {
  const f = freeze();
  assert.throws(
    () => {
      (f.manifest.capabilities.tools as unknown as Array<string>).push(
        "evil_tool",
      );
    },
    TypeError,
  );
});

test("FRZ10: dimensions are preserved exactly across reads", () => {
  const f = freeze();
  const m = makeValidManifest();
  assert.equal(f.manifest.experiment_id, m.experiment_id);
  assert.equal(f.manifest.subject_id_hint, m.subject_id_hint);
  assert.equal(f.manifest.harness.id, m.harness.id);
  assert.equal(f.manifest.harness.version, m.harness.version);
  assert.equal(
    f.manifest.harness.source_revision,
    m.harness.source_revision,
  );
  assert.equal(f.manifest.model.provider, m.model.provider);
  assert.equal(f.manifest.model.model_id, m.model.model_id);
  assert.deepEqual(
    f.manifest.model.configuration,
    m.model.configuration,
  );
  assert.equal(f.manifest.prompt.prompt_id, m.prompt.prompt_id);
  assert.equal(
    f.manifest.prompt.content_hash,
    m.prompt.content_hash,
  );
  assert.equal(f.manifest.task.task_id, m.task.task_id);
  assert.equal(
    f.manifest.task.fixture_revision,
    m.task.fixture_revision,
  );
  assert.equal(f.manifest.repository.commit, m.repository.commit);
  assert.equal(
    f.manifest.repository.dirty_policy,
    m.repository.dirty_policy,
  );
  assert.equal(
    f.manifest.budget.wall_clock_ms,
    m.budget.wall_clock_ms,
  );
  assert.equal(f.manifest.budget.turns, m.budget.turns);
  assert.equal(f.manifest.budget.tool_calls, m.budget.tool_calls);
  assert.equal(f.manifest.budget.token_limit, m.budget.token_limit);
  assert.deepEqual(f.manifest.capabilities.tools, m.capabilities.tools);
  assert.equal(
    f.manifest.capabilities.network,
    m.capabilities.network,
  );
  assert.equal(
    f.manifest.capabilities.filesystem,
    m.capabilities.filesystem,
  );
  assert.equal(
    f.manifest.capabilities.execution_policy,
    m.capabilities.execution_policy,
  );
  assert.equal(
    f.manifest.repetition.repetition_index,
    m.repetition.repetition_index,
  );
  assert.equal(f.manifest.repetition.seed, m.repetition.seed);
});

/**
 * D-C02: deep immutability. The original freezeSubject
 * stopped recursing when it saw an already-frozen node,
 * which left nested objects mutable. The fixed deepFreeze
 * freezes the current node first, then ALWAYS recurses
 * into children regardless of frozen status, so every
 * nested node is immutable.
 */
test("FRZ11: deeply-nested configuration object is frozen", () => {
  const f = freeze();
  const cfg = f.manifest.model.configuration as unknown as Record<
    string,
    unknown
  >;
  const nested = cfg["nested"] as Record<string, unknown>;
  const optimizer = nested["optimizer"] as Record<string, unknown>;
  assert.equal(Object.isFrozen(optimizer), true);
});

test("FRZ12: deeply-nested configuration mutation is rejected", () => {
  const f = freeze();
  const cfg = f.manifest.model.configuration as unknown as Record<
    string,
    unknown
  >;
  const nested = cfg["nested"] as Record<string, unknown>;
  const optimizer = nested["optimizer"] as Record<string, unknown>;
  assert.throws(
    () => {
      optimizer["learningRate"] = 999;
    },
    TypeError,
  );
});

test("FRZ13: deeply-nested configuration array mutation is rejected", () => {
  const f = freeze();
  const cfg = f.manifest.model.configuration as unknown as Record<
    string,
    unknown
  >;
  const nested = cfg["nested"] as Record<string, unknown>;
  const optimizer = nested["optimizer"] as Record<string, unknown>;
  const beta = optimizer["beta"] as Array<number>;
  assert.throws(
    () => {
      beta.push(1.0);
    },
    TypeError,
  );
});

/**
 * D-C03: manifest ↔ SubjectId binding.
 */
test("BIND01: manifest A + SubjectId B is rejected", () => {
  const r1 = decodeSubjectManifest(makeValidManifest());
  const r2 = decodeSubjectManifest(
    makeValidManifest({ experiment_id: "exp-002" as never }),
  );
  if (!r1.ok || !r2.ok) {
    throw new Error("setup failure: both decodes should succeed");
  }

  const bad = {
    manifest: r1.value.manifest,
    subjectId: r2.value.subjectId,
  };
  const f = freezeSubject(bad);
  assert.equal(f.ok, false);
  if (!f.ok) {
    assert.equal(f.failure.kind, "manifest_id_mismatch");
    assert.equal(f.failure.expected, r1.value.subjectId);
    assert.equal(f.failure.actual, r2.value.subjectId);
  }
});

test("BIND02: manifest A + its own SubjectId succeeds", () => {
  const r = decodeSubjectManifest(makeValidManifest());
  if (!r.ok) throw new Error("setup failure");
  const f = freezeSubject(r.value);
  assert.equal(f.ok, true);
  if (f.ok) {
    assert.equal(f.value.subjectId, r.value.subjectId);
  }
});
