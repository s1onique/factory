/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * The canonical pure metric projector (M2).
 *
 *   computeRunMetrics(
 *       subject,
 *       manifest,
 *       orderedEvents,
 *       contractVersion,
 *   ) -> MetricResult
 *
 * Invariant (M2):
 *
 *   SAME_INPUT_EVIDENCE
 *   +
 *   SAME_METRIC_CONTRACT
 *   =
 *   STRUCTURALLY_EQUIVALENT_METRIC_REPORT
 *
 * Invariant (M3):
 *
 *   METRIC_TERMINAL_OUTCOME
 *   ==
 *   PHASE_E_TERMINAL_OUTCOME
 *
 * Invariant (M-C01, CORRECTION01 + CORRECTION02 M-C07
 *             + CORRECTION03 M-C13):
 *
 *   METRIC_REPORT  ↔  EXACT_RUN_EVIDENCE
 *
 *   The Phase-E projection is INTERNALLY derived from the
 *   same `orderedEvents` the rest of the report consumes.
 *   Callers cannot supply a projection from a different
 *   evidence stream. To verify an externally-supplied
 *   projection against the evidence, use
 *   `verifyProjectionBind` — which compares the supplied
 *   projection to the internally-derived one with STRUCTURAL
 *   (value) equality, not JavaScript reference identity
 *   (CORRECTION02 M-C07).
 *
 *   METRIC_AUTHORITY_END_STATE == PHASE_E_AUTHORITY_END_STATE
 *
 *   The metric has ONE interpretation of the frozen
 *   Phase-E precedence model (M-C09). `walkAuthority()`
 *   returns the same closure-authority boolean, the same
 *   review-blocker boolean, and the same work epoch as
 *   the Phase-E projector (M-C13). Any divergence is a
 *   typed metric rejection so authority-algebra drift
 *   surfaces here rather than in a downstream consumer.
 *
 * The projector NEVER:
 *
 *   - touches Date.now()
 *   - touches Math.random()
 *   - reads ambient process state
 *   - inspects the filesystem
 *   - reaches across the network
 *   - reads current vendor pricing
 *   - reads the current git / fs state
 *
 * The only I/O the projector performs is a single
 * `createHash(...).update(...)` call inside the
 * `run_evidence_hash` derivation (`metric-hash.ts`).
 * Otherwise this module is pure.
 */

import { isDeepStrictEqual } from "node:util";

import type {
  CommittedRunEvent,
  RunManifest,
  RunProjection,
} from "../run/run-types.js";
import { projectRun } from "../run/run-projector.js";
import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  METRIC_REPORT_SCHEMA_VERSION,
  type ConvergenceFacts,
  type CorrectionBurden,
  type Counters,
  type ConvergenceDistances,
  type FailureObservations,
  type MetricReport,
  type ReportProvenance,
  type ResourceMetrics,
  type SuccessNormalized,
  type SurvivingDefectSurface,
  type TimeMetrics,
} from "./metric-types.js";

import { guardContractVersion } from "./metric-contract.js";
import {
  assertAuthorityEndStateMatchesProjection,
  walkAuthority,
} from "./metric-authority.js";
import { deriveCounters } from "./metric-counters.js";
import {
  deriveConvergenceDistances,
  deriveCorrectionBurden,
} from "./metric-distances.js";
import { deriveTimeMetrics } from "./metric-time.js";
import { deriveResourceMetrics } from "./metric-resources.js";
import {
  deriveConvergenceFacts,
  deriveFailureObservations,
  deriveSuccessNormalized,
} from "./metric-shape.js";
import { deriveSurvivingDefectSurface } from "./metric-surviving-defect.js";
import { deriveRunEvidenceHash } from "./metric-hash.js";

/**
 * The single canonical result type for `computeRunMetrics`.
 * The projector NEVER throws. A failed run surfaces as
 * `{ok:false, reason}` so callers can compose uniformly.
 */
export type MetricResult =
  | { readonly ok: true; readonly report: MetricReport }
  | { readonly ok: false; readonly reason: string };

