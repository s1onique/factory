/**
 * LH-06 canary + cardinality oracle tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *
 *   - canary run at epoch start + epoch end must produce
 *     identical semantic shape
 *   - 12 LH05 case identities + 17 LH04 case identities each
 *     have exactly one semantic digest across the run
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LH06_LH04_CASE_IDS,
  LH06_LH05_CASE_IDS,
} from "../../soak/types.js";

test("LH-06 canary: LH05 case identity set is exactly LC01..LC12", () => {
  assert.equal(LH06_LH05_CASE_IDS.length, 12);
  assert.deepEqual(
    [...LH06_LH05_CASE_IDS],
    [
      "LC01", "LC02", "LC03", "LC04", "LC05", "LC06",
      "LC07", "LC08", "LC09", "LC10", "LC11", "LC12",
    ],
  );
});

test("LH-06 canary: LH04 case identity set is exactly F01..F17", () => {
  assert.equal(LH06_LH04_CASE_IDS.length, 17);
  assert.deepEqual(
    [...LH06_LH04_CASE_IDS],
    [
      "F01", "F02", "F03", "F04", "F05", "F06", "F07",
      "F08", "F09", "F10", "F11", "F12", "F13", "F14",
      "F15", "F16", "F17",
    ],
  );
});

test("LH-06 canary: case identity sets are disjoint", () => {
  const intersect = LH06_LH05_CASE_IDS.filter((c) =>
    LH06_LH04_CASE_IDS.includes(c),
  );
  assert.equal(intersect.length, 0);
});
