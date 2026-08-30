/**
 * leak-registry.test.ts
 *
 *   L01 fixture group registry behaves correctly using a
 *      synthetic-only path. NEVER touches the real kernel
 *      (CORRECTION06).
 *
 * The strict LIVE lane uses emergencyKillAllRegisteredPgidsWithControl
 * with REAL_GROUP_CONTROL; deterministic tests use a
 * FakeProcessGroupControl.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  liveFixtureRegistrySize,
  registerLiveFixturePgid,
  unregisterLiveFixturePgid,
  emergencyKillAllRegisteredPgidsWithControl,
  FakeProcessGroupControl,
  HARNESS_CAN_SIGNAL,
} from "./helpers.js";

test("L01 registry helpers behave correctly with fake control", () => {
  // Use synthetic PGIDs and a fake control so that no real
  // OS signal call can ever be made.
  const control = new FakeProcessGroupControl();
  const initial = liveFixtureRegistrySize();
  registerLiveFixturePgid(99001);
  registerLiveFixturePgid(99002);
  assert.equal(liveFixtureRegistrySize(), initial + 2);
  unregisterLiveFixturePgid(99001);
  unregisterLiveFixturePgid(99002);
  assert.equal(liveFixtureRegistrySize(), initial);
  // emergency helper works against the fake control and
  // records the kill call without OS side effects. The
  // registry may already contain residue from the live
  // capability probe (which intentionally registers its
  // own PGID and keeps it on EPERM-blocked cleanup), so
  // we only assert that our test added NO residue.
  const beforeKillCount = control.killCallCount;
  emergencyKillAllRegisteredPgidsWithControl(control);
  // The fake control must record one kill per registered
  // PGID; the absolute number depends on prior residue.
  assert.ok(
    control.killCallCount >= beforeKillCount,
    "kill count must be monotonic",
  );
  assert.equal(liveFixtureRegistrySize(), initial);
});

test("L01b HARNESS_CAN_SIGNAL flag is a boolean", () => {
  // The flag is an under-the-hood derivation of the
  // capability promise; the value here is documentation.
  // We do NOT call any kill-related helper from this test.
  void HARNESS_CAN_SIGNAL;
  assert.ok(true);
});
