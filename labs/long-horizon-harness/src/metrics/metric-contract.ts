/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Contract identity & version guard. The projector reads
 * `requestedContractVersion` once and routes through this
 * guard. The guard refuses any contract version that is not
 * in the closed-world `METRIC_CONTRACT_VERSIONS` set.
 *
 * Doctrine (M1):
 *   "Changing metric semantics requires a new contract
 *    version. Never silently reinterpret historical runs
 *    using changed formulas while preserving the same
 *    version."
 *
 * Therefore V1 surfaces EXACTLY ONE contract identity:
 *
 *   CONVERGENCE_METRIC_CONTRACT_V1
 *
 * Adopting a future V2 means adding the new constant +
 * adding it to the closed-world list + bumping the
 * SchemaReportSchemaVersion only where the structural
 * shape of the MetricReport itself changes (not on every
 * formula tweak).
 *
 * This module is pure: no I/O.
 */

import {
  CONVERGENCE_METRIC_CONTRACT_V1,
  METRIC_CONTRACT_VERSIONS,
  type ConvergenceMetricContractV1,
  type MetricContractVersion,
  isMetricContractVersion,
} from "./metric-types.js";

/**
 * The single contract identity recognized in V1. Re-exported
 * here as the canonical alias callers in the projector use.
 */
export const SUPPORTED_CONTRACT_VERSION: ConvergenceMetricContractV1 =
  CONVERGENCE_METRIC_CONTRACT_V1;

export type { ConvergenceMetricContractV1, MetricContractVersion };

/**
 * Result of asking the projector to honor a specific
 * contract version. The guard returns one of:
 *
 *   {ok: true, version: <canonical contract id>}
 *   {ok: false, reason: ...}
 *
 * Never throws. M1 says changing metric semantics requires
 * a new contract version, so the projector refusing an
 * unrecognized version is a hard failure (not a fallback).
 */
export type ContractGuardResult =
  | { readonly ok: true; readonly version: ConvergenceMetricContractV1 }
  | { readonly ok: false; readonly reason: string };

/**
 * Decide whether to honor a requested contract version.
 *
 * Caller-facing signature accepts a `string` because callers
 * typically pass through an external configuration field.
 * The guard either normalizes it to the canonical contract
 * identity or refuses it.
 */
export function guardContractVersion(
  requested: unknown,
): ContractGuardResult {
  if (typeof requested !== "string") {
    return {
      ok: false,
      reason:
        `metric contract version MUST be a string; got ${typeof requested}`,
    };
  }
  if (!isMetricContractVersion(requested)) {
    const knownList = METRIC_CONTRACT_VERSIONS.join(", ");
    return {
      ok: false,
      reason:
        `metric contract version '${requested}' is not recognized by ` +
        `LH-02 (known: ${knownList}). Adopting a new contract ` +
        `requires adding the version to METRIC_CONTRACT_VERSIONS; ` +
        `silent re-interpretation under the existing version is forbidden.`,
    };
  }
  return { ok: true, version: requested };
}

/**
 * The single canonical contract identity string callers
 * will use most of the time. Re-exported here from
 * metric-types for ergonomic import locality.
 */
export { CONVERGENCE_METRIC_CONTRACT_V1 };
