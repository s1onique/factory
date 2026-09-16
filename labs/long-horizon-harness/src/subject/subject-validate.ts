/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Structural validator for SubjectManifest.
 *
 * Pure and TOTAL: returns a discriminated union and NEVER
 * throws. The decoder (subject-decode.ts) composes this with
 * the trust-boundary parse step.
 *
 * Doctrine (NESTED_CLOSED_WORLD):
 *
 *   The structure of the manifest is closed-world. Every
 *   dimension — harness, model (except configuration),
 *   prompt, task, repository, budget, capabilities,
 *   repetition — MUST contain EXACTLY the closed-world key
 *   set declared in subject-types.ts. Unknown keys at any
 *   depth fail closed.
 *
 *   Exception: model.configuration is an explicitly OPEN
 *   JSON-value namespace. Its contents are validated by
 *   validateJsonValue (subject-json.ts), which is a deeper
 *   "is this a well-formed JSON value?" check, NOT a
 *   key-shape check.
 *
 *   Rationale: an experiment manifest must NEVER silently
 *   drop unrecognized fields. Two distinct input documents
 *   that differ only in ignored fields would decode into
 *   the same canonical subject, contaminating the
 *   content-bound identity property.
 */

import {
  BUDGET_KEYS,
  CAPABILITIES_EXECUTION_POLICY_VALUES,
  CAPABILITIES_KEYS,
  HARNESS_KEYS,
  IDENTIFIER_GRAMMAR,
  MODEL_KEYS,
  PROMPT_KEYS,
  REPETITION_KEYS,
  REPOSITORY_DIRTY_POLICY_VALUES,
  REPOSITORY_KEYS,
  SUBJECT_MANIFEST_KEYS,
  SUBJECT_SCHEMA_VERSION,
  TASK_KEYS,
  type RepositoryDirtyPolicy,
  type CapabilitiesExecutionPolicy,
} from "./subject-types.js";

/**
 * Validation result. Either ok or a single joined reason
 * (the validator collects ALL violations and joins them so
 * callers see every problem at once).
 */
export type SubjectValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function ok(): SubjectValidation {
  return { ok: true };
}
function fail(reason: string): SubjectValidation {
  return { ok: false, reason };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireNonEmptyString(
  o: Record<string, unknown>,
  key: string,
  reasons: string[],
): void {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    reasons.push(`${key} must be a non-empty string`);
  }
}

function requireIdentifierString(
  o: Record<string, unknown>,
  key: string,
  reasons: string[],
): void {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    reasons.push(`${key} must be a non-empty string`);
    return;
  }
  if (!IDENTIFIER_GRAMMAR.test(v)) {
    reasons.push(`${key} must match IDENTIFIER_GRAMMAR`);
  }
}

function requireNonNegativeInteger(
  o: Record<string, unknown>,
  key: string,
  reasons: string[],
): void {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    reasons.push(`${key} must be a non-negative integer`);
  }
}

function requireSha256Hex(
  o: Record<string, unknown>,
  key: string,
  reasons: string[],
): void {
  const v = o[key];
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) {
    reasons.push(`${key} must be a 64-char lowercase hex SHA-256`);
  }
}

function requireStringArrayOfGrammar(
  o: Record<string, unknown>,
  key: string,
  reasons: string[],
): void {
  const v = o[key];
  if (!Array.isArray(v)) {
    reasons.push(`${key} must be an array of strings`);
    return;
  }
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    if (typeof e !== "string" || !IDENTIFIER_GRAMMAR.test(e)) {
      reasons.push(`${key}[${i}] must match IDENTIFIER_GRAMMAR`);
      return;
    }
  }
}

function requireBoolean(
  o: Record<string, unknown>,
  key: string,
  reasons: string[],
): void {
  const v = o[key];
  if (typeof v !== "boolean") {
    reasons.push(`${key} must be a boolean`);
  }
}

/**
 * Reject unknown keys at the dimension level. `allowed` is
 * the closed-world key set; any extra key fails closed.
 *
 * This helper checks the CLOSED-WORLD property: the keys
 * PRESENT must be a subset of `allowed`. It does NOT check
 * that REQUIRED keys are present — that is the caller's
 * job.
 */
function requireClosedWorldKeys(
  o: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  dimension: string,
  reasons: string[],
): void {
  const allowedSet = new Set<string>(allowed);
  for (const k of Object.keys(o)) {
    if (!allowedSet.has(k)) {
      reasons.push(
        `${dimension}: unknown key ${JSON.stringify(k)} ` +
          `(allowed: ${allowed.map((s) => JSON.stringify(s)).join(", ")})`,
      );
    }
  }
}

/**
 * Validate the full manifest structurally. Pure; never throws.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }` with a
 * joined reason string.
 *
 * Note: this validator does NOT recursively inspect
 * model.configuration. That field is intentionally open-
 * world; its content validation lives in subject-json.ts.
 */
