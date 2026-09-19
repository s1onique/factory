/**
 * LH-05 runner — fixtures module (split for source-size discipline).
 *
 * L05-C08: parent runner.ts is the SINGLE logical authority.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { LifecycleScenario, RawFixture } from "../types.js";
import type { CommittedRunEvent, RunEvent, RunManifest } from "../../src/run/run-types.js";
import type { SubjectId } from "../../src/subject/subject-types.js";
import { RUN_EVENT_SCHEMA_VERSION, RUN_MANIFEST_SCHEMA_VERSION, computeRunId, makeRunEventId } from "../../src/run/run-types.js";
import { makeSubjectId } from "../../src/subject/index.js";
export { loadRawFixtureText, loadFakeScript, loadFactoryExternalEvents, makeSubjectIdForScenario, buildManifest, commitEvents };

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
  // L05-C01 fallout: accept BOTH the legacy object-wrapped
  // shape (`{harness:[...], run_events:[...]}`) AND the
  // top-level array shape used by the LC01..LC12 fixtures.
  const parsed = JSON.parse(text) as
    | ReadonlyArray<{
        readonly type: string;
        readonly attemptId?: string;
        readonly tool?: string;
        readonly callId?: string;
        readonly ok?: boolean;
        readonly error?: string;
        readonly summary?: string;
        readonly code?: string;
        readonly message?: string;
      }>
    | {
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
  if (Array.isArray(parsed)) {
    return { harness: parsed, run_events: [] };
  }
  const obj = parsed as {
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
    harness: obj.harness ?? [],
    run_events: obj.run_events ?? [],
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
function loadFactoryExternalEvents(
  repoRoot: string,
  scenario: LifecycleScenario,
): ReadonlyArray<RunEvent> {
  const oracle = scenario.raw_fixture_set.find(
    (f): f is RawFixture & { readonly kind: "factory_external_events_json" } =>
      f.kind === "factory_external_events_json",
  );
  if (oracle === undefined) return [];
  const text = loadRawFixtureText(repoRoot, oracle.repo_relative_path);
  return JSON.parse(text) as ReadonlyArray<RunEvent>;
}

/* ====================================================================== *
 * Adapter normalization                                                   *
 * ====================================================================== */
