/**
 * LH-06 deterministic long-duration soak laboratory —
 * terminal result synthesis + run-loop + env entry.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * This module is the canonical assembly for:
 *
 *   - The terminal result artifact (synthesised from worker
 *     state; never self-authoritative).
 *   - The worker run-loop (drives `runEpoch` until the
 *     qualification contract is met).
 *   - The env-based entrypoint (`runSoakFromEnv`).
 *
 * The supervisor reads the result artifact; it does NOT
 * trust any "verdict" string inside the JSON (ACT §43).
 */
import { LH06_PROFILES } from "./contract.js";
import {
  envIdentity,
  isSubstrateComplete,
  substrateBindingFromFiles,
} from "./substrate-binding.js";
import type { SoakWorkerState } from "./worker-state.js";
import {
  type LH06FailureRecord,
  type LH06Result,
  verdictForFailure,
} from "./result.js";
import {
  LH06_RESULT_SCHEMA,
  LH06_SOAK_CONTRACT_VERSION,
  type LH06Verdict,
  type SoakFaultInjection,
} from "./types.js";
import type { OwnedResourceSnapshot } from "./resource-ledger.js";
import type { DurableTelemetryClose } from "./telemetry-store.js";
import {
  deriveInternalFailure,
  listMissingSubstrate,
} from "./failure-derivation.js";
import {
  buildFrozenTreeSection,
  buildLatencySection,
  buildResourceSection,
  buildSemanticSection,
} from "./section-builders.js";

export interface LH06RunLoopArgs {
  readonly state: SoakWorkerState;
  readonly result_path: string;
  readonly max_epochs?: number;
}

export type { OwnedResourceSnapshot };

export function parseInjection(s: string): SoakFaultInjection {
  switch (s) {
    case "NONE":
      return { kind: "NONE" };
    case "LEAK01":
      return { kind: "LEAK01_RETAIN_BYTES_PER_EPOCH", bytes: 1024 * 1024 };
    case "LEAK02":
      return { kind: "LEAK02_LEAVE_WORKSPACE_OPEN" };
    case "LEAK03":
      return { kind: "LEAK03_RETAIN_OWNED_STREAM" };
    case "LEAK04":
      return { kind: "LEAK04_SEMANTIC_DRIFT_AT_EPOCH", at_epoch: 5 };
    case "LEAK05":
      return { kind: "LEAK05_LATENCY_DRIFT_PER_EPOCH", per_epoch_ms: 50 };
    case "LEAK06":
      return {
        kind: "LEAK06_MUTATE_FROZEN_FIXTURE",
        fixture_rel_path:
          "lifecycle-corpus/fixtures/lc01-canonical-success/pi.session.jsonl",
      };
    case "LEAK07":
      return { kind: "LEAK07_STOP_HEARTBEATS_AFTER", after_epoch: 5 };
    default:
      return { kind: "NONE" };
  }
}

export function readOwnedSnapshot(
  state: SoakWorkerState,
): OwnedResourceSnapshot {
  return state.ledger.snapshot();
}


/**
 * Build the full terminal result. The caller supplies an
 * `externalFailure` for worker-level crash / hang paths;
 * otherwise the function inspects the soak state and
 * surfaces the first internal violation as the failure.
 *
 * L06-CORRECTION03:
 *   - L06-C16: frozen-tree integrity must have
 *     `status.ok=true` (or a CONTENT change surfaces as
 *     FROZEN_MUTATION).
 *   - L06-C17: durable telemetry MUST be closed and
 *     its hash recorded. `INVALID_TELEMETRY` is
 *     surfaced when no telemetry is available.
 *   - L06-C21: substrate must be COMPLETE (all six
 *     identities non-null) before PASS is possible.
 */
