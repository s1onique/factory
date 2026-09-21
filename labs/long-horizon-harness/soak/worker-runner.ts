/**
 * LH-06 deterministic long-duration soak laboratory — the
 * run loop and env-based entrypoint.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from result-builder.ts for source-size discipline.
 * Pure orchestration; consumes the result builder + epoch
 * runner.
 */
import { injectionAllowedForProfile } from "./resource-ledger.js";
import {
  createWorkerState,
  type SoakWorkerState,
} from "./worker-state.js";
import {
  type LH06Result,
  type LH06FailureRecord,
  writeResult,
} from "./result.js";
import {
  LH06_LH04_CASE_IDS,
  LH06_LH05_CASE_IDS,
  type LH06SoakProfile,
  type SoakFaultInjection,
} from "./types.js";
import { runEpoch, restoreLeak06, prepareLeak06 } from "./epoch.js";
import { qualificationMet } from "./epoch-helpers.js";
import { buildResult, parseInjection } from "./result-builder.js";
import { defaultRepoRoot } from "./substrate-binding.js";
import {
  DurableTelemetryStore,
  type DurableTelemetryClose,
} from "./telemetry-store.js";
import { resolve as pathResolve } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

export interface LH06RunLoopArgs {
  readonly state: SoakWorkerState;
  readonly result_path: string;
  readonly max_epochs?: number;
}

/**
 * Run the soak worker to completion. The terminal result is
 * written on every exit path.
 *
 * Required:
 *   EVERY_STARTED_SOAK_HAS_TERMINAL_RESULT = TRUE
 *
 * L06-CORRECTION02 C02-04: the production resource balance
 * includes `active_soak_runs`. We acquire / release the
 * counter honestly here (not just in the env entrypoint) so
 * the wiring is correct regardless of how the worker is
 * invoked — direct call, test harness, supervisor, or
 * run-soak.sh.
 *
 * Idempotent: `beginRun` throws on duplicate runId, so we
 * skip the call if the counter is already non-zero for this
 * runId (e.g. when called via `runSoakFromEnv`, which has
 * already acquired the counter).
 */
function ensureRunAcquired(state: SoakWorkerState): void {
  // Inspect the ledger's in-flight set to determine whether
  // the run counter is already acquired. We do NOT call
  // `snapshot()` because the active_soak_runs counter is
  // also at 1 even after `endRun` was called by a prior
  // failed run (the worker may have been respawned with a
  // fresh state); what we actually need to check is the
  // inFlightRuns set membership for THIS runId.
  const inFlight = (state.ledger as unknown as {
    inFlightRuns?: Set<string>;
  }).inFlightRuns;
  if (inFlight !== undefined && inFlight.has(state.runId)) return;
  state.ledger.beginRun(state.runId);
}

/**
 * Idempotent endRun: only releases the counter if the
 * ledger currently holds it. Without this guard the
 * `finally` block would throw `endRun: unknown runId`
 * when `runSoakWorker` is called via `runSoakFromEnv`
 * (which already released the counter).
 */
function releaseRunIfHeld(state: SoakWorkerState): void {
  const inFlight = (state.ledger as unknown as {
    inFlightRuns?: Set<string>;
  }).inFlightRuns;
  if (inFlight === undefined || !inFlight.has(state.runId)) return;
  state.ledger.endRun(state.runId);
}

