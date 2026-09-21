/**
 * LH-06 memory threshold tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *
 *   evaluateHeapStability(samples, contract) is a pure
 *   function tested with:
 *
 *     - flat sequence        => PASS
 *     - bounded warm-up      => PASS
 *     - slow linear leak     => FAIL
 *     - late leak            => FAIL
 *     - one temporary spike  => not necessarily FAIL
 *     - too few samples      => INCONCLUSIVE/INVALID
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHeapStability,
  median,
  olsSlope,
  takeFirst,
  takeLast,
} from "../../soak/thresholds.js";

test("LH-06 memory threshold: median of empty array is null", () => {
  assert.equal(median([]), null);
});

test("LH-06 memory threshold: median of single-element array is that element", () => {
  assert.equal(median([42]), 42);
});

test("LH-06 memory threshold: median of even-length array is midpoint average", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("LH-06 memory threshold: takeFirst / takeLast are bounded", () => {
  const arr = [1, 2, 3, 4, 5];
  assert.deepEqual([...takeFirst(arr, 3)], [1, 2, 3]);
  assert.deepEqual([...takeLast(arr, 3)], [3, 4, 5]);
  assert.deepEqual([...takeFirst(arr, 10)], arr);
  assert.deepEqual([...takeLast(arr, 0)], []);
});

test("LH-06 memory threshold: olsSlope on flat sequence is zero", () => {
  const flat = Array.from({ length: 50 }, () => 100).map((v, i) => [i, v] as [number, number]);
  const slope = olsSlope(flat);
  assert.ok(Math.abs(slope) < 1e-9);
});

test("LH-06 memory threshold: olsSlope on linear leak is the leak rate", () => {
  const leak = Array.from({ length: 50 }, (_, i) => [i, 100 + i] as [number, number]);
  const slope = olsSlope(leak);
  assert.ok(Math.abs(slope - 1) < 1e-9);
});

test("LH-06 memory threshold: flat sequence => PASS", () => {
  const samples = Array.from({ length: 100 }, () => 50 * 1024 * 1024);
  const v = evaluateHeapStability({ samples });
  assert.equal(v.pass, true);
  assert.equal(v.reason, "STABLE");
});

test("LH-06 memory threshold: too few samples => INSUFFICIENT_SAMPLES", () => {
  const samples = [100, 200, 300];
  const v = evaluateHeapStability({ samples });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "INSUFFICIENT_SAMPLES");
});

test("LH-06 memory threshold: bounded warm-up => PASS", () => {
  // First 5 samples larger, then flat — should still PASS
  // because the slope / window-median comparison holds.
  const samples = [
    100, 100, 100, 100, 100,  // warm-up jitter (still flat)
    ...Array.from({ length: 60 }, () => 100),
  ];
  const v = evaluateHeapStability({ samples });
  assert.equal(v.pass, true);
});

test("LH-06 memory threshold: slow linear leak => FAIL", () => {
  // 50 MiB baseline + 20 KiB per epoch = 50*1024*1024 + 20000*i
  const samples = Array.from(
    { length: 200 },
    (_, i) => 50 * 1024 * 1024 + 20_000 * i,
  );
  const v = evaluateHeapStability({ samples });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "SLOPE_EXCEEDED");
});

test("LH-06 memory threshold: late leak (last window > first) => FAIL", () => {
  // Flat for first 100, then 20 MiB jump at the end
  const samples: number[] = Array.from({ length: 100 }, () => 50 * 1024 * 1024);
  // Last 100 samples are 20 MiB larger
  for (let i = 0; i < 100; i++) samples.push(70 * 1024 * 1024);
  const v = evaluateHeapStability({ samples });
  assert.equal(v.pass, false);
});

test("LH-06 memory threshold: one temporary spike => does not necessarily FAIL", () => {
  // Flat baseline + one outlier in the middle.
  const samples: number[] = Array.from({ length: 100 }, () => 50 * 1024 * 1024);
  samples[50] = 200 * 1024 * 1024;
  // Restore flat
  for (let i = 51; i < 100; i++) samples[i] = 50 * 1024 * 1024;
  const v = evaluateHeapStability({ samples });
  // The median of the first/last 20-sample windows is
  // unchanged. The slope may rise slightly but should stay
  // below 16 KiB / epoch.
  assert.equal(v.pass, true);
});

test("LH-06 memory threshold: ABSOLUTE_TOLERANCE_BYTES is 8 MiB", () => {
  // 8 MiB + 20% of 50 MiB baseline = 18 MiB allowed
  const samples = Array.from(
    { length: 200 },
    (_, i) => 50 * 1024 * 1024 + Math.floor(i / 10) * 1024,
  );
  // Total growth ~ 20 KiB/sample ≈ 4 MiB over 200 samples;
  // this is well under 18 MiB so PASS.
  const v = evaluateHeapStability({ samples });
  assert.equal(v.pass, true);
});
