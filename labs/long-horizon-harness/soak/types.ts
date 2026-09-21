/**
 * LH-06 deterministic long-duration soak laboratory — core
 * types.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Closed-world type vocabulary. This module deliberately
 * imports from NO other soak module so that it can be the
 * root of a circular-free type graph.
 *
 * Doctrine:
 *   - Profiles are a closed union. Adding a profile is a
 *     contract-visible change.
 *   - Failure kinds are a closed union. A soak qualification
 *     MUST report WHICH kind of failure occurred.
 *   - The soak contract version is a single string. Changing
 *     a threshold requires a contract-version bump.
 */

export const LH06_SOAK_CONTRACT_VERSION = "lh06.soak.contract.v1" as const;
export const LH06_RESULT_SCHEMA = "lh06.deterministic.soak.result.v1" as const;
export const LH06_SCHEDULE_VERSION = "lh06.schedule.v1" as const;

/**
 * Closed-world profile type. V1 has exactly three members.
 */
export type LH06SoakProfile = "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";

/**
 * Profile contract — minimum wall-clock and minimum epoch
 * count are BOTH gating conditions for QUALIFICATION.
 */
export interface LH06ProfileContract {
  readonly profile: LH06SoakProfile;
  readonly minimum_wall_clock_ms: number;
  readonly minimum_epochs: number;
  readonly heartbeat_timeout_ms: number;
  readonly warmup_epochs: number;
  readonly extended_diagnostic: boolean;
}

/**
 * LH06FailureKind — closed-world run failure kinds.
 *
 * The result MUST report the specific kind that failed; it
 * MUST NOT collapse everything into a generic SOAK_FAILED.
 */
export type LH06FailureKind =
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

/**
 * LH06Verdict — closed-world terminal verdicts.
 */
export type LH06Verdict =
  | "PASS_DETERMINISTIC_SOAK"
  | "FAIL_SEMANTIC_DRIFT"
  | "FAIL_RESOURCE_STABILITY"
  | "FAIL_LATENCY_STABILITY"
  | "FAIL_CLEANUP"
  | "FAIL_FROZEN_INTEGRITY"
  | "FAIL_WORKER"
  | "QUALIFICATION_INCOMPLETE"
  | "INCONCLUSIVE_ENVIRONMENT";

/**
 * SoakFaultInjection — closed-world test seam.
 *
 * Default NONE. Production / qualification profile MUST
 * reject non-NONE injection.
 */
export type SoakFaultInjection =
  | { readonly kind: "NONE" }
  | { readonly kind: "LEAK01_RETAIN_BYTES_PER_EPOCH"; readonly bytes: number }
  | { readonly kind: "LEAK02_LEAVE_WORKSPACE_OPEN" }
  | { readonly kind: "LEAK03_RETAIN_OWNED_STREAM" }
  | { readonly kind: "LEAK04_SEMANTIC_DRIFT_AT_EPOCH"; readonly at_epoch: number }
  | { readonly kind: "LEAK05_LATENCY_DRIFT_PER_EPOCH"; readonly per_epoch_ms: number }
  | { readonly kind: "LEAK06_MUTATE_FROZEN_FIXTURE"; readonly fixture_rel_path: string }
  | { readonly kind: "LEAK07_STOP_HEARTBEATS_AFTER"; readonly after_epoch: number };

/**
 * Canonical epoch composition (V1): 12 LH-05 lifecycle
 * scenarios, 17 LH-04 fault experiments, 1 LH-05 canonical
 * positive-control replay, 1 frozen-substrate integrity
 * checkpoint, 1 cleanup checkpoint.
 */
export const LH06_EPOCH_LIFECYCLE_COUNT = 12 as const;
export const LH06_EPOCH_FAULT_COUNT = 17 as const;
export const LH06_EPOCH_CANARY_COUNT = 1 as const;
export const LH06_EPOCH_INTEGRITY_CHECKPOINT_COUNT = 1 as const;
export const LH06_EPOCH_CLEANUP_CHECKPOINT_COUNT = 1 as const;

/**
 * Cardinality invariants. The module deliberately places
 * them next to the per-epoch constants so that adding a case
 * is a schema-visible change.
 */
export const LH06_LH05_CASE_IDS: readonly string[] = Object.freeze([
  "LC01", "LC02", "LC03", "LC04", "LC05", "LC06",
  "LC07", "LC08", "LC09", "LC10", "LC11", "LC12",
]);

export const LH06_LH04_CASE_IDS: readonly string[] = Object.freeze([
  "F01", "F02", "F03", "F04", "F05", "F06", "F07",
  "F08", "F09", "F10", "F11", "F12", "F13", "F14",
  "F15", "F16", "F17",
]);