export function validateSubjectManifest(value: unknown): SubjectValidation {
  const reasons: string[] = [];

  if (!isPlainObject(value)) {
    return fail("manifest root must be a plain object");
  }

  // Closed-world at the root.
  requireClosedWorldKeys(
    value,
    SUBJECT_MANIFEST_KEYS as ReadonlyArray<string>,
    "manifest",
    reasons,
  );

  // schema_version
  if (value.schema_version !== SUBJECT_SCHEMA_VERSION) {
    reasons.push(
      `schema_version must be the literal ${JSON.stringify(SUBJECT_SCHEMA_VERSION)}`,
    );
  }

  // experiment_id, subject_id_hint
  requireIdentifierString(value, "experiment_id", reasons);
  requireIdentifierString(value, "subject_id_hint", reasons);

  // harness
  if (!isPlainObject(value.harness)) {
    reasons.push("harness must be an object");
  } else {
    requireClosedWorldKeys(value.harness, HARNESS_KEYS, "harness", reasons);
    requireNonEmptyString(value.harness, "id", reasons);
    requireNonEmptyString(value.harness, "version", reasons);
    requireSha256Hex(value.harness, "source_revision", reasons);
  }

  // model
  if (!isPlainObject(value.model)) {
    reasons.push("model must be an object");
  } else {
    requireClosedWorldKeys(value.model, MODEL_KEYS, "model", reasons);
    requireNonEmptyString(value.model, "provider", reasons);
    requireNonEmptyString(value.model, "model_id", reasons);
    if (!isPlainObject(value.model.configuration)) {
      reasons.push("model.configuration must be an object");
    }
    // Contents of model.configuration are validated as JsonValue
    // at the decoder layer (subject-decode.ts), not here.
  }

  // prompt
  if (!isPlainObject(value.prompt)) {
    reasons.push("prompt must be an object");
  } else {
    requireClosedWorldKeys(value.prompt, PROMPT_KEYS, "prompt", reasons);
    requireIdentifierString(value.prompt, "prompt_id", reasons);
    requireSha256Hex(value.prompt, "content_hash", reasons);
  }

  // task
  if (!isPlainObject(value.task)) {
    reasons.push("task must be an object");
  } else {
    requireClosedWorldKeys(value.task, TASK_KEYS, "task", reasons);
    requireIdentifierString(value.task, "task_id", reasons);
    requireNonEmptyString(value.task, "fixture_revision", reasons);
  }

  // repository
  if (!isPlainObject(value.repository)) {
    reasons.push("repository must be an object");
  } else {
    requireClosedWorldKeys(
      value.repository,
      REPOSITORY_KEYS,
      "repository",
      reasons,
    );
    requireSha256Hex(value.repository, "commit", reasons);
    const dp = value.repository.dirty_policy;
    if (
      !REPOSITORY_DIRTY_POLICY_VALUES.includes(dp as RepositoryDirtyPolicy)
    ) {
      reasons.push(
        `repository.dirty_policy must be one of ` +
          REPOSITORY_DIRTY_POLICY_VALUES.map((s) => JSON.stringify(s)).join("|") +
          ` (got ${JSON.stringify(dp)})`,
      );
    }
  }

  // budget
  if (!isPlainObject(value.budget)) {
    reasons.push("budget must be an object");
  } else {
    requireClosedWorldKeys(value.budget, BUDGET_KEYS, "budget", reasons);
    requireNonNegativeInteger(value.budget, "wall_clock_ms", reasons);
    requireNonNegativeInteger(value.budget, "turns", reasons);
    requireNonNegativeInteger(value.budget, "tool_calls", reasons);
    if (
      "token_limit" in value.budget &&
      value.budget.token_limit !== undefined
    ) {
      requireNonNegativeInteger(value.budget, "token_limit", reasons);
    }
  }

  // capabilities
  if (!isPlainObject(value.capabilities)) {
    reasons.push("capabilities must be an object");
  } else {
    requireClosedWorldKeys(
      value.capabilities,
      CAPABILITIES_KEYS,
      "capabilities",
      reasons,
    );
    requireStringArrayOfGrammar(value.capabilities, "tools", reasons);
    requireBoolean(value.capabilities, "network", reasons);
    requireBoolean(value.capabilities, "filesystem", reasons);
    const ep = value.capabilities.execution_policy;
    if (
      !CAPABILITIES_EXECUTION_POLICY_VALUES.includes(
        ep as CapabilitiesExecutionPolicy,
      )
    ) {
      reasons.push(
        `capabilities.execution_policy must be one of ` +
          CAPABILITIES_EXECUTION_POLICY_VALUES.map((s) => JSON.stringify(s)).join("|") +
          ` (got ${JSON.stringify(ep)})`,
      );
    }
  }

  // repetition
  if (!isPlainObject(value.repetition)) {
    reasons.push("repetition must be an object");
  } else {
    requireClosedWorldKeys(
      value.repetition,
      REPETITION_KEYS,
      "repetition",
      reasons,
    );
    requireNonNegativeInteger(
      value.repetition,
      "repetition_index",
      reasons,
    );
    if (
      "seed" in value.repetition &&
      value.repetition.seed !== undefined &&
      typeof value.repetition.seed !== "string"
    ) {
      reasons.push("repetition.seed must be a string when present");
    }
  }

  if (reasons.length > 0) {
    return fail(reasons.join("; "));
  }
  return ok();
}
