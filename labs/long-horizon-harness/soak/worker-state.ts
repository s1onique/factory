/**
 * LH-06 deterministic long-duration soak laboratory —
 * worker state and helpers.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Pure-state helpers and worker state construction. The
 * substrate-binding, environment-identity, frozen-tree
 * digest, repo-commit, and GC helpers live in
 * `./substrate-binding.js` to keep this module under the
 * 400-LOC source-size discipline ceiling.
 */
import { createHash } from "node:crypto";
import { ResourceLedger } from "./resource-ledger.js";
import { SemanticLedger } from "./semantic-ledger.js";
import { BoundedTelemetryBuffer } from "./telemetry.js";
import { computeFrozenTreeDigest } from "./substrate-binding.js";
import type { LH06SoakProfile, SoakFaultInjection } from "./types.js";
import type { LH06SubstrateBinding } from "./result.js";

/**
 * L06-CORRECTION03 L06-C21: CI_SMOKE-only env seam.
 * Production profiles MUST NOT honour this variable;
 * the worker reads it only when the profile is
 * CI_SMOKE. Returning `undefined` is a no-op.
 */
function readSubstrateOverrideEnv(): LH06SubstrateBinding | undefined {
  const raw = process.env["LH06_SUBSTRATE_OVERRIDE"];
  if (raw === undefined || raw === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as LH06SubstrateBinding;
  } catch {
    return undefined;
  }
}

export function makeRunId(args: {
  readonly started_at_ms: number;
  readonly repo_commit: string | null;
}): string {
  const h = createHash("sha256");
  h.update(`${args.started_at_ms}|${args.repo_commit ?? "<no-commit>"}`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Soak worker state. Held by the worker; nothing else
 * writes to this object.
 */
export interface SoakWorkerState {
  readonly runId: string;
  readonly repoRoot: string;
  readonly profile: LH06SoakProfile;
  readonly injection: SoakFaultInjection;
  readonly started_at_ms: number;
  epochs_completed: number;
  cases_completed: number;
  heapSamples: number[];
  rssSamples: number[];
  epochLatenciesMs: number[];
  resource_balance_failures: number;
  workspace_leaks: number;
  lh05_replays: number;
  lh04_executions: number;
  fault_escape_count: number;
  lifecycle_drift_count: number;
  fault_wrong_kind_count: number;
  fault_wrong_authority_count: number;
  last_completed_case: string | null;
  readonly ledger: ResourceLedger;
  readonly semanticLedger: SemanticLedger;
  readonly telemetry: BoundedTelemetryBuffer;
  // L06-CORRECTION03 L06-C16: beforeFrozenSha is the
  // pristine SHA captured at run start. We hold a string
  // when the integrity oracle could be computed and
  // `null` when the run was unable to capture it (which
  // is itself a typed FAILURE surfaced via the frozen
  // tree section's `status.ok=false`).
  beforeFrozenSha: string | null;
  // L06-CORRECTION03 L06-C21: CI_SMOKE-only substrate
  // override. Production profiles (QUALIFICATION /
  // EXTENDED) MUST ignore this; the worker reads it
  // only when the profile is CI_SMOKE.
  readonly substrateOverride: LH06SubstrateBinding | undefined;
  leak05PerEpochMs: number;
  leak01RetainedBuffer: Buffer[];
  leak02RetainedWorkspacePath: string | null;
  leak03RetainedStreamId: string | null;
  leak07StoppedHeartbeats: boolean;
}

export function createWorkerState(args: {
  readonly profile: LH06SoakProfile;
  readonly injection: SoakFaultInjection;
  readonly repoRoot: string;
}): SoakWorkerState {
  const startMs = Date.now();
  return {
    runId: makeRunId({
      started_at_ms: startMs,
      // repo_commit is resolved separately during
      // substrate-binding assembly. The run-id is bound to
      // the wall-clock start to keep the id cheap and
      // process-local; the actual repo commit is recorded
      // in the result artifact.
      repo_commit: null,
    }),
    repoRoot: args.repoRoot,
    profile: args.profile,
    injection: args.injection,
    started_at_ms: startMs,
    epochs_completed: 0,
    cases_completed: 0,
    heapSamples: [],
    rssSamples: [],
    epochLatenciesMs: [],
    resource_balance_failures: 0,
    workspace_leaks: 0,
    lh05_replays: 0,
    lh04_executions: 0,
    fault_escape_count: 0,
    lifecycle_drift_count: 0,
    fault_wrong_kind_count: 0,
    fault_wrong_authority_count: 0,
    last_completed_case: null,
    ledger: new ResourceLedger(),
    semanticLedger: new SemanticLedger(),
    telemetry: new BoundedTelemetryBuffer(),
    beforeFrozenSha: (() => {
      // L06-CORRECTION03 L06-C16: the digest result is
      // a closed sum type. Capture only the SHA when the
      // integrity oracle succeeded; `null` is the
      // typed-failure marker that flows into
      // `frozen_tree.status.ok=false`.
      const r = computeFrozenTreeDigest(args.repoRoot);
      return r.ok ? r.digest : null;
    })(),
    // L06-CORRECTION03 L06-C21: CI_SMOKE-only env seam
    // that lets a test harness inject a complete substrate
    // without consulting the live qualification artifacts.
    // Production profiles (QUALIFICATION / EXTENDED)
    // ignore the override.
    substrateOverride: readSubstrateOverrideEnv(),
    leak05PerEpochMs: 0,
    leak01RetainedBuffer: [],
    leak02RetainedWorkspacePath: null,
    leak03RetainedStreamId: null,
    leak07StoppedHeartbeats: false,
  };
}
