/**
 * clock.test.ts
 *
 * Proves realClock.sleep honors AbortSignal.
 *
 *   CLK01 sleep(5000, AbortSignal) -> abort immediately -> returns aborted
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { realClock } from "../../src/process/clock.js";

test("CLK01 real timer sleep is cancellable by AbortSignal", async () => {
  const clock = realClock();
  const ctrl = new AbortController();
  const t0 = Date.now();
  const p = clock.sleep(5000, ctrl.signal);
  // Abort after a tiny moment so the underlying timer is cancelled
  // before its 5s deadline.
  setTimeout(() => ctrl.abort(), 20);
  const r = await p;
  const elapsed = Date.now() - t0;
  assert.equal(r.kind, "aborted");
  assert.ok(elapsed < 1000, `expected abort within 1s; got ${elapsed}ms`);
});

test("CLK02 real timer sleep completes when not aborted", async () => {
  const clock = realClock();
  const r = await clock.sleep(50);
  assert.equal(r.kind, "completed");
});
