/**
 * process-group.test.ts
 *
 * Exercises the centralized process-group signal + probe helper.
 * This test uses REAL OS signals against a long-lived fixture so
 * the production code path is exercised, not a fake port.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import {
  nodeSignalPort,
  validatePgid,
  signalGroupOrChild,
} from "../../src/process/process-group.js";
import {
  FIXTURE_JS,
  NODE_RUNTIME,
  FAST_BUDGET,
  makeEnv,
  catastrophicWatchdog,
  requireSignalCapability,
} from "./helpers.js";

const signals = nodeSignalPort();

test("PG01 validatePgid rejects invalid inputs", () => {
  assert.notEqual(validatePgid(0), null);
  assert.notEqual(validatePgid(1), null);
  assert.notEqual(validatePgid(-1), null);
  assert.notEqual(validatePgid(NaN), null);
  assert.notEqual(validatePgid(Infinity), null);
  assert.notEqual(validatePgid(2.5), null);
  assert.equal(validatePgid(12345), null);
});

test("PG02 signalGroup refuses invalid pgid without reaching the OS", () => {
  for (const bad of [0, 1, -1, NaN, 2.5]) {
    const r = signals.signalGroup(bad, "SIGTERM");
    assert.equal(r.kind, "error");
    if (r.kind === "error") {
      assert.equal(r.code, "EINVAL");
    }
  }
});

test("PG03 probeGroup refuses invalid pgid without reaching the OS", () => {
  for (const bad of [0, 1, -1, NaN]) {
    const r = signals.probeGroup(bad);
    assert.equal(r.kind, "probe_error");
    if (r.kind === "probe_error") {
      assert.equal(r.code, "EINVAL");
    }
  }
});

test("PG04 signalGroup against a live detached fixture returns sent", async (t) => {
  if (!requireSignalCapability(t)) return;
  const wd = catastrophicWatchdog(FAST_BUDGET.outerWatchdogMs, () => {});
  const child = spawn(NODE_RUNTIME, [FIXTURE_JS, "sleep", "--ms", "5000"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...makeEnv() },
  });
  try {
    // Give the kernel a moment to register the child.
    await new Promise((r) => setTimeout(r, 50));
    const pgid = child.pid ?? null;
    assert.notEqual(pgid, null);
    if (pgid === null) return;

    // On macOS, kill(-pgid, 0) from outside the group returns
    // EPERM; on Linux it returns 0 (alive). Both classify the
    // group as observable. signalGroup with SIGTERM uses the
    // SAME negative-pgid convention; the kernel performs the
    // authorisation check against the target group. The
    // supervisor owns the immediate child and falls back to the
    // child PID when EPERM occurs.
    const term = signalGroupOrChild(pgid, pgid, "SIGTERM");
    assert.equal(term.kind, "sent", `expected sent; got ${JSON.stringify(term)}`);

    // Wait briefly for the group to disappear.
    let absent = false;
    for (let i = 0; i < 30 && !absent; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const p = signals.probeGroup(pgid);
      absent = p.kind === "absent";
    }
    assert.equal(absent, true, "group should have disappeared after SIGTERM");
  } finally {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    wd.cancel();
  }
});
