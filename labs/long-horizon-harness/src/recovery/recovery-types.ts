/**
 * FOUNDATION03 — recovery domain types.
 *
 * Pure types and ADTs. No imports of fs, child_process, process,
 * timers, or signal methods. No mutations.
 *
 * Doctrine F03-D05: prefer conservative classification over
 * invented success/failure. The projector produces one of the
 * five canonical {@link ExecutionRecoveryState} kinds.
 */

import type { ProcessId } from "../process/process-types.js";

import type {
  PersistedGroupProbe,
  PersistedProcessResult,
} from "../evidence/codec-types.js";

/**
 * Canonical recovery states. Each kind is a deliberately
 * distinct gap, NOT a collapsed "crashed" boolean (F03-D04).
 */
export type ExecutionRecoveryState =
  | { readonly kind: "not_started" }
  | {
      readonly kind: "spawn_outcome_unknown";
      readonly processId: ProcessId;
    }
  | {
      readonly kind: "in_flight_at_crash";
      readonly processId: ProcessId;
      readonly pid: number;
      readonly pgid: number;
      readonly phase: RecoveredExecutionPhase;
    }
  | {
      readonly kind: "spawn_failure_observed";
      readonly processId: ProcessId;
      readonly failure: import("../evidence/codec-types.js").PersistedProcessFailure;
    }
  | {
      readonly kind: "result_unknown_after_cleanup";
      readonly processId: ProcessId;
      readonly pid: number | null;
      readonly pgid: number;
      readonly reason:
        | "group_absent_no_close"
        | "group_absent_close_no_result"
        | "close_no_result";
    }
  | {
      readonly kind: "settled";
      readonly processId: ProcessId;
      readonly result: PersistedProcessResult;
      readonly pid: number | null;
      readonly pgid: number | null;
    };

/**
 * Bounded recovered phase (F03-D04 / D21).
 *
 * Each variant corresponds to a stable execution substate
 * derivable from durable evidence alone. The projector never
 * infers more than the events permit.
 */
export type RecoveredExecutionPhase =
  | "running"
  | "term_requested"
  | "term_sent"
  | "kill_requested"
  | "kill_sent"
  | "group_absence_seen"
  | "close_seen";

/**
 * Recovery decision ADT (F03 §25). Each variant is the read-only
 * product of reconciliation. NONE of these decisions authorize
 * destructive signalling (F03-D07 / D27).
 */
export type RecoveryDecision =
  | {
      readonly kind: "no_action";
      readonly reason:
        | "no_execution_observed"
        | "already_settled"
        | "spawn_outcome_unknown_cannot_probe"
        | "spawn_failure_observed_durable_pending";
      readonly state: ExecutionRecoveryState;
    }
  | {
      readonly kind: "execution_settled";
      readonly state: Extract<ExecutionRecoveryState, { kind: "settled" }>;
    }
  | {
      readonly kind: "historical_group_observed_alive";
      readonly processId: ProcessId;
      readonly historicalPid: number | null;
      readonly historicalPgid: number;
    }
  | {
      readonly kind: "historical_group_absent";
      readonly processId: ProcessId;
      readonly historicalPid: number | null;
      readonly historicalPgid: number;
    }
  | {
      readonly kind: "historical_group_probe_denied";
      readonly processId: ProcessId;
      readonly historicalPid: number | null;
      readonly historicalPgid: number;
      readonly code?: string;
    }
  | {
      readonly kind: "historical_group_probe_error";
      readonly processId: ProcessId;
      readonly historicalPid: number | null;
      readonly historicalPgid: number;
      readonly message: string;
      readonly code?: string;
    };

export type RecoveryError =
  | { readonly kind: "invalid_evidence"; readonly reason: string }
  | { readonly kind: "mixed_process_identity"; readonly processId: string }
  | {
      readonly kind: "mixed_attempt_identity";
      readonly attemptId: string;
      readonly processId: string;
    }
  | { readonly kind: "inconsistent_history"; readonly reason: string };

export type RecoveryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RecoveryError };

/**
 * The full sequence of process-evidence records seen during
 * replay. The projector consumes this list and returns a
 * `RecoveryResult<ExecutionRecoveryState>`.
 */
export type EvidenceStream = ReadonlyArray<{
  readonly payload: import("../evidence/codec-types.js").PersistedProcessEvidencePayload;
  readonly observedAt: number;
  readonly seq: number;
}>;

export type GroupProbeSnapshot = PersistedGroupProbe;
