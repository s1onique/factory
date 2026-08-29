/**
 * Transitions out of `gating`.
 *
 * CORRECTION01: the gating state carries an algebraic
 * {@link GateProgress} sub-state. The transition table is:
 *
 *   gating(awaiting_start) --gating_started(g, a)--> gating(running, g, a)
 *   gating(awaiting_start) --gate_passed/ gate_failed/ review_started--> rejected
 *
 *   gating(running, g, a)   --gate_passed(g, a)--> gating(passed, g, a)
 *   gating(running, g, a)   --gate_failed(g, a, failure)--> repairing
 *   gating(running, g, a)   --gating_started--> rejected (duplicate)
 *   gating(running, g, a)   --review_started--> rejected (gate not yet passed)
 *
 *   gating(passed, g, a)    --review_started--> reviewing
 *   gating(passed, g, a)    --gate_passed/ gate_failed--> rejected
 *
 * `gating_started`, `gate_passed`, and `gate_failed` MUST carry an
 * `attemptId` matching `state.currentAttempt`. `gate_passed` and
 * `gate_failed` MUST additionally carry a `gate` matching the
 * currently running gate (or, in `passed`, the recorded gate).
 */

import { err, ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { GateProgress, RunState } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import {
  invalidTransition,
  makeTerminal,
  unexpected,
} from "./transition-helpers.js";

type GatingState<S extends GateProgress["phase"]> = Extract<
  RunState,
  { kind: "gating" }
> & { readonly gateProgress: Extract<GateProgress, { phase: S }> };

function narrow<S extends GateProgress["phase"]>(
  state: Extract<RunState, { kind: "gating" }>,
  phase: S,
): GatingState<S> | null {
  if (state.gateProgress.phase === phase) {
    return state as GatingState<S>;
  }
  return null;
}

export function fromGating(
  state: Extract<RunState, { kind: "gating" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  const awaiting = narrow(state, "awaiting_start");
  if (awaiting !== null) return fromGatingAwaiting(awaiting, event);
  const running = narrow(state, "running");
  if (running !== null) return fromGatingRunning(running, event);
  const passed = narrow(state, "passed");
  if (passed !== null) return fromGatingPassed(passed, event);
  return unexpected(state.kind, event.type);
}

function fromGatingAwaiting(
  state: GatingState<"awaiting_start">,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  if (event.type === "gating_started") {
    if (event.attemptId !== state.currentAttempt) {
      return err(
        invalidTransition(
          state.kind,
          event.type,
          `gating_started attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
        ),
      );
    }
    return ok({
      kind: "gating",
      runId: state.runId,
      missionId: state.missionId,
      counters: state.counters,
      currentAttempt: state.currentAttempt,
      gateProgress: {
        phase: "running",
        gate: event.gate,
        attemptId: event.attemptId,
      },
      lastEventId: event.eventId,
      seq: event.seq,
    });
  }
  return unexpected(state.kind, event.type);
}

function fromGatingRunning(
  state: GatingState<"running">,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  if (event.type === "gate_passed") {
    if (event.attemptId !== state.currentAttempt) {
      return err(
        invalidTransition(
          state.kind,
          event.type,
          `gate_passed attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
        ),
      );
    }
    if (event.gate !== state.gateProgress.gate) {
      return err(
        invalidTransition(
          state.kind,
          event.type,
          `gate_passed gate '${event.gate}' does not match running gate '${state.gateProgress.gate}'.`,
        ),
      );
    }
    return ok({
      kind: "gating",
      runId: state.runId,
      missionId: state.missionId,
      counters: state.counters,
      currentAttempt: state.currentAttempt,
      gateProgress: {
        phase: "passed",
        gate: event.gate,
        attemptId: event.attemptId,
      },
      lastEventId: event.eventId,
      seq: event.seq,
    });
  }
  if (event.type === "gate_failed") {
    if (event.attemptId !== state.currentAttempt) {
      return err(
        invalidTransition(
          state.kind,
          event.type,
          `gate_failed attemptId '${event.attemptId}' does not match current attempt '${state.currentAttempt}'.`,
        ),
      );
    }
    if (event.gate !== state.gateProgress.gate) {
      return err(
        invalidTransition(
          state.kind,
          event.type,
          `gate_failed gate '${event.gate}' does not match running gate '${state.gateProgress.gate}'.`,
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
  return unexpected(state.kind, event.type);
}

function fromGatingPassed(
  state: GatingState<"passed">,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  if (event.type === "review_started") {
    return ok({
      kind: "reviewing",
      runId: state.runId,
      missionId: state.missionId,
      counters: state.counters,
      lastEventId: event.eventId,
      seq: event.seq,
    });
  }
  return unexpected(state.kind, event.type);
}
