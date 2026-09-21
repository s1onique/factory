/**
 * LH-06 telemetry boundedness tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *
 *   IN_MEMORY_TELEMETRY_CARDINALITY = BOUNDED
 *
 *   - Pushing more than `capacity` lines evicts the oldest
 *     (FIFO ring buffer).
 *   - `size()` never exceeds capacity.
 *   - `snapshot()` is in chronological order.
 *   - `lastK(k)` returns the most recent k lines.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BoundedTelemetryBuffer,
  cadenceHit,
} from "../../soak/telemetry.js";
import { LH06_IN_MEMORY_TELEMETRY_CAP } from "../../soak/contract.js";

test("LH-06 telemetry: buffer capacity equals the contract constant", () => {
  const buf = new BoundedTelemetryBuffer();
  assert.equal(buf.capacity(), LH06_IN_MEMORY_TELEMETRY_CAP);
});

test("LH-06 telemetry: pushing more than capacity evicts oldest", () => {
  const buf = new BoundedTelemetryBuffer(5);
  for (let i = 0; i < 10; i++) {
    buf.push({
      kind: "EPOCH",
      ts_ms: i,
      payload: { i },
    });
  }
  assert.equal(buf.size(), 5);
  const snap = buf.snapshot();
  // The snapshot must be in chronological order: the oldest
  // is the 5th push, the newest is the 10th push.
  assert.equal(snap[0]?.ts_ms, 5);
  assert.equal(snap[4]?.ts_ms, 9);
});

test("LH-06 telemetry: snapshot returns chronological order", () => {
  const buf = new BoundedTelemetryBuffer(10);
  for (let i = 0; i < 5; i++) {
    buf.push({
      kind: "EPOCH",
      ts_ms: 100 + i,
      payload: { i },
    });
  }
  const snap = buf.snapshot();
  for (let i = 0; i < snap.length; i++) {
    assert.equal(snap[i]?.ts_ms, 100 + i);
  }
});

test("LH-06 telemetry: lastK returns the most recent K lines", () => {
  const buf = new BoundedTelemetryBuffer(10);
  for (let i = 0; i < 10; i++) {
    buf.push({
      kind: "EPOCH",
      ts_ms: i,
      payload: { i },
    });
  }
  const last3 = buf.lastK(3);
  assert.equal(last3.length, 3);
  assert.equal(last3[0]?.ts_ms, 7);
  assert.equal(last3[2]?.ts_ms, 9);
});

test("LH-06 telemetry: capacity must be positive", () => {
  assert.throws(() => new BoundedTelemetryBuffer(0));
  assert.throws(() => new BoundedTelemetryBuffer(-1));
});

test("LH-06 telemetry: cadenceHit returns true at exact cadence", () => {
  assert.equal(cadenceHit({ epoch_index: 5, cadence_n: 5 }), true);
  assert.equal(cadenceHit({ epoch_index: 10, cadence_n: 5 }), true);
  assert.equal(cadenceHit({ epoch_index: 7, cadence_n: 5 }), false);
  assert.equal(cadenceHit({ epoch_index: 0, cadence_n: 5 }), false);
  assert.equal(cadenceHit({ epoch_index: 5, cadence_n: 0 }), false);
});
