/**
 * Transitions out of `reviewing`.
 *
 * I02: review_passed is the ONLY event that produces completed.
 */

import { ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { makeTerminal, unexpected } from "./transition-helpers.js";

export function fromReviewing(
  state: Extract<RunState, { kind: "reviewing" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  switch (event.type) {
    case "review_started":
      return ok({ ...state, lastEventId: event.eventId, seq: event.seq });
    case "review_passed":
      return makeTerminal({ kind: "completed", state, event });
    case "review_failed":
      return makeTerminal({
        kind: "repairing",
        state,
        event,
        reason: event.failure,
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
