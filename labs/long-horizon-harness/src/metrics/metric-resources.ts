/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure resource-observation derivations (M9 / M10 / M11).
 *
 * Phase E exposes `ResourceObservation` only as the
 * `observation` field of a `RUN_TIMEOUT` event in V1
 * (no standalone RESOURCE_OBSERVATION event exists). LH-02
 * surfaces those observations when present.
 *
 * Doctrine (M9):
 *   "Do NOT infer tool calls from ACTION_STARTED count
 *    unless the contract explicitly defines an action as
 *    exactly one tool call — which it currently does not.
 *    If evidence is absent: tool_calls_total = unavailable,
 *    not zero."
 *
 * Doctrine (M10):
 *   "Token evidence MUST carry enough provenance to
 *    distinguish model-reported / provider-reported /
 *    harness-estimated if Phase E observations expose that
 *    distinction. If Phase E cannot currently prove
 *    provenance, record metric availability limits rather
 *    than broadening Phase E inside this ACT."
 *
 * Doctrine (M11):
 *   "From Phase-E resource observations, derive where
 *    available: peak_process_count, observed_wall_clock_ms,
 *    token totals, tool-call totals. Do not invent
 *    CPU/RSS measurements unless evidence exists."
 *
 * Doctrine (M12):
 *   "RESOURCE_METRICS now. Do not bind current vendor
 *    prices into deterministic run metrics. MEASURED_CONSUMPTION
 *    != PRICING."
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent } from "../run/run-types.js";
import type { ResourceMetrics } from "./metric-types.js";
import {
  available,
  unavailable,
  type MetricValue,
} from "./metric-types.js";

/**
 * The single Phase E source for resource observations in
 * V1: the `observation` field of a `RUN_TIMEOUT` event.
 * LH-02 finds the FIRST `RUN_TIMEOUT` (the projector will
 * have rejected multiple incompatible terminals upstream),
 * then if its `observation.kind` matches one of the four
 * `ResourceObservationKind` values that Phase E supports,
 * we surface the value under the matching metric slot.
 *
 * For all other kinds the metric is `unavailable(NOT_OBSERVED)`.
 * Phase E does NOT allow inferring tool calls / tokens /
 * process counts from action counts (M9).
 */
export function deriveResourceMetrics(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): ResourceMetrics {
  let tool_calls_total: MetricValue<number> = unavailable("NOT_OBSERVED");
  let input_tokens: MetricValue<number> = unavailable("NOT_OBSERVED");
  let output_tokens: MetricValue<number> = unavailable("NOT_OBSERVED");
  let total_tokens: MetricValue<number> = unavailable("NOT_OBSERVED");
  let peak_process_count: MetricValue<number> = unavailable("NOT_OBSERVED");
  let observed_wall_clock_ms: MetricValue<number> =
    unavailable("NOT_OBSERVED");

  // Find the FIRST RUN_TIMEOUT and use its observation. V1
  // does not aggregate across multiple timeouts because Phase
  // E rejects multiple incompatible terminals upstream.
  for (const e of orderedEvents) {
    if (e.event.type !== "RUN_TIMEOUT") continue;
    const observation = e.event.observation;
    const observed = observation.observed;
    const kind = observation.kind;
    if (kind === "tool_calls") {
      tool_calls_total = available(observed);
    } else if (kind === "tokens") {
      // Phase E exposes `tokens` as a single observed value
      // without input / output distinction. Therefore V1
      // exposes ONLY `total_tokens`; input_tokens / output_tokens
      // remain unavailable. M10 explicitly anticipates this:
      // "expose only what was actually observed".
      total_tokens = available(observed);
    } else if (kind === "process_count") {
      peak_process_count = available(observed);
    } else if (kind === "wall_clock_ms") {
      observed_wall_clock_ms = available(observed);
    }
    break;
  }

  return {
    tool_calls_total,
    input_tokens,
    output_tokens,
    total_tokens,
    peak_process_count,
    observed_wall_clock_ms,
    // M10: Phase E V1 cannot prove provenance on
    // ResourceObservation; report unavailable rather than
    // inventing a category.
    token_source: unavailable("UNSUPPORTED_BY_CONTRACT"),
  };
}
