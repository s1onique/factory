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
 */

import type { RunId, MissionId, EventId, AttemptId } from "../domain/ids.js";
import type { BudgetKind } from "../domain/budget.js";

/** Current schema version for the persisted event envelope. */
export const SCHEMA_VERSION = 1 as const;
export const SUPPORTED_SCHEMA_VERSIONS: ReadonlyArray<number> = [1] as const;

/**
 * A persisted event envelope. Versioned so future evolutions can detect
 * incompatible records on load.
 */
export type EventEnvelope = {
  readonly schema_version: 1;
  readonly event_id: EventId;
  readonly run_id: RunId;
  readonly mission_id: MissionId;
  readonly sequence: number;
  readonly observed_at: number;
  readonly event: PersistedEvent;
};

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

export type PersistedBudgetObservation = {
  readonly kind: BudgetKind;
  readonly limit: number;
  readonly observed: number;
};
