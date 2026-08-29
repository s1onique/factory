/**
 * Run lifecycle state.
 *
 * The state is a small discriminated union that is explicit about whether
 * a state is non-terminal (the supervisor may continue progressing the run)
 * or terminal (no further ordinary lifecycle events apply).
 *
 * Terminal states:
 *   - completed
 *   - blocked
 *   - exhausted
 *   - crashed
 *   - cancelled
 */

import type { AttemptId, EventId, MissionId, RunId } from "./ids.js";
import type { Failure } from "./failure.js";
import type { BudgetObservation } from "./budget.js";

export type RunStateKind =
  | "queued"
  | "preparing"
  | "running"
  | "gating"
  | "repairing"
  | "reviewing"
  | "completed"
  | "blocked"
  | "exhausted"
  | "crashed"
  | "cancelled";

export const NON_TERMINAL_KINDS: readonly RunStateKind[] = [
  "queued",
  "preparing",
  "running",
  "gating",
  "repairing",
  "reviewing",
] as const;

export const TERMINAL_KINDS: readonly RunStateKind[] = [
  "completed",
  "blocked",
  "exhausted",
  "crashed",
  "cancelled",
] as const;

export function isTerminal(kind: RunStateKind): boolean {
  return (TERMINAL_KINDS as readonly string[]).includes(kind);
}

export function isNonTerminal(kind: RunStateKind): boolean {
  return (NON_TERMINAL_KINDS as readonly string[]).includes(kind);
}

/**
 * Counters tracked alongside the state. They influence no transitions in
 * FOUNDATION01 (e.g. we do not yet auto-terminate when attempts > limit),
 * but the supervisor must keep them observable and persistent so future
 * ACTs can consume them without re-derivation.
 */
export type RunCounters = {
  readonly attempts: number;
  readonly repairs: number;
  readonly toolCalls: number;
  readonly modelTurns: number;
};

export function emptyCounters(): RunCounters {
  return { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 };
}

export type NonTerminalState =
  | { readonly kind: "queued"; readonly runId: RunId; readonly missionId: MissionId; readonly createdAtSeq: number }
  | { readonly kind: "preparing"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number }
  | { readonly kind: "running"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly currentAttempt: AttemptId; readonly lastEventId: EventId; readonly seq: number }
  | { readonly kind: "gating"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly currentAttempt: AttemptId; readonly lastEventId: EventId; readonly seq: number }
  | { readonly kind: "repairing"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number; readonly reason: Failure }
  | { readonly kind: "reviewing"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number };

export type TerminalState =
  | { readonly kind: "completed"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number }
  | { readonly kind: "blocked"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number; readonly reason: Failure }
  | { readonly kind: "exhausted"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number; readonly observation: BudgetObservation }
  | { readonly kind: "crashed"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number; readonly reason: Failure }
  | { readonly kind: "cancelled"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number };

export type RunState = NonTerminalState | TerminalState;

export type AnyState = RunState;

export function isTerminalState(s: RunState): s is TerminalState {
  return isTerminal(s.kind);
}

/**
 * Initial state for a fresh run. The supervisor creates this when it
 * receives the very first event of a run (which must be `run_created`).
 */
export function initialState(
  runId: RunId,
  missionId: MissionId,
  seq: number,
): Extract<NonTerminalState, { kind: "queued" }> {
  return { kind: "queued", runId, missionId, createdAtSeq: seq };
}
