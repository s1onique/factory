/**
 * Clock / timer port implementations.
 *
 * Two clocks are exposed:
 *   - `nowMs`: wall-clock millisecond timestamp. Observation only;
 *     not used for deadline correctness.
 *   - `nowMonotonicMs`: monotonic millisecond timestamp (perf_hooks).
 *     Used for deadline arithmetic.
 *
 * The same `Clock` type is shared by production and tests so a
 * fake/manual clock can be injected for pure sequencing tests
 * without touching `Date.now()` or real timers.
 */

import { setTimeout as timersTimeout } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import type { Clock } from "./process-ports.js";

export function realClock(): Clock {
  return {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
    sleep: async (ms, signal) => {
      if (signal === undefined) {
        await timersTimeout(ms);
        return { kind: "completed" };
      }
      // AbortSignal-aware sleep: race setTimeout against the signal.
      let aborted = false;
      const onAbort = (): void => {
        aborted = true;
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal.aborted) {
          return { kind: "aborted" };
        }
        await timersTimeout(ms);
        if (aborted) {
          return { kind: "aborted" };
        }
        return { kind: "completed" };
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

/**
 * Manual fake clock. Test code calls `advance(ms)` to move time
 * forward deterministically. `sleep()` resolves immediately when
 * the requested delay has been advanced past; it never waits for
 * real time.
 *
 * NOTE: this fake is suitable for tests that only need to verify
 * pure sequencing and ordering. Tests that exercise real
 * OS-level deadlines MUST use `realClock()`.
 */
export function manualClock(): Clock & {
  readonly advance: (ms: number) => void;
  readonly setMonotonic: (ms: number) => void;
  readonly current: () => number;
} {
  let monotonicMs = 0;
  let wallMs = 0;
  return {
    nowMs: () => wallMs,
    nowMonotonicMs: () => monotonicMs,
    sleep: async (ms, signal) => {
      if (signal !== undefined && signal.aborted) {
        return { kind: "aborted" };
      }
      monotonicMs += ms;
      wallMs += ms;
      return { kind: "completed" };
    },
    advance: (ms: number) => {
      monotonicMs += ms;
      wallMs += ms;
    },
    setMonotonic: (ms: number) => {
      monotonicMs = ms;
    },
    current: () => monotonicMs,
  };
}
