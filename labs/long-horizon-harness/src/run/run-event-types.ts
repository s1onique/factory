/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * RunEvent vocabulary + supporting union types (split out from
 * run-types.ts to keep each Phase E source file under the
 * SOURCE_SIZE_DISCIPLINE 400-LOC ceiling).
 *
 * This module holds ONLY:
 *   - RunEventType (closed-world event-type vocabulary)
 *   - RUN_EVENT_TYPES (the runtime list of legal types)
 *   - isRunEventType
 *   - ActionTarget / ActionStatus
 *   - ResourceObservationKind / ResourceObservation
 *   - TerminalSemantic / TERMINAL_OUTCOMES / isTerminalSemantic
 *   - AgentSelfReport
 *   - RunEvent (the discriminated union)
 *   - re-export of Failure
 *
 * run-types.ts re-exports every name from this module so that
 * consumers can keep importing from "./run-types.js" or
 * "./run/index.js" — the public surface is unchanged.
 *
 * This module is pure: no I/O.
 */

import type { Failure } from "../domain/failure.js";
import type {
  AttemptId,
  GateId,
  RepairCycleId,
  ReviewCycleId,
} from "./run-types.js";

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed-world Phase E event vocabulary. Names chosen to be
 * semantically neutral between "observation" and "derived state":
 * every event is a raw observation of the external world. Terminal
 * outcomes are DERIVED by the projector (run-projector.ts), not
 * read from these event names.
 */
export type RunEventType =
  | "RUN_STARTED"
  | "HARNESS_STARTED"
  | "HARNESS_STOPPED"
  | "ACTION_STARTED"
  | "ACTION_FINISHED"
  | "GATE_STARTED"
  | "GATE_FINISHED"
  | "REPAIR_STARTED"
  | "REPAIR_FINISHED"
  | "REVIEW_STARTED"
  | "REVIEW_FINISHED"
  | "RUN_CANCEL_REQUESTED"
  | "RUN_TIMEOUT"
  | "RUN_FINISHED"
  | "RUN_ABORTED";

export const RUN_EVENT_TYPES: readonly RunEventType[] = [
  "RUN_STARTED",
  "HARNESS_STARTED",
  "HARNESS_STOPPED",
  "ACTION_STARTED",
  "ACTION_FINISHED",
  "GATE_STARTED",
  "GATE_FINISHED",
  "REPAIR_STARTED",
  "REPAIR_FINISHED",
  "REVIEW_STARTED",
  "REVIEW_FINISHED",
  "RUN_CANCEL_REQUESTED",
  "RUN_TIMEOUT",
  "RUN_FINISHED",
  "RUN_ABORTED",
] as const;

