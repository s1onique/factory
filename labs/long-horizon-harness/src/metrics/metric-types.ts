/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure types, version constants, and the closed-world metric
 * vocabulary. LH-02 defines a deterministic measurement contract
 * over Phase E's immutable evidence substrate.
 *
 * Doctrine (LH-02 / ACT-FACTORY-LONG-HORIZON-LAB-CONVERGENCE-
 * METRIC-CONTRACT01):
 *
 *   - Metrics are pure projections over Phase E evidence.
 *   - LH-02 does NOT alter run legality, terminal outcome,
 *     closure authority, event interpretation, or subject identity.
 *   - Missing evidence MUST surface as `{available:false, reason}`
 *     rather than as a fabricated zero / false / empty value.
 *   - Every report MUST bind a metric contract version and a
 *     schema version, so historical reports cannot be silently
 *     reinterpreted by a future contract.
 *
 * This module is pure: no I/O.
 */

/**
 * Frozen V1 contract identity. The string value participates in
 * `run_evidence_hash`-equivalent identity for reports; any change
 * to the metric semantics MUST be accompanied by introducing a
 * new contract version rather than editing the existing one
 * (M1: "Changing metric semantics requires a new contract
 * version. Never silently reinterpret historical runs using
 * changed formulas while preserving the same version.").
 */
export const CONVERGENCE_METRIC_CONTRACT_V1 =
  "convergence.metric.contract.v1" as const;
export type ConvergenceMetricContractV1 =
  typeof CONVERGENCE_METRIC_CONTRACT_V1;

/**
 * Schema version for the structural shape of a `MetricReport`.
 * Bumping this value is a wire-format-breaking change for the
 * report object. Independent from the contract identity so that
 * contract semantics can stay constant while the report shape
 * evolves (M1).
 */
export const METRIC_REPORT_SCHEMA_VERSION =
  "metric.report.schema.v1" as const;
export type MetricReportSchemaVersion =
  typeof METRIC_REPORT_SCHEMA_VERSION;

/**
 * Closed-world set of metric contract identities recognized by
 * LH-02. New entries require introducing a new value here; the
 * projector rejects unrecognized values (M1).
 */
export const METRIC_CONTRACT_VERSIONS: readonly string[] = [
  CONVERGENCE_METRIC_CONTRACT_V1,
] as const;

