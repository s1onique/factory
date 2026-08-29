/**
 * Transitions out of `preparing`.
 */

import { ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { bump, makeTerminal, unexpected } from "./transition-helpers.js";

export function fromPreparing(
  state: Extract<RunState, { kind: "preparing" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  switch (event.type) {
    case "preparation_started":
      return ok({ ...state, lastEventId: event.eventId, seq: event.seq });
    case "preparation_succeeded":
      return ok({ ...state, lastEventId: event.eventId, seq: event.seq });
    case "preparation_failed":
      return makeTerminal({
        kind: "blocked",
        state,
        event,
        reason: event.failure,
      });
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
