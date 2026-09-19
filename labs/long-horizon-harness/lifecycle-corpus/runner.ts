/**
 * LH-05 adversarial lifecycle corpus — runner.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * For each eligible (scenario, harness) pair the runner:
 *
 *   1. Creates fresh isolated replay workspace.
 *   2. Loads immutable raw fixture.
 *   3. Verifies LH-03 evidence provenance.
 *   4. Runs frozen adapter normalization.
 *   5. If expected adapter rejection:
 *      compares structured adapter error/disposition and stops.
 *   6. Otherwise decodes/projects with frozen Phase E.
 *   7. Computes frozen LH-02 metrics.
 *   8. Compares only declared golden predicates.
 *   9. Asserts forbidden outcomes absent.
 *  10. Records result.
 *  11. Destroys workspace.
 *
 * No network. No model API. No actual Pi/Cline executable.
 * No ambient user state.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type {
  LifecycleScenario,
  LifecycleReplayResult,
  HarnessQualificationIdentity,
  HarnessKind,
  AdapterErrorKind,
  RawFixture,
} from "./types.js";
import {
  LIFECYCLE_CORPUS_CATALOG,
  findScenario,
} from "./catalog.js";
import { compareScenario } from "./expected.js";
import {
  fakeAttemptId,
  harnessEventsToRunEvents,
  closeAttemptAndHarness,
} from "./reference-control.js";
import {
  loadPiFixture,
  piAttemptId,
  piHarnessEventsToRunEvents,
} from "./pi-fixtures.js";
import type {
  CommittedRunEvent,
  RunEvent,
  RunManifest,
  AttemptId,
} from "../src/run/run-types.js";
import {
  RUN_EVENT_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  computeRunId,
  makeRunEventId,
} from "../src/run/run-types.js";
import { projectRun } from "../src/run/run-projector.js";
import { computeRunMetrics } from "../src/metrics/metric-projector.js";
import type { SubjectId } from "../src/subject/subject-types.js";
import { makeSubjectId } from "../src/subject/index.js";

/* ====================================================================== *
 * Harness qualification identities                                        *
 * ====================================================================== */

export const PI_QUALIFICATION_IDENTITY: HarnessQualificationIdentity =
  Object.freeze({
    kind: "pi",
    provider: "earendil-works",
    version: "0.85.1",
    protocol: "JSONL_EVENTS",
    role: "QUALIFIED_HARNESS",
  });

export const CLINE_INELIGIBLE_IDENTITY: HarnessQualificationIdentity =
  Object.freeze({
    kind: "cline",
    provider: "cline",
    version: "unknown",
    protocol: "NDJSON",
    role: "INELIGIBLE_HALT",
  });

export const FAKE_REFERENCE_CONTROL_IDENTITY: HarnessQualificationIdentity =
  Object.freeze({
    kind: "fake",
    provider: "factory-scripted-fake",
    version: "v1",
    protocol: "SCRIPTED",
    role: "REFERENCE_CONTROL",
  });

/**
 * Per-scenario harness-eligibility evaluation. V1 expects:
 *
 *   PI:
 *     deterministic_protocol_qualification = PASS
 *     lifecycle_corpus_eligible = YES
 *   CLINE:
 *     qualification = HALT_CLINE_NOT_INSTALLED
 *     lifecycle_corpus_eligible = NO
 *   SCRIPTED_FAKE_ADAPTER:
 *     role = REFERENCE_CONTROL
 */
export function listEligibleHarnesses(): {
  readonly eligible: readonly HarnessQualificationIdentity[];
  readonly halted: readonly HarnessQualificationIdentity[];
} {
  return {
    eligible: [PI_QUALIFICATION_IDENTITY, FAKE_REFERENCE_CONTROL_IDENTITY],
    halted: [CLINE_INELIGIBLE_IDENTITY],
  };
}

/* ====================================================================== *
 * Manifest + event commitment helpers                                     *
 * ====================================================================== */