export async function runSoakWorker(
  args: LH06RunLoopArgs,
): Promise<LH06Result> {
  // Acquire the production run counter so the balance is
  // honest on every exit path. Idempotent with respect to
  // the env entrypoint.
  ensureRunAcquired(args.state);
  // L06-CORRECTION03 L06-C17 + L06-CORRECTION04 L06-C23:
  // open the durable telemetry store at run start so
  // EVERY exit path produces a closed telemetry file.
  // The close result feeds the result artifact.
  //
  // C23 ownership: the default telemetry directory is a
  // per-run mkdtemp under os.tmpdir(), NOT the
  // repository. Tests MUST NOT leave persistent
  // filesystem residue inside the lab. The
  // `LH06_TELEMETRY_DIR` env var is the only way to
  // override the path; qualification runs pass it
  // explicitly to route the artifact to the durable
  // evidence location, and the supervisor copies the
  // closed file to the canonical result path.
  const telemetryDir = process.env["LH06_TELEMETRY_DIR"]
    ? pathResolve(process.env["LH06_TELEMETRY_DIR"])
    : pathResolve(tmpdir(), "factory-lh06");
  // Make sure the directory exists. We do NOT use
  // mkdtempSync here because the closed file's path
  // must remain readable by the supervisor's
  // re-verification after the worker exits (L06-C20).
  mkdirSync(telemetryDir, { recursive: true });
  const telemetryPath = pathResolve(
    telemetryDir,
    `lh06-${args.state.runId}.telemetry.jsonl`,
  );
  const telemetry = new DurableTelemetryStore(telemetryPath);
  telemetry.open();
  let capturedClose: DurableTelemetryClose | null = null;
  let capturedErr: string | null = null;
  try {
    // Capture the pristine LEAK06 fixture BEFORE any epoch
    // runs, so subsequent mutations can be rolled back to
    // the original bytes regardless of any prior run's
    // behaviour.
    if (args.state.injection.kind === "LEAK06_MUTATE_FROZEN_FIXTURE") {
      prepareLeak06(
        args.state.repoRoot,
        args.state.injection.fixture_rel_path,
      );
    }
    if (
      !injectionAllowedForProfile(args.state.injection, args.state.profile)
    ) {
      const fail: LH06FailureRecord = {
        kind: "WORKER_CRASH",
        epoch: null,
        last_completed_case: null,
        minimal_diff: {
          injection: args.state.injection,
          profile: args.state.profile,
        },
        message:
          `injection ${args.state.injection.kind} is not allowed on profile ${args.state.profile}`,
      };
      // Close telemetry so we still have a closed file.
      const closeRes = telemetry.close();
      if (closeRes.ok) capturedClose = closeRes;
      else capturedErr = closeRes.detail;
      const result = buildResult({
        state: args.state,
        failure: fail,
        telemetry: capturedClose,
      });
      const pub = writeResult({ path: args.result_path, result });
      restoreLeak06();
      // `pub.result` is the enhanced artifact with
      // `publication_durability` baked in. Return
      // THAT, not the pre-write `result` (whose
      // `publication_durability` is still null).
      // L06-CORRECTION06 L06-C33.
      return pub.result;
    }
    const max = args.max_epochs ?? Number.POSITIVE_INFINITY;
    let failure: LH06FailureRecord | null = null;
    for (let i = 0; i < max; i++) {
      const epochOutcome = await runEpoch({
        state: args.state,
        epochIndex: i,
      });
      // L06-CORRECTION03 L06-C17: append a per-epoch
      // telemetry line so the supervisor can re-verify a
      // non-empty stream. We don't fail the run if the
      // write errors — that's a typed INVALID_TELEMETRY
      // captured at close.
      try {
        telemetry.append({
          kind: "EPOCH",
          ts_ms: Date.now(),
          payload: {
            epoch_index: i,
            outcome_ok: epochOutcome.ok,
            epochs_completed: args.state.epochs_completed,
            cases_completed: args.state.cases_completed,
          },
        });
        telemetry.flush();
      } catch {
        // best-effort; the close path surfaces typed errors
      }
      if (!epochOutcome.ok) {
        failure = {
          kind: epochOutcome.failure ?? "WORKER_CRASH",
          epoch: i,
          last_completed_case: args.state.last_completed_case,
          minimal_diff: null,
          message:
            `epoch ${i} failed: ${epochOutcome.failure ?? "WORKER_CRASH"}`,
        };
        break;
      }
      const elapsed = Date.now() - args.state.started_at_ms;
      if (qualificationMet({
        profile: args.state.profile,
        duration_ms: elapsed,
        epochs_completed: args.state.epochs_completed,
      })) {
        break;
      }
    }
    // Close telemetry BEFORE building the result so the
    // hash is available for binding.
    const closeRes = telemetry.close();
    if (closeRes.ok) capturedClose = closeRes;
    else capturedErr = closeRes.detail;
    void capturedErr;
    const result = buildResult({
      state: args.state,
      failure,
      telemetry: capturedClose,
    });
    const pub = writeResult({ path: args.result_path, result });
    // `pub.result` is the enhanced artifact with
    // `publication_durability` baked in. Return that
    // so downstream callers (and assertions about the
    // returned terminal record) see the actual
    // durability class. The on-disk file at
    // `args.result_path` carries the same enhanced
    // JSON; the verifier reads it directly.
    // L06-CORRECTION06 L06-C33.
    return pub.result;
  } finally {
    // L06-CORRECTION03 L06-C19: restore any LEAK06-mutated
    // fixture on EVERY exit path (including test-induced
    // throws) so subsequent runs start from a clean state.
    try {
      restoreLeak06();
    } catch {
      // best-effort
    }
    // L06-CORRECTION04 L06-C23: the telemetry file
    // lives under os.tmpdir()/factory-lh06/ — outside
    // the repository — so no cleanup is required for
    // repo hygiene. The OS will eventually sweep the
    // temp directory; the closed file's path must
    // remain readable so the supervisor's
    // re-verification (L06-C20) can find it.
    // Release the production run counter on EVERY exit
    // path so the balance is zero at process exit.
    releaseRunIfHeld(args.state);
    void capturedClose;
    void capturedErr;
  }
}

