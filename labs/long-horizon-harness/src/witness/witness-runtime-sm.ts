/**
 * FOUNDATION04 — witness state-machine.
 *
 * Pure state-transition logic. Given the current context and a
 * typed input, returns the next context.
 */

import type {
  WitnessExecutionStatus,
  WitnessState,
  WitnessPersistedResult,
} from "./witness-types.js";
import type {
  CommandJournalEntry,
} from "./witness-runtime-types.js";
import {
  COMMAND_JOURNAL_BOUND,
  getSequence,
  readyNotActivated,
  makeActiveIdle,
  makeExecutionRunning,
  makeExecutionSettled,
  makeExecutionStarting,
  makeFailed,
  isActiveState,
  isSettledResponse,
  extractResult,
} from "./witness-runtime-sm-helpers.js";

export type WitnessStateInput =
  | {
      readonly kind: "witness_ready_observed";
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
    }
  | { readonly kind: "activate_requested"; readonly commandId: import("./witness-types.js").WitnessCommandId }
  | { readonly kind: "spawn_requested" }
  | { readonly kind: "spawn_succeeded"; readonly pid: number; readonly pgid: number }
  | { readonly kind: "spawn_failed"; readonly reason: string }
  | { readonly kind: "command_received"; readonly entry: CommandJournalEntry }
  | {
      readonly kind: "command_completed";
      readonly commandId: import("./witness-types.js").WitnessCommandId;
      readonly responseBody:
        | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
        | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
        | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
        | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
        | { readonly kind: "authority_unavailable"; readonly reason: string }
        | { readonly kind: "ok"; readonly result: WitnessPersistedResult | null };
    }
  | { readonly kind: "candidate_observed"; readonly status: WitnessExecutionStatus }
  | { readonly kind: "bootstrap_lease_expired" }
  | { readonly kind: "fatal_error"; readonly reason: string };

export type StateTransition =
  | { readonly ok: true; readonly context: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext; readonly emittedEvidence: ReadonlyArray<import("./witness-types-persisted.js").PersistedWitnessEvidence> }
  | { readonly ok: false; readonly error: string };

export function applyRuntimeInput(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
  input: WitnessStateInput,
): StateTransition {
  switch (input.kind) {
    case "witness_ready_observed":
      return {
        ok: true,
        context: {
          ...ctx,
          witnessPublicKey: input.witnessPublicKey,
          witnessPublicKeyFingerprint: input.witnessPublicKeyFingerprint,
          controllerPublicKeyFingerprint: input.controllerPublicKeyFingerprint,
          state: readyNotActivated(
            ctx,
            input.witnessPublicKey,
            input.witnessPublicKeyFingerprint,
            input.controllerPublicKeyFingerprint,
            input.socketPath,
            input.protocolVersion,
          ),
        },
        emittedEvidence: [],
      };
    case "activate_requested":
      return applyActivate(ctx);
    case "spawn_requested":
      return applySpawnRequested(ctx);
    case "spawn_succeeded":
      return applySpawnSucceeded(ctx, input.pid, input.pgid);
    case "spawn_failed":
      return applySpawnFailed(ctx, input.reason);
    case "command_received":
      return applyCommandReceived(ctx, input.entry);
    case "command_completed":
      return applyCommandCompleted(ctx, input.commandId, input.responseBody);
    case "candidate_observed":
      return {
        ok: true,
        context: { ...ctx, lastExecutionStatus: input.status },
        emittedEvidence: [],
      };
    case "bootstrap_lease_expired":
      return applyBootstrapLeaseExpired(ctx);
    case "fatal_error":
      return {
        ok: true,
        context: { ...ctx, state: makeFailed(ctx.state, getSequence(ctx), input.reason) },
        emittedEvidence: [],
      };
  }
}

function applyActivate(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
): StateTransition {
  if (ctx.state.kind !== "ready_not_activated" && ctx.state.kind !== "active_idle") {
    return { ok: false, error: "activate before ready" };
  }
  return {
    ok: true,
    context: {
      ...ctx,
      activated: true,
      state: ctx.state.kind === "ready_not_activated"
        ? makeActiveIdle(ctx.state, getSequence(ctx))
        : ctx.state,
    },
    emittedEvidence: [],
  };
}

