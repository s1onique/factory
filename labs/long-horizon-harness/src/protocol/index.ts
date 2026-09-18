/**
 * FOUNDATION04 — LH-03 — Candidate-neutral protocol barrel.
 *
 * Public re-exports for the candidate-neutral harness
 * adapter protocol. The V1 contract (`harness-adapter.ts`)
 * is preserved verbatim. V2 extensions (`harness-identity`,
 * `harness-capabilities`, `harness-run`,
 * `harness-adapter-errors`, `harness-adapter-v2`) are
 * additive: every existing D08 caller continues to compile
 * against the V1 surface.
 *
 * Doctrine (D08): no candidate-specific types (Cline
 * session IDs, Pi RPC message names, …) appear in this
 * barrel. Candidate adapters live in `../adapters/<name>/`.
 */

export {
  KNOWN_HARNESS_KINDS,
  isHarnessKind,
  type HarnessAdapter,
  type HarnessKind,
  type HarnessEvent,
  type HarnessStatus,
  type StartInput,
  type StartResult,
  type InterruptResult,
} from "./harness-adapter.js";

export {
  PROTOCOL_MODES,
  isProtocolMode,
  qualificationIdentityEquals,
  isFullyQualifiedIdentity,
  type HarnessIdentity,
  type HarnessQualificationIdentity,
  type ProtocolMode,
} from "./harness-identity.js";

export {
  CAPABILITY_STATES,
  CAPABILITY_KEYS,
  CAPABILITY_PROBE_KINDS,
  EVIDENCE_DISPOSITIONS,
  LIVE_QUALIFICATION_STATES,
  isCapabilityState,
  isCapabilityKey,
  isCapabilityProbeKind,
  isEvidenceDisposition,
  isLiveQualificationState,
  emptyCapabilities,
  assertCapabilitiesComplete,
  validateLiveQualification,
  type HarnessCapabilities,
  type CapabilityKey,
  type CapabilityState,
  type CapabilityProbeKind,
  type EvidenceDisposition,
  type CapabilityProbeEvidence,
  type LiveQualificationState,
  type CapabilityAxis,
  type LiveQualificationViolation,
} from "./harness-capabilities.js";

export {
  ADAPTER_ERROR_CODES,
  isAdapterErrorCode,
  adapterError,
  type AdapterErrorCode,
  type HarnessAdapterError,
} from "./harness-adapter-errors.js";

export type {
  PreparedHarnessRun,
  HarnessProcessResult,
  HarnessRawArtifact,
  HarnessRawArtifactKind,
  HarnessCancellationResult,
} from "./harness-run.js";

export {
  isCapabilitiesResolved,
  type HarnessAdapterV2,
  type AdapterV2Init,
  type UnknownNativeEventError,
} from "./harness-adapter-v2.js";
