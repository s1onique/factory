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
  buildIsolatedDataDirEvidence,
} from "./evidence-reader.js";

export {
  verifyLiveQualificationEvidence,
  resolveEvidencePath,
  EVIDENCE_VERIFICATION_ERROR_KINDS,
  type EvidenceVerificationErrorKind,
  type EvidenceVerificationError,
  type EvidenceVerificationResult,
} from "./evidence-verifier.js";

export {
  writeInvocationEvidence,
  readInvocationEvidence,
  deriveInvocationSemantics,
  isInvocationProtocol,
  isLaunchForm,
  INVOCATION_PROTOCOLS,
  LAUNCH_FORMS,
  type InvocationEvidence,
  type RawInvocationLaunch,
  type InvocationProtocol,
  type LaunchForm,
  type DerivedInvocationSemantics,
} from "./invocation-evidence.js";

export {
  computeExecutionId,
  writeExecutionCaptureManifest,
  readExecutionCaptureManifest,
  shaOfExecutionCaptureManifest,
  isRuntimeSessionFileInside,
  shaOfEmpty,
  reverifyExecutionCaptureManifestArtifacts,
  type ExecutionCaptureManifest,
  type CaptureOrigin,
} from "./execution-capture.js";
