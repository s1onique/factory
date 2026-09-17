/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Resource metric tests (M9, M10, M11, M12).
 *
 *   METRIC12: no-resource run -> every resource field
 *             unavailable (NOT_OBSERVED).
 *   METRIC13: explicit-zero tool calls run ->
 *             available(0), not unavailable.
 *   METRIC09: timeout run with wall_clock_ms observation.
 *   METRIC08: budget-exhausted run with tokens observation.
 *   M10: token_source is unavailable in V1
 *        (UNSUPPORTED_BY_CONTRACT).
 *   M12: MEASURED_CONSUMPTION is reported separately from
 *        pricing (no PricingReport produced by V1).
 *
 * CORRECTION01 M-C01: tests no longer pre-construct a
 * projection; the metric projector derives it internally.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isUnavailableWith } from "../../src/metrics/index.js";
import {
  computeRunMetricsFor,
  makeSuccessRunMinimal,
  makeZeroToolCallsRun,
  makeTimeoutRun,
  makeBudgetExhaustedRun,
} from "./_metric_helpers.js";

test("METRIC12: no-resource run -> every resource field unavailable (NOT_OBSERVED)", () => {
  // makeSuccessRunMinimal emits no RUN_TIMEOUT, so no
  // resource observation is recorded. ALL resource
  // slots are `unavailable(NOT_OBSERVED)`.
  const r = makeSuccessRunMinimal({ seed: "lh02-no-resource-obs" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const res = m.report.resources;
  assert.equal(isUnavailableWith(res.tool_calls_total, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.total_tokens, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.input_tokens, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.output_tokens, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.peak_process_count, "NOT_OBSERVED"), true);
  assert.equal(isUnavailableWith(res.observed_wall_clock_ms, "NOT_OBSERVED"), true);
});

test("METRIC13: explicit zero tool calls -> available(0), NOT unavailable", () => {
  const r = makeZeroToolCallsRun({ seed: "lh02-zero-tool-calls" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  const res = m.report.resources;
  assert.equal(res.tool_calls_total.available, true);
  if (!res.tool_calls_total.available) throw new Error("ok");
  assert.equal(res.tool_calls_total.value, 0);
});

test("METRIC09: TIMEOUT with wall_clock_ms -> observed_wall_clock_ms available", () => {
  const r = makeTimeoutRun({ seed: "lh02-wc", observedWallClockMs: 4242 });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.resources.observed_wall_clock_ms.available, true);
  if (!m.report.resources.observed_wall_clock_ms.available) throw new Error("ok");
  assert.equal(m.report.resources.observed_wall_clock_ms.value, 4242);
  assert.equal(
    isUnavailableWith(m.report.resources.tool_calls_total, "NOT_OBSERVED"),
    true,
  );
  assert.equal(
    isUnavailableWith(m.report.resources.total_tokens, "NOT_OBSERVED"),
    true,
  );
});

test("METRIC08: BUDGET_EXHAUSTED with tokens -> total_tokens available", () => {
  const r = makeBudgetExhaustedRun({ seed: "lh02-budget", tokens: 555 });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.resources.total_tokens.available, true);
  if (!m.report.resources.total_tokens.available) throw new Error("ok");
  assert.equal(m.report.resources.total_tokens.value, 555);
});

test("METRIC10: token-source provenance unavailable in V1 (UNSUPPORTED_BY_CONTRACT)", () => {
  const r = makeBudgetExhaustedRun({ seed: "lh02-token-source" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(
    isUnavailableWith(
      m.report.resources.token_source,
      "UNSUPPORTED_BY_CONTRACT",
    ),
    true,
  );
});

test("METRIC11 (negative oracle): no resource observation -> input/output tokens unavailable", () => {
  const r = makeBudgetExhaustedRun({ seed: "lh02-input-output" });
  const m = computeRunMetricsFor(r);
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error("ok");
  assert.equal(m.report.resources.input_tokens.available, false);
  assert.equal(m.report.resources.output_tokens.available, false);
});
