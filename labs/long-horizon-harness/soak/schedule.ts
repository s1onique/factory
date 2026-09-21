/**
 * LH-06 deterministic long-duration soak laboratory —
 * deterministic order variation.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Fixed execution order can hide state contamination. But
 * uncontrolled randomness damages replayability. Therefore
 * V1 uses deterministic order variation based on the cycle
 * index — same cycle index => same execution order.
 *
 * Required:
 *   SAME_EPOCH_INDEX => SAME_EXECUTION_ORDER
 *
 * Forbidden:
 *   Math.random(), crypto.randomUUID(), Date.now() for
 *   picking execution order.
 *
 * Recommended V1 (ACT §5):
 *
 *   cycle % 4 == 0: LH05 forward, LH04 forward
 *   cycle % 4 == 1: LH05 reverse, LH04 forward
 *   cycle % 4 == 2: LH05 rotated by cycle index, LH04 reverse
 *   cycle % 4 == 3: LH04 first, LH05 rotated by cycle index
 *
 * Schedule version: lh06.schedule.v1
 */
import { LH06_LH04_CASE_IDS, LH06_LH05_CASE_IDS, LH06_SCHEDULE_VERSION } from "./types.js";

/**
 * A canonical epoch has 31 cases (12 + 17 + canary + integrity
 * + cleanup). The schedule describes the ORDER in which
 * those cases are executed within a single epoch.
 *
 * The schedule is intentionally NOT a hash of the cases
 * themselves — that would make test introspection hard. The
 * schedule is a closed-world list of `ScheduledCase` values.
 */
export interface ScheduledCase {
  readonly case_id: string;
  readonly source: "LH05" | "LH04" | "CANARY" | "INTEGRITY" | "CLEANUP";
  /**
   * The 0-based index of this case within the canonical
   * epoch (LH05 cases 0..11, LH04 cases 12..28, canary 29,
   * integrity 30, cleanup 31). The scheduler returns the
   * cases in a different order.
   */
  readonly canonical_index: number;
}

/**
 * Build the V1 canonical epoch.
 */
export function buildCanonicalEpoch(): readonly ScheduledCase[] {
  const out: ScheduledCase[] = [];
  LH06_LH05_CASE_IDS.forEach((id, i) => out.push({
    case_id: id,
    source: "LH05",
    canonical_index: i,
  }));
  LH06_LH04_CASE_IDS.forEach((id, i) => out.push({
    case_id: id,
    source: "LH04",
    canonical_index: LH06_LH05_CASE_IDS.length + i,
  }));
  out.push({
    case_id: "CANARY_LC01",
    source: "CANARY",
    canonical_index: LH06_LH05_CASE_IDS.length + LH06_LH04_CASE_IDS.length,
  });
  out.push({
    case_id: "INTEGRITY_CHECKPOINT",
    source: "INTEGRITY",
    canonical_index: LH06_LH05_CASE_IDS.length + LH06_LH04_CASE_IDS.length + 1,
  });
  out.push({
    case_id: "CLEANUP_CHECKPOINT",
    source: "CLEANUP",
    canonical_index: LH06_LH05_CASE_IDS.length + LH06_LH04_CASE_IDS.length + 2,
  });
  return Object.freeze(out);
}

/**
 * Rotate an array left by `k` positions, wrapping. Pure
 * function; used for cycle-index rotation. We do NOT use
 * `Array.prototype.splice` to keep the operation obvious.
 */
export function rotateLeft<T>(arr: readonly T[], k: number): readonly T[] {
  if (arr.length === 0) return arr;
  const n = arr.length;
  const r = ((k % n) + n) % n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[(i + r) % n] as T);
  }
  return Object.freeze(out);
}

export function reverseStable<T>(arr: readonly T[]): readonly T[] {
  return Object.freeze([...arr].reverse());
}

/**
 * Compute the V1 schedule for a given epoch index.
 *
 * Determinism: returns the SAME value for the SAME
 * epochIndex. Never reads wall-clock time, random sources,
 * or process identity for ordering decisions.
 *
 * The four cycle quadrants are documented in ACT §5.
 */
export function scheduleForEpoch(epochIndex: number): readonly ScheduledCase[] {
  if (!Number.isInteger(epochIndex) || epochIndex < 0) {
    throw new Error(
      `scheduleForEpoch: epochIndex must be a non-negative integer, got ${epochIndex}`,
    );
  }
  const canonical = buildCanonicalEpoch();
  const lh05Cases = canonical.filter((c) => c.source === "LH05");
  const lh04Cases = canonical.filter((c) => c.source === "LH04");
  const tail = canonical.filter(
    (c) =>
      c.source === "CANARY" ||
      c.source === "INTEGRITY" ||
      c.source === "CLEANUP",
  );

  const q = epochIndex % 4;
  let ordered: ScheduledCase[] = [];
  switch (q) {
    case 0: {
      // LH05 forward, LH04 forward
      ordered = [...lh05Cases, ...lh04Cases];
      break;
    }
    case 1: {
      // LH05 reverse, LH04 forward
      ordered = [...reverseStable(lh05Cases), ...lh04Cases];
      break;
    }
    case 2: {
      // LH05 rotated by cycle index, LH04 reverse
      ordered = [
        ...rotateLeft(lh05Cases, epochIndex),
        ...reverseStable(lh04Cases),
      ];
      break;
    }
    case 3: {
      // LH04 first, LH05 rotated by cycle index
      ordered = [
        ...lh04Cases,
        ...rotateLeft(lh05Cases, epochIndex),
      ];
      break;
    }
    default: {
      // unreachable — defensive
      ordered = [...canonical];
    }
  }
  // Tail (canary / integrity / cleanup) is appended in
  // fixed canonical order; ordering variation is for the
  // active workload only. The canary comes at the END of
  // the epoch so the canary comparison is well-defined.
  ordered.push(...tail);
  return Object.freeze(ordered);
}

/**
 * Re-export schedule version so consumers don't need to
 * import from types directly.
 */
export const SCHEDULE_VERSION = LH06_SCHEDULE_VERSION;