/**
 * Convenience entrypoint.
 */
export async function runSoakFromEnv(args: {
  readonly result_path: string;
}): Promise<LH06Result> {
  const profile = (process.env["LH06_PROFILE"] ?? "CI_SMOKE") as LH06SoakProfile;
  const injectionRaw = process.env["LH06_INJECTION"] ?? "NONE";
  const injection = parseInjection(injectionRaw);
  const repoRoot = defaultRepoRoot();
  const state = createWorkerState({ profile, injection, repoRoot });
  // L06-CORRECTION02 C02-04: the production resource
  // balance INCLUDES `active_soak_runs` — the worker must
  // honestly acquire / release it. This is the wiring that
  // was missing in CORRECTION01: the summary claimed the
  // counter was exercised by the run loop, but
  // `beginRun()` / `endRun()` were never called.
  state.ledger.beginRun(state.runId);
  // LH06_MAX_EPOCHS caps the loop when supplied (used by the
  // supervisor or the CI smoke script). Without it the worker
  // runs until the qualification contract is met.
  const envCap = process.env["LH06_MAX_EPOCHS"];
  const maxEpochs =
    envCap !== undefined && envCap !== ""
      ? Number.parseInt(envCap, 10)
      : undefined;
  const runArgs: {
    readonly state: SoakWorkerState;
    readonly result_path: string;
    readonly max_epochs?: number;
  } = {
    state,
    result_path: args.result_path,
  };
  if (maxEpochs !== undefined) {
    (runArgs as { max_epochs?: number }).max_epochs = maxEpochs;
  }
  try {
    return await runSoakWorker(runArgs);
  } finally {
    // Release the run counter on every exit path so the
    // production balance is zero at process exit.
    state.ledger.endRun(state.runId);
  }
}

export const LH06_CORPUS_COUNTS = Object.freeze({
  lh05: LH06_LH05_CASE_IDS.length,
  lh04: LH06_LH04_CASE_IDS.length,
  canonical_epoch_size:
    LH06_LH05_CASE_IDS.length + LH06_LH04_CASE_IDS.length + 3,
});

export type { SoakFaultInjection };

/**
 * Module entrypoint. When this file is spawned as the main
 * module by `node --import tsx soak/worker-runner.ts`, the
 * harness invokes `runSoakFromEnv` and writes the result to
 * `LH06_RESULT_PATH` (or a default under the lab's
 * qualification directory). Without this entrypoint the
 * process would load definitions and exit without running
 * any soak — a critical defect that previously made the
 * supervisor path a no-op.
 *
 * This block ONLY runs when this file is the process entry
 * point (`import.meta.url === pathToFileURL(process.argv[1])`).
 */
const invokedDirectly = (() => {
  try {
    const thisUrl = new URL(import.meta.url);
    const argvUrl = new URL(
      `file://${process.argv[1] ?? ""}`,
    );
    return thisUrl.href === argvUrl.href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const resultPath =
    process.env["LH06_RESULT_PATH"] ??
    "qualification/lh06-deterministic-soak.json";
  runSoakFromEnv({ result_path: resultPath })
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            verdict: result.verdict,
            epochs: result.epochs_completed,
            duration_ms: result.duration_ms,
          },
          null,
          2,
        ),
      );
      // Exit with a non-zero status when the verdict is not
      // PASS_DETERMINISTIC_SOAK. The supervisor reads the
      // result artifact for the final disposition; the exit
      // code is a fast-path signal.
      process.exit(result.verdict === "PASS_DETERMINISTIC_SOAK" ? 0 : 1);
    })
    .catch((err: unknown) => {
      console.error(
        JSON.stringify({
          type: "LH06_WORKER_FATAL",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      process.exit(2);
    });
}
