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
 * walking the ordered event stream and recording positions
 * / counts. The "authoritative pass" anchor is the LAST
 * passing closure gate that contributed to a
 * `trustworthy_success` outcome — i.e. the gate that
 * authorized terminal SUCCESS. For non-SUCCESS runs the
 * `*_to_last_authoritative_pass` fields are explicitly
 * unavailable rather than anchoring on a passing gate that
 * may later be invalidated (CORRECTION01 M-C04).
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
import { deriveAuthorityChannels } from "./metric-counters.js";

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
 * Locate the LAST GATE_FINISHED(pass=true) event in the
 * stream that authorized terminal SUCCESS.
 *
 * CORRECTION02 (M-C09): the authoritative-pass walker now
 * delegates to `walkAuthority` so it shares its
 * interpretation of the frozen Phase E precedence model
 * with `metric-counters.ts`. The previous in-line walker
 * here had drifted on REVIEW_FINISHED semantics; the
 * single-source approach removes the divergence.
 *
 * Returns `null` when no passing closure gate was
 * observed; callers anchor the `*_to_last_authoritative_pass`
 * fields on this position.
 */
function findAuthoritativePassPosition(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): Position | null {
  const w = deriveAuthorityChannels(orderedEvents);
  if (w.lastAuthoritativeGatePosition === null) return null;
  return { index1Based: w.lastAuthoritativeGatePosition };
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
 * Discriminator helpers used by `countEventsUpTo`. Each is
 * a closed-world discriminator; new event types must be
 * added explicitly.
 *
 * CORRECTION01 (M-C03):
 *
 *   `selectActionStarted` discriminates ACTION_STARTED
 *   (attempts ENTERED), not ACTION_FINISHED. The M5
 *   distance field measures iterations / convergence, not
 *   raw closed-action count; an action that is in-flight at
 *   the anchor gate is the action OWNING that gate and MUST
 *   be counted.
 *
 *   The closed-action count remains the structural counter
 *   (`action_count`) so we don't lose that information.
 */
function selectActionStarted(e: CommittedRunEvent): boolean {
  return e.event.type === "ACTION_STARTED";
}
function selectRepairStarted(e: CommittedRunEvent): boolean {
  return e.event.type === "REPAIR_STARTED";
}
function selectReviewStarted(e: CommittedRunEvent): boolean {
  return e.event.type === "REVIEW_STARTED";
}
function selectGateFinished(e: CommittedRunEvent): boolean {
  return e.event.type === "GATE_FINISHED";
}

/**
 * Derive the work epoch at the given event position
 * (1-based inclusive). The walk mirrors Phase E's E-C14 V2
 * transition rule: increments on ACTION_STARTED,
 * REPAIR_STARTED, and ACTION_FINISHED(ERROR). For position
 * > events.length we return the work epoch at the end of
 * the stream.
 */
function workEpochAtPosition(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
  posInclusive: number,
): number {
  let workEpoch = 0;
  const upTo = Math.min(posInclusive, orderedEvents.length);
  for (let i = 0; i < upTo; i++) {
    const e = orderedEvents[i];
    if (e === undefined) continue;
    const t = e.event.type;
    if (
      t === "ACTION_STARTED" ||
      t === "REPAIR_STARTED" ||
      (t === "ACTION_FINISHED" && e.event.status === "ERROR")
    ) {
      workEpoch += 1;
    }
  }
  return workEpoch;
}

/**
 * Derive the full ConvergenceDistances vector (M5).
 *
 * For terminal runs, the anchor position is the FIRST
 * terminal event in the stream. For non-terminal runs, the
 * anchor is `events.length` (the end of the stream).
 *
 * `actions_to_*` discriminators use ACTION_STARTED so the
 * value measures "attempts entered by the anchor", which
 * is the M5-relevant iterand.
 *
 * `work_epochs_to_*` uses the actual Phase E work epoch at
 * the anchor (NOT the event array position).
 *
 * `*_to_last_authoritative_pass` fields anchor on the
 * passing closure gate that AUTHORIZED terminal SUCCESS.
 * For non-SUCCESS runs these fields surface
 * `unavailable("NOT_APPLICABLE")` rather than anchoring on
 * a passing gate that may later be invalidated.
 *
 * `trustworthySuccess` is supplied by the projector
 * (Phase E E-C07 + E-C14). It is the SAME boolean that
 * gates the `convergence.trustworthy_success` field on
 * the report.
 */
export function deriveConvergenceDistances(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
  trustworthySuccess: boolean,
): ConvergenceDistances {
  const terminalPos = findFirstTerminalPosition(orderedEvents);
  const effectiveTerminalPos =
    terminalPos !== null ? terminalPos.index1Based : orderedEvents.length;

  const actions_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    selectActionStarted,
  );
  const repairs_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    selectRepairStarted,
  );
  const reviews_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    selectReviewStarted,
  );
  const gates_to_terminal = countEventsUpTo(
    orderedEvents,
    effectiveTerminalPos,
    selectGateFinished,
  );
  const work_epochs_to_terminal = workEpochAtPosition(
    orderedEvents,
    effectiveTerminalPos,
  );

  let actions_to_last_authoritative_pass: MetricValue<number>;
  let repairs_to_last_authoritative_pass: MetricValue<number>;
  let reviews_to_last_authoritative_pass: MetricValue<number>;
  let work_epochs_to_last_authoritative_pass: MetricValue<number>;
  if (!trustworthySuccess) {
    // CORRECTION01 M-C04: a passing gate followed by
    // negative evidence is NOT "authoritative" for purposes
    // of this metric. For non-SUCCESS runs the anchor is
    // undefined, so we surface unavailable(NOT_APPLICABLE)
    // rather than the position of a gate that did not
    // authorize SUCCESS.
    actions_to_last_authoritative_pass = unavailable("NOT_APPLICABLE");
    repairs_to_last_authoritative_pass = unavailable("NOT_APPLICABLE");
    reviews_to_last_authoritative_pass = unavailable("NOT_APPLICABLE");
    work_epochs_to_last_authoritative_pass = unavailable("NOT_APPLICABLE");
  } else {
    const lastPassPos = findAuthoritativePassPosition(orderedEvents);
    if (lastPassPos === null) {
      actions_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
      repairs_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
      reviews_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
      work_epochs_to_last_authoritative_pass = unavailable("NOT_OBSERVED");
    } else {
      actions_to_last_authoritative_pass = available(
        countEventsUpTo(
          orderedEvents,
          lastPassPos.index1Based,
          selectActionStarted,
        ),
      );
      repairs_to_last_authoritative_pass = available(
        countEventsUpTo(
          orderedEvents,
          lastPassPos.index1Based,
          selectRepairStarted,
        ),
      );
      reviews_to_last_authoritative_pass = available(
        countEventsUpTo(
          orderedEvents,
          lastPassPos.index1Based,
          selectReviewStarted,
        ),
      );
      work_epochs_to_last_authoritative_pass = available(
        workEpochAtPosition(orderedEvents, lastPassPos.index1Based),
      );
    }
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
 * `historical_authority_invalidation_count` is the
 * HISTORICAL closure-channel correction burden: events that
 * invalidated previously established POSITIVE closure
 * authority, counted by the canonical authority walker in
 * `metric-authority.ts`. REVIEW_FINISHED events do NOT
 * contribute (CORRECTION02 M-C08).
 *
 * `historical_review_blocker_activation_count` is the
 * historical review-blocker-channel activation count
 * (CORRECTION02 M-C08): REVIEW_FINISHED(pass=false)
 * events. Independent of the closure channel.
 *
 * `current_authority_blocker_count` is the CURRENT-STATE
 * diagnostic (the previous V1 definition): 0..2 reflecting
 * whether an unrecovered failure still blocks SUCCESS.
 *
 * LH-02 deliberately does NOT collapse these into a single
 * scalar.
 */
export function deriveCorrectionBurden(
  counters: Counters,
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
  projection: RunProjection,
): CorrectionBurden {
  const actionInvalid =
    projection.current_epoch_action_failure === true ? 1 : 0;
  const reviewInvalid =
    projection.current_epoch_review_failure === true ? 1 : 0;
  const channels = deriveAuthorityChannels(orderedEvents);
  return {
    repair_cycle_count: counters.repair_cycle_count,
    failed_action_count: counters.failed_action_count,
    failing_gate_count: counters.failing_gate_count,
    failing_review_count: counters.failing_review_count,
    historical_authority_invalidation_count:
      channels.historical_authority_invalidation_count,
    historical_review_blocker_activation_count:
      channels.historical_review_blocker_activation_count,
    current_authority_blocker_count: actionInvalid + reviewInvalid,
  };
}
