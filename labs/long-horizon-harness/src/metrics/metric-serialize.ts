/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Deterministic MetricReport serialization (M19).
 *
 * Doctrine (M19):
 *   "Define one canonical MetricReport serialization.
 *    Required:
 *      same semantic report
 *      +
 *      different object insertion order
 *      =
 *      same canonical bytes
 *    Reuse established deterministic JSON machinery where
 *    applicable. Avoid parallel canonicalization authorities."
 *
 * LH-02 reuses Phase E's existing `deterministicJson` as its
 * sole canonicalization authority. There is no parallel
 * serializer in the LH-02 module.
 *
 * This module is pure: no I/O.
 */

import type { MetricReport } from "./metric-types.js";
import { deterministicJson } from "../run/run-serialize.js";

/**
 * Serialize a `MetricReport` to a deterministic JSON string.
 * Pure: same report -> same bytes; insertion order does not
 * change the result.
 */
export function serializeMetricReport(report: MetricReport): string {
  return deterministicJson(report);
}

/**
 * Equivalent: serialize and return a Buffer of UTF-8 bytes
 * for hashing. Kept as a convenience for downstream
 * consumers who want to compute further hashes on top of
 * the canonical report (without introducing a second
 * canonicalization).
 */
export function serializeMetricReportBytes(report: MetricReport): Uint8Array {
  return new TextEncoder().encode(serializeMetricReport(report));
}
