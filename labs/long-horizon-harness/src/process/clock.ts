/**
 * Clock / timer port implementations.
 *
 * Two clocks:
 *   - nowMs: wall-clock millisecond timestamp. Observation only.
 *   - nowMonotonicMs: monotonic millisecond (perf_hooks). Used for
 *     deadline arithmetic.
 *
 * sleep() honors AbortSignal by passing the signal to Node's
 * timersPromises.setTimeout — the underlying timer is cancelled
 * when the signal aborts, so the sleep returns promptly.
 */

import { setTimeout as timersTimeout } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import type { Clock } from "./process-types.js";

export function realClock(): Clock {
  return {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
    sleep: async (ms, signal) => {
      if (signal !== undefined) {
        if (signal.aborted) {
          return { kind: "aborted" };
        }
        try {
          await timersTimeout(ms, undefined, { signal });
          return { kind: "completed" };
        } catch (e: unknown) {
          // timersPromises throws an AbortError (DOMException with
          // name === "AbortError", code "ABORT_ERR") when the
          // signal aborts. Treat any thrown abort as aborted.
          if (isAbortError(e)) {
            return { kind: "aborted" };
          }
          throw e;
        }
      }
      await timersTimeout(ms);
      return { kind: "completed" };
    },
  };
}

function isAbortError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as { name?: unknown; code?: unknown };
  return obj.name === "AbortError" || obj.code === "ABORT_ERR";
}

/**
 * Manual fake clock. Pure-sequencing tests only.
 * Honors AbortSignal by immediately returning "aborted" without
 * sleeping when the signal is aborted. This is acceptable for
 * sequencing tests because no real time elapses anyway.
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
