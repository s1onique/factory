/**
 * Pure total transition function for the run lifecycle.
 *
 * Contract:
 *  - Given a {@link RunState} and a {@link RunEvent}, return either a new
 *    state or a typed {@link InvalidTransition} error.
 *  - The function is pure: no filesystem, no Date.now, no randomness, no
 *    process, no environment reads.
 *  - Terminal states (completed, blocked, exhausted, crashed, cancelled)
 *    reject ordinary lifecycle events with a typed error.
 *
 * Doctrines enforced:
 *  - D02: agent_reported_completion NEVER produces completed.
 *  - I07: gate_failed never produces completed.
 *  - I02..I06: terminal states are immutable under ordinary events.
 *  - I08: invalid state/event pairs return typed rejections.
 *
 * Per-state logic lives in sibling files to keep this entry-point small.
 */

import { err, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import { isTerminalState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { fromQueued } from "./transition-queued.js";
import { fromPreparing } from "./transition-preparing.js";
import { fromRunning } from "./transition-running.js";
import { fromGating } from "./transition-gating.js";
import { fromRepairing } from "./transition-repairing.js";
import { fromReviewing } from "./transition-reviewing.js";
import { invalidTransition } from "./transition-helpers.js";

export { invalidTransition };

export function transition(
  state: RunState,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  if (isTerminalState(state)) {
    return err(
      invalidTransition(
        state.kind,
        event.type,
        `Run is in terminal state '${state.kind}'; no further events accepted.`,
      ),
    );
  }
  if (event.runId !== state.runId) {
    return err(
      invalidTransition(
        state.kind,
        event.type,
        `Event runId '${event.runId}' does not match state runId '${state.runId}'.`,
      ),
    );
  }
  if (event.missionId !== state.missionId) {
    return err(
      invalidTransition(
        state.kind,
        event.type,
        `Event missionId '${event.missionId}' does not match state missionId '${state.missionId}'.`,
      ),
    );
  }

  switch (state.kind) {
    case "queued":
      return fromQueued(state, event);
    case "preparing":
      return fromPreparing(state, event);
    case "running":
      return fromRunning(state, event);
    case "gating":
      return fromGating(state, event);
    case "repairing":
      return fromRepairing(state, event);
    case "reviewing":
      return fromReviewing(state, event);
  }
}
