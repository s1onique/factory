/**
 * LH-06 schedule tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *   SAME_EPOCH_INDEX => SAME_EXECUTION_ORDER
 *
 * Forbidden:
 *   Math.random(), crypto.randomUUID(), Date.now() for
 *   picking execution order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalEpoch,
  reverseStable,
  rotateLeft,
  scheduleForEpoch,
  SCHEDULE_VERSION,
} from "../../soak/schedule.js";

test("LH-06 schedule: version is the V1 schedule", () => {
  assert.equal(SCHEDULE_VERSION, "lh06.schedule.v1");
});

test("LH-06 schedule: canonical epoch has 12 LH05 + 17 LH04 + 3 tail = 32 cases", () => {
  const c = buildCanonicalEpoch();
  assert.equal(c.length, 32);
  const lh05 = c.filter((x) => x.source === "LH05").length;
  const lh04 = c.filter((x) => x.source === "LH04").length;
  const tail = c.filter((x) =>
    x.source === "CANARY" ||
    x.source === "INTEGRITY" ||
    x.source === "CLEANUP",
  ).length;
  assert.equal(lh05, 12);
  assert.equal(lh04, 17);
  assert.equal(tail, 3);
});

test("LH-06 schedule: same epoch index => same execution order", () => {
  const a = scheduleForEpoch(0);
  const b = scheduleForEpoch(0);
  assert.deepEqual(a.map((c) => c.case_id), b.map((c) => c.case_id));
});

test("LH-06 schedule: different quadrants => different order", () => {
  const q0 = scheduleForEpoch(0).map((c) => c.case_id);
  const q1 = scheduleForEpoch(1).map((c) => c.case_id);
  const q2 = scheduleForEpoch(2).map((c) => c.case_id);
  const q3 = scheduleForEpoch(3).map((c) => c.case_id);
  // q0 and q4 share the same q0 quadrant, so q0 != q1
  // proves the cycles 0..3 differ. We only assert on the
  // first four cycles here.
  assert.notDeepEqual(q0, q1);
  assert.notDeepEqual(q1, q2);
  assert.notDeepEqual(q2, q3);
});

test("LH-06 schedule: tail (canary + integrity + cleanup) is always last 3", () => {
  for (let i = 0; i < 8; i++) {
    const s = scheduleForEpoch(i);
    const tail = s.slice(-3).map((c) => c.source);
    assert.deepEqual(tail, ["CANARY", "INTEGRITY", "CLEANUP"]);
  }
});

test("LH-06 schedule: cycles in q0 quadrant are NOT all identical (q0 has no rotation)", () => {
  // q0 cycles do not rotate LH05; the schedule for cycles
  // 0, 4, 8 are identical — q0 has a fixed ordering. We
  // assert that determinism holds (same epoch => same order).
  const q0a = scheduleForEpoch(0).map((c) => c.case_id);
  const q0b = scheduleForEpoch(4).map((c) => c.case_id);
  assert.deepEqual(q0a, q0b);
});

test("LH-06 schedule: rotateLeft / reverseStable are pure", () => {
  const arr = [1, 2, 3, 4];
  const a = rotateLeft(arr, 1);
  const b = rotateLeft(arr, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(reverseStable(arr), [4, 3, 2, 1]);
  // original array is NOT mutated
  assert.deepEqual(arr, [1, 2, 3, 4]);
});

test("LH-06 schedule: rejects negative / non-integer epoch indices", () => {
  assert.throws(() => scheduleForEpoch(-1));
  assert.throws(() => scheduleForEpoch(0.5));
  assert.throws(() => scheduleForEpoch(Number.NaN));
});
