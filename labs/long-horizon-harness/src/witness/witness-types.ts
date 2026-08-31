/**
 * FOUNDATION04 — witness domain types (core).
 *
 * Pure types and ADTs. No imports of fs, child_process, crypto,
 * timers, or signal methods. No mutations.
 *
 * Doctrine F04-D04: branded identifier primitives enforce identity
 * boundaries at compile time. A WitnessId is never interchangeable
 * with a ProcessId even though both are strings at runtime.
 *
 * Doctrine F04-D07: witness state is a discriminated union, never
 * a boolean soup.
 *
 * Doctrine F04-D09: authority is explicit typed state, never
 * inferred from numeric PID values.
 */

import type { AttemptId, MissionId, RunId, InvalidId } from "../domain/ids.js";
import type { ProcessId } from "../process/process-types.js";
import { IDENTIFIER_GRAMMAR } from "../domain/ids.js";
import { err, ok, type Result } from "../domain/result.js";

// --------------------------------------------------------------------------
// Branded identifier primitives
// --------------------------------------------------------------------------

declare const __witnessBrand: unique symbol;
type Brand<T, B> = T & { readonly [__witnessBrand]: B };

/** Stable logical witness role within a run. */
export type WitnessId = Brand<string, "WitnessId">;

/** Unique identifier for one physical witness process lifetime. */
export type WitnessInstanceId = Brand<string, "WitnessInstanceId">;

/** Controller-issued command identifier for idempotent replay. */
export type WitnessCommandId = Brand<string, "WitnessCommandId">;

export function makeWitnessId(value: string): WitnessId {
  return value as WitnessId;
}

export function makeWitnessInstanceId(value: string): WitnessInstanceId {
  return value as WitnessInstanceId;
}

export function makeWitnessCommandId(value: string): WitnessCommandId {
  return value as WitnessCommandId;
}

/**
 * Trust-boundary validators. These reject values that do
 * not match the IDENTIFIER_GRAMMAR and surface typed
 * `invalid_id` errors. Used by the LedgerWriter wire
 * boundary and any other caller that ingests untrusted JS
 * bytes for these identifiers.
 *
 * (B0-CORR03 §12: the LedgerWriter MUST NOT locally
 * approximate the witness schema.)
 */
function parseId<F extends string>(
  value: unknown,
  field: F,
): Result<string, InvalidId> {
  if (typeof value !== "string") {
    return err({
      kind: "invalid_id",
      field,
      reason: `expected string, got ${value === null ? "null" : typeof value}`,
    });
  }
  if (!IDENTIFIER_GRAMMAR.test(value)) {
    return err({
      kind: "invalid_id",
      field,
      reason: `value does not match identifier grammar`,
    });
  }
  return ok(value);
}

export function parseWitnessId(value: unknown): Result<WitnessId, InvalidId> {
  const r = parseId(value, "WitnessId");
  return r.ok
    ? ok(r.value as WitnessId)
    : err(r.error);
}

export function parseWitnessInstanceId(value: unknown): Result<WitnessInstanceId, InvalidId> {
  const r = parseId(value, "WitnessInstanceId");
  return r.ok
    ? ok(r.value as WitnessInstanceId)
    : err(r.error);
}

export function parseWitnessCommandId(value: unknown): Result<WitnessCommandId, InvalidId> {
  const r = parseId(value, "WitnessCommandId");
  return r.ok
    ? ok(r.value as WitnessCommandId)
    : err(r.error);
}

// --------------------------------------------------------------------------
// Witness identity bindings (F04-D08)
// --------------------------------------------------------------------------

/**
 * The complete identity binding a witness must carry.
 *
 * Every witness is bound to one RunId, one MissionId, one AttemptId,
 * one ProcessId, one WitnessId, and one WitnessInstanceId. Witness
 * responses MUST echo these fields.
 */
export type WitnessBinding = {
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
};

// --------------------------------------------------------------------------
// Witness execution status (F04-D11 / D129)
// --------------------------------------------------------------------------

/**
 * Stable observable state of the candidate execution from the
 * witness's perspective.
 */
export type WitnessExecutionStatus =
  | { readonly kind: "not_started" }
  | { readonly kind: "running"; readonly pid: number; readonly pgid: number }
  | { readonly kind: "settled"; readonly result: WitnessPersistedResult }
  | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult };

/**
 * Bounded transportable result. Mirrors FOUNDATION02 / F03
 * PersistedProcessResult where possible, but with a more conservative
 * surface (we never persist live process state in the witness; only
 * the terminal outcome). Used for control responses.
 */
export type WitnessPersistedResult =
  | { readonly outcome_kind: "exited"; readonly exit_code: number | null }
  | {
      readonly outcome_kind: "signaled";
      readonly signal: string | null;
      readonly exit_code: number | null;
    }
  | { readonly outcome_kind: "deadline" }
  | { readonly outcome_kind: "cancelled" }
  | { readonly outcome_kind: "spawn_failed"; readonly message: string }
  | { readonly outcome_kind: "cleanup_failed"; readonly message: string }
  | { readonly outcome_kind: "still_running" };

// State, authority, command, evidence, and persisted-shape types
// live in sibling files to keep this file under the 400 LOC
// source-size discipline.
export type { WitnessState } from "./witness-types-state.js";
export type {
  CommandOutcome,
  ControllerCommand,
  ExecutionAuthority,
  WitnessAction,
  WitnessAuthorityState,
} from "./witness-types-state.js";
export type { WitnessEvidence } from "./witness-types-evidence.js";
export type {
  PersistedCommandOutcome,
  PersistedWitnessEvidence,
  PersistedWitnessPersistedResult,
} from "./witness-types-persisted.js";
