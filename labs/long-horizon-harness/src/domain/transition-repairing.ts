/**
 * Transitions out of `repairing`.
 *
 * `repair_started` records that repair work has begun; `attempt_started`
 * is the gateway back into `running` with a fresh attempt id.
 */

import { ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { bump, makeTerminal, unexpected } from "./transition-helpers.js";

export function fromRepairing(
  state: Extract<RunState, { kind: "repairing" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  switch (event.type) {
    case "repair_started": {
      const next = bump(state.counters, "repairs");
      return ok({
        kind: "repairing",
        runId: state.runId,
        missionId: state.missionId,
        counters: next,
        reason: state.reason,
        lastEventId: event.eventId,
        seq: event.seq,
      });
    }
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
