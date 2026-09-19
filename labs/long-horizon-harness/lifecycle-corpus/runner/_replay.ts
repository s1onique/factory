/**
 * LH-05 runner — replay module (split for source-size discipline).
 *
 * L05-C08: parent runner.ts is the SINGLE logical authority.
 */
import type { HarnessQualificationIdentity, HarnessKind, LifecycleScenario, LifecycleReplayResult } from "../types.js";
import type { AttemptId, RunEvent } from "../../src/run/run-types.js";
import { computeRunMetrics } from "../../src/metrics/metric-projector.js";
import { projectRun } from "../../src/run/run-projector.js";
import { compareScenario, compareScenarioWithHandoff } from "../expected.js";
import { fakeAttemptId, harnessEventsToRunEvents, closeAttemptAndHarness } from "../reference-control.js";
import { piAttemptId, piHarnessEventsToRunEvents } from "../pi-fixtures.js";
import { PI_QUALIFICATION_IDENTITY, CLINE_INELIGIBLE_IDENTITY, FAKE_REFERENCE_CONTROL_IDENTITY } from "./_identities.js";
import { commitEvents, buildManifest, loadFactoryExternalEvents } from "./_fixtures.js";
import { normalizePi, normalizeFake } from "./_normalize.js";
import { runLh04Handoff } from "./_handoff.js";
export { runReplay };

