/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Types for the immutable experiment subject manifest.
 *
 * Phase D doctrine:
 *
 *   A SubjectManifest names everything that defines ONE
 *   experimental subject. It is the closed-world claim:
 *
 *     "If you ran me with these inputs, you were running
 *      experiment X about subject Y under conditions C."
 *
 *   The manifest is:
 *
 *     - versioned via SUBJECT_SCHEMA_VERSION
 *     - validated structurally by a typed decoder (the
 *       RUNTIME AUTHORITY — see subject-decode.ts)
 *     - content-addressed via canonical JSON + SHA-256, so
 *       the SubjectId is a deterministic function of the
 *       declared content
 *     - frozen after creation; mutation is rejected at
 *       runtime (see subject-frozen.ts)
 *
 *   Phase D does NOT carry run evidence, gate transitions,
 *   or convergence metrics. Those arrive in Phase E.
 *
 * All identifier-bearing strings MUST satisfy
 * IDENTIFIER_GRAMMAR (defined in ../domain/ids.ts).
 *
 * This module is pure: no I/O, no fs, no network.
 */

import {
  IDENTIFIER_GRAMMAR,
  makeHarnessHandle,
  type HarnessHandle,
} from "../domain/ids.js";

// Re-export IDENTIFIER_GRAMMAR so consumers of subject-types
// can pull the grammar alongside their subject types without
// a second import edge. The runtime authority for grammar
// enforcement is the source of truth in domain/ids.ts; this
// is a pass-through.
export { IDENTIFIER_GRAMMAR };

/**
 * The single, closed-world schema version string for the
 * Phase D subject manifest. Bumping this value is a
 * wire-breaking change.
 */
export const SUBJECT_SCHEMA_VERSION = "phase-d.subject.v1" as const;
export type SubjectSchemaVersion = typeof SUBJECT_SCHEMA_VERSION;

/**
 * Branded identifier for an experiment.
 */
export type ExperimentId = HarnessHandle;
export function makeExperimentId(value: string): ExperimentId {
  return makeHarnessHandle(value);
}

/**
 * Branded identifier for a SubjectManifest content hash.
 *
 * Carries a domain prefix ("subject:") inside the grammar.
 */
declare const __subjectIdBrand: unique symbol;
export type SubjectId =
  string & { readonly [__subjectIdBrand]: "SubjectId" };

/**
 * SubjectId grammar: "subject:" + 64 lowercase hex chars.
 *
 * Total length: 8 + 64 = 72 chars, well within
 * IDENTIFIER_GRAMMAR's 128-char cap.
 */
export const SUBJECT_ID_GRAMMAR = /^subject:[0-9a-f]{64}$/;

export function makeSubjectId(value: string): SubjectId {
  if (!SUBJECT_ID_GRAMMAR.test(value)) {
    throw new Error(
      `Invalid SubjectId: must match ${SUBJECT_ID_GRAMMAR}`,
    );
  }
  return value as SubjectId;
}

/**
 * Branded identifier for the subject-id hint field. This is a
 * human-readable label, NOT the canonical SubjectId.
 */
export type SubjectIdHint = HarnessHandle;
export function makeSubjectIdHint(value: string): SubjectIdHint {
  return makeHarnessHandle(value);
}

// Re-exported so consumers of subject-types can pull the
// grammar alongside their subject types without a second
// import edge.

/** ---------------------------------------------------------------------------
 * Required-dimension types.
 * ------------------------------------------------------------------------- */

/**
 * The candidate harness executing the experiment. `id` is a
 * stable machine identifier (e.g. "cline"); `version` is the
 * declared harness version; `source_revision` is the git SHA
 * the harness was built from.
 */
export type SubjectHarness = {
  readonly id: string;
  readonly version: string;
  readonly source_revision: string;
};

/**
 * Model identity and configuration. Configuration is treated
 * as an opaque string-keyed record so future knobs do not
 * require schema bumps; the decoder still requires the field
 * to be present and an object.
 */
export type SubjectModel = {
  readonly provider: string;
  readonly model_id: string;
  readonly configuration: Readonly<Record<string, unknown>>;
};

/**
 * Prompt binding. `content_hash` is the canonical SHA-256 of
 * the prompt body (hex, lowercase). Phase D does NOT inspect
 * prompt content; it only binds the hash so that two runs
 * with the same declared hash are content-equivalent and two
 * runs with different hashes are not.
 */
export type SubjectPrompt = {
  readonly prompt_id: string;
  readonly content_hash: string;
};

/**
 * Task and fixture binding. `task_id` identifies the task
 * specification; `fixture_revision` binds the test fixture
 * version used to evaluate candidate output.
 */
export type SubjectTask = {
  readonly task_id: string;
  readonly fixture_revision: string;
};

/**
 * Repository binding. `commit` is the git SHA of the
 * repository state the subject was defined against;
 * `dirty_policy` is the declared policy on a dirty tree
 * ("reject" | "allow-record"). Phase D rejects "ignore" as
 * a safety default — the subject MUST be bound to a known
 * repository state.
 */
export type SubjectRepository = {
  readonly commit: string;
  readonly dirty_policy: "reject" | "allow-record";
};

/**
 * Run budget. All numeric fields are non-negative integers.
 * `token_limit` is optional (not every harness exposes a
 * token budget).
 */
export type SubjectBudget = {
  readonly wall_clock_ms: number;
  readonly turns: number;
  readonly tool_calls: number;
  readonly token_limit?: number;
};

/**
 * Capability set declared by the experimenter.
 * `execution_policy` enum is closed-world:
 *
 *   "sandbox"    : the harness runs in a hermetic sandbox
 *   "host"       : the harness runs with full host access
 *   "container"  : the harness runs in a container
 */