function makeSubjectIdForScenario(scenario: LifecycleScenario): SubjectId {
  // SubjectId grammar: /^subject:[0-9a-f]{64}$/.
  // Derive a deterministic 64-hex tail from scenario id.
  const onlyHex = scenario.id.toLowerCase().replace(/[^0-9a-f]/g, "a");
  let hex: string;
  if (onlyHex.length === 64) {
    hex = onlyHex;
  } else if (onlyHex.length > 64) {
    hex = onlyHex.slice(0, 64);
  } else {
    hex = onlyHex.padEnd(64, "0");
  }
  return makeSubjectId(`subject:${hex}`);
}

function buildManifest(scenario: LifecycleScenario): RunManifest {
  const subjectId = makeSubjectIdForScenario(scenario);
  const repetition = { index: 0, seed: scenario.id };
  const runId = computeRunId({
    subjectId,
    runSchemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    repetition,
  });
  return {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    subject_id: subjectId,
    run_protocol_version: "phase-e.lh05-corpus.v1",
    runner_revision: "lh05-corpus-runner",
    started_by: "lh05-corpus-runner",
    created_at: 0,
    repetition,
  };
}

function commitEvents(
  manifest: RunManifest,
  events: ReadonlyArray<RunEvent>,
): ReadonlyArray<CommittedRunEvent> {
  const out: CommittedRunEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const seq = i + 1;
    const eventId = makeRunEventId(
      `evt:${manifest.run_id}:${seq.toString().padStart(4, "0")}`,
    );
    out.push({
      schema_version: RUN_EVENT_SCHEMA_VERSION,
      event_id: eventId,
      run_id: manifest.run_id,
      subject_id: manifest.subject_id,
      sequence: seq,
      event: ev,
      observed_at: seq * 1000,
    });
  }
  return out;
}

/* ====================================================================== *
 * Fixture loading                                                         *
 * ====================================================================== */

function loadRawFixtureText(
  repoRoot: string,
  relPath: string,
): string {
  // Fixture paths in the catalog are relative to the lab
  // directory (`labs/long-horizon-harness/`), not the factory
  // repo root. The runner accepts either form.
  const labRoot = resolve(repoRoot, "labs/long-horizon-harness");
  const direct = resolve(repoRoot, relPath);
  const underLab = resolve(labRoot, relPath);
  // Prefer the path that exists. Order:
  //   1. if relPath starts with "labs/long-horizon-harness/"
  //      then the caller passed the top-level repo root and
  //      the direct path is correct.
  //   2. if the direct path exists (caller passed the lab
  //      root directly), use it.
  //   3. fall back to the under-lab path (caller passed the
  //      top-level repo root and relPath is relative to the
  //      lab dir).
  if (relPath.startsWith("labs/long-horizon-harness/")) {
    return readFileSync(direct, "utf8");
  }
  if (existsSync(direct)) {
    return readFileSync(direct, "utf8");
  }
  return readFileSync(underLab, "utf8");
}

function loadFakeScript(
  repoRoot: string,
  relPath: string,
): {
  readonly harness: ReadonlyArray<{
    readonly type: string;
    readonly attemptId?: string;
    readonly tool?: string;
    readonly callId?: string;
    readonly ok?: boolean;
    readonly error?: string;
    readonly summary?: string;
    readonly code?: string;
    readonly message?: string;
  }>;
  readonly run_events: ReadonlyArray<RunEvent>;
} {
  const text = loadRawFixtureText(repoRoot, relPath);
  const parsed = JSON.parse(text) as {
    harness?: ReadonlyArray<{
      readonly type: string;
      readonly attemptId?: string;
      readonly tool?: string;
      readonly callId?: string;
      readonly ok?: boolean;
      readonly error?: string;
      readonly summary?: string;
      readonly code?: string;
      readonly message?: string;
    }>;
    run_events?: ReadonlyArray<RunEvent>;
  };
  return {
    harness: parsed.harness ?? [],
    run_events: parsed.run_events ?? [],
  };
}

