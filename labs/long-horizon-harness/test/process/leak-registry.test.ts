/**
 * leak-registry.test.ts
 *
 *   L01 fixture group registry empty after real suite (skip if
 *       harness blocks signal delivery).
 *
 * The registry is checked at suite end via an afterAll on the
 * process test file. This test exists to ensure the helper
 * functions are exercised in CI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HARNESS_CAN_SIGNAL,
  liveFixtureRegistrySize,
  registerLiveFixturePgid,
  unregisterLiveFixturePgid,
  emergencyKillAllRegisteredPgids,
} from "./helpers.js";

test("L01 registry helpers behave correctly", async (t) => {
  if (!HARNESS_CAN_SIGNAL) {
    t.skip("harness denies process.kill(2); cannot supervise real OS processes in this environment");
    return;
  }
  const initial = liveFixtureRegistrySize();
  registerLiveFixturePgid(99001);
  registerLiveFixturePgid(99002);
  assert.equal(liveFixtureRegistrySize(), initial + 2);
  unregisterLiveFixturePgid(99001);
  unregisterLiveFixturePgid(99002);
  assert.equal(liveFixtureRegistrySize(), initial);
  // emergency helper does not throw even when registry is empty
  emergencyKillAllRegisteredPgids();
  assert.equal(liveFixtureRegistrySize(), initial);
});