export type SubjectCapabilities = {
  readonly tools: ReadonlyArray<string>;
  readonly network: boolean;
  readonly filesystem: boolean;
  readonly execution_policy: "sandbox" | "host" | "container";
};

/**
 * Repetition metadata. `repetition_index` is the zero-based
 * index of THIS run within an experiment's repetition set.
 * `seed` is optional; when present it MUST be a string.
 */
export type SubjectRepetition = {
  readonly repetition_index: number;
  readonly seed?: string;
};

/** ---------------------------------------------------------------------------
 * SubjectManifest — the closed-world root type.
 * ------------------------------------------------------------------------- */

/**
 * The complete, versioned, immutable experiment subject.
 *
 * Required top-level keys (no extras permitted; unknown keys
 * fail closed at decode time):
 *
 *   schema_version
 *   experiment_id
 *   subject_id_hint
 *   harness
 *   model
 *   prompt
 *   task
 *   repository
 *   budget
 *   capabilities
 *   repetition
 */
export type SubjectManifest = {
  readonly schema_version: SubjectSchemaVersion;
  readonly experiment_id: ExperimentId;
  readonly subject_id_hint: SubjectIdHint;

  readonly harness: SubjectHarness;
  readonly model: SubjectModel;
  readonly prompt: SubjectPrompt;
  readonly task: SubjectTask;
  readonly repository: SubjectRepository;
  readonly budget: SubjectBudget;
  readonly capabilities: SubjectCapabilities;
  readonly repetition: SubjectRepetition;
};

/**
 * Canonical list of permitted top-level keys, in declaration
 * order. The decoder uses this set to enforce the
 * "unknown fields fail closed" doctrine.
 */
export const SUBJECT_MANIFEST_KEYS = [
  "schema_version",
  "experiment_id",
  "subject_id_hint",
  "harness",
  "model",
  "prompt",
  "task",
  "repository",
  "budget",
  "capabilities",
  "repetition",
] as const;

/** ---------------------------------------------------------------------------
 * Structural validator.
 *
 * Pure and TOTAL: returns a discriminated union and NEVER
 * throws. The decoder (subject-decode.ts) composes this with
 * the trust-boundary parse step.
 * ------------------------------------------------------------------------- */

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

function requireString(
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


/**
 * Validate the full manifest structurally. Pure; never throws.
 *
 * On failure returns `{ ok: false, reason: "<all reasons joined>" }`
 * so a caller can show every problem at once.
 */
export function validateSubjectManifest(value: unknown): SubjectValidation {
  const reasons: string[] = [];

  if (!isPlainObject(value)) {
    return fail("manifest root must be a plain object");
  }

  // Unknown top-level keys: closed-world doctrine.
  for (const k of Object.keys(value)) {
    if (!(SUBJECT_MANIFEST_KEYS as ReadonlyArray<string>).includes(k)) {
      reasons.push(`unknown top-level key: ${JSON.stringify(k)}`);
    }
  }

  // schema_version
  if (value.schema_version !== SUBJECT_SCHEMA_VERSION) {
    reasons.push(
      `schema_version must be the literal ${JSON.stringify(SUBJECT_SCHEMA_VERSION)}`,
    );
  }

  // experiment_id, subject_id_hint
  requireString(value, "experiment_id", reasons);
  requireString(value, "subject_id_hint", reasons);

  // harness
  if (!isPlainObject(value.harness)) {
    reasons.push("harness must be an object");
  } else {
    requireNonEmptyString(value.harness, "id", reasons);
    requireNonEmptyString(value.harness, "version", reasons);
    requireSha256Hex(value.harness, "source_revision", reasons);
  }

  // model
  if (!isPlainObject(value.model)) {
    reasons.push("model must be an object");
  } else {
    requireNonEmptyString(value.model, "provider", reasons);
    requireNonEmptyString(value.model, "model_id", reasons);
    if (!isPlainObject(value.model.configuration)) {
      reasons.push("model.configuration must be an object");
    }
  }

  // prompt
  if (!isPlainObject(value.prompt)) {
    reasons.push("prompt must be an object");
  } else {
    requireString(value.prompt, "prompt_id", reasons);
    requireSha256Hex(value.prompt, "content_hash", reasons);
  }

  // task
  if (!isPlainObject(value.task)) {
    reasons.push("task must be an object");
  } else {
    requireString(value.task, "task_id", reasons);
    requireNonEmptyString(value.task, "fixture_revision", reasons);
  }

  // repository
  if (!isPlainObject(value.repository)) {
    reasons.push("repository must be an object");
  } else {
    requireSha256Hex(value.repository, "commit", reasons);
    const dp = value.repository.dirty_policy;
    if (dp !== "reject" && dp !== "allow-record") {
      reasons.push(
        `repository.dirty_policy must be "reject" or "allow-record" (got ${JSON.stringify(dp)})`,
      );
    }
  }


  // budget
  if (!isPlainObject(value.budget)) {
    reasons.push("budget must be an object");
  } else {
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
    requireStringArrayOfGrammar(value.capabilities, "tools", reasons);
    if (typeof value.capabilities.network !== "boolean") {
      reasons.push("capabilities.network must be a boolean");
    }
    if (typeof value.capabilities.filesystem !== "boolean") {
      reasons.push("capabilities.filesystem must be a boolean");
    }
    const ep = value.capabilities.execution_policy;
    if (ep !== "sandbox" && ep !== "host" && ep !== "container") {
      reasons.push(
        `capabilities.execution_policy must be one of "sandbox"|"host"|"container" (got ${JSON.stringify(ep)})`,
      );
    }
  }

  // repetition
  if (!isPlainObject(value.repetition)) {
    reasons.push("repetition must be an object");
  } else {
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

export type SubjectManifestKey = typeof SUBJECT_MANIFEST_KEYS[number];