export function isMetricContractVersion(
  value: unknown,
): value is ConvergenceMetricContractV1 {
  return (
    typeof value === "string" &&
    (METRIC_CONTRACT_VERSIONS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Metric availability algebra (M16)
// ---------------------------------------------------------------------------

/**
 * Canonical reasons a metric may be unavailable. The set is
 * intentionally closed; the projector never invents a new reason
 * at runtime.
 *
 *   NOT_OBSERVED          — no Phase E observation of the
 *                           underlying signal exists.
 *   NOT_APPLICABLE        — the metric is not meaningful in
 *                           this run's terminal class.
 *   INCOMPLETE_RUN        — the run did not reach terminal
 *                           closure; some structural metrics
 *                           cannot be computed.
 *   INVALID_EVIDENCE      — the projector flagged the evidence
 *                           stream as INVALID_EVIDENCE; V1
 *                           refuses to derive most metrics in
 *                           that case rather than producing
 *                           misleading values.
 *   UNSUPPORTED_BY_CONTRACT
 *                         — the metric exists in the catalogue
 *                           but is not computable under the
 *                           current contract version.
 *   INVALID_DURATION      — observed wall-clock observations
 *                           were non-monotonic or produced a
 *                           negative duration; we refuse to
 *                           clamp.
 *   MISSING_TIMESTAMPS    — at least one observation needed for
 *                           the metric lacks an `observed_at`
 *                           stamp.
 */
export type UnavailabilityReason =
  | "NOT_OBSERVED"
  | "NOT_APPLICABLE"
  | "INCOMPLETE_RUN"
  | "INVALID_EVIDENCE"
  | "UNSUPPORTED_BY_CONTRACT"
  | "INVALID_DURATION"
  | "MISSING_TIMESTAMPS";

export const UNAVAILABILITY_REASONS: readonly UnavailabilityReason[] = [
  "NOT_OBSERVED",
  "NOT_APPLICABLE",
  "INCOMPLETE_RUN",
  "INVALID_EVIDENCE",
  "UNSUPPORTED_BY_CONTRACT",
  "INVALID_DURATION",
  "MISSING_TIMESTAMPS",
] as const;

/**
 * The metric availability algebra (M16).
 *
 * Every metric value is one of:
 *   {available: true,  value: V}
 *   {available: false, reason: UnavailabilityReason}
 *
 * This is the only shape a metric may take. LH-02 NEVER
 * substitutes 0 / false / "" for missing evidence.
 */
export type MetricValue<V> =
  | { readonly available: true; readonly value: V }
  | { readonly available: false; readonly reason: UnavailabilityReason };

/**
 * Construct an Available metric value.
 */
export function available<V>(value: V): MetricValue<V> {
  return { available: true, value };
}

/**
 * Construct an Unavailable metric value.
 */
export function unavailable<V>(
  reason: UnavailabilityReason,
): MetricValue<V> {
  return { available: false, reason };
}

/**
 * Type guard: is this metric value available?
 */
export function isAvailable<V>(
  v: MetricValue<V>,
): v is { readonly available: true; readonly value: V } {
  return v.available;
}

/**
 * Type guard: is this metric value unavailable with the
 * given reason? Used by tests asserting unavailability
 * reasons explicitly (M16 oracle).
 */
export function isUnavailableWith<V>(
  v: MetricValue<V>,
  reason: UnavailabilityReason,
): v is { readonly available: false; readonly reason: UnavailabilityReason } {
  return !v.available && v.reason === reason;
}

/**
 * Alias for the contract version string type. Re-exported
 * so call sites can write `MetricContractVersion` rather
 * than `ConvergenceMetricContractV1`.
 */
export type MetricContractVersion = ConvergenceMetricContractV1;

// ---------------------------------------------------------------------------
// Counter shapes (M4, M5, M6)
// ---------------------------------------------------------------------------

/**
 * Pure structural counters derived from the ordered Phase E
 * event stream. Definitions come from the M4 section of the
 * ACT. Every counter is an integer ≥ 0.
 *
 *   action_count             — count of ACTION_FINISHED events
 *                              (completed attempts only).
 *   successful_action_count  — count of ACTION_FINISHED with
 *                              status="OK"
 *   failed_action_count      — count of ACTION_FINISHED with
 *                              status="ERROR"
 *   gate_count               — count of GATE_FINISHED events
 *   passing_gate_count       — count of GATE_FINISHED with
 *                              pass=true
 *   failing_gate_count       — count of GATE_FINISHED with
 *                              pass=false
 *   repair_cycle_count       — count of REPAIR_FINISHED events
 *   completed_repair_cycle_count
 *                            — same as repair_cycle_count in V1
 *                              (every REPAIR_FINISHED is a
 *                              completed cycle); surfaced as a
 *                              distinct field per M4 to keep
 *                              the door open for future
 *                              partial-repair vocabulary.
 *   review_count             — count of REVIEW_FINISHED events
 *   passing_review_count     — count of REVIEW_FINISHED with
 *                              pass=true
 *   failing_review_count     — count of REVIEW_FINISHED with
 *                              pass=false
 *   work_epoch_count         — final value of
 *                              runProjection.work_epoch; the
 *                              number of distinct work epochs
 *                              observed.
 */
export type Counters = {
  readonly action_count: number;
  readonly successful_action_count: number;
  readonly failed_action_count: number;
  readonly gate_count: number;
  readonly passing_gate_count: number;
  readonly failing_gate_count: number;
  readonly repair_cycle_count: number;
  readonly completed_repair_cycle_count: number;
  readonly review_count: number;
  readonly passing_review_count: number;
  readonly failing_review_count: number;
  readonly work_epoch_count: number;
};

// ---------------------------------------------------------------------------
// Distance / iteration shapes (M5)
// ---------------------------------------------------------------------------

/**
 * Convergence distance measures (M5). Each is the count of
 * structural events from the start of the stream up to and
 * including the relevant anchor. NOT composite scores; LH-02
 * exposes the vector so callers can pick their own aggregation.
 *
 * M5 forbids calling any single one "the convergence score".
 *
 * `*_to_terminal` is always defined and counts the events
 * observed BEFORE the terminal claim (or, for non-terminal
 * runs, the events observed up to the end of the stream).
 *
 * `*_to_last_authoritative_pass` is the count of events
 * observed up to and including the LAST passing
 * GATE_FINISHED. Unavailable if no passing gate was ever
 * observed.
 */
export type ConvergenceDistances = {
  readonly actions_to_terminal: number;
  readonly repairs_to_terminal: number;
  readonly reviews_to_terminal: number;
  readonly gates_to_terminal: number;
  readonly work_epochs_to_terminal: number;
  readonly actions_to_last_authoritative_pass: MetricValue<number>;
  readonly repairs_to_last_authoritative_pass: MetricValue<number>;
  readonly reviews_to_last_authoritative_pass: MetricValue<number>;
  readonly work_epochs_to_last_authoritative_pass: MetricValue<number>;
};

// ---------------------------------------------------------------------------
// Correction burden (M6)
// ---------------------------------------------------------------------------

/**
 * Correction burden (M6).
 *
 * `authority_invalidation_count` is the count of
 * negative-evidence events that currently invalidate prior
 * closure authority. Concretely it is:
 *
 *   current_epoch_action_failure ? 1 : 0
 *   + current_epoch_review_failure ? 1 : 0
 *
 * This is bounded by 2 in V1 — those are the only two
 * structural authority-invalidation sources Phase E exposes
 * via projection (ACTION ERROR and REVIEW FAIL). Callers
 * should compose richer "burden" notions from the full
 * counter vector; LH-02 does not invent a single scalar.
 */
export type CorrectionBurden = {
  readonly repair_cycle_count: number;
  readonly failed_action_count: number;
  readonly failing_gate_count: number;
  readonly failing_review_count: number;
  readonly authority_invalidation_count: number;
};

// ---------------------------------------------------------------------------
// Time / wall-clock metrics (M8)
// ---------------------------------------------------------------------------

/**
 * Time/duration metrics (M8).
 *
 * Doctrine (M8):
 *   1. logical ordering remains Phase E `sequence`
 *   2. timestamps MUST NOT determine event order
 *   3. backward/non-monotonic wall-clock observations
 *      produce `unavailable`, never a clamped value
 *   4. missing timestamps produce `unavailable`, never 0
 *   5. negative durations fail metric validation
 *
 * All three durations are typed `MetricValue<number>` so the
 * type system forces callers to handle the unavailable case.
 */
export type TimeMetrics = {
  /**
   * wall-clock duration from the first observed event to
   * the last observed event of the run, in milliseconds.
   * Unavailable if any observed_at is missing or the
   * sequence is non-monotonic in wall-clock terms.
   */
  readonly observed_run_duration_ms: MetricValue<number>;
  /**
   * wall-clock duration from RUN_STARTED to the first
   * terminal event (or to the last observed event if no
   * terminal is present), in milliseconds.
   */
  readonly time_to_terminal_ms: MetricValue<number>;
  /**
   * wall-clock duration from RUN_STARTED to the last
   * passing GATE_FINISHED, in milliseconds. Unavailable
   * if no passing gate was observed.
   */
  readonly time_to_last_authoritative_pass_ms: MetricValue<number>;
};

// ---------------------------------------------------------------------------
// Resource metrics (M9, M10, M11)
// ---------------------------------------------------------------------------

/**
 * Resource metrics (M9 / M10 / M11).
 *
 * Each is either `available(value)` or `unavailable(reason)`
 * depending on whether the Phase E evidence stream exposes
 * the underlying observation.
 *
 * Phase E exposes `ResourceObservation` only as the
 * `observation` field of a `RUN_TIMEOUT` event in V1. LH-02
 * surfaces those observations as available when present and
 * otherwise as `unavailable("NOT_OBSERVED")`. LH-02 NEVER
 * infers resource consumption from action counts (M9), gate
 * counts, or any non-resource event (M10 / M11). This is
 * exactly the `MEASURED_CONSUMPTION != PRICING` separation
 * the ACT requires (M12).
 */
export type ResourceMetrics = {
  readonly tool_calls_total: MetricValue<number>;
  readonly input_tokens: MetricValue<number>;
  readonly output_tokens: MetricValue<number>;
  readonly total_tokens: MetricValue<number>;
  readonly peak_process_count: MetricValue<number>;
  readonly observed_wall_clock_ms: MetricValue<number>;
  /**
   * Token-source provenance distinction. Phase E V1 does
   * not capture provenance on ResourceObservation (the
   * observation is just `{kind, observed}`), so V1 reports
   * this dimension as
   * `unavailable("UNSUPPORTED_BY_CONTRACT")`. M10 says:
   * "If Phase E cannot currently prove provenance, record
   * metric availability limits rather than broadening Phase
   * E inside this ACT."
   */
  readonly token_source: MetricValue<
    "model_reported" | "provider_reported" | "harness_estimated" | "unclassified"
  >;
};

// ---------------------------------------------------------------------------
// Failure-shape observations (M14)
// ---------------------------------------------------------------------------

/**
 * Structural failure-shape observations (M14).
 *
 * OBSERVED facts only. LH-02 does NOT infer causal
 * statements like `MODEL_CAUSED_GATE_FAILURE`. The
 * `attributed_cause` field is always
 * `unavailable(...)` in V1 so the doctrine
 * `OBSERVED_FAILURE != ATTRIBUTED_CAUSE` is enforced at the
 * type level. A future ACT may introduce a separately
 * reviewed evidence vocabulary for causal attribution.
 */
export type FailureObservations = {
  readonly had_action_error: boolean;
  readonly had_gate_failure: boolean;
  readonly had_review_failure: boolean;
  readonly had_repair: boolean;
  readonly had_authority_invalidation: boolean;
  readonly observed_failure: boolean;
  readonly attributed_cause: MetricValue<string>;
};

// ---------------------------------------------------------------------------
// Convergence / non-convergence orthogonal facts (M15)
// ---------------------------------------------------------------------------

/**
 * Convergence / non-convergence orthogonal facts (M15).
 *
 * Doctrine: V1 MUST NOT use a single boolean to express
 * convergence. Instead, callers compose any convergence
 * predicate from the orthogonal facts below. V1 echoes the
 * Phase E `lifecycle_state` and `terminal_outcome` here,
 * but adds explicit `trustworthy_success`,
 * `budget_exhausted`, `timed_out`, `cancelled`,
 * `incomplete`, `invalid_evidence` booleans so downstream
 * consumers do not have to re-derive them from the
 * terminal semantic string.
 */
export type ConvergenceFacts = {
  readonly terminal: boolean;
  readonly terminal_outcome: string | null;
  readonly trustworthy_success: boolean;
  readonly budget_exhausted: boolean;
  readonly timed_out: boolean;
  readonly cancelled: boolean;
  readonly incomplete: boolean;
  readonly invalid_evidence: boolean;
};

// ---------------------------------------------------------------------------
// Success-normalized metrics (M13)
// ---------------------------------------------------------------------------

/**
 * Success-normalized metrics (M13). For trustworthy SUCCESS
 * only. For non-success runs LH-02 exposes
 * `eligible_for_success_normalized_metrics = false` rather
 * than encoding misleading divisions-by-zero. Cross-run
 * aggregation is OUT OF SCOPE for V1 (M0 / M13); each
 * report holds a single run's measurement vector.
 */
export type SuccessNormalized = {
  readonly eligible_for_success_normalized_metrics: boolean;
  readonly actions_per_success: MetricValue<number>;
  readonly repairs_per_success: MetricValue<number>;
  readonly tokens_per_success: MetricValue<number>;
  readonly tool_calls_per_success: MetricValue<number>;
  readonly time_per_success_ms: MetricValue<number>;
};

// ---------------------------------------------------------------------------
// Surviving-defect surface (M7)
// ---------------------------------------------------------------------------

/**
 * Surviving-defect surface (M7).
 *
 * Phase E records review verdict only (pass / fail), not a
 * structured defect inventory. V1 deliberately does NOT
 * fabricate `surviving_defect_count`. LH-02 exposes
 * `failing_review_count` and `final_review_state`. The
 * `surviving_defect_count` slot is reserved as
 * `unavailable("UNSUPPORTED_BY_CONTRACT")` so a future
 * evidence vocabulary extension can populate it without a
 * contract bump.
 */
export type SurvivingDefectSurface = {
  readonly failing_review_count: number;
  readonly final_review_state: MetricValue<boolean>;
  readonly surviving_defect_count: MetricValue<number>;
};

// ---------------------------------------------------------------------------
// Provenance / identity binding (M17)
// ---------------------------------------------------------------------------

/**
 * Report provenance (M17). Every MetricReport MUST bind:
 *
 *   metric_contract_version
 *   metric_report_schema_version
 *   run_id
 *   subject_id
 *   terminal_outcome
 *   last_sequence
 *   event_count
 *
 * Plus `run_evidence_hash` — sha-256 hex over the canonical
 * Phase E serialization of the ordered evidence stream, so
 * the report has a deterministic, replay-stable binding to
 * the exact evidence it describes.
 */
export type ReportProvenance = {
  readonly metric_contract_version: ConvergenceMetricContractV1;
  readonly metric_report_schema_version: MetricReportSchemaVersion;
  readonly run_id: string;
  readonly subject_id: string;
  readonly terminal_outcome: string | null;
  readonly last_sequence: number;
  readonly event_count: number;
  readonly run_evidence_hash: string;
};

// ---------------------------------------------------------------------------
// The MetricReport
// ---------------------------------------------------------------------------

/**
 * The convergence MetricReport. Pure derived value over the
 * immutable Phase E evidence substrate.
 *
 * `convergence.terminal_outcome` is structurally tied to
 * `provenance.terminal_outcome` because
 * `computeRunMetrics` constructs the report by reading the
 * projector-supplied `RunProjection.terminal_outcome` once
 * and writing the same value into both fields (M3 doctrine:
 * METRIC_TERMINAL_OUTCOME == PHASE_E_TERMINAL_OUTCOME).
 *
 * `metric_evidence_failure_observed` is true iff the
 * projector was given a Phase E `RunProjection` whose
 * `lifecycle_state` was `INVALID_EVIDENCE`. LH-02 does NOT
 * silently remap that into SUCCESS or any other terminal
 * outcome; the structural flag exists so the rejected-
 * derivation path is visible (M23).
 */
export type MetricReport = {
  readonly provenance: ReportProvenance;
  readonly convergence: ConvergenceFacts;
  readonly counters: Counters;
  readonly distances: ConvergenceDistances;
  readonly correction_burden: CorrectionBurden;
  readonly time: TimeMetrics;
  readonly resources: ResourceMetrics;
  readonly failure_shape: FailureObservations;
  readonly success_normalized: SuccessNormalized;
  readonly surviving_defect_surface: SurvivingDefectSurface;
  readonly metric_evidence_failure_observed: boolean;
};