async function runReplay(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
  readonly harness: HarnessKind;
}): Promise<LifecycleReplayResult> {
  const harnessId: HarnessQualificationIdentity =
    args.harness === "pi"
      ? PI_QUALIFICATION_IDENTITY
      : args.harness === "cline"
        ? CLINE_INELIGIBLE_IDENTITY
        : FAKE_REFERENCE_CONTROL_IDENTITY;

  // LC11: hand off to LH-04 frozen verifier.
  if (args.scenario.scenario_class === "FAULT_LAB_HANDOFF") {
    const handoff = await runLh04Handoff({
      repoRoot: args.repoRoot,
      scenario: args.scenario,
    });
    // L05-C04: only LH04_HANDOFF_REJECTED_AS_EXPECTED can
    // produce a PASS. The other four typed outcomes must each
    // fail loudly so the corpus can detect a regression in
    // either the LH-04 substrate or our handoff logic.
    return compareScenarioWithHandoff(args.scenario, harnessId, handoff);
  }

  const harnessEventAttemptId: AttemptId =
    args.harness === "fake" ? fakeAttemptId(args.scenario.id) : piAttemptId(args.scenario.id);

  // 1. Adapter normalization.
  const norm =
    args.harness === "pi"
      ? normalizePi({
          repoRoot: args.repoRoot,
          scenario: args.scenario,
          harnessEventAttemptId,
        })
      : args.harness === "fake"
        ? normalizeFake({
            repoRoot: args.repoRoot,
            scenario: args.scenario,
            harnessEventAttemptId,
          })
        : { kind: "REJECTED" as const, error_kind: "EVIDENCE_CORRUPTION_DETECTED" as const, harnessEvents: [] };

  // Short-circuit on adapter rejection.
  if (norm.kind === "REJECTED") {
    return compareScenario(args.scenario, harnessId, {
      adapter: { kind: "REJECTED", error_kind: norm.error_kind },
      phase_e: null,
      lh02: null,
      success_normalized_metrics_emitted: false,
    });
  }

  // 2. Map HarnessEvents -> RunEvents, then insert the
  // scenario-specific Phase E oracle events (gate / terminal).
  // The harness mapper emits RUN_STARTED + HARNESS_STARTED +
  // an open ACTION_STARTED (no close) UNLESS omit_run_started
  // is set on the scenario (LC02/LC10/LC11 -> INCOMPLETE).
  const omitRunStarted = args.scenario.omit_run_started === true;
  // L05-C01: the harness mapper returns pre_gate and post_gate
  // event arrays. The runner interleaves the external-events
  // oracle (gate / cancel / terminal) BETWEEN them so that the
  // gate can re-authorise after the action started but before
  // the action finished.
  const mapperOut =
    args.harness === "fake"
      ? harnessEventsToRunEvents(norm.harnessEvents, harnessEventAttemptId, omitRunStarted)
      : piHarnessEventsToRunEvents(norm.harnessEvents, harnessEventAttemptId, omitRunStarted);
  const oracleEvents = loadFactoryExternalEvents(args.repoRoot, args.scenario);
  const runEvents: ReadonlyArray<RunEvent> = closeAttemptAndHarness(
    mapperOut.pre_gate,
    mapperOut.post_gate,
    oracleEvents,
    harnessEventAttemptId,
    "OK",
  );

  // 3. Build manifest + commit events.
  const manifest = buildManifest(args.scenario);
  const committed = commitEvents(manifest, runEvents);

  // 4. Phase E projection.
  const projection = projectRun(manifest, committed);
  if (!projection.ok && process.env["LH05_DEBUG"] === "1") {
    console.error("LH-05 PROJECTION FAILED:", args.scenario.id, args.harness, JSON.stringify(projection.failure));
  }
  const phaseEActual = projection.ok
    ? {
        lifecycle_state: projection.value.lifecycle_state,
        terminal_outcome: projection.value.terminal_outcome,
        closure_authority_fresh: projection.value.closure_authority_fresh,
        current_epoch_action_failure: projection.value.current_epoch_action_failure,
        current_epoch_review_failure: projection.value.current_epoch_review_failure,
        last_gate_pass: projection.value.current_gate.kind === "finished"
          ? projection.value.current_gate.pass
          : null,
        last_action_status: projection.value.last_action_status,
        last_review_pass: projection.value.last_review_pass,
        action_failure_at_epoch: projection.value.action_failure_at_epoch,
        review_failure_at_epoch: projection.value.review_failure_at_epoch,
      }
    : null;

  // 5. LH-02 metric predicates.
  // V1: we call the FROZEN LH-02 projector to obtain the
  // canonical `MetricReport`. The corpus asserts only the
  // declared predicates; no new LH-02 contract field is
  // introduced. The frozen LH-02 contract is at HEAD
  // 715e6390d78228f089270259e1bd1307140adb75.
  const lh02Result = projection.ok
    ? computeRunMetrics({
        subject: manifest.subject_id,
        manifest,
        orderedEvents: committed,
        contractVersion: "convergence.metric.contract.v1",
      })
    : null;
  if (projection.ok && (!lh02Result || !lh02Result.ok) && process.env["LH05_DEBUG"] === "1") {
    console.error("LH-05 LH02 FAILED:", args.scenario.id, args.harness, JSON.stringify(lh02Result));
  }

  const lh02Actual = lh02Result !== null && lh02Result.ok
    ? {
        metric_contract_version: lh02Result.report.provenance.metric_contract_version,
        terminal_outcome: lh02Result.report.provenance.terminal_outcome ?? null,
        eligible_for_success_normalized_metrics:
          lh02Result.report.success_normalized !== undefined &&
          lh02Result.report.success_normalized !== null
            ? lh02Result.report.success_normalized.eligible_for_success_normalized_metrics
            : null,
        historical_authority_invalidation_count:
          lh02Result.report.correction_burden.historical_authority_invalidation_count,
        metric_evidence_failure_observed:
          lh02Result.report.metric_evidence_failure_observed,
      }
    : null;

  const successMetricsEmitted =
    phaseEActual !== null && phaseEActual.terminal_outcome === "SUCCESS";

  return compareScenario(args.scenario, harnessId, {
    adapter: { kind: "ACCEPTED" },
    phase_e: phaseEActual,
    lh02: lh02Actual,
    success_normalized_metrics_emitted: successMetricsEmitted,
  });
}

/* ====================================================================== *
 * Public runner entrypoints                                               *
 * ====================================================================== */
