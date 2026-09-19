/**
 * LH-05 runner — identities module (split for source-size discipline).
 *
 * L05-C08: parent runner.ts is the SINGLE logical authority.
 */
import type { HarnessQualificationIdentity } from "../types.js";

export const PI_QUALIFICATION_IDENTITY: HarnessQualificationIdentity =
  Object.freeze({
    kind: "pi",
    provider: "earendil-works",
    version: "0.85.1",
    protocol: "JSONL_EVENTS",
    role: "QUALIFIED_HARNESS",
  });

export const CLINE_INELIGIBLE_IDENTITY: HarnessQualificationIdentity =
  Object.freeze({
    kind: "cline",
    provider: "cline",
    version: "unknown",
    protocol: "NDJSON",
    role: "INELIGIBLE_HALT",
  });

export const FAKE_REFERENCE_CONTROL_IDENTITY: HarnessQualificationIdentity =
  Object.freeze({
    kind: "fake",
    provider: "factory-scripted-fake",
    version: "v1",
    protocol: "SCRIPTED",
    role: "REFERENCE_CONTROL",
  });

/**
 * Per-scenario harness-eligibility evaluation. V1 expects:
 *
 *   PI:
 *     deterministic_protocol_qualification = PASS
 *     lifecycle_corpus_eligible = YES
 *   CLINE:
 *     qualification = HALT_CLINE_NOT_INSTALLED
 *     lifecycle_corpus_eligible = NO
 *   SCRIPTED_FAKE_ADAPTER:
 *     role = REFERENCE_CONTROL
 */
export function listEligibleHarnesses(): {
  readonly eligible: readonly HarnessQualificationIdentity[];
  readonly halted: readonly HarnessQualificationIdentity[];
} {
  return {
    eligible: [PI_QUALIFICATION_IDENTITY, FAKE_REFERENCE_CONTROL_IDENTITY],
    halted: [CLINE_INELIGIBLE_IDENTITY],
  };
}
