/**
 * Transitions out of `running`.
 *
 * D02: agent_reported_completion does NOT produce completed; it moves
 * the run into `gating.awaiting_start` so an external gate may
 * authorize completion.
 *
 * CORRECTION01:
 *  - `review_started` from `running` is FORBIDDEN. The only path from
 *    `running` into `gating` is `agent_reported_completion`.
 *  - `gating_started` from `running` is FORBIDDEN. Gating must be
 *    entered only via `agent_reported_completion`.
 *  - `gate_passed` / `gate_failed` from `running` are FORBIDDEN.
 */

import { err, ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { bump, invalidTransition, makeTerminal, unexpected } from "./transition-helpers.js";

export function fromRunning(
  state: Extract<RunState, { kind: "running" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  switch (event.type) {
    case "attempt_started": {
      const next = bump(state.counters, "attempts");
      return ok({
        kind: "running",
        runId: state.runId,
        missionId: state.missionId,
        counters: next,
        currentAttempt: event.attemptId,
        lastEventId: event.eventId,
        seq: event.seq,
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
      // D02: the only legal transition from running into gating.
      return ok({
        kind: "gating",
        runId: state.runId,
        missionId: state.missionId,
        counters: state.counters,
        currentAttempt: state.currentAttempt,
        gateProgress: { phase: "awaiting_start" },
        lastEventId: event.eventId,
        seq: event.seq,
      });
    }
    case "agent_failed": {
      if (event.attemptId !== state.currentAttempt) {
        return err(
          invalidTransition(
            state.kind,
            event.type,
            `agent_failed attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
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
