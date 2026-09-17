/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * The canonical pure metric projector (M2).
 *
 *   computeRunMetrics(
 *       subject,
 *       manifest,
 *       orderedEvents,
 *       runProjection,
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

import type {
  CommittedRunEvent,
  RunManifest,
  RunProjection,
} from "../run/run-types.js";
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
 *                     `runProjection.subject_id`, enforcing
 *                     M3 identity binding).
 *   manifest        — the Phase E `RunManifest`.
 *   orderedEvents   — the immutably-ordered Phase E event
 *                     stream. The projector does NOT
 *                     re-project this stream; the caller is
 *                     expected to have produced
 *                     `runProjection` from the SAME
 *                     orderedEvents via
 *                     `projectRun(manifest, orderedEvents)`.
 *   runProjection   — the projector-supplied `RunProjection`
 *                     for the same evidence stream.
 *   contractVersion — the metric-contract identity the
 *                     caller wants to use. V1 recognizes
 *                     exactly `CONVERGENCE_METRIC_CONTRACT_V1`.
 *
 * Output:
 *   MetricResult. On success the report contains the full
 *   measurement vector. On failure the reason string
 *   documents why derivation did not produce a report.
 */
export function computeRunMetrics(args: {
  readonly subject: string;
  readonly manifest: RunManifest;
  readonly orderedEvents: ReadonlyArray<CommittedRunEvent>;
  readonly runProjection: RunProjection;
  readonly contractVersion: string;
}): MetricResult {
  // (1) Contract guard (M1).
  const cv = guardContractVersion(args.contractVersion);
  if (!cv.ok) {
    return { ok: false, reason: cv.reason };
  }

  // (2) Identity-binding to the projector (M23). The metric
  // projector re-asserts that the supplied run/subject
  // pair matches the projector's view. It refuses to mint
  // a report if they don't — LH-02 is bound to Phase E
  // identity, not free-floating inputs.
  if (args.manifest.run_id !== args.runProjection.run_id) {
    return {
      ok: false,
      reason:
        `computeRunMetrics: manifest.run_id '${args.manifest.run_id}' ` +
        `does not match runProjection.run_id '${args.runProjection.run_id}'`,
    };
  }
  if (args.subject !== args.runProjection.subject_id) {
    return {
      ok: false,
      reason:
        `computeRunMetrics: subject '${args.subject}' does not match ` +
        `runProjection.subject_id '${args.runProjection.subject_id}'`,
    };
  }

  // (3) Derive sub-vectors. Each is a pure function of
  // (orderedEvents, runProjection, counters). The
  // composition order is fixed so two callers with the
  // same inputs produce structurally equal reports
  // (M2 oracle).
  const counters: Counters = deriveCounters(
    args.orderedEvents,
    args.runProjection.work_epoch,
  );
  const distances: ConvergenceDistances = deriveConvergenceDistances(
    args.orderedEvents,
  );
  const correction_burden: CorrectionBurden = deriveCorrectionBurden(
    counters,
    args.runProjection,
  );
  const time: TimeMetrics = deriveTimeMetrics(args.orderedEvents);
  const resources: ResourceMetrics = deriveResourceMetrics(
    args.orderedEvents,
  );
  const convergence: ConvergenceFacts = deriveConvergenceFacts(
    args.runProjection,
  );
  const failure_shape: FailureObservations = deriveFailureObservations(
    counters,
    args.runProjection,
  );
  const success_normalized: SuccessNormalized = deriveSuccessNormalized(
    args.runProjection,
    counters,
    time,
    resources,
  );
  const surviving_defect_surface: SurvivingDefectSurface =
    deriveSurvivingDefectSurface(counters, args.orderedEvents);

  // (4) Hash the evidence stream.
  const run_evidence_hash = deriveRunEvidenceHash(args.orderedEvents);

  // (5) Assemble the provenance.
  const provenance: ReportProvenance = {
    metric_contract_version: cv.version,
    metric_report_schema_version: METRIC_REPORT_SCHEMA_VERSION,
    run_id: args.runProjection.run_id,
    subject_id: args.runProjection.subject_id,
    terminal_outcome: args.runProjection.terminal_outcome,
    last_sequence: args.runProjection.last_sequence,
    event_count: args.runProjection.event_count,
    run_evidence_hash,
  };

  // (6) Final report. `convergence.terminal_outcome` is
  // filled from the same projector value as
  // `provenance.terminal_outcome` — see below for the
  // `metric_evidence_failure_observed` flag, which is
  // structural visibility into the rejected-derivation
  // path rather than a silent remap.
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
      args.runProjection.lifecycle_state === "INVALID_EVIDENCE",
  };
  return { ok: true, report };
}

/**
 * Re-export the V1 contract identity from this entry point
 * for callers that don't want to reach through
 * `metric-contract.ts`.
 */
export { CONVERGENCE_METRIC_CONTRACT_V1 };
