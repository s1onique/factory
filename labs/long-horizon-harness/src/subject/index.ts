/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Public re-exports for the Phase D subject surface.
 *
 * The published surface is intentionally small. The runtime
 * authority for manifest validity is `decodeSubjectManifest`.
 * Everything else is either a type, a brand, a constant, or
 * a pure helper.
 *
 *   - decodeSubjectManifest       : trust-boundary decoder
 *                                   (NEVER throws)
 *   - validateSubjectManifest     : pure structural validator
 *   - validateJsonValue           : recursive JsonValue check
 *                                   (used at the trust boundary)
 *   - computeSubjectId            : canonical content hash
 *   - freezeSubject               : manifest ↔ id binding +
 *                                   deep-freeze (typed result)
 *   - canonicalize                : pure canonical-bytes helper
 *   - types                       : manifest + dimensions + ids
 *   - constants                   : schema_version, grammars,
 *                                   closed-world key sets,
 *                                   closed-world enums
 *
 * Phase D does NOT yet wire into the run evidence (Phase E).
 * Callers store the DecodedSubject / FrozenSubject alongside
 * their own bookkeeping; no ledger binding exists here.
 */

export {
  canonicalize,
  SUBJECT_ID_V1_TAG,
} from "./subject-canonicalize.js";
export {
  computeSubjectId,
} from "./subject-id.js";
export {
  validateJsonValue,
  snapshotJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type JsonValidation,
} from "./subject-json.js";
export {
  decodeSubjectManifest,
  type DecodedSubject,
  type SubjectDecodeFailure,
  type SubjectDecodeResult,
} from "./subject-decode.js";
export {
  freezeSubject,
  type FrozenSubject,
  type SubjectFreezeFailure,
  type SubjectFreezeResult,
} from "./subject-frozen.js";
export {
  validateSubjectManifest,
  type SubjectValidation,
} from "./subject-validate.js";
export {
  // constants
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
  SUBJECT_ID_GRAMMAR,
  SUBJECT_MANIFEST_KEYS,
  SUBJECT_SCHEMA_VERSION,
  TASK_KEYS,
  // factories
  makeExperimentId,
  makeSubjectId,
  makeSubjectIdHint,
  // types
  type CapabilitiesExecutionPolicy,
  type ExperimentId,
  type RepositoryDirtyPolicy,
  type SubjectBudget,
  type SubjectCapabilities,
  type SubjectHarness,
  type SubjectId,
  type SubjectIdHint,
  type SubjectManifest,
  type SubjectManifestKey,
  type SubjectModel,
  type SubjectPrompt,
  type SubjectRepetition,
  type SubjectRepository,
  type SubjectSchemaVersion,
  type SubjectTask,
} from "./subject-types.js";
