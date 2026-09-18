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
