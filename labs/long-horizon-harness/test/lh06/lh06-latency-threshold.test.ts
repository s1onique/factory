/**
 * LH-06 latency threshold tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *
 *   evaluateLatencyStability(samples, contract) is a pure
 *   function tested with:
 *
 *     - flat                  PASS
 *     - minor noise           PASS
 *     - 50% boundary          precise documented behavior
 *     - slow degradation      FAIL
 *     - single outlier        should not dominate median
 *     - missing samples       invalid/inconclusive
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLatencyStability } from "../../soak/thresholds.js";

test("LH-06 latency threshold: flat sequence => PASS", () => {
  const samples = Array.from({ length: 100 }, () => 100);
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, true);
  assert.equal(v.reason, "STABLE");
});

test("LH-06 latency threshold: minor noise => PASS", () => {
  const samples = Array.from(
    { length: 100 },
    (_, i) => 100 + (i % 5) - 2,
  );
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, true);
});

test("LH-06 latency threshold: 50% growth is at the boundary", () => {
  // First 50 at 100ms, last 50 at 149ms (1.49x growth).
  // ratio_max = 1.50, so this is just inside the threshold.
  const samples: number[] = [
    ...Array.from({ length: 50 }, () => 100),
    ...Array.from({ length: 50 }, () => 149),
  ];
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, true);
});

test("LH-06 latency threshold: slow degradation => FAIL", () => {
  // Start at 100ms, grow to 600ms (6x growth) — well past
  // both the 1.5x ratio and the +250ms absolute tolerance.
  const samples = Array.from(
    { length: 200 },
    (_, i) => 100 + Math.floor((i / 199) * 500),
  );
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, false);
});

test("LH-06 latency threshold: single outlier does not dominate median", () => {
  // Flat 100ms + one huge outlier in the middle.
  const samples = Array.from({ length: 100 }, () => 100);
  samples[50] = 10_000;
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, true);
});

test("LH-06 latency threshold: too few samples => INSUFFICIENT_SAMPLES", () => {
  const samples = [1, 2, 3];
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "INSUFFICIENT_SAMPLES");
});

test("LH-06 latency threshold: invalid sample (NaN) => INVALID_SAMPLE", () => {
  const samples = Array.from({ length: 100 }, () => 100);
  samples[10] = Number.NaN;
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "INVALID_SAMPLE");
});

test("LH-06 latency threshold: negative sample => INVALID_SAMPLE", () => {
  const samples = Array.from({ length: 100 }, () => 100);
  samples[10] = -1;
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "INVALID_SAMPLE");
});

test("LH-06 latency threshold: zero baseline + flat zero => STABLE", () => {
  // Degenerate zero baseline (everything finished in 0ms).
  const samples = Array.from({ length: 100 }, () => 0);
  const v = evaluateLatencyStability({ samples });
  assert.equal(v.pass, true);
});
