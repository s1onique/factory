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
 *
 * Gating carries an algebraic {@link GateProgress} sub-state. The
 * progress is part of the state, not a separate channel; the supervisor
 * MUST consult `gateProgress` to decide which events are legal in each
 * gating phase. Multiple named gates, gate suites, or external gate
 * executors are deliberately out of scope here; the FOUNDATION01 gate
 * model is exactly one abstract deterministic gate phase.
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

export type RunCounters = {
  readonly attempts: number;
  readonly repairs: number;
  readonly toolCalls: number;
  readonly modelTurns: number;
};

export function emptyCounters(): RunCounters {
  return { attempts: 0, repairs: 0, toolCalls: 0, modelTurns: 0 };
}

/**
 * Algebraic sub-state of the gating phase.
 *
 * Three small variants:
 *
 *  - {@link GateAwaitingStart} — the run has just been told to gate. The
 *    next legal event is `gating_started`.
 *  - {@link GateRunning} — the gate has been started and is currently
 *    running. The next legal events are `gate_passed` or `gate_failed`,
 *    matching the recorded gate name and the recorded attempt id.
 *  - {@link GatePassed} — the gate has passed. The next legal event is
 *    `review_started`. `gate_passed`/`gate_failed` are no longer accepted
 *    in this phase.
 *
 * The `attemptId` is recorded alongside the progress so the transition
 * reducer can compare it against the event's `attemptId` without
 * remembering past attempts.
 */
export type GateProgress =
  | { readonly phase: "awaiting_start" }
  | {
      readonly phase: "running";
      readonly gate: string;
      readonly attemptId: AttemptId;
    }
  | {
      readonly phase: "passed";
      readonly gate: string;
      readonly attemptId: AttemptId;
    };

export type NonTerminalState =
  | { readonly kind: "queued"; readonly runId: RunId; readonly missionId: MissionId; readonly createdAtSeq: number }
  | { readonly kind: "preparing"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly lastEventId: EventId; readonly seq: number }
  | { readonly kind: "running"; readonly runId: RunId; readonly missionId: MissionId; readonly counters: RunCounters; readonly currentAttempt: AttemptId; readonly lastEventId: EventId; readonly seq: number }
  | {
      readonly kind: "gating";
      readonly runId: RunId;
      readonly missionId: MissionId;
      readonly counters: RunCounters;
      readonly currentAttempt: AttemptId;
      readonly gateProgress: GateProgress;
      readonly lastEventId: EventId;
      readonly seq: number;
    }
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

/** Extract the gating sub-state for pattern matching; null if not gating. */
export function gateProgress(s: RunState): GateProgress | null {
  return s.kind === "gating" ? s.gateProgress : null;
}

export function initialState(
  runId: RunId,
  missionId: MissionId,
  seq: number,
): Extract<NonTerminalState, { kind: "queued" }> {
  return { kind: "queued", runId, missionId, createdAtSeq: seq };
}