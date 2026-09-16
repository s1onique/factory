/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Pure types, enums, branded identifiers, and public
 * constants for the immutable experiment subject manifest.
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
 * Layout:
 *
 *   This module holds ONLY:
 *     - schema-version constants + types
 *     - branded identifier types + factories + grammars
 *     - closed-world key constants
 *     - the dimension interfaces (Harness, Model, ...,
 *       SubjectManifest itself)
 *
 *   It does NOT hold the structural validator (see
 *   subject-validate.ts) or the JsonValue validator (see
 *   subject-json.ts). Splitting these keeps every Phase D
 *   source file under the SOURCE_SIZE_DISCIPLINE 400-LOC
 *   ceiling.
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
import type { JsonObject } from "./subject-json.js";

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
 * Closed-world list of the top-level keys a SubjectManifest
 * MUST contain. Unknown top-level keys fail closed at the
 * decoder (SUBJECT_MANIFEST_KEYS_POLICY = EXPLICIT_REJECT).
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
export type SubjectManifestKey = typeof SUBJECT_MANIFEST_KEYS[number];

/**
 * Closed-world list of keys each required dimension MUST
 * contain. The decoder rejects unknown keys per dimension
 * (NESTED_CLOSED_WORLD).
 *
 * Exception: `model.configuration` is intentionally
 * OPEN-WORLD. Its contents are recursively validated as
 * JsonValue (see subject-json.ts). This split is doctrine:
 * the structure of the manifest is closed; model-
 * configuration contents are an explicitly extensible JSON
 * namespace.
 */
export const HARNESS_KEYS = [
  "id",
  "version",
  "source_revision",
] as const;
export const MODEL_KEYS = [
  "provider",
  "model_id",
  "configuration",
] as const;
export const PROMPT_KEYS = [
  "prompt_id",
  "content_hash",
] as const;
export const TASK_KEYS = [
  "task_id",
  "fixture_revision",
] as const;
export const REPOSITORY_KEYS = [
  "commit",
  "dirty_policy",
] as const;
export const BUDGET_KEYS = [
  "wall_clock_ms",
  "turns",
  "tool_calls",
  "token_limit",
] as const;
export const CAPABILITIES_KEYS = [
  "tools",
  "network",
  "filesystem",
  "execution_policy",
] as const;
export const REPETITION_KEYS = [
  "repetition_index",
  "seed",
] as const;

/**
 * Closed-world enum for repository.dirty_policy. "ignore" is
 * NOT allowed — the subject MUST be bound to a known
 * repository state. Bumping this enum is a wire-breaking
 * change.
 */
export const REPOSITORY_DIRTY_POLICY_VALUES = [
  "reject",
  "allow-record",
] as const;
export type RepositoryDirtyPolicy =
  typeof REPOSITORY_DIRTY_POLICY_VALUES[number];

/**
 * Closed-world enum for capabilities.execution_policy.
 * Bumping this enum is a wire-breaking change.
 */
export const CAPABILITIES_EXECUTION_POLICY_VALUES = [
  "sandbox",
  "host",
  "container",
] as const;
export type CapabilitiesExecutionPolicy =
  typeof CAPABILITIES_EXECUTION_POLICY_VALUES[number];

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

/**
 * Required-dimension types.
 *
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
 * as an OPEN JSON namespace (the only one in the manifest)
 * so future knobs do not require schema bumps; the decoder
 * recursively validates and CLONES its contents into an
 * INERT OWNED JsonValue tree (D-M05, D-M09, D-M10). Callers
 * receive the owned snapshot; the caller's live object graph
 * never enters the manifest.
 *
 * D-M11: the static type of `configuration` is JsonObject,
 * not JsonValue. validateSubjectManifest() requires the
 * configuration to be a plain object (it calls isPlainObject
 * on the value during structural validation); a primitive,
 * array, or exotic at this position is REJECTED before the
 * recursive JsonValue walk. The type surface now matches
 * that runtime contract.
 */
export type SubjectModel = {
  readonly provider: string;
  readonly model_id: string;
  readonly configuration: JsonObject;
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
 * `dirty_policy` is the declared policy on a dirty tree.
 */
export type SubjectRepository = {
  readonly commit: string;
  readonly dirty_policy: RepositoryDirtyPolicy;
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
 */
export type SubjectCapabilities = {
  readonly tools: ReadonlyArray<string>;
  readonly network: boolean;
  readonly filesystem: boolean;
  readonly execution_policy: CapabilitiesExecutionPolicy;
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

/**
 * The complete, versioned, immutable experiment subject.
 *
 * One manifest describes ONE subject (i.e. one experimental
 * unit). To compare two runs against the same subject, both
 * runs must produce a SubjectId equal to
 * `computeSubjectId(this manifest)`. To compare against
 * DIFFERENT subjects, the manifests must differ in at least
 * one required dimension.
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