/**
 * Compute the canonical `MetricReport` for one run.
 *
 * Inputs:
 *   subject         — the Phase D `SubjectId` (kept for
 *                     provenance completeness; the projector
 *                     asserts that this matches
 *                     `manifest.subject_id`).
 *   manifest        — the Phase E `RunManifest`.
 *   orderedEvents   — the immutably-ordered Phase E event
 *                     stream. The metric module DERIVES the
 *                     Phase E projection from this stream
 *                     internally via
 *                     `projectRun(manifest, orderedEvents)`.
 *                     Callers cannot supply a separate
 *                     projection (CORRECTION01 M-C01); use
 *                     `verifyProjectionBind` to verify an
 *                     externally-supplied projection
 *                     matches the internally-derived one.
 *   contractVersion — the metric-contract identity the
 *                     caller wants to use. V1 recognizes
 *                     exactly `convergence.metric.contract.v1`.
 *                     Unrecognized values are refused (M1).
 */
export function computeRunMetrics(args: {
  readonly subject: import("../subject/subject-types.js").SubjectId;
  readonly manifest: RunManifest;
  readonly orderedEvents: ReadonlyArray<CommittedRunEvent>;
  readonly contractVersion: unknown;
}): MetricResult {
  // (1) Guard the requested contract version. Refusing an
  // unrecognized version is a hard failure (M1) — the
  // projector never silently reinterprets under a different
  // formula while preserving the same version.
  const cv = guardContractVersion(args.contractVersion);
  if (!cv.ok) {
    return { ok: false, reason: cv.reason };
  }

  // (2) Internally derive the Phase E projection from the
  // SAME orderedEvents the report will describe. M-C01
  // (CORRECTION01): the projection is no longer an
  // independent caller input. Every metric, terminal
  // outcome, provenance field, and evidence hash derives
  // from this one stream.
  const projectionResult = projectRun(args.manifest, args.orderedEvents);
  if (!projectionResult.ok) {
    return {
      ok: false,
      reason:
        `computeRunMetrics: phase E projection rejected the evidence ` +
        `stream (${projectionResult.failure.kind}): ` +
        `${projectionResult.failure.reason}`,
    };
  }
  const projection: RunProjection = projectionResult.value;

  // (3) Identity binding to the projector (M23). The
  // supplied subject must match the projector's view.
  // LH-02 is bound to Phase E identity, not free-floating
  // inputs.
  if (args.subject !== projection.subject_id) {
    return {
      ok: false,
      reason:
        `computeRunMetrics: subject '${args.subject}' does not match ` +
        `projection.subject_id '${projection.subject_id}'`,
    };
  }

  // (3.5) End-state parity oracle (CORRECTION03 M-C13).
  // The metric has ONE interpretation of the frozen
  // Phase-E authority precedence model. We now assert
  // that the canonical `walkAuthority()` end-state
  // matches the Phase-E projector's end-state on every
  // field that the metric channeled exposes:
  // closure authority, review-blocker boolean, and
  // work epoch. Any divergence is a typed metric
  // rejection — never a silent corruption — so future
  // authority-algebra drift surfaces here rather than
  // in a downstream consumer's report.
  const authorityWalk = walkAuthority(args.orderedEvents);
  const parity = assertAuthorityEndStateMatchesProjection(
    authorityWalk,
    projection,
  );
  if (!parity.ok) {
    return {
      ok: false,
      reason: `computeRunMetrics: ${parity.reason}`,
    };
  }

  // (4) Derive sub-vectors. Each is a pure function of
  // (orderedEvents, projection, counters). The composition
  // order is fixed so two callers with the same inputs
  // produce structurally equal reports (M2 oracle).
  const counters: Counters = deriveCounters(
    args.orderedEvents,
    projection.work_epoch,
  );
  const convergence: ConvergenceFacts = deriveConvergenceFacts(projection);
  const distances: ConvergenceDistances = deriveConvergenceDistances(
    args.orderedEvents,
    convergence.trustworthy_success,
  );
  const correction_burden: CorrectionBurden = deriveCorrectionBurden(
    counters,
    args.orderedEvents,
    projection,
  );
  const time: TimeMetrics = deriveTimeMetrics(args.orderedEvents);
  const resources: ResourceMetrics = deriveResourceMetrics(
    args.orderedEvents,
  );
  const failure_shape: FailureObservations = deriveFailureObservations(
    counters,
    projection,
  );
  const success_normalized: SuccessNormalized = deriveSuccessNormalized(
    projection,
    counters,
    time,
    resources,
  );
  const surviving_defect_surface: SurvivingDefectSurface =
    deriveSurvivingDefectSurface(counters, args.orderedEvents);

  // (5) Hash the evidence stream.
  const run_evidence_hash = deriveRunEvidenceHash(args.orderedEvents);

  // (6) Assemble the provenance.
  const provenance: ReportProvenance = {
    metric_contract_version: cv.version,
    metric_report_schema_version: METRIC_REPORT_SCHEMA_VERSION,
    run_id: projection.run_id,
    subject_id: projection.subject_id,
    terminal_outcome: projection.terminal_outcome,
    last_sequence: projection.last_sequence,
    event_count: projection.event_count,
    run_evidence_hash,
  };

  // (7) Final report. `convergence.terminal_outcome` is
  // filled from the same projector value as
  // `provenance.terminal_outcome` — both come from the
  // SAME internally-derived projection over the SAME
  // `orderedEvents`. The `metric_evidence_failure_observed`
  // flag surfaces the INVALID_EVIDENCE lifecycle_state
  // structurally rather than silently remapping it.
  const report: MetricReport = {
    provenance,
    convergence,
    counters,
    distances,
    correction_burden,
    time,
    resources,
    failure_shape,
    success_normalized,
    surviving_defect_surface,
    metric_evidence_failure_observed:
      projection.lifecycle_state === "INVALID_EVIDENCE",
  };
  return { ok: true, report };
}