export function buildResult(args: {
  readonly state: SoakWorkerState;
  readonly failure: LH06FailureRecord | null;
  readonly telemetry: DurableTelemetryClose | null;
}): LH06Result {
  const started = new Date(args.state.started_at_ms).toISOString();
  const finished = new Date().toISOString();
  const duration = Date.now() - args.state.started_at_ms;
  const semantic = buildSemanticSection(args.state);
  const resources = buildResourceSection(args.state);
  const latency = buildLatencySection(args.state);
  const frozenTree = buildFrozenTreeSection(args.state);
  // L06-CORRECTION03 L06-C21: tests can override the
  // substrate binding for CI_SMOKE. Production profiles
  // ignore the override.
  const substrateOverride = (args.state as unknown as {
    substrateOverride?: Parameters<typeof substrateBindingFromFiles>[1];
  }).substrateOverride;
  const substrate =
    args.state.profile === "CI_SMOKE" && substrateOverride !== undefined
      ? substrateBindingFromFiles(args.state.repoRoot, substrateOverride)
      : substrateBindingFromFiles(args.state.repoRoot);

  const internal = deriveInternalFailure({
    state: args.state,
    external: args.failure,
    semantic,
    resources,
    latency,
    frozenTree,
  });

  // L06-CORRECTION03 L06-C21: substrate completeness is a
  // PASS gate, not a warning. Surface as a typed failure
  // so the run cannot PASS without all six identities.
  const substrateComplete = isSubstrateComplete(substrate);
  let internalOrSubstrate: LH06FailureRecord | null = internal;
  if (
    internalOrSubstrate === null &&
    !substrateComplete
  ) {
    internalOrSubstrate = {
      kind: "INCONCLUSIVE_ENVIRONMENT",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: { missing_substrate: listMissingSubstrate(substrate) },
      message: "substrate binding incomplete",
    };
  }

  // L06-CORRECTION03 L06-C17: telemetry must be present.
  if (internalOrSubstrate === null && args.telemetry === null) {
    internalOrSubstrate = {
      kind: "INVALID_TELEMETRY",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: { reason: "no durable telemetry close result" },
      message: "durable telemetry was not closed before run termination",
    };
  }

  // The PASS verdict is reserved for runs whose duration AND
  // epoch count both satisfy the profile contract. An
  // under-length run (caller-imposed max_epochs exhaustion
  // before the qualification deadline) is reported as
  // QUALIFICATION_INCOMPLETE — never PASS. ONE_GREEN_ITERATION
  // != SOAK_STABILITY.
  const pc = LH06_PROFILES[args.state.profile];
  const contractMet =
    duration >= pc.minimum_wall_clock_ms &&
    args.state.epochs_completed >= pc.minimum_epochs;

  let verdict: LH06Verdict;
  // L06-CORRECTION06 L06-C32: when the producer
  // determines the verdict, it MUST also keep the
  // failure record consistent. The verifier enforces
  // `verdict === PASS_DETERMINISTIC_SOAK iff failure
  // === null`. So a QUALIFICATION_INCOMPLETE verdict
  // (without any other failure) needs an
  // accompanying `failure` record of the matching
  // kind. The previous design left `failure: null`
  // with a non-PASS verdict; the verifier (rightly)
  // rejected that as INCONSISTENT_VERDICT, even
  // though it was the producer's own output. This
  // fixes the producer so the verifier and the
  // producer agree on the verdict/failure pairing.
  let failureWithIncomplete:
    | LH06FailureRecord
    | null = internalOrSubstrate;
  if (internalOrSubstrate !== null) {
    verdict = verdictForFailure(internalOrSubstrate.kind);
  } else if (!contractMet) {
    verdict = "QUALIFICATION_INCOMPLETE";
    failureWithIncomplete = {
      kind: "QUALIFICATION_INCOMPLETE",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: {
        duration_ms: duration,
        epochs_completed: args.state.epochs_completed,
        minimum_wall_clock_ms: pc.minimum_wall_clock_ms,
        minimum_epochs: pc.minimum_epochs,
      },
      message:
        `profile ${args.state.profile} contract minima not satisfied ` +
        `(duration_ms=${duration} >= ${pc.minimum_wall_clock_ms} ?, ` +
        `epochs_completed=${args.state.epochs_completed} >= ` +
        `${pc.minimum_epochs} ?); the run terminated before contract met`,
    };
  } else {
    verdict = "PASS_DETERMINISTIC_SOAK";
  }

  return {
    schema: LH06_RESULT_SCHEMA,
    contract_version: LH06_SOAK_CONTRACT_VERSION,
    profile: args.state.profile,
    started_at: started,
    finished_at: finished,
    duration_ms: duration,
    environment_identity: envIdentity(
      args.state.runId,
      args.state.profile,
      LH06_SOAK_CONTRACT_VERSION,
    ),
    substrate,
    epochs_completed: args.state.epochs_completed,
    cases_completed: args.state.cases_completed,
    semantic,
    resources,
    latency,
    frozen_tree: frozenTree,
    repeatability: {
      semantic_repeatability:
        semantic.drift_count === 0 &&
        semantic.predecessor_dependency_count === 0 &&
        semantic.cases_with_multiple_semantic_results === 0,
    },
    failure: failureWithIncomplete,
    verdict,
    telemetry_path: args.telemetry?.path ?? null,
    telemetry_sha256: args.telemetry?.sha256 ?? null,
    telemetry_bytes: args.telemetry?.bytes ?? null,
    telemetry_line_count: args.telemetry?.line_count ?? null,
    supervisor_run_id:
      process.env["LH06_SUPERVISOR_RUN_ID"] ?? null,
    substrate_complete: substrateComplete,
    // L06-CORRECTION06 L06-C33: publication durability
    // is a property of the WRITE, not of the run. The
    // builder sets a sentinel (`null`); `writeResult`
    // fills in the actual durability class of the
    // canonical publication. The verifier reads the
    // field after writeResult runs.
    publication_durability: null,
  };

}
