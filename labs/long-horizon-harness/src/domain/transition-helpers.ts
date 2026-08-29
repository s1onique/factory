/**
 * Shared helpers for the per-state transition functions.
 */

import { err, ok, type Result } from "./result.js";
import type { Failure, InvalidTransition } from "./failure.js";
import type { RunState, RunCounters, TerminalState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import type { BudgetObservation } from "./budget.js";

export function invalidTransition(
  from: string,
  event: string,
  message: string,
): InvalidTransition {
  return { kind: "invalid_transition", from, event, message };
}

export function bump(c: RunCounters, key: keyof RunCounters): RunCounters {
  switch (key) {
    case "attempts":
      return { ...c, attempts: c.attempts + 1 };
    case "repairs":
      return { ...c, repairs: c.repairs + 1 };
    case "toolCalls":
      return { ...c, toolCalls: c.toolCalls + 1 };
    case "modelTurns":
      return { ...c, modelTurns: c.modelTurns + 1 };
  }
}

export function unexpected(
  from: string,
  eventType: string,
): Result<RunState, InvalidTransition> {
  return err(
    invalidTransition(
      from,
      eventType,
      `Event '${eventType}' is not valid from state '${from}'.`,
    ),
  );
}

export type TargetKind = TerminalState["kind"] | "repairing";

/**
 * Build a new RunState from a non-queued source state, copying counters
 * and stamping the latest event id / sequence.
 */
export function makeTerminal(args: {
  readonly kind: TargetKind;
  readonly state: Exclude<RunState, { kind: "queued" }>;
  readonly event: RunEvent;
  readonly reason?: Failure;
  readonly observation?: BudgetObservation;
}): Result<RunState, InvalidTransition> {
  const { state, event } = args;
  const counters = state.counters;
  const lastEventId = event.eventId;
  const seq = event.seq;
  switch (args.kind) {
    case "completed":
      return ok({
        kind: "completed",
        runId: state.runId,
        missionId: state.missionId,
        counters,
        lastEventId,
        seq,
      });
    case "cancelled":
      return ok({
        kind: "cancelled",
        runId: state.runId,
        missionId: state.missionId,
        counters,
        lastEventId,
        seq,
      });
    case "crashed": {
      if (!args.reason) {
        return err(
          invalidTransition(state.kind, event.type, "crashed requires reason"),
        );
      }
      return ok({
        kind: "crashed",
        runId: state.runId,
        missionId: state.missionId,
        counters,
        lastEventId,
        seq,
        reason: args.reason,
      });
    }
    case "blocked": {
      if (!args.reason) {
        return err(
          invalidTransition(state.kind, event.type, "blocked requires reason"),
        );
      }
      return ok({
        kind: "blocked",
        runId: state.runId,
        missionId: state.missionId,
        counters,
        lastEventId,
        seq,
        reason: args.reason,
      });
    }
    case "exhausted": {
      if (!args.observation) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            "exhausted requires observation",
          ),
        );
      }
      return ok({
        kind: "exhausted",
        runId: state.runId,
        missionId: state.missionId,
        counters,
        lastEventId,
        seq,
        observation: args.observation,
      });
    }
    case "repairing": {
      if (!args.reason) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            "repairing transition requires reason",
          ),
        );
      }
      return ok({
        kind: "repairing",
        runId: state.runId,
        missionId: state.missionId,
        counters,
        reason: args.reason,
        lastEventId,
        seq,
      });
    }
  }
}
