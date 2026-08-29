/**
 * Deterministic replay of an event sequence into a derived {@link RunState}.
 *
 * Replay is pure (no IO, no clock) once the input envelopes have been decoded
 * and validated by {@link evidence/codec}. It folds the events through the
 * pure transition reducer, starting from the canonical initial state.
 *
 * Replay fails closed:
 *   - Empty input sequence yields a queued state (no events processed yet).
 *   - Duplicate sequence numbers fail.
 *   - Sequence gaps fail.
 *   - Mixed run identities fail.
 *   - Any invalid transition fails the entire replay. The reducer never
 *     partially claims success after encountering invalid evidence.
 */

import { err, ok, type Result } from "./result.js";
import type { Failure, InvalidTransition } from "./failure.js";
import type { RunId, MissionId } from "./ids.js";
import {
  initialState,
  type RunState,
} from "./run-state.js";
import { transition } from "./transition.js";
import type { RunEvent } from "./run-event.js";

export type ReplayResult = {
  readonly state: RunState;
  readonly eventsProcessed: number;
  readonly lastSeq: number;
};

export type ReplayError =
  | InvalidTransition
  | (Failure & { readonly kind: "invalid_evidence" });

/**
 * Replay an ordered list of decoded events for a single run.
 *
 * The first event, if present, must have seq=1 and must be of type
 * `run_created`. Subsequent events must have strictly monotonically
 * increasing seq values.
 */
export function replay(
  runId: RunId,
  missionId: MissionId,
  events: ReadonlyArray<RunEvent>,
): Result<ReplayResult, ReplayError> {
  let state: RunState = initialState(runId, missionId, 0);
  let processed = 0;
  let lastSeq = 0;
  for (const event of events) {
    if (event.runId !== runId) {
      return err({
        kind: "invalid_evidence",
        reason: `Event runId '${event.runId}' does not match ledger runId '${runId}'.`,
      });
    }
    if (event.missionId !== missionId) {
      return err({
        kind: "invalid_evidence",
        reason: `Event missionId '${event.missionId}' does not match ledger missionId '${missionId}'.`,
      });
    }
    if (event.seq <= lastSeq) {
      // Duplicate or out-of-order sequence. (Strictly less is covered; equal
      // is duplicate; greater-than-one jump is detected by the equality
      // check combined with our expectation of +1, but we also verify +1
      // explicitly below.)
      return err({
        kind: "invalid_evidence",
        reason: `Sequence out of order: expected > ${lastSeq}, got ${event.seq}.`,
      });
    }
    if (event.seq !== lastSeq + 1) {
      return err({
        kind: "invalid_evidence",
        reason: `Sequence gap: expected ${lastSeq + 1}, got ${event.seq}.`,
      });
    }
    const r = transition(state, event);
    if (r.ok === false) {
      return err(r.error);
    }
    state = r.value;
    processed += 1;
    lastSeq = event.seq;
  }
  return ok({ state, eventsProcessed: processed, lastSeq });
}
