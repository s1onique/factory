/**
 * Reconciler read-only safety test (FOUNDATION03 §27).
 *
 * TypeScript enforces that `SignalPort` is NOT assignable to
 * `RecoveryProbe`. This file documents that fact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SignalPort } from "../../src/process/process-ports.js";
import type { RecoveryProbe } from "../../src/recovery/recovery-ports.js";

// Compile-time assignment check. If SignalPort becomes
// assignable to RecoveryProbe, the @ts-expect-error below
// breaks the build. We rely on the structural mismatch:
// SignalPort has `signalGroup`, RecoveryProbe has only
// `probeHistoricalGroup`.

// @ts-expect-error - SignalPort MUST NOT be assignable to RecoveryProbe.
const _fail: RecoveryProbe = (null as unknown) as SignalPort;
void _fail;

test("SignalPort cannot be assigned to RecoveryProbe", () => {
  // Runtime anchor: the actual invariant is enforced at
  // compile time by the structural mismatch.
  assert.ok(true);
});

/* placeholder */
