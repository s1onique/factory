/**
 * LH-06 deterministic long-duration soak laboratory —
 * pure threshold functions.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * The threshold logic is intentionally split out as pure
 * functions so it can be unit-tested without spinning up the
 * worker. The worker loops call these; tests assert on their
 * output.
 */
import {
  LH06_HEAP_ABSOLUTE_TOLERANCE_BYTES,
  LH06_HEAP_RELATIVE_TOLERANCE_FRACTION,
  LH06_HEAP_SLOPE_MAX_BYTES_PER_EPOCH,
  LH06_HEAP_WINDOW_SIZE,
  LH06_LATENCY_ABSOLUTE_TOLERANCE_MS,
  LH06_LATENCY_RATIO_MAX,
} from "./contract.js";

/**
 * Compute the median of a numeric array. Pure function. If
 * the array is empty, returns `null`.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) return null;
  return (lo + hi) / 2;
}

/**
 * Ordinary least-squares slope of y against x.
 *
 *   slope = (n * sum(xy) - sum(x) * sum(y)) /
 *           (n * sum(x^2) - sum(x)^2)
 *
 * If the input is degenerate (e.g. all x equal), returns 0.
 */
export function olsSlope(
  points: ReadonlyArray<readonly [number, number]>,
): number {
  const n = points.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function takeFirst<T>(arr: readonly T[], n: number): readonly T[] {
  if (n <= 0) return Object.freeze([]);
  if (arr.length <= n) return Object.freeze([...arr]);
  return Object.freeze(arr.slice(0, n));
}

export function takeLast<T>(arr: readonly T[], n: number): readonly T[] {
  if (n <= 0) return Object.freeze([]);
  if (arr.length <= n) return Object.freeze([...arr]);
  return Object.freeze(arr.slice(arr.length - n));
}

export interface HeapStabilityVerdict {
  readonly pass: boolean;
  readonly reason:
    | "INSUFFICIENT_SAMPLES"
    | "STABLE"
    | "ABSOLUTE_GROWTH_EXCEEDED"
    | "RELATIVE_GROWTH_EXCEEDED"
    | "SLOPE_EXCEEDED";
  readonly first_window_median: number | null;
  readonly last_window_median: number | null;
  readonly delta_bytes: number | null;
  readonly slope_bytes_per_epoch: number;
}

/**
 * Evaluate the heap stability threshold against the contract.
 *
 * `samples` is the post-GC `heapUsed` value per epoch
 * (already after warm-up has been removed by the caller).
 *
 * Behavior (V1):
 *   - too few samples          => INSUFFICIENT_SAMPLES
 *   - flat sequence            => STABLE
 *   - bounded warm-up          => STABLE
 *   - slow linear leak         => SLOPE_EXCEEDED / ABSOLUTE/RELATIVE
 *   - late leak                => ABSOLUTE_GROWTH_EXCEEDED
 *   - one temporary spike      => NOT NECESSARILY FAIL (single
 *                                 outlier is mediated by median)
 */
export function evaluateHeapStability(args: {
  readonly samples: readonly number[];
  readonly window_size?: number;
  readonly absolute_tolerance_bytes?: number;
  readonly relative_tolerance_fraction?: number;
  readonly slope_max_bytes_per_epoch?: number;
}): HeapStabilityVerdict {
  const w = args.window_size ?? LH06_HEAP_WINDOW_SIZE;
  const abs = args.absolute_tolerance_bytes ?? LH06_HEAP_ABSOLUTE_TOLERANCE_BYTES;
  const rel = args.relative_tolerance_fraction ?? LH06_HEAP_RELATIVE_TOLERANCE_FRACTION;
  const slopeMax = args.slope_max_bytes_per_epoch ?? LH06_HEAP_SLOPE_MAX_BYTES_PER_EPOCH;

  // Need at least one full window on each side to compute
  // the first / last medians. If fewer than `2 * w` samples,
  // we have insufficient data.
  if (args.samples.length < 2 * w) {
    return {
      pass: false,
      reason: "INSUFFICIENT_SAMPLES",
      first_window_median: null,
      last_window_median: null,
      delta_bytes: null,
      slope_bytes_per_epoch: 0,
    };
  }
  const first = median(takeFirst(args.samples, w));
  const last = median(takeLast(args.samples, w));
  if (first === null || last === null) {
    return {
      pass: false,
      reason: "INSUFFICIENT_SAMPLES",
      first_window_median: first,
      last_window_median: last,
      delta_bytes: null,
      slope_bytes_per_epoch: 0,
    };
  }
  const delta = last - first;
  const allowedAbsolute = Math.max(abs, first * rel);
  const slopePoints: [number, number][] = args.samples.map((v, i) => [i, v]);
  const slope = olsSlope(slopePoints);
  const absoluteExceeded = delta > allowedAbsolute;
  const slopeExceeded = slope > slopeMax;
  if (absoluteExceeded && slopeExceeded) {
    return {
      pass: false,
      reason: "SLOPE_EXCEEDED",
      first_window_median: first,
      last_window_median: last,
      delta_bytes: delta,
      slope_bytes_per_epoch: slope,
    };
  }
  if (absoluteExceeded) {
    return {
      pass: false,
      reason: delta > abs ? "ABSOLUTE_GROWTH_EXCEEDED" : "RELATIVE_GROWTH_EXCEEDED",
      first_window_median: first,
      last_window_median: last,
      delta_bytes: delta,
      slope_bytes_per_epoch: slope,
    };
  }
  if (slopeExceeded) {
    return {
      pass: false,
      reason: "SLOPE_EXCEEDED",
      first_window_median: first,
      last_window_median: last,
      delta_bytes: delta,
      slope_bytes_per_epoch: slope,
    };
  }
  return {
    pass: true,
    reason: "STABLE",
    first_window_median: first,
    last_window_median: last,
    delta_bytes: delta,
    slope_bytes_per_epoch: slope,
  };
}

export interface LatencyStabilityVerdict {
  readonly pass: boolean;
  readonly reason:
    | "INSUFFICIENT_SAMPLES"
    | "STABLE"
    | "RATIO_EXCEEDED"
    | "ABSOLUTE_EXCEEDED"
    | "INVALID_SAMPLE";
  readonly first_window_median_ms: number | null;
  readonly last_window_median_ms: number | null;
  readonly drift_ratio: number | null;
}

/**
 * Evaluate the latency drift threshold. Mirrors the heap
 * threshold's pure-function shape.
 *
 * Behavior (V1):
 *   - flat                    => STABLE
 *   - minor noise             => STABLE
 *   - 50% boundary            => precise documented behavior
 *   - slow degradation        => FAIL
 *   - single outlier          => should not dominate median
 *   - missing samples         => INVALID_SAMPLE
 */
export function evaluateLatencyStability(args: {
  readonly samples: readonly number[];
  readonly window_size?: number;
  readonly ratio_max?: number;
  readonly absolute_tolerance_ms?: number;
}): LatencyStabilityVerdict {
  const w = args.window_size ?? LH06_HEAP_WINDOW_SIZE;
  const ratio = args.ratio_max ?? LH06_LATENCY_RATIO_MAX;
  const abs = args.absolute_tolerance_ms ?? LH06_LATENCY_ABSOLUTE_TOLERANCE_MS;
  for (const s of args.samples) {
    if (!Number.isFinite(s) || s < 0) {
      return {
        pass: false,
        reason: "INVALID_SAMPLE",
        first_window_median_ms: null,
        last_window_median_ms: null,
        drift_ratio: null,
      };
    }
  }
  if (args.samples.length < 2 * w) {
    return {
      pass: false,
      reason: "INSUFFICIENT_SAMPLES",
      first_window_median_ms: null,
      last_window_median_ms: null,
      drift_ratio: null,
    };
  }
  const first = median(takeFirst(args.samples, w));
  const last = median(takeLast(args.samples, w));
  if (first === null || last === null) {
    return {
      pass: false,
      reason: "INSUFFICIENT_SAMPLES",
      first_window_median_ms: first,
      last_window_median_ms: last,
      drift_ratio: null,
    };
  }
  if (first <= 0) {
    // Degenerate baseline (everything finished in 0ms). The
    // soak can still claim "stable" if last is also <= abs.
    if (last <= abs) {
      return {
        pass: true,
        reason: "STABLE",
        first_window_median_ms: first,
        last_window_median_ms: last,
        drift_ratio: null,
      };
    }
    return {
      pass: false,
      reason: "ABSOLUTE_EXCEEDED",
      first_window_median_ms: first,
      last_window_median_ms: last,
      drift_ratio: null,
    };
  }
  const driftRatio = last / first;
  const allowedAbsolute = Math.max(first * ratio, first + abs);
  if (driftRatio > ratio && last > allowedAbsolute) {
    return {
      pass: false,
      reason: last > first + abs ? "ABSOLUTE_EXCEEDED" : "RATIO_EXCEEDED",
      first_window_median_ms: first,
      last_window_median_ms: last,
      drift_ratio: driftRatio,
    };
  }
  return {
    pass: true,
    reason: "STABLE",
    first_window_median_ms: first,
    last_window_median_ms: last,
    drift_ratio: driftRatio,
  };
}
