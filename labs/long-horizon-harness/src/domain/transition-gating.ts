/**
 * Transitions out of `gating`.
 *
 * I07: gate_failed cannot produce completed.
 */

import { err, ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { invalidTransition, makeTerminal, unexpected } from "./transition-helpers.js";

export function fromGating(
  state: Extract<RunState, { kind: "gating" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  switch (event.type) {
    case "gating_started": {
      if (event.attemptId !== state.currentAttempt) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            `gating_started attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
          ),
        );
      }
      return ok({ ...state, lastEventId: event.eventId, seq: event.seq });
    }
    case "gate_passed": {
      if (event.attemptId !== state.currentAttempt) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            `gate_passed attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
          ),
        );
      }
      // I07: remain in gating; review_started moves us to reviewing.
      return ok({ ...state, lastEventId: event.eventId, seq: event.seq });
    }
    case "gate_failed": {
      if (event.attemptId !== state.currentAttempt) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            `gate_failed attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
          ),
        );
      }
      return makeTerminal({
        kind: "repairing",
        state,
        event,
        reason: event.failure,
      });
    }
    case "agent_reported_completion": {
      if (event.attemptId !== state.currentAttempt) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            `agent_reported_completion attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
          ),
        );
      }
      return ok({ ...state, lastEventId: event.eventId, seq: event.seq });
    }
    case "review_started":
      return ok({
        kind: "reviewing",
        runId: state.runId,
        missionId: state.missionId,
        counters: state.counters,
        lastEventId: event.eventId,
        seq: event.seq,
      });
    case "crashed":
      return makeTerminal({ kind: "crashed", state, event, reason: event.reason });
    case "cancelled":
      return makeTerminal({ kind: "cancelled", state, event });
    case "budget_exhausted":
      return makeTerminal({
        kind: "exhausted",
        state,
        event,
        observation: event.observation,
      });
    case "blocked":
      return makeTerminal({ kind: "blocked", state, event, reason: event.reason });
    default:
      return unexpected(state.kind, event.type);
  }
}
