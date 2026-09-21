/**
 * LH-06 deterministic long-duration soak laboratory — result
 * schema and terminal-result writer.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * The terminal result artifact is the durable record of the
 * soak. It MUST be written even on crash / hang / watchdog
 * termination (ACT §29). The schema is closed-world and
 * machine-demonstrable; the verifier inspects every
 * required closure field (ACT §43).
 */
import { LH06_RESULT_SCHEMA, type LH06Verdict } from "./types.js";
import type { HeapStabilityVerdict } from "./thresholds.js";
import type { LatencyStabilityVerdict } from "./thresholds.js";

/**
 * Substrate commit bindings (ACT §25, §30).
 */
export interface LH06SubstrateBinding {
  readonly phase_e_head: string | null;
  readonly lh02_head: string | null;
  readonly lh03_frozen_commit: string | null;
  readonly lh04_frozen_commit: string | null;
  readonly lh05_corpus_commit: string | null;
  readonly repo_commit: string | null;
}

/**
 * Environment identity (ACT §25).
 */
export interface LH06EnvironmentIdentity {
  readonly os: string;
  readonly arch: string;
  readonly node_version: string;
  readonly cpu_count: number;
  readonly total_memory_bytes: number;
  readonly contract_version: string;
  readonly profile: "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";
  readonly soak_run_id: string;
}

/**
 * Resource measurements (ACT §30).
 */
export interface LH06ResourceSection {
  readonly post_gc_heap_first_window: number | null;
  readonly post_gc_heap_last_window: number | null;
  readonly post_gc_heap_delta: number | null;
  readonly heap_slope_bytes_per_epoch: number;
  readonly rss_first_window: number | null;
  readonly rss_last_window: number | null;
  readonly rss_delta: number | null;
  readonly rss_slope: number;
  readonly resource_balance_failures: number;
  readonly workspace_leaks: number;
  readonly heap_verdict: HeapStabilityVerdict | null;
}

/**
 * Latency measurements (ACT §30).
 */
export interface LH06LatencySection {
  readonly first_window_median_ms: number | null;
  readonly last_window_median_ms: number | null;
  readonly drift_ratio: number | null;
  readonly verdict: LatencyStabilityVerdict | null;
}

/**
 * Frozen-tree integrity (ACT §20).
 *
 * L06-CORRECTION03 L06-C16: a missing / unreadable /
 * duplicate-identity frozen-tree digest is a TYPED
 * FAILURE returned in `status.kind`. `changed=true`
 * combined with `status.ok=true` means the digest
 * comparison itself was valid AND a content change was
 * observed. `status.ok=false` means the integrity
 * invariant could not even be computed; the run cannot
 * PASS in that case.
 */
export type LH06FrozenTreeStatus =
  | { readonly ok: true; readonly kind: "VALID" | "CHANGED" }
  | {
      readonly ok: false;
      readonly kind:
        | "MISSING_EVIDENCE"
        | "UNREADABLE_EVIDENCE"
        | "DUPLICATE_FROZEN_PATH_IDENTITY"
        | "INVALID_FROZEN_TREE_DECLARATION";
      readonly path: string;
      readonly detail: string;
    };

export interface LH06FrozenTreeSection {
  readonly before_sha256: string | null;
  readonly after_sha256: string | null;
  readonly changed: boolean | null;
  readonly status: LH06FrozenTreeStatus;
}

/**
 * Semantic repeatability (ACT §14, §16, §17, §40).
 *
 * L06-CORRECTION11 C47: bounded lifecycle-drift
 * attribution map. Each key is a lifecycle case id
 * (LC01..LC12); each value is the integer count of drift
 * observations attributed to that scenario. Bounded by
 * the lifecycle scenario count, NOT by the total number
 * of failures observed.
 */
export interface LH06SemanticSection {
  readonly drift_count: number;
  readonly fault_escape_count: number;
  readonly lifecycle_drift_count: number;
  readonly predecessor_dependency_count: number;
  readonly canary_before_equals_canary_after: boolean | null;
  readonly cases_with_multiple_semantic_results: number;
  /**
   * L06-CORRECTION11 C47: bounded lifecycle-drift
   * attribution. Each key is a lifecycle case id
   * (LC01..LC12); each value is an integer counter.
   * Diagnostics only — does NOT affect verdict.
   */
  readonly lifecycle_drift_by_scenario: Readonly<Record<string, number>>;
}

