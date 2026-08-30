/**
 * Persisted-shape types for the evidence layer.
 *
 * This file is types-only. Encoding/decoding logic lives in `codec-encode.ts`
 * and `codec-decode.ts` respectively.
 *
 * Doctrine D04: external data is untrusted. Persisted JSON is kept in this
 * strict shape so the decoder can mechanically validate it before anything
 * downstream treats it as a {@link RunEvent}. The decoder is the trust
 * boundary; everything past it is typed.
 *
 * FOUNDATION03 schema evolution:
 *   - schema_version 1: lifecycle-only envelope. Persisted under
 *     FOUNDATION01/F02. Still decodes and replays; no breaking change.
 *   - schema_version 2: discriminated envelope. `kind` MUST be present
 *     and is either "lifecycle" (the same payload shape as v1, but
 *     with the discriminator made explicit so future readers can
 *     branch mechanically) or "process_evidence" (a process-runtime
 *     record that the recovery projector consumes; never seen by the
 *     mission-lifecycle replay reducer).
 *   - Old v1 records remain replayable. New records use v2.
 */

import type {
  RunId,
  MissionId,
  EventId,
  AttemptId,
} from "../domain/ids.js";
import type { ProcessId } from "../process/process-types.js";
import type { BudgetKind } from "../domain/budget.js";

/** Current schema version for the persisted event envelope. */
export const SCHEMA_VERSION = 2 as const;
export const SUPPORTED_SCHEMA_VERSIONS: ReadonlyArray<number> = [1, 2] as const;

/**
 * A persisted event envelope. Versioned so future evolutions can detect
 * incompatible records on load.
 *
 * Discriminated union:
 *   - schema_version === 1, lifecycle only (FOUNDATION01 / F02 legacy)
 *   - schema_version === 2, kind === "lifecycle"
 *   - schema_version === 2, kind === "process_evidence"
 *
 * The decoder is responsible for selecting the correct variant.
 */
export type EventEnvelope =
  | {
      readonly schema_version: 1;
      readonly event_id: EventId;
      readonly run_id: RunId;
      readonly mission_id: MissionId;
      readonly sequence: number;
      readonly observed_at: number;
      readonly event: PersistedEvent;
    }
  | {
      readonly schema_version: 2;
      readonly event_id: EventId;
      readonly run_id: RunId;
      readonly mission_id: MissionId;
      readonly sequence: number;
      readonly observed_at: number;
      readonly kind: "lifecycle";
      readonly event: PersistedEvent;
    }
  | {
      readonly schema_version: 2;
      readonly event_id: EventId;
      readonly run_id: RunId;
      readonly mission_id: MissionId;
      readonly sequence: number;
      readonly observed_at: number;
      readonly kind: "process_evidence";
      readonly process_evidence: PersistedProcessEvidencePayload;
    };;

/**
 * The serialised form of a {@link RunEvent}.
 *
 * Mirrors the in-memory shape so decoding is mechanical. Field names are
 * snake_case on disk to remain neutral across languages.
 */
export type PersistedEvent =
  | { readonly type: "run_created" }
  | { readonly type: "preparation_started" }
  | { readonly type: "preparation_succeeded" }
  | { readonly type: "preparation_failed"; readonly failure: PersistedFailure }
  | { readonly type: "attempt_started"; readonly attempt_id: AttemptId }
  | { readonly type: "agent_reported_completion"; readonly attempt_id: AttemptId; readonly summary: string }
  | { readonly type: "agent_failed"; readonly attempt_id: AttemptId; readonly failure: PersistedFailure }
  | { readonly type: "gating_started"; readonly attempt_id: AttemptId; readonly gate: string }
  | { readonly type: "gate_passed"; readonly attempt_id: AttemptId; readonly gate: string }
  | { readonly type: "gate_failed"; readonly attempt_id: AttemptId; readonly gate: string; readonly failure: PersistedFailure }
  | { readonly type: "repair_started"; readonly reason: PersistedFailure }
  | { readonly type: "review_started" }
  | { readonly type: "review_passed" }
  | { readonly type: "review_failed"; readonly failure: PersistedFailure }
  | { readonly type: "budget_exhausted"; readonly observation: PersistedBudgetObservation }
  | { readonly type: "blocked"; readonly reason: PersistedFailure }
  | { readonly type: "crashed"; readonly reason: PersistedFailure }
  | { readonly type: "cancelled" };

/** Persisted shape of a {@link Failure}. */
export type PersistedFailure =
  | { readonly kind: "candidate_failure"; readonly code: string; readonly message: string }
  | { readonly kind: "tool_failure"; readonly tool: string; readonly message: string }
  | { readonly kind: "gate_failure"; readonly gate: string; readonly message: string }
  | { readonly kind: "policy_denied"; readonly policy: string; readonly message: string }
  | { readonly kind: "timeout"; readonly subject: string; readonly message: string }
  | { readonly kind: "budget_exhausted"; readonly budget: BudgetKind; readonly limit: number; readonly observed: number; readonly message: string }
  | { readonly kind: "invalid_evidence"; readonly reason: string }
  | { readonly kind: "invalid_transition"; readonly from: string; readonly event: string; readonly message: string }
  | { readonly kind: "internal_failure"; readonly message: string };

/**
 * Identity carried by every process-evidence record (FOUNDATION03 §10/§54).
 *
 * Every variant of {@link PersistedProcessEvidencePayload} carries this
 * identity explicitly. `attempt_id` is MANDATORY: multi-attempt
 * reconciliation is impossible without it.
 */
