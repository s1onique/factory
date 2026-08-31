/**
 * FOUNDATION04 — witness state-machine helpers.
 *
 * Pure helpers used by witness-runtime-sm.ts. Kept separate so the
 * main state-machine file stays under the 400 LOC discipline.
 */

import type {
  WitnessExecutionStatus,
  WitnessState,
  WitnessPersistedResult,
} from "./witness-types.js";
import type {
  CommandJournalEntry,
  WitnessBootstrapConfig,
} from "./witness-runtime-types.js";

export const COMMAND_JOURNAL_BOUND = 256;

export type WitnessRuntimeContext = {
  readonly bootstrap: WitnessBootstrapConfig;
  readonly witnessPublicKey: string;
  readonly witnessPublicKeyFingerprint: string;
  readonly witnessPid: number;
  readonly controllerPublicKeyFingerprint: string;
  state: WitnessState;
  commandJournal: ReadonlyArray<CommandJournalEntry>;
  activated: boolean;
  candidate: { pid: number; pgid: number } | null;
  lastExecutionStatus: WitnessExecutionStatus;
};

export function getSequence(ctx: WitnessRuntimeContext): number {
  switch (ctx.state.kind) {
    case "bootstrapping":
    case "ready_not_activated":
      return 0;
    case "active_idle":
    case "execution_starting":
    case "execution_running":
    case "execution_settled":
    case "failed":
      return ctx.state.witnessSequence;
  }
}

export function readyNotActivated(
  ctx: WitnessRuntimeContext,
  witnessPublicKey: string,
  witnessPublicKeyFingerprint: string,
  controllerPublicKeyFingerprint: string,
  socketPath: string,
  protocolVersion: number,
): WitnessState {
  return {
    kind: "ready_not_activated",
    binding: ctx.bootstrap.binding,
    historicalWitnessPid: ctx.witnessPid,
    witnessPublicKey,
    witnessPublicKeyFingerprint,
    controllerPublicKeyFingerprint,
    socketPath,
    protocolVersion,
  };
}

export function makeActiveIdle(prev: WitnessState, seq: number): WitnessState {
  const carry = carryForward(prev);
  return { ...carry, kind: "active_idle", witnessSequence: seq };
}

export function isSettledResponse(
  r:
    | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
    | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
    | { readonly kind: "authority_unavailable"; readonly reason: string }
    | { readonly kind: "ok"; readonly result: WitnessPersistedResult | null },
): boolean {
  return (
    r.kind === "cancelled" ||
    r.kind === "terminated" ||
    r.kind === "already_settled" ||
    r.kind === "cleanup_failed"
  );
}

export function extractResult(
  r:
    | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
    | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
    | { readonly kind: "authority_unavailable"; readonly reason: string }
    | { readonly kind: "ok"; readonly result: WitnessPersistedResult | null },
): WitnessPersistedResult {
  if (r.kind === "cancelled" || r.kind === "terminated" || r.kind === "already_settled" || r.kind === "cleanup_failed") {
    return r.result;
  }
  return { outcome_kind: "still_running" };
}

export function makeExecutionSettled(
  prev: WitnessState,
  seq: number,
  result: WitnessPersistedResult,
): WitnessState {
  const carry = carryForward(prev);
  return {
    ...carry,
    kind: "execution_settled",
    witnessSequence: seq,
    result,
  };
}

export function makeExecutionStarting(prev: WitnessState, seq: number): WitnessState {
  const carry = carryForward(prev);
  return { ...carry, kind: "execution_starting", witnessSequence: seq };
}

export function makeExecutionRunning(
  prev: WitnessState,
  seq: number,
  pid: number,
  pgid: number,
): WitnessState {
  const carry = carryForward(prev);
  return { ...carry, kind: "execution_running", witnessSequence: seq, pid, pgid };
}

export function makeFailed(prev: WitnessState, seq: number, reason: string): WitnessState {
  const carry = carryForward(prev);
  return { ...carry, kind: "failed", witnessSequence: seq, reason };
}

function carryForward(prev: WitnessState): {
  readonly binding: import("./witness-types.js").WitnessBinding;
  readonly witnessPublicKey: string;
  readonly witnessPublicKeyFingerprint: string;
  readonly controllerPublicKeyFingerprint: string;
  readonly socketPath: string;
  readonly protocolVersion: number;
} {
  switch (prev.kind) {
    case "bootstrapping":
      return {
        binding: prev.binding,
        witnessPublicKey: "",
        witnessPublicKeyFingerprint: "",
        controllerPublicKeyFingerprint: "",
        socketPath: "",
        protocolVersion: 1,
      };
    case "ready_not_activated":
    case "active_idle":
    case "execution_starting":
    case "execution_running":
    case "execution_settled":
    case "failed":
      return {
        binding: prev.binding,
        witnessPublicKey: prev.witnessPublicKey,
        witnessPublicKeyFingerprint: prev.witnessPublicKeyFingerprint,
        controllerPublicKeyFingerprint: prev.controllerPublicKeyFingerprint,
        socketPath: prev.socketPath,
        protocolVersion: prev.protocolVersion,
      };
  }
}

export function isActiveState(ctx: WitnessRuntimeContext): boolean {
  return (
    ctx.state.kind === "active_idle" ||
    ctx.state.kind === "execution_starting" ||
    ctx.state.kind === "execution_running" ||
    ctx.state.kind === "execution_settled"
  );
}