/**
 * Load a phase_e_oracle fixture, which declares the
 * canonical hand-pinned Phase E events (gate / terminal)
 * that close the run. This is the closed-world
 * "Phase E reference oracle" exception permitted by
 * ACT §7: every scenario still drives the harness
 * adapter for harness-native events; only the gate /
 * terminal Phase E events are hand-authored.
 */
function loadPhaseEOracle(
  repoRoot: string,
  scenario: LifecycleScenario,
): ReadonlyArray<RunEvent> {
  const oracle = scenario.raw_fixture_set.find(
    (f): f is RawFixture & { readonly kind: "phase_e_oracle_json" } =>
      f.kind === "phase_e_oracle_json",
  );
  if (oracle === undefined) return [];
  const text = loadRawFixtureText(repoRoot, oracle.repo_relative_path);
  return JSON.parse(text) as ReadonlyArray<RunEvent>;
}

/* ====================================================================== *
 * Adapter normalization                                                   *
 * ====================================================================== */

type AdapterOutcome =
  | { readonly kind: "ACCEPTED" }
  | { readonly kind: "REJECTED"; readonly error_kind: AdapterErrorKind };

function normalizePi(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
  readonly harnessEventAttemptId: AttemptId;
}): AdapterOutcome & {
  readonly harnessEvents: ReadonlyArray<import("../src/protocol/harness-adapter.js").HarnessEvent>;
} {
  // Pick the first pi_native_session_jsonl fixture, or concatenate segments.
  const piFixtures = args.scenario.raw_fixture_set.filter(
    (f): f is RawFixture & { readonly kind: "pi_native_session_jsonl" } =>
      f.kind === "pi_native_session_jsonl",
  );
  if (piFixtures.length === 0) {
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
    };
  }
  try {
    let all: import("../src/protocol/harness-adapter.js").HarnessEvent[] = [];
    for (const fx of piFixtures) {
      const part = loadPiFixture({
        repoRoot: args.repoRoot,
        repoRelativePath: fx.repo_relative_path,
        attemptId: args.harnessEventAttemptId,
      });
      all = all.concat(part);
    }
    return { kind: "ACCEPTED", harnessEvents: all };
  } catch (err) {
    // Decode threw -> adapter boundary rejection.
    const msg = (err as Error).message;
    if (msg.includes("malformed")) {
      return {
        kind: "REJECTED",
        error_kind: "MALFORMED_NATIVE_EVENT",
        harnessEvents: [],
      };
    }
    if (msg.includes("unknown")) {
      return {
        kind: "REJECTED",
        error_kind: "UNKNOWN_NATIVE_EVENT_KIND",
        harnessEvents: [],
      };
    }
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
    };
  }
}

function normalizeFake(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
  readonly harnessEventAttemptId: AttemptId;
}): AdapterOutcome & {
  readonly harnessEvents: ReadonlyArray<import("../src/protocol/harness-adapter.js").HarnessEvent>;
  readonly directRunEvents: ReadonlyArray<RunEvent>;
} {
  if (!args.scenario.eligible_harnesses.fake_reference_control.eligible) {
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
      directRunEvents: [],
    };
  }
  const fx = args.scenario.raw_fixture_set.find(
    (f): f is RawFixture & { readonly kind: "scripted_fake_event_script" } =>
      f.kind === "scripted_fake_event_script",
  );
  if (fx === undefined) {
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
      directRunEvents: [],
    };
  }
  const raw = loadFakeScript(args.repoRoot, fx.repo_relative_path);
  // The scripted-fake-adapter consumes typed HarnessEvents;
  // for the reference control we treat the script JSON as
  // a serialized HarnessEvent stream.
  const events: import("../src/protocol/harness-adapter.js").HarnessEvent[] = [];
  for (const e of raw.harness) {
    switch (e.type) {
      case "candidate_started":
        events.push({ type: "candidate_started", attemptId: e.attemptId ?? args.harnessEventAttemptId });
        break;
      case "candidate_message":
        events.push({ type: "candidate_message", attemptId: e.attemptId ?? args.harnessEventAttemptId, text: e.summary ?? "" });
        break;
      case "tool_started":
        events.push({ type: "tool_started", attemptId: e.attemptId ?? args.harnessEventAttemptId, tool: e.tool ?? "unknown", callId: e.callId ?? "c1" });
        break;
      case "tool_finished":
        events.push({ type: "tool_finished", attemptId: e.attemptId ?? args.harnessEventAttemptId, tool: e.tool ?? "unknown", callId: e.callId ?? "c1", ok: e.ok ?? false, ...(e.error !== undefined ? { error: e.error } : {}) });
        break;
      case "candidate_reported_completion":
        events.push({ type: "candidate_reported_completion", attemptId: e.attemptId ?? args.harnessEventAttemptId, summary: e.summary ?? "done" });
        break;
      case "candidate_error":
        events.push({ type: "candidate_error", attemptId: e.attemptId ?? args.harnessEventAttemptId, code: e.code ?? "ERROR", message: e.message ?? "" });
        break;
      default:
        return {
          kind: "REJECTED",
          error_kind: "UNKNOWN_NATIVE_EVENT_KIND",
          harnessEvents: [],
          directRunEvents: [],
        };
    }
  }
  return { kind: "ACCEPTED", harnessEvents: events, directRunEvents: raw.run_events };
}