/**
 * Failure record (ACT §28).
 */
export interface LH06FailureRecord {
  readonly kind:
    | "SEMANTIC_DRIFT"
    | "RESOURCE_LEAK"
    | "MEMORY_GROWTH"
    | "LATENCY_DRIFT"
    | "WORKSPACE_LEAK"
    | "FROZEN_MUTATION"
    | "WORKER_CRASH"
    | "WORKER_HANG"
    | "BASELINE_REGRESSION"
    | "FAULT_ESCAPE"
    | "LIFECYCLE_DRIFT"
    | "INVALID_TELEMETRY"
    | "QUALIFICATION_INCOMPLETE"
    | "INCONCLUSIVE_ENVIRONMENT";
  readonly epoch: number | null;
  readonly last_completed_case: string | null;
  readonly minimal_diff: unknown;
  readonly message: string;
}

/**
 * The full result artifact.
 */
export interface LH06Result {
  readonly schema: typeof LH06_RESULT_SCHEMA;
  readonly contract_version: string;
  readonly profile: "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly environment_identity: LH06EnvironmentIdentity;
  readonly substrate: LH06SubstrateBinding;
  readonly epochs_completed: number;
  readonly cases_completed: number;
  readonly semantic: LH06SemanticSection;
  readonly resources: LH06ResourceSection;
  readonly latency: LH06LatencySection;
  readonly frozen_tree: LH06FrozenTreeSection;
  readonly repeatability: { readonly semantic_repeatability: boolean };
  readonly failure: LH06FailureRecord | null;
  readonly verdict: LH06Verdict;
  /**
   * L06-CORRECTION03 L06-C17: durable telemetry binding.
   * The worker writes a JSONL stream to
   * `telemetry_path`, then closes it and computes
   * `telemetry_sha256` over the closed bytes. The
   * supervisor re-verifies the hash from the file
   * (L06-C20). PASS_DETERMINISTIC_SOAK requires BOTH
   * fields to be present and consistent with the file
   * on disk.
   */
  readonly telemetry_path: string | null;
  readonly telemetry_sha256: string | null;
  readonly telemetry_bytes: number | null;
  readonly telemetry_line_count: number | null;
  /**
   * L06-CORRECTION06 L06-C33: publication durability
   * class for THIS artifact. `CRASH_DURABLE` means the
   * temp-write + fsync + rename + parent-directory
   * fsync sequence all succeeded; the artifact survives
   * a power loss between the rename and any later read.
   * `ATOMIC_ONLY` means the file is fsynced and visible
   * atomically (readers see the old bytes or the new
   * bytes, never a torn write) but a power loss between
   * the rename and the directory entry commit can lose
   * the rename. PASS_DETERMINISTIC_SOAK qualification
   * closure requires CRASH_DURABLE.
   */
  readonly publication_durability:
    | "CRASH_DURABLE"
    | "ATOMIC_ONLY"
    | null;
  /**
   * L06-CORRECTION02 C02-02: bind the worker artifact to the
   * supervisor's run-id when the worker was launched under
   * supervision. The supervisor reads this field and refuses
   * to promote the artifact to the canonical result path
   * unless the run-id matches its own generation. This
   * prevents stale PASS files from surviving a new failed
   * run that the worker never wrote.
   */
  readonly supervisor_run_id: string | null;
  /**
   * L06-CORRECTION03 L06-C21: substrate completeness flag.
   * For PASS qualification, all six substrate identities
   * MUST be present. The supervisor also re-verifies this
   * (L06-C20) and refuses to promote any worker result
   * that lacks the flag.
   */
  readonly substrate_complete: boolean;
}


export {
  writeResult,
  writeSupervisorResult,
  publishReconciledJson,
  verdictForFailure,
  DurabilityReconciliationError,
  type PublicationDurability,
} from "./result-io.js";
