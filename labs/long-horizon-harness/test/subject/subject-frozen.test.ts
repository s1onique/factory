/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Acceptance target covered here:
 *
 *   MUTATION_AFTER_CREATION        = REJECTED
 *
 * And the orthogonal property: a frozen subject preserves
 * every declared dimension across any number of read
 * accesses (proves the deep-freeze did not silently drop
 * nested structure).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  freezeSubject,
  SubjectMutationRejected,
} from "../../src/subject/subject-frozen.js";
import { decodeSubjectManifest } from "../../src/subject/subject-decode.js";
import { makeValidManifest } from "./_subject_helpers.js";

function freeze(): ReturnType<typeof freezeSubject> {
  const r = decodeSubjectManifest(makeValidManifest());
  if (!r.ok) {
    throw new Error("setup failure: decode should succeed");
  }
  return freezeSubject(r.value.manifest, r.value.subjectId);
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
      // TS would reject this at compile time; we cast to bypass
      // the readonly type so we can exercise the runtime freeze.
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

test("FRZ09: SubjectMutationRejected is exported and constructable", () => {
  const e = new SubjectMutationRejected("foo.bar", "test reason");
  assert.equal(e.name, "SubjectMutationRejected");
  assert.equal(e.target, "foo.bar");
  assert.match(e.message, /foo\.bar/);
});

test("FRZ10: dimensions are preserved exactly across reads", () => {
  const f = freeze();
  const m = makeValidManifest();
  // Spot-check every required dimension round-trips intact.
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
