/**
 * LH-06 deterministic long-duration soak laboratory —
 * per-section result builders.
 *
 * Split from `result-builder.ts` for source-size
 * discipline. This module owns:
 *
 *   - `buildResourceSection`
 *   - `buildLatencySection` (L06-C18: removed the unsafe
 *     `LH06_LATENCY_TEST_WINDOW_SIZE` env seam)
 *   - `buildSemanticSection`
 *   - `buildFrozenTreeSection` (L06-C16: typed status)
 */
import {
  evaluateHeapStability,
  evaluateLatencyStability,
  median,
  olsSlope,
  takeFirst,
  takeLast,
} from "./thresholds.js";
import { LH06_HEAP_WINDOW_SIZE, LH06_PROFILES } from "./contract.js";
import { computeFrozenTreeDigest } from "./substrate-binding.js";
import type { SoakWorkerState } from "./worker-state.js";
import type {
  LH06FrozenTreeSection,
  LH06LatencySection,
  LH06ResourceSection,
  LH06SemanticSection,
} from "./result.js";

/**
 * Drop the first `warmup_epochs` samples from a sample
 * array. Implements the "post-warmup steady-state"
 * measurement required by the contract.
 */
function dropWarmup<T>(
  samples: readonly T[],
  warmup_epochs: number,
  sample_cadence: number,
): readonly T[] {
  if (warmup_epochs <= 0 || sample_cadence <= 0) return samples;
  const cutoff = Math.floor(warmup_epochs / sample_cadence);
  if (cutoff <= 0) return samples;
  if (cutoff >= samples.length) return Object.freeze([]);
  return Object.freeze(samples.slice(cutoff));
}

export function buildResourceSection(
  state: SoakWorkerState,
): LH06ResourceSection {
  const warmup = LH06_PROFILES[state.profile].warmup_epochs;
  const heapSubset = dropWarmup(state.heapSamples, warmup, 5);
  const heapFirst = median(takeFirst(heapSubset, LH06_HEAP_WINDOW_SIZE));
  const heapLast = median(takeLast(heapSubset, LH06_HEAP_WINDOW_SIZE));
  const heapDelta =
    heapFirst !== null && heapLast !== null ? heapLast - heapFirst : null;
  const heapSlope = olsSlope(heapSubset.map((v, i) => [i, v] as [number, number]));
  const heapVerdict =
    heapFirst !== null && heapLast !== null
      ? evaluateHeapStability({ samples: heapSubset })
      : null;
  const rssSubset = dropWarmup(state.rssSamples, warmup, 5);
  const rssFirst = median(takeFirst(rssSubset, LH06_HEAP_WINDOW_SIZE));
  const rssLast = median(takeLast(rssSubset, LH06_HEAP_WINDOW_SIZE));
  const rssDelta =
    rssFirst !== null && rssLast !== null ? rssLast - rssFirst : null;
  const rssSlope = olsSlope(rssSubset.map((v, i) => [i, v] as [number, number]));
  return {
    post_gc_heap_first_window: heapFirst,
    post_gc_heap_last_window: heapLast,
    post_gc_heap_delta: heapDelta,
    heap_slope_bytes_per_epoch: heapSlope,
    rss_first_window: rssFirst,
    rss_last_window: rssLast,
    rss_delta: rssDelta,
    rss_slope: rssSlope,
    resource_balance_failures: state.resource_balance_failures,
    workspace_leaks: state.workspace_leaks,
    heap_verdict: heapVerdict,
  };
}

export function buildLatencySection(
  state: SoakWorkerState,
): LH06LatencySection {
  // L06-CORRECTION03 L06-C18: CI_SMOKE test seam is a
  // state field, NOT a process.env read. Production
  // profiles never consult the override.
  const warmup = LH06_PROFILES[state.profile].warmup_epochs;
  const subset =
    warmup > 0 && warmup < state.epochLatenciesMs.length
      ? Object.freeze(state.epochLatenciesMs.slice(warmup))
      : state.epochLatenciesMs;
  const override = (state as unknown as {
    latencyWindowOverride?: number;
  }).latencyWindowOverride;
  const windowSize =
    state.profile === "CI_SMOKE" &&
    typeof override === "number" &&
    override > 0
      ? override
      : LH06_HEAP_WINDOW_SIZE;
  const first = median(takeFirst(subset, windowSize));
  const last = median(takeLast(subset, windowSize));
  const verdict =
    subset.length >= 2 * windowSize
      ? evaluateLatencyStability({
          samples: subset,
          window_size: windowSize,
        })
      : null;
  return {
    first_window_median_ms: first,
    last_window_median_ms: last,
    drift_ratio:
      first !== null && first > 0 && last !== null ? last / first : null,
    verdict,
  };
}

export function buildSemanticSection(
  state: SoakWorkerState,
): LH06SemanticSection {
  const verdict = state.semanticLedger.verdict();
  let multiCount = 0;
  for (const [, n] of Object.entries(verdict.unique_digests_per_case)) {
    if (n > 1) multiCount += 1;
  }
  return {
    drift_count: verdict.semantic_drift_count,
    fault_escape_count: state.fault_escape_count,
    lifecycle_drift_count: state.lifecycle_drift_count,
    predecessor_dependency_count: verdict.predecessor_dependency_count,
    canary_before_equals_canary_after:
      verdict.canary_before_equals_canary_after,
    cases_with_multiple_semantic_results: multiCount,
    // L06-CORRECTION11 C47: bounded per-scenario
    // attribution. Diagnostic only; does NOT affect
    // verdict.
    lifecycle_drift_by_scenario: Object.freeze(
      { ...state.lifecycle_drift_by_scenario },
    ),
  };
}

export function buildFrozenTreeSection(
  state: SoakWorkerState,
): LH06FrozenTreeSection {
  const after = computeFrozenTreeDigest(state.repoRoot);
  if (!after.ok) {
    return {
      before_sha256: state.beforeFrozenSha,
      after_sha256: null,
      changed: null,
      status: after,
    };
  }
  if (state.beforeFrozenSha === null) {
    return {
      before_sha256: null,
      after_sha256: after.digest,
      changed: null,
      status: {
        ok: false,
        kind: "UNREADABLE_EVIDENCE",
        path: "<before-capture>",
        detail: "beforeFrozenSha was not captured at run start",
      },
    };
  }
  const changed = state.beforeFrozenSha !== after.digest;
  return {
    before_sha256: state.beforeFrozenSha,
    after_sha256: after.digest,
    changed,
    status: {
      ok: true,
      kind: changed ? "CHANGED" : "VALID",
    },
  };
}
