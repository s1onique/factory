/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure convergence-distance derivations (M5) and correction
 * burden (M6).
 *
 * Doctrine (M5):
 *   "Define the primary structural convergence measure
 *    without inventing one composite score."
 *
 * Doctrine (M6):
 *   "PASS -> more work -> PASS is qualitatively different
 *    from work -> PASS, even if both terminate successfully."
 *
 * Both distance and correction-burden values come from
 * walking the ordered event stream and recording positions.
 * The "position of the LAST passing closure gate"
 * determination uses Phase E's `GATE_FINISHED(pass=true)`
 * events.
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent, RunProjection } from "../run/run-types.js";
import type {
  ConvergenceDistances,
  CorrectionBurden,
  MetricValue,
  Counters,
} from "./metric-types.js";
import { available, unavailable } from "./metric-types.js";

/**
 * 1-based position of an event in the ordered stream. We
 * use positions (rather than array indices) so callers can
 * compare directly with the Phase E `sequence` field if
 * needed.
 */
type Position = {
  readonly index1Based: number;
};

/**
 * Locate the 1-based position of the FIRST terminal event in
 * the stream, if any. Returns `null` for ACTIVE / INCOMPLETE
 * runs. The "terminal" anchor here is the first event whose
 * type maps to a terminal-semantic claim (RUN_FINISHED,
 * RUN_TIMEOUT, RUN_ABORTED).
 */
function findFirstTerminalPosition(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): Position | null {
  for (let i = 0; i < orderedEvents.length; i++) {
    const e = orderedEvents[i];
    if (e === undefined) continue;
    const t = e.event.type;
    if (t === "RUN_FINISHED" || t === "RUN_TIMEOUT" || t === "RUN_ABORTED") {
      return { index1Based: i + 1 };
    }
  }
  return null;
}

/**
 * Locate the 1-based position of the LAST
 * GATE_FINISHED(pass=true) event, if any. Returns `null`
 * if no passing gate was ever observed.
 *
 * M5 calls this the "last authoritative pass": the gate
 * evidence that ultimately authorized SUCCESS, when one
 * exists.
 */
function findLastAuthoritativePassPosition(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): Position | null {
  let last: Position | null = null;
  for (let i = 0; i < orderedEvents.length; i++) {
    const e = orderedEvents[i];
    if (e === undefined) continue;
    if (e.event.type === "GATE_FINISHED" && e.event.pass === true) {
      last = { index1Based: i + 1 };
    }
  }
  return last;
}

/**
 * Count, up to and including `pos` (1-based), the events of
 * the requested discriminator kind.
 *
 * Used to compute "actions_to_terminal" / "gates_to_terminal"
 * / "repairs_to_terminal" / "reviews_to_terminal".
 */
function countEventsUpTo(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
  posInclusive: number,
  selector: (e: CommittedRunEvent) => boolean,
): number {
  let n = 0;
  const upTo = Math.min(posInclusive, orderedEvents.length);
  for (let i = 0; i < upTo; i++) {
    const e = orderedEvents[i];
    if (e !== undefined && selector(e)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Selectors used by `countEventsUpTo`. Each is a closed-world
 * discriminator; new event types must be added explicitly.
 */
const SELECTORS = {
  action: (e: CommittedRunEvent) => e.event.type === "ACTION_FINISHED",
  gate: (e: CommittedRunEvent) => e.event.type === "GATE_FINISHED",
  repair: (e: CommittedRunEvent) => e.event.type === "REPAIR_FINISHED",
  review: (e: CommittedRunEvent) => e.event.type === "REVIEW_FINISHED",
};

/**
 * Derive the full ConvergenceDistances vector.
 *
 * The `*_to_terminal` measures use the FULL stream length
 * when no terminal is present (so ACTIVE / INCOMPLETE runs
 * still report useful "events observed so far" counts).
 *
 * `*_to_last_authoritative_pass` are `MetricValue<number>`
 * per M5 — `unavailable` when no passing gate was observed.
 */
export function deriveConvergenceDistances(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): ConvergenceDistances {
  const terminalPos = findFirstTerminalPosition(orderedEvents);
  const effectiveTerminalPos =
    terminalPos === null
      ? orderedEvents.length
      : terminalPos.index1Based;

  const lastPassPos = findLastAuthoritativePassPosition(orderedEvents);

  const actions_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    SELECTORS.action,
  );
  const repairs_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    SELECTORS.repair,
  );
  const reviews_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    SELECTORS.review,
  );
  const gates_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    SELECTORS.gate,
  );
  // "positions observed through terminal" — the projector
  // owns the work_epoch scalar via the supplied projection
  // (used in deriveCorrectionBurden). For the distance field
  // we use the 1-based event position as the trajectory
  // length proxy, which is consistent with the other
  // *_to_terminal values.
  const work_epochs_to_terminal = effectiveTerminalPos;

  let actions_to_last_authoritative_pass: MetricValue<number>;
  let repairs_to_last_authoritative_pass: MetricValue<number>;
  let reviews_to_last_authoritative_pass: MetricValue<number>;
  let work_epochs_to_last_authoritative_pass: MetricValue<number>;
  if (lastPassPos === null) {
    actions_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
    repairs_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
    reviews_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
    work_epochs_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
  } else {
    actions_to_last_authoritative_pass = available(
      countEventsUpTo(orderedEvents, lastPassPos.index1Based, SELECTORS.action),
    );
    repairs_to_last_authoritative_pass = available(
      countEventsUpTo(orderedEvents, lastPassPos.index1Based, SELECTORS.repair),
    );
    reviews_to_last_authoritative_pass = available(
      countEventsUpTo(orderedEvents, lastPassPos.index1Based, SELECTORS.review),
    );
    work_epochs_to_last_authoritative_pass = available(
      lastPassPos.index1Based,
    );
  }

  return {
    actions_to_terminal,
    repairs_to_terminal,
    reviews_to_terminal,
    gates_to_terminal,
    work_epochs_to_terminal,
    actions_to_last_authoritative_pass,
    repairs_to_last_authoritative_pass,
    reviews_to_last_authoritative_pass,
    work_epochs_to_last_authoritative_pass,
  };
}

/**
 * Derive the CorrectionBurden vector (M6).
 *
 * The scalar fields here mirror the corresponding Counters
 * fields; we copy them in so the burden section is
 * self-contained for downstream consumers.
 *
 * `authority_invalidation_count` is the count of
 * negative-evidence events that CURRENTLY invalidate
 * prior closure authority (per Phase E E-C23):
 *
 *   current_epoch_action_failure ? 1 : 0
 *   + current_epoch_review_failure ? 1 : 0
 *
 * In V1 that is bounded by 2: those are the only two
 * authority-invalidation channels Phase E exposes via
 * RunProjection. LH-02 deliberately does NOT invent a
 * richer "weighted burden".
 */
export function deriveCorrectionBurden(
  counters: Counters,
  projection: RunProjection,
): CorrectionBurden {
  const actionInvalid =
    projection.current_epoch_action_failure === true ? 1 : 0;
  const reviewInvalid =
    projection.current_epoch_review_failure === true ? 1 : 0;
  return {
    repair_cycle_count: counters.repair_cycle_count,
    failed_action_count: counters.failed_action_count,
    failing_gate_count: counters.failing_gate_count,
    failing_review_count: counters.failing_review_count,
    authority_invalidation_count: actionInvalid + reviewInvalid,
  };
}
