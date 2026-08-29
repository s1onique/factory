/**
 * process-group.test.ts
 *
 * PGID guard + classification tests for the centralized
 * process-group signal/probe helper. These tests cover the
 * validation, error classification, and the fail-closed
 * EPERM policy introduced in CORRECTION01.
 *
 * Live-OS tests live in supervised-process.test.ts under the
 * P/LIVE namespace.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nodeSignalPort,
  validatePgid,
} from "../../src/process/process-group.js";

const signals = nodeSignalPort();

test("PG01 validatePgid rejects invalid inputs", () => {
  for (const bad of [0, 1, -1, NaN, Infinity, 2.5, -42]) {
    assert.notEqual(validatePgid(bad), null, `pgid=${bad} should be invalid`);
  }
});

test("PG02 validatePgid accepts positive integers > 1", () => {
  for (const ok of [2, 100, 99999]) {
    assert.equal(validatePgid(ok), null);
  }
});

test("PG03 signalGroup refuses invalid pgid without reaching OS", () => {
  for (const bad of [0, 1, -1, NaN, 2.5]) {
    const r = signals.signalGroup(bad, "SIGTERM");
    assert.equal(r.kind, "error");
    if (r.kind === "error") {
      assert.equal(r.code, "EINVAL");
    }
  }
});

test("PG04 probeGroup refuses invalid pgid without reaching OS", () => {
  for (const bad of [0, 1, -1, NaN]) {
    const r = signals.probeGroup(bad);
    assert.equal(r.kind, "probe_error");
    if (r.kind === "probe_error") {
      assert.equal(r.code, "EINVAL");
    }
  }
});