function applySpawnRequested(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
): StateTransition {
  if (!ctx.activated) return { ok: false, error: "spawn before activation" };
  if (!isActiveState(ctx)) return { ok: false, error: "spawn in non-active state" };
  return {
    ok: true,
    context: { ...ctx, state: makeExecutionStarting(ctx.state, getSequence(ctx) + 1) },
    emittedEvidence: [],
  };
}

function applySpawnSucceeded(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
  pid: number,
  pgid: number,
): StateTransition {
  if (!ctx.activated || ctx.candidate !== null) {
    return { ok: false, error: "spawn while candidate exists or unactivated" };
  }
  if (!isActiveState(ctx)) return { ok: false, error: "spawn in non-active state" };
  return {
    ok: true,
    context: {
      ...ctx,
      candidate: { pid, pgid },
      lastExecutionStatus: { kind: "running", pid, pgid },
      state: makeExecutionRunning(ctx.state, getSequence(ctx) + 1, pid, pgid),
    },
    emittedEvidence: [],
  };
}

function applySpawnFailed(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
  reason: string,
): StateTransition {
  if (!isActiveState(ctx)) return { ok: true, context: ctx, emittedEvidence: [] };
  return {
    ok: true,
    context: {
      ...ctx,
      candidate: null,
      lastExecutionStatus: {
        kind: "settled",
        result: { outcome_kind: "spawn_failed", message: reason },
      },
      state: makeExecutionSettled(ctx.state, getSequence(ctx) + 1, { outcome_kind: "spawn_failed", message: reason }),
    },
    emittedEvidence: [],
  };
}

function applyCommandReceived(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
  entry: CommandJournalEntry,
): StateTransition {
  if (ctx.commandJournal.some((e) => e.commandId === entry.commandId)) {
    return { ok: false, error: "duplicate command_id without idempotent context" };
  }
  if (ctx.commandJournal.length >= COMMAND_JOURNAL_BOUND) {
    return { ok: false, error: "command journal overflow" };
  }
  return {
    ok: true,
    context: { ...ctx, commandJournal: [...ctx.commandJournal, entry] },
    emittedEvidence: [],
  };
}

function applyCommandCompleted(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
  commandId: import("./witness-types.js").WitnessCommandId,
  responseBody:
    | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
    | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
    | { readonly kind: "authority_unavailable"; readonly reason: string }
    | { readonly kind: "ok"; readonly result: WitnessPersistedResult | null },
): StateTransition {
  const idx = ctx.commandJournal.findIndex((e) => e.commandId === commandId);
  if (idx === -1) return { ok: false, error: "command_completed for unknown command_id" };
  const existing = ctx.commandJournal[idx];
  if (!existing) return { ok: false, error: "command_completed for unknown command_id" };
  if (existing.kind === "completed") {
    return { ok: false, error: "command_completed for already-completed command_id" };
  }
  const completed: CommandJournalEntry = {
    kind: "completed",
    commandId: existing.commandId,
    request: existing.request,
    requestFingerprint: existing.requestFingerprint,
    responseBody,
  };
  const next = ctx.commandJournal.slice();
  next[idx] = completed;
  let stateChange: WitnessState = ctx.state;
  if (isSettledResponse(responseBody)) {
    stateChange = isActiveState(ctx)
      ? makeExecutionSettled(ctx.state, getSequence(ctx) + 1, extractResult(responseBody))
      : ctx.state;
  }
  return {
    ok: true,
    context: { ...ctx, commandJournal: next, state: stateChange },
    emittedEvidence: [],
  };
}

function applyBootstrapLeaseExpired(
  ctx: import("./witness-runtime-sm-helpers.js").WitnessRuntimeContext,
): StateTransition {
  if (ctx.activated) return { ok: true, context: ctx, emittedEvidence: [] };
  if (ctx.state.kind !== "ready_not_activated") {
    return { ok: true, context: ctx, emittedEvidence: [] };
  }
  return {
    ok: true,
    context: { ...ctx, state: makeFailed(ctx.state, getSequence(ctx), "bootstrap_lease_expired") },
    emittedEvidence: [],
  };
}
