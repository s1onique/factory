/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure wall-clock duration derivations (M8).
 *
 * Doctrine (M8):
 *   1. logical ordering remains Phase E `sequence`
 *   2. timestamps MUST NOT determine event order
 *   3. backward/non-monotonic wall-clock observations
 *      produce `unavailable`, never a clamped value
 *   4. missing timestamps produce `unavailable`, never 0
 *   5. negative durations fail metric validation
 *
 * The projector only consults `observed_at` (a captured
 * observation) for durations. Phase E's `sequence` is the
 * authoritative ordering; durations are derived purely for
 * measurement.
 *
 * LH-02 NEVER infers `observed_at` from logical position.
 * If `observed_at` is invalid, the metric is
 * `unavailable`.
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent } from "../run/run-types.js";
import type { MetricValue, TimeMetrics } from "./metric-types.js";
import { available, unavailable } from "./metric-types.js";

/**
 * Validate that `observed_at` is a finite non-negative
 * number. Phase E documents observed_at as a millisecond
 * duration; we accept any non-negative finite number.
 */
function isValidObservedAt(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Check the time series for non-monotonicity (M8 #3).
 * Returns:
 *   "ok"             — series is monotonically non-decreasing
 *   "non_monotonic"  — some adjacent pair is backwards
 *   "missing"        — some timestamp is invalid
 *
 * Logical ordering remains Phase E `sequence` (M8 #1); this
 * check is an external observation that should normally be
 * non-decreasing but may legitimately NOT be (the harness
 * may catch up after a stall), and M8 says we refuse to
 * silently clamp in that case.
 */
type MonotonicResult = "ok" | "non_monotonic" | "missing";

/**
 * Walk the ordered events and verify the observed_at series
 * is monotonically non-decreasing. Returns "ok" / "non_monotonic"
 * / "missing" depending on what we observed (M8 #3 / #4).
 */
function checkMonotonic(
  ordered: ReadonlyArray<CommittedRunEvent>,
): MonotonicResult {
  let prev: number | null = null;
  for (const e of ordered) {
    if (!isValidObservedAt(e.observed_at)) {
      return "missing";
    }
    if (prev !== null && e.observed_at < prev) {
      return "non_monotonic";
    }
    prev = e.observed_at;
  }
  return "ok";
}

/**
 * Derive the full TimeMetrics vector.
 *
 * `time_to_terminal_ms` uses the FIRST terminal event as its
 * anchor. For non-terminal runs it is `unavailable`
 * because M8 forbids fabricating a fake terminal.
 *
 * `time_to_last_authoritative_pass_ms` uses the LAST passing
 * gate as its anchor.
 */
export function deriveTimeMetrics(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): TimeMetrics {
  const mono = checkMonotonic(orderedEvents);

  // observed_run_duration_ms: first -> last observed event.
  let observed_run_duration_ms: MetricValue<number>;
  if (orderedEvents.length === 0) {
    observed_run_duration_ms = unavailable("NOT_OBSERVED");
  } else if (mono === "missing") {
    observed_run_duration_ms = unavailable("MISSING_TIMESTAMPS");
  } else if (mono === "non_monotonic") {
    observed_run_duration_ms = unavailable("INVALID_DURATION");
  } else {
    const first = orderedEvents[0];
    const last = orderedEvents[orderedEvents.length - 1];
    if (first === undefined || last === undefined) {
      observed_run_duration_ms = unavailable("NOT_OBSERVED");
    } else {
      const delta = last.observed_at - first.observed_at;
      if (delta < 0) {
        observed_run_duration_ms = unavailable("INVALID_DURATION");
      } else {
        observed_run_duration_ms = available(delta);
      }
    }
  }

  function findRunStartedIndex(): number | null {
    for (let i = 0; i < orderedEvents.length; i++) {
      const e = orderedEvents[i];
      if (e !== undefined && e.event.type === "RUN_STARTED") {
        return i;
      }
    }
    return null;
  }

  function findFirstTerminalIndex(): number | null {
    for (let i = 0; i < orderedEvents.length; i++) {
      const e = orderedEvents[i];
      if (e === undefined) continue;
      const t = e.event.type;
      if (
        t === "RUN_FINISHED" || t === "RUN_TIMEOUT" || t === "RUN_ABORTED"
      ) {
        return i;
      }
    }
    return null;
  }

  function findLastPassingGateIndex(): number | null {
    let last: number | null = null;
    for (let i = 0; i < orderedEvents.length; i++) {
      const e = orderedEvents[i];
      if (
        e !== undefined &&
        e.event.type === "GATE_FINISHED" &&
        e.event.pass === true
      ) {
        last = i;
      }
    }
    return last;
  }

  function durationBetween(
    startIdx: number,
    endIdx: number,
  ): MetricValue<number> {
    if (mono === "missing") return unavailable("MISSING_TIMESTAMPS");
    if (mono === "non_monotonic") return unavailable("INVALID_DURATION");
    const s = orderedEvents[startIdx];
    const e = orderedEvents[endIdx];
    if (s === undefined || e === undefined) {
      return unavailable("NOT_OBSERVED");
    }
    if (!isValidObservedAt(s.observed_at) || !isValidObservedAt(e.observed_at)) {
      return unavailable("MISSING_TIMESTAMPS");
    }
    const d = e.observed_at - s.observed_at;
    if (d < 0) return unavailable("INVALID_DURATION");
    return available(d);
  }

  const startIdx = findRunStartedIndex();
  const terminalIdx = findFirstTerminalIndex();
  let time_to_terminal_ms: MetricValue<number>;
  if (startIdx === null || terminalIdx === null) {
    time_to_terminal_ms = unavailable("INCOMPLETE_RUN");
  } else if (terminalIdx < startIdx) {
    time_to_terminal_ms = unavailable("INVALID_DURATION");
  } else {
    time_to_terminal_ms = durationBetween(startIdx, terminalIdx);
  }

  const lastPassIdx = findLastPassingGateIndex();
  let time_to_last_authoritative_pass_ms: MetricValue<number>;
  if (startIdx === null || lastPassIdx === null) {
    time_to_last_authoritative_pass_ms = unavailable("NOT_OBSERVED");
  } else if (lastPassIdx < startIdx) {
    time_to_last_authoritative_pass_ms = unavailable("INVALID_DURATION");
  } else {
    time_to_last_authoritative_pass_ms = durationBetween(
      startIdx,
      lastPassIdx,
    );
  }

  return {
    observed_run_duration_ms,
    time_to_terminal_ms,
    time_to_last_authoritative_pass_ms,
  };
}
