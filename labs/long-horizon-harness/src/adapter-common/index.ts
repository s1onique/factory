/**
 * FOUNDATION04 — LH-03 — Adapter-common barrel.
 *
 * Cross-adapter helpers shared between candidate-specific
 * adapter packages (Cline, Pi, future Qwen / OpenCode /
 * Hermes / mini-swe-agent). All exports here are
 * candidate-neutral.
 */

export {
  computeSchemaFingerprint,
  canonicaliseFingerprintInput,
  stableStringify,
  type SchemaFingerprintInput,
} from "./schema-fingerprint.js";

export {
  inspectOwnProperties,
  isPlainString,
  isNonNegativeInt,
  isFiniteNumber,
  isBoolean,
  type HostileFieldViolation,
  type HostileObjectReport,
} from "./hostile-object.js";

export {
  artifactSha256,
  readJsonlFirstLine,
  readJsonObject,
  buildProbeEvidence,
  notRunProbeEvidence,
  haltProbeEvidence,
} from "./evidence-reader.js";

export {
  verifyLiveQualificationEvidence,
  resolveEvidencePath,
  EVIDENCE_VERIFICATION_ERROR_KINDS,
  type EvidenceVerificationErrorKind,
  type EvidenceVerificationError,
  type EvidenceVerificationResult,
} from "./evidence-verifier.js";