export function isRunEventType(value: unknown): value is RunEventType {
  return (
    typeof value === "string" &&
    (RUN_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * What kind of target an ACTION_* event refers to. ACTION_STARTED
 * / ACTION_FINISHED are general-purpose open/close pairs; the
 * specific lifecycle pairs (GATE_*, REPAIR_*, REVIEW_*) carry their
 * own typed IDs and are modeled separately for clarity.
 *
 * An ACTION_STARTED always carries an `AttemptId` because attempts
 * are the canonical unit of harness work.
 */
export type ActionTarget =
  | { readonly kind: "attempt"; readonly attempt_id: AttemptId };

export type ActionStatus = "OK" | "ERROR";

/**
 * Resource observation kinds. Phase E implements the seam (E18):
 * raw observations only. Derived metrics arrive in Phase F.
 */
export type ResourceObservationKind =
  | "wall_clock_ms"
  | "tokens"
  | "tool_calls"
  | "process_count";

export type ResourceObservation = {
  readonly kind: ResourceObservationKind;
  /** Non-negative integer or non-negative finite number. */
  readonly observed: number;
};

// ---------------------------------------------------------------------------
// Terminal semantics: shared super-set + per-event sub-types (E-C08).
// ---------------------------------------------------------------------------

/**
 * The closed-world set of terminal semantic claims. This is the
 * super-set over every per-event sub-type; it is the value the
 * projector derives as `RunProjection.terminal_outcome`.
 *
 * Per E-C08, NOT every terminal event type can carry every
 * terminal semantic value; each event type declares a per-event
 * sub-type below. The decoder rejects mismatches at the trust
 * boundary.
 */
export type TerminalSemantic =
  | "SUCCESS"
  | "VALID_FAILURE"
  | "HARNESS_FAILURE"
  | "MODEL_FAILURE"
  | "ENVIRONMENT_FAILURE"
  | "TIMEOUT"
  | "CANCELLED"
  | "EVIDENCE_FAILURE"
  | "BUDGET_EXHAUSTED";

export const TERMINAL_OUTCOMES: readonly TerminalSemantic[] = [
  "SUCCESS",
  "VALID_FAILURE",
  "HARNESS_FAILURE",
  "MODEL_FAILURE",
  "ENVIRONMENT_FAILURE",
  "TIMEOUT",
  "CANCELLED",
  "EVIDENCE_FAILURE",
  "BUDGET_EXHAUSTED",
] as const;

export function isTerminalSemantic(value: unknown): value is TerminalSemantic {
  return (
    typeof value === "string" &&
    (TERMINAL_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * E-C08: per-event terminal-semantic sub-types. These narrow the
 * set of legal values a given event may carry.
 *
 *   RUN_FINISHED            : SUCCESS | VALID_FAILURE
 *   RUN_TIMEOUT             : TIMEOUT | BUDGET_EXHAUSTED
 *   RUN_ABORTED             : CANCELLED
 *                            | HARNESS_FAILURE
 *                            | MODEL_FAILURE
 *                            | ENVIRONMENT_FAILURE
 *                            | EVIDENCE_FAILURE
 *
 *   RUN_CANCEL_REQUESTED    : NON-TERMINAL (no terminal semantic
 *                            in V1; carries an optional reason
 *                            only). Run-cancellation INTENT is
 *                            observation; the actual closure
 *                            must come from a subsequent
 *                            RUN_ABORTED(CANCELLED) or
 *                            RUN_TIMEOUT(CANCELLED). The
 *                            decoder rejects any terminal
 *                            semantic field on a
 *                            RUN_CANCEL_REQUESTED payload.
 */
export type RunFinishedSemantic = "SUCCESS" | "VALID_FAILURE";
export const RUN_FINISHED_SEMANTICS: readonly RunFinishedSemantic[] = [
  "SUCCESS",
  "VALID_FAILURE",
] as const;
export function isRunFinishedSemantic(
  value: unknown,
): value is RunFinishedSemantic {
  return (
    typeof value === "string" &&
    (RUN_FINISHED_SEMANTICS as readonly string[]).includes(value)
  );
}

export type RunTimeoutSemantic = "TIMEOUT" | "BUDGET_EXHAUSTED";
export const RUN_TIMEOUT_SEMANTICS: readonly RunTimeoutSemantic[] = [
  "TIMEOUT",
  "BUDGET_EXHAUSTED",
] as const;
export function isRunTimeoutSemantic(
  value: unknown,
): value is RunTimeoutSemantic {
  return (
    typeof value === "string" &&
    (RUN_TIMEOUT_SEMANTICS as readonly string[]).includes(value)
  );
}

export type RunAbortedSemantic =
  | "CANCELLED"
  | "HARNESS_FAILURE"
  | "MODEL_FAILURE"
  | "ENVIRONMENT_FAILURE"
  | "EVIDENCE_FAILURE";
export const RUN_ABORTED_SEMANTICS: readonly RunAbortedSemantic[] = [
  "CANCELLED",
  "HARNESS_FAILURE",
  "MODEL_FAILURE",
  "ENVIRONMENT_FAILURE",
  "EVIDENCE_FAILURE",
] as const;
export function isRunAbortedSemantic(
  value: unknown,
): value is RunAbortedSemantic {
  return (
    typeof value === "string" &&
    (RUN_ABORTED_SEMANTICS as readonly string[]).includes(value)
  );
}

/**
 * E-C08: RUN_CANCEL_REQUESTED is NON-TERMINAL. The decoder
 * rejects any `semantic` field on a cancel-request payload; the
 * closed-world key list no longer admits `semantic` for that
 * event type. The `reason?` field is the only payload-side
 * observation.
 */
export const RUN_CANCEL_REQUESTED_KEYS = ["type", "reason"] as const;

/**
 * Optional agent self-report. Per E7, this is OBSERVATION only; the
 * projector MUST NOT promote it to a terminal claim.
 */
export type AgentSelfReport = {
  readonly message: string;
  /** Optional: the agent may declare a tentative verdict; ignored by projector. */
  readonly claimed?: string;
};

/**
 * Phase E RunEvent envelope (in-memory). The projector folds these
 * into a RunProjection. The persisted wire shape lives in
 * run-serialize.ts (snake_case for portability).
 */
export type RunEvent =
  | { readonly type: "RUN_STARTED" }
  | { readonly type: "HARNESS_STARTED" }
  | { readonly type: "HARNESS_STOPPED" }
  | {
      readonly type: "ACTION_STARTED";
      readonly target: ActionTarget;
      readonly at_ms?: number;
    }
  | {
      readonly type: "ACTION_FINISHED";
      readonly target: ActionTarget;
      readonly status: ActionStatus;
      readonly failure?: Failure;
    }
  | {
      readonly type: "GATE_STARTED";
      readonly gate_id: GateId;
      readonly attempt_id: AttemptId;
    }
  | {
      readonly type: "GATE_FINISHED";
      readonly gate_id: GateId;
      readonly attempt_id: AttemptId;
      readonly pass: boolean;
      readonly reason?: string;
    }
  | {
      readonly type: "REPAIR_STARTED";
      readonly repair_id: RepairCycleId;
      readonly reason: string;
    }
  | {
      readonly type: "REPAIR_FINISHED";
      readonly repair_id: RepairCycleId;
    }
  | {
      readonly type: "REVIEW_STARTED";
      readonly review_id: ReviewCycleId;
    }
  | {
      readonly type: "REVIEW_FINISHED";
      readonly review_id: ReviewCycleId;
      readonly pass: boolean;
      readonly reason?: string;
    }
  | {
      readonly type: "RUN_CANCEL_REQUESTED";
      // E-C08: cancel-request is NON-TERMINAL; it carries an
      // optional reason only. The `semantic` field has been
      // removed from both the type and the closed-world key
      // list.
      readonly reason?: string;
    }
  | {
      readonly type: "RUN_TIMEOUT";
      // E-C08: narrowed to the per-event semantic sub-type.
      readonly semantic: RunTimeoutSemantic;
      readonly observation: ResourceObservation;
    }
  | {
      readonly type: "RUN_FINISHED";
      // E-C08: narrowed to the per-event semantic sub-type.
      readonly semantic: RunFinishedSemantic;
      readonly agent_report?: AgentSelfReport;
    }
  | {
      readonly type: "RUN_ABORTED";
      // E-C08: narrowed to the per-event semantic sub-type.
      readonly semantic: RunAbortedSemantic;
      readonly reason: string;
    };

/** Re-export Failure so external consumers can import from run-types. */
export type { Failure };

// ---------------------------------------------------------------------------
// Closed-world payload keys
// (split out for source-size discipline; these live with the
//  vocabulary so that any vocabulary change forces a co-located
//  change to the closed-world key list)
// ---------------------------------------------------------------------------

/** Closed-world keys for an ACTION_STARTED / ACTION_FINISHED payload. */
export const ACTION_TARGET_KEYS = ["kind", "attempt_id"] as const;
export const ACTION_STARTED_KEYS = ["type", "target", "at_ms"] as const;
export const ACTION_FINISHED_KEYS = ["type", "target", "status", "failure"] as const;

/** Closed-world keys for GATE_* / REPAIR_* / REVIEW_* payloads. */
export const GATE_STARTED_KEYS = ["type", "gate_id", "attempt_id"] as const;
export const GATE_FINISHED_KEYS = [
  "type",
  "gate_id",
  "attempt_id",
  "pass",
  "reason",
] as const;
export const REPAIR_STARTED_KEYS = ["type", "repair_id", "reason"] as const;
export const REPAIR_FINISHED_KEYS = ["type", "repair_id"] as const;
export const REVIEW_STARTED_KEYS = ["type", "review_id"] as const;
export const REVIEW_FINISHED_KEYS = [
  "type",
  "review_id",
  "pass",
  "reason",
] as const;
// NOTE (E-C08): RUN_CANCEL_REQUESTED_KEYS is declared above
// alongside the per-event semantic sub-types; it does NOT
// include `semantic` because cancel-request is non-terminal.
export const RUN_TIMEOUT_KEYS = [
  "type",
  "semantic",
  "observation",
] as const;
export const RUN_FINISHED_KEYS = ["type", "semantic", "agent_report"] as const;
export const RUN_ABORTED_KEYS = ["type", "semantic", "reason"] as const;
export const AGENT_SELF_REPORT_KEYS = ["message", "claimed"] as const;
export const RESOURCE_OBSERVATION_KEYS = ["kind", "observed"] as const;