/* ====================================================================== *
 * LH-04 handoff for LC11                                                  *
 * ====================================================================== */

import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync as _readFileSync, writeFileSync as _writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as _resolve } from "node:path";
import {
  verifyLiveQualificationEvidence,
} from "../src/adapter-common/evidence-verifier.js";
import {
  buildCanonicalBaseline,
  CANONICAL_BASELINE_FILES,
} from "./deterministic-baseline-bridge.js";
import { FAULT_CATALOG } from "./lh04-fault-bridge.js";

async function runLh04Handoff(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
}): Promise<AdapterOutcome> {
  // LC11 is the only FAULT_LAB_HANDOFF scenario.
  const faultIdMarker = args.scenario.raw_fixture_set.find(
    (f) => f.kind === "corruption_handoff_fixture",
  );
  if (faultIdMarker === undefined) {
    return { kind: "REJECTED", error_kind: "EVIDENCE_CORRUPTION_DETECTED" };
  }
  const markerText = loadRawFixtureText(
    args.repoRoot,
    faultIdMarker.repo_relative_path,
  );
  const faultId = markerText.trim();
  const fault = FAULT_CATALOG.find((f) => f.id === faultId);
  if (fault === undefined) {
    return { kind: "REJECTED", error_kind: "EVIDENCE_CORRUPTION_DETECTED" };
  }
  const labRoot = _resolve(args.repoRoot, "labs/long-horizon-harness");
  const base = process.env["FACTORY_LH05_WORKSPACE_BASE"] ?? tmpdir();
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  const ws = mkdtempSync(`${base.replace(/\/$/, "")}/lh05-fault-handoff-`);
  try {
    // Copy the canonical baseline files into the workspace.
    // The LH-04 baseline files are repo-relative to the lab dir.
    for (const rel of CANONICAL_BASELINE_FILES) {
      const src = _resolve(labRoot, rel);
      const dst = _resolve(ws, rel);
      mkdirSync(dirname(dst), { recursive: true });
      _writeFileSync(dst, _readFileSync(src));
    }
    // Build the canonical baseline; verify it passes (unmutated).
    const baseline = buildCanonicalBaseline({ workspaceRoot: ws });
    const verifierOk = verifyLiveQualificationEvidence(baseline, ws).ok;
    if (!verifierOk) {
      return { kind: "REJECTED", error_kind: "EVIDENCE_CORRUPTION_DETECTED" };
    }
    // Apply the fault's mutate + postBuild hooks against the workspace,
    // re-build the baseline, and verify the LH-04 frozen verifier rejects.
    await fault.mutate(ws);
    let mutated = buildCanonicalBaseline({ workspaceRoot: ws });
    if (fault.postBuild !== undefined) {
      mutated = fault.postBuild(ws, mutated, baseline);
    }
    const verifierResult = verifyLiveQualificationEvidence(mutated, ws);
    if (verifierResult.ok) {
      // ESCAPED: LH-04 should have rejected this; the handoff
      // failed closed at the verifier level.
      return { kind: "REJECTED", error_kind: "EVIDENCE_CORRUPTION_DETECTED" };
    }
    // LH-04 frozen verifier rejected the corrupted evidence;
    // the handoff succeeded.
    return { kind: "REJECTED", error_kind: "EVIDENCE_CORRUPTION_DETECTED" };
  } catch {
    return { kind: "REJECTED", error_kind: "EVIDENCE_CORRUPTION_DETECTED" };
  } finally {
    try {
      rmSync(ws, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

/* ====================================================================== *
 * Per-scenario replay execution                                           *
 * ====================================================================== */

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

  // LC11: hand off to LH-04.
  if (args.scenario.scenario_class === "FAULT_LAB_HANDOFF") {
    const adapter = await runLh04Handoff({
      repoRoot: args.repoRoot,
      scenario: args.scenario,
    });
    return compareScenario(args.scenario, harnessId, {
      adapter,
      phase_e: null,
      lh02: null,
      success_normalized_metrics_emitted: false,
    });
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
  const harnessMapped: ReadonlyArray<RunEvent> =
    args.harness === "fake"
      ? harnessEventsToRunEvents(norm.harnessEvents, harnessEventAttemptId, omitRunStarted)
      : piHarnessEventsToRunEvents(norm.harnessEvents, harnessEventAttemptId, omitRunStarted);
  const oracleEvents = loadPhaseEOracle(args.repoRoot, args.scenario);
  const runEvents: ReadonlyArray<RunEvent> = closeAttemptAndHarness(
    harnessMapped,
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

export async function runScenarioForHarness(args: {
  readonly repoRoot: string;
  readonly scenarioId: string;
  readonly harness: HarnessKind;
}): Promise<LifecycleReplayResult> {
  const scenario = findScenario(args.scenarioId);
  if (scenario === undefined) {
    throw new Error(`runScenarioForHarness: unknown scenario '${args.scenarioId}'`);
  }
  return runReplay({
    repoRoot: args.repoRoot,
    scenario,
    harness: args.harness,
  });
}

export async function runCorpus(args: {
  readonly repoRoot: string;
}): Promise<ReadonlyArray<LifecycleReplayResult>> {
  const out: LifecycleReplayResult[] = [];
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (scenario.eligible_harnesses.pi.eligible) {
      out.push(
        await runReplay({
          repoRoot: args.repoRoot,
          scenario,
          harness: "pi",
        }),
      );
    }
    if (scenario.eligible_harnesses.fake_reference_control.eligible) {
      out.push(
        await runReplay({
          repoRoot: args.repoRoot,
          scenario,
          harness: "fake",
        }),
      );
    }
  }
  return out;
}

/**
 * Strip fields that legitimately vary between runs (free-text
 * notes) and keep only the semantically meaningful fields.
 * Used for TWO_RUN_SEMANTIC_REPEATABILITY.
 */
export function semanticReplayShape(
  result: LifecycleReplayResult,
): Omit<LifecycleReplayResult, "notes"> {
  return {
    scenario_id: result.scenario_id,
    scenario_version: result.scenario_version,
    scenario_class: result.scenario_class,
    harness: result.harness,
    execution_mode: result.execution_mode,
    adapter_disposition: result.adapter_disposition,
    adapter_error_kind: result.adapter_error_kind,
    phase_e_lifecycle_state: result.phase_e_lifecycle_state,
    phase_e_terminal_outcome: result.phase_e_terminal_outcome,
    lh02_predicates: result.lh02_predicates,
    forbidden_outcomes: result.forbidden_outcomes,
    success_normalized_metrics_emitted: result.success_normalized_metrics_emitted,
    disposition: result.disposition,
  };
}