export type PersistedProcessEvidenceIdentity = {
  readonly attempt_id: AttemptId;
  readonly process_id: ProcessId;
};

export type PersistedEscalationEvidence = {
  readonly term_requested: boolean;
  readonly term_sent: boolean;
  readonly term_result: PersistedSignalAttemptResult | null;
  readonly kill_requested: boolean;
  readonly kill_sent: boolean;
  readonly kill_result: PersistedSignalAttemptResult | null;
  readonly final_group_probe: PersistedGroupProbe;
};

export type PersistedBudgetObservation = {
  readonly kind: BudgetKind;
  readonly limit: number;
  readonly observed: number;
};

/**
 * Persisted shape of a single process-runtime evidence record
 * (FOUNDATION03).
 *
 * Process evidence is a separate projection from lifecycle events.
 * It is consumed by the recovery projector
 * (`src/recovery/process-recovery-projector.ts`), NOT by the
 * mission-lifecycle replay reducer.
 *
 * Each variant is intentionally narrow:
 *   - no Buffers
 *   - no Promises
 *   - no class instances
 *   - no runtime handles
 *   - no full environment, credentials, or arbitrary argv
 *
 * Numeric PID/PGID remain observational; recovery treats them as
 * historical evidence, not authority.
 */
export type PersistedProcessEvidencePayload =
  | {
      readonly kind: "process_spawn_requested";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
    }
  | {
      readonly kind: "process_spawned";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly pid: number;
      readonly pgid: number;
    }
  | {
      readonly kind: "process_spawn_failed";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly failure: PersistedProcessFailure;
    }
  | {
      readonly kind: "process_deadline_reached";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
    }
  | {
      readonly kind: "process_cancel_requested";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
    }
  | {
      readonly kind: "process_signal_attempted";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly signal: "SIGTERM" | "SIGKILL";
    }
  | {
      readonly kind: "process_signal_result";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly signal: "SIGTERM" | "SIGKILL";
      readonly result: PersistedSignalAttemptResult;
    }
  | {
      readonly kind: "process_group_probe";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly probe: PersistedGroupProbe;
    }
  | {
      readonly kind: "process_close_observed";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly exit_code: number | null;
      readonly signal: string | null;
    }
  | {
      readonly kind: "process_output_summary";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly stdout: PersistedOutputSummary;
      readonly stderr: PersistedOutputSummary;
    }
  | {
      readonly kind: "process_result_committed";
      readonly attempt_id: AttemptId;
      readonly process_id: ProcessId;
      readonly result: PersistedProcessResult;
    };

/** Persisted shape of {@link ProcessFailure}. */
export type PersistedProcessFailure =
  | { readonly kind: "invalid_process_spec"; readonly message: string }
  | {
      readonly kind: "spawn_failure";
      readonly code?: string;
      readonly syscall?: string;
      readonly path?: string;
      readonly message: string;
    }
  | {
      readonly kind: "signal_failure";
      readonly signal: "SIGTERM" | "SIGKILL" | 0;
      readonly code?: string;
      readonly message: string;
    }
  | {
      readonly kind: "cleanup_timeout";
      readonly phase: "term" | "kill" | "close";
      readonly message: string;
    }
  | {
      readonly kind: "stdio_failure";
      readonly stream: "stdout" | "stderr";
      readonly code?: string;
      readonly message: string;
    }
  | { readonly kind: "internal_process_failure"; readonly message: string }
  | {
      readonly kind: "evidence_persistence_failure";
      readonly stage: "ownership" | "settlement";
      readonly message: string;
    }
  | { readonly kind: "capability_unavailable"; readonly message: string };

/** Persisted shape of {@link SignalAttemptResult}. */
export type PersistedSignalAttemptResult =
  | { readonly result_kind: "sent"; readonly signal: "SIGTERM" | "SIGKILL" | 0 }
  | { readonly result_kind: "group_absent" }
  | { readonly result_kind: "permission_denied"; readonly code?: string }
  | { readonly result_kind: "error"; readonly code?: string; readonly message: string };

/** Persisted shape of {@link GroupProbe}. */
export type PersistedGroupProbe =
  | { readonly probe_kind: "alive" }
  | { readonly probe_kind: "absent" }
  | { readonly probe_kind: "permission_denied"; readonly code?: string }
  | { readonly probe_kind: "probe_error"; readonly code?: string; readonly message: string };

/** Persisted shape of bounded output evidence (FOUNDATION03 §47). */
export type PersistedOutputSummary = {
  readonly bytes_seen: number;
  readonly bytes_retained: number;
  readonly truncated: boolean;
};

/**
 * Persisted shape of the final runtime result (the durable boundary
 * — FOUNDATION03 §12).
 *
 * Records NONE of: Buffer contents, stdio failure details, full
 * spec/argv/environment. The richer in-memory {@link ProcessResult}
 * is intentionally NOT persisted; this is the durable evidence
 * boundary.
 */
export type PersistedProcessResult =
  | { readonly outcome_kind: "exited"; readonly exit_code: number | null }
  | { readonly outcome_kind: "signaled"; readonly signal: string | null; readonly exit_code: number | null }
  | {
      readonly outcome_kind: "deadline";
      readonly escalation: PersistedEscalationEvidence;
    }
  | {
      readonly outcome_kind: "cancelled";
      readonly escalation: PersistedEscalationEvidence;
    }
  | { readonly outcome_kind: "spawn_failed"; readonly failure: PersistedProcessFailure }
  | {
      readonly outcome_kind: "cleanup_failed";
      readonly failure: PersistedProcessFailure;
      readonly escalation: PersistedEscalationEvidence;
    };
