/**
 * Transitions out of `queued`.
 *
 * The only valid event from `queued` is `run_created`, which moves the
 * run into `preparing`. The first event must carry seq=1.
 */

import { err, ok, type Result } from "./result.js";
import type { InvalidTransition } from "./failure.js";
import type { RunState } from "./run-state.js";
import { emptyCounters } from "./run-state.js";
import type { RunEvent } from "./run-event.js";
import { invalidTransition, unexpected } from "./transition-helpers.js";

export function fromQueued(
  state: Extract<RunState, { kind: "queued" }>,
  event: RunEvent,
): Result<RunState, InvalidTransition> {
  if (event.type === "run_created") {
    if (event.seq !== state.createdAtSeq + 1) {
      return err(
        invalidTransition(
          state.kind,
          event.type,
          `First event must have seq=1; got seq=${event.seq}.`,
        ),
      );
    }
    return ok({
      kind: "preparing",
      runId: state.runId,
      missionId: state.missionId,
      counters: emptyCounters(),
      lastEventId: event.eventId,
      seq: event.seq,
    });
  }
  return unexpected(state.kind, event.type);
}
