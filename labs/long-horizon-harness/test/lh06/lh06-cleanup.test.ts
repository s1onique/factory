/**
 * LH-06 cleanup tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *   ACTIVE_WORKSPACES_AFTER_EPOCH = 0
 *   state_reset_digest == EMPTY_STATE_DIGEST
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  EMPTY_STATE_DIGEST,
  allocateEpochWorkspace,
  closeEpochWorkspace,
  stateResetDigest,
  verifyStateReset,
  LH06_WORKSPACE_ROOT_BASE,
} from "../../soak/cleanup.js";
import { ResourceLedger } from "../../soak/resource-ledger.js";

test("LH-06 cleanup: workspace root base is factory-lh06", () => {
  assert.equal(LH06_WORKSPACE_ROOT_BASE, "factory-lh06");
});

test("LH-06 cleanup: allocateEpochWorkspace creates a real directory", () => {
  const ws = allocateEpochWorkspace({ runId: "test-run", epochIndex: 0 });
  assert.equal(existsSync(ws.path), true);
  assert.equal(ws.runId, "test-run");
  assert.equal(ws.epochIndex, 0);
  closeEpochWorkspace(ws);
  assert.equal(existsSync(ws.path), false);
});

test("LH-06 cleanup: stateResetDigest matches EMPTY_STATE_DIGEST for fresh ledger", () => {
  const l = new ResourceLedger();
  assert.equal(stateResetDigest(l), EMPTY_STATE_DIGEST);
  const v = verifyStateReset(l);
  assert.equal(v.is_reset, true);
});

test("LH-06 cleanup: stateResetDigest detects retained state", () => {
  const l = new ResourceLedger();
  l.acquireWorkspace("w", "/tmp/x");
  const v = verifyStateReset(l);
  assert.equal(v.is_reset, false);
  assert.notEqual(v.actual, EMPTY_STATE_DIGEST);
  l.releaseWorkspace("w");
  assert.equal(verifyStateReset(l).is_reset, true);
});

test("LH-06 cleanup: injection counters are part of the state-reset oracle", () => {
  const l = new ResourceLedger();
  l.trackInjectionRetainedBytes(1024);
  // State-reset oracle includes injection counters.
  const v = verifyStateReset(l);
  assert.equal(v.is_reset, false);
  // Production balance (separate from injection) is still zero.
  assert.equal(l.productionBalance().is_zero, true);
});