/**
 * CORRECTION02 M-C07 — value-equality verify-bind helper.
 *
 * Caller-supplied projections are no longer accepted by
 * `computeRunMetrics`. This helper lets callers that ALREADY
 * hold a projection (e.g. for some upstream routing
 * decision) verify it was derived from the same evidence
 * the report will describe.
 *
 * Returns `{ok: true}` iff `suppliedRunProjection` is
 * STRUCTURALLY EQUAL to the projection derived from
 * `(manifest, orderedEvents)` via `projectRun`. We use
 * `node:util`'s `isDeepStrictEqual` so two independently
 * produced projections of the same evidence are
 * recognized as the same projection.
 *
 * Why value equality, not reference identity: Phase E's
 * projector is deterministic (E12 oracle), which means
 *
 *   f(x) ≡ f(x)       in value
 *
 * NOT
 *
 *   f(x) === f(x)     in JavaScript reference identity.
 *
 * Two independent calls to a pure projector ordinarily
 * allocate two distinct object references. A reference-
 * identity check would (incorrectly) reject a perfectly
 * valid projection produced by an independent call. That
 * breaks reproducibility: repeatability requires that
 * two measurements of the same evidence agree, not
 * that the two result objects happen to be the same
 * allocation. See NIST TN 1297 Appendix D.1.
 *
 * If the projections disagree on any field, `verifyProjectionBind`
 * returns a structured `{ok:false, reason}` describing
 * which field(s) differ so callers can diagnose the
 * mismatch.
 */
export function verifyProjectionBind(args: {
  readonly manifest: RunManifest;
  readonly orderedEvents: ReadonlyArray<CommittedRunEvent>;
  readonly suppliedRunProjection: RunProjection;
}): {
  readonly ok: boolean;
  readonly reason?: string;
} {
  const projectionResult = projectRun(args.manifest, args.orderedEvents);
  if (!projectionResult.ok) {
    return {
      ok: false,
      reason:
        `verifyProjectionBind: phase E projection rejected the ` +
        `evidence stream (${projectionResult.failure.kind}): ` +
        `${projectionResult.failure.reason}`,
    };
  }
  if (!isDeepStrictEqual(projectionResult.value, args.suppliedRunProjection)) {
    return {
      ok: false,
      reason:
        `verifyProjectionBind: supplied projection was NOT ` +
        `structurally equal to the canonical projection of ` +
        `this evidence stream (projection binding violation; ` +
        `REPORT_PROJECTION_EVIDENCE_SPLIT_BRAIN)`,
    };
  }
  return { ok: true };
}

/**
 * Re-export the V1 contract identity from this entry point
 * for callers that don't want to reach through
 * `metric-contract.ts`.
 */
export { CONVERGENCE_METRIC_CONTRACT_V1 };
