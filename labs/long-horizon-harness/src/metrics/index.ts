/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Public barrel for the metric module. The metric module
 * depends only on Phase E (`src/run`) and Phase D
 * (`src/subject`) for subject-identity re-use. No upward
 * call sites reach through this index for anything beyond
 * the names below.
 *
 * Consumers MUST import from this barrel rather than from
 * internal modules so the metric module can be refactored
 * without breaking call sites.
 */
export {
  CONVERGENCE_METRIC_CONTRACT_V1,
  METRIC_REPORT_SCHEMA_VERSION,
  METRIC_CONTRACT_VERSIONS,
  UNAVAILABILITY_REASONS,
  available,
  unavailable,
  isAvailable,
  isUnavailableWith,
  isMetricContractVersion,
  type ConvergenceMetricContractV1,
  type MetricReportSchemaVersion,
  type MetricContractVersion,
  type UnavailabilityReason,
  type MetricValue,
  type Counters,
  type ConvergenceDistances,
  type CorrectionBurden,
  type TimeMetrics,
  type ResourceMetrics,
  type FailureObservations,
  type ConvergenceFacts,
  type SuccessNormalized,
  type SurvivingDefectSurface,
  type ReportProvenance,
  type MetricReport,
} from "./metric-types.js";

export {
  SUPPORTED_CONTRACT_VERSION,
  guardContractVersion,
  type ContractGuardResult,
} from "./metric-contract.js";

export {
  computeRunMetrics,
  verifyProjectionBind,
  type MetricResult,
} from "./metric-projector.js";

export {
  serializeMetricReport,
  serializeMetricReportBytes,
} from "./metric-serialize.js";

export {
  deriveRunEvidenceHash,
} from "./metric-hash.js";

export {
  walkAuthority,
  assertAuthorityEndStateMatchesProjection,
  type AuthorityWalk,
} from "./metric-authority.js";
