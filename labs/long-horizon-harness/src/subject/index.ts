/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Public re-exports for the Phase D subject surface.
 *
 * The published surface is intentionally small. The runtime
 * authority for manifest validity is `decodeSubjectManifest`.
 * Everything else is either a type, a brand, or a pure
 * helper.
 *
 *   - decodeSubjectManifest       : trust-boundary decoder
 *   - validateSubjectManifest     : pure structural validator
 *   - computeSubjectId            : canonical content hash
 *   - freezeSubject               : deep-freeze + mutation reject
 *   - SubjectMutationRejected     : typed mutation error
 *   - canonicalize                : pure canonical-bytes helper
 *   - types                       : manifest + dimensions + ids
 *   - constants                   : schema_version, grammars
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
  decodeSubjectManifest,
  type DecodedSubject,
  type SubjectDecodeFailure,
  type SubjectDecodeResult,
} from "./subject-decode.js";
export {
  freezeSubject,
  SubjectMutationRejected,
  type FrozenSubject,
} from "./subject-frozen.js";
export {
  makeExperimentId,
  makeSubjectId,
  makeSubjectIdHint,
  validateSubjectManifest,
  SUBJECT_MANIFEST_KEYS,
  SUBJECT_SCHEMA_VERSION,
  SUBJECT_ID_GRAMMAR,
  IDENTIFIER_GRAMMAR,
  type ExperimentId,
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
  type SubjectValidation,
} from "./subject-types.js";
