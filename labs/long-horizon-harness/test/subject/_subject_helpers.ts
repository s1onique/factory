/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Test helpers for the subject module. Provides a single
 * canonical VALID_MANIFEST (used by every passing-path test)
 * and small factory functions for the small mutations the
 * one-field-change tests need to perform.
 *
 * All identifiers satisfy IDENTIFIER_GRAMMAR. All SHAs are
 * 64-char lowercase hex (they are not real repository SHAs;
 * they are deterministic placeholders — Phase D only requires
 * the manifest to bind SOMETHING that is shaped like a SHA).
 */

import {
  SUBJECT_SCHEMA_VERSION,
  type SubjectManifest,
} from "../../src/subject/subject-types.js";

/** 64-char lowercase hex placeholder for harness source_revision. */
export const HARNESS_REV =
  "1111111111111111111111111111111111111111111111111111111111111111";

/** 64-char lowercase hex placeholder for prompt content_hash. */
export const PROMPT_HASH =
  "2222222222222222222222222222222222222222222222222222222222222222";

/** 64-char lowercase hex placeholder for repository commit. */
export const REPO_COMMIT =
  "3333333333333333333333333333333333333333333333333333333333333333";

/**
 * Canonical valid manifest used by every passing-path test.
 *
 * Cloning MUST be a deep copy (a fresh top-level object +
 * fresh nested objects), so that one test's mutation does not
 * leak into another test via shared references.
 */
export function makeValidManifest(
  over: Partial<SubjectManifest> = {},
): SubjectManifest {
  const base: SubjectManifest = {
    schema_version: SUBJECT_SCHEMA_VERSION,
    experiment_id: "exp-001" as SubjectManifest["experiment_id"],
    subject_id_hint: "subj-hint-001" as SubjectManifest["subject_id_hint"],

    harness: {
      id: "cline",
      version: "0.1.0",
      source_revision: HARNESS_REV,
    },

    model: {
      provider: "factory-lab",
      model_id: "fake-model-v1",
      configuration: Object.freeze({
        temperature: 0.0,
        max_tokens: 4096,
      }),
    },

    prompt: {
      prompt_id: "prompt-A",
      content_hash: PROMPT_HASH,
    },

    task: {
      task_id: "task-001",
      fixture_revision: "fixture-rev-001",
    },

    repository: {
      commit: REPO_COMMIT,
      dirty_policy: "reject",
    },

    budget: {
      wall_clock_ms: 600_000,
      turns: 50,
      tool_calls: 200,
      token_limit: 1_000_000,
    },

    capabilities: {
      tools: Object.freeze(["read_file", "write_file", "bash"]) as ReadonlyArray<string>,
      network: false,
      filesystem: true,
      execution_policy: "sandbox",
    },

    repetition: {
      repetition_index: 0,
      seed: "seed-A",
    },
  };

  return deepMerge(base, over as Record<string, unknown>) as SubjectManifest;
}

function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) {
    const bv = base[k];
    const ov = over[k];
    if (
      isPlainObject(bv) &&
      isPlainObject(ov)
    ) {
      out[k] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else if (ov !== undefined) {
      out[k] = ov;
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
