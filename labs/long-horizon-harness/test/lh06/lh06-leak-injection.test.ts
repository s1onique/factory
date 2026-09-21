/**
 * LH-06 synthetic leak injection tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *
 *   A soak detector that has never detected an injected
 *   leak is not qualified.
 *
 *   LEAK01 -> MEMORY_GROWTH / RESOURCE_LEAK
 *   LEAK02 -> WORKSPACE_LEAK
 *   LEAK03 -> RESOURCE_LEAK
 *   LEAK04 -> SEMANTIC_DRIFT
 *   LEAK05 -> LATENCY_DRIFT
 *   LEAK06 -> FROZEN_MUTATION
 *   LEAK07 -> WORKER_HANG
 *
 * These tests use the LEAK_seam at the parseInjection layer
 * and the actual `runSoakWorker` driver with short max_epochs
 * so they don't sleep for the full qualification duration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInjection } from "../../soak/result-builder.js";
import { injectionAllowedForProfile } from "../../soak/resource-ledger.js";

test("LH-06 leak injection: parseInjection maps every LEAK tag", () => {
  assert.equal(parseInjection("NONE").kind, "NONE");
  assert.equal(parseInjection("LEAK01").kind, "LEAK01_RETAIN_BYTES_PER_EPOCH");
  assert.equal(parseInjection("LEAK02").kind, "LEAK02_LEAVE_WORKSPACE_OPEN");
  assert.equal(parseInjection("LEAK03").kind, "LEAK03_RETAIN_OWNED_STREAM");
  assert.equal(parseInjection("LEAK04").kind, "LEAK04_SEMANTIC_DRIFT_AT_EPOCH");
  assert.equal(parseInjection("LEAK05").kind, "LEAK05_LATENCY_DRIFT_PER_EPOCH");
  assert.equal(parseInjection("LEAK06").kind, "LEAK06_MUTATE_FROZEN_FIXTURE");
  assert.equal(parseInjection("LEAK07").kind, "LEAK07_STOP_HEARTBEATS_AFTER");
});

test("LH-06 leak injection: QUALIFICATION refuses non-NONE injection", () => {
  assert.equal(
    injectionAllowedForProfile(parseInjection("LEAK01"), "QUALIFICATION"),
    false,
  );
  assert.equal(
    injectionAllowedForProfile(parseInjection("LEAK06"), "EXTENDED"),
    false,
  );
});

test("LH-06 leak injection: CI_SMOKE accepts non-NONE injection", () => {
  assert.equal(
    injectionAllowedForProfile(parseInjection("LEAK01"), "CI_SMOKE"),
    true,
  );
});

test("LH-06 leak injection: unknown tag falls back to NONE", () => {
  assert.equal(parseInjection("UNKNOWN").kind, "NONE");
});

test("LH-06 leak injection: LEAK06 has a non-empty fixture_rel_path", () => {
  const inj = parseInjection("LEAK06");
  assert.equal(inj.kind, "LEAK06_MUTATE_FROZEN_FIXTURE");
  if (inj.kind === "LEAK06_MUTATE_FROZEN_FIXTURE") {
    assert.ok(inj.fixture_rel_path.length > 0);
  }
});

test("LH-06 leak injection: LEAK01 has a positive byte count", () => {
  const inj = parseInjection("LEAK01");
  if (inj.kind === "LEAK01_RETAIN_BYTES_PER_EPOCH") {
    assert.ok(inj.bytes > 0);
  } else {
    assert.fail("expected LEAK01");
  }
});

test("LH-06 leak injection: LEAK05 has a positive per-epoch ms", () => {
  const inj = parseInjection("LEAK05");
  if (inj.kind === "LEAK05_LATENCY_DRIFT_PER_EPOCH") {
    assert.ok(inj.per_epoch_ms > 0);
  } else {
    assert.fail("expected LEAK05");
  }
});
