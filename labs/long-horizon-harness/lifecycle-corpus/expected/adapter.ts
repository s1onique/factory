/**
 * LH-05 expected adapter / handoff comparator.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Split from `expected.ts` for source-size discipline.
 */
import type {
  ExpectedAdapterDisposition,
  AdapterErrorKind,
  Lh04HandoffResult,
} from "../types.js";

export function checkAdapterDisposition(
  expected: ExpectedAdapterDisposition,
  actual:
    | { readonly kind: "ACCEPTED" }
    | { readonly kind: "REJECTED"; readonly error_kind: AdapterErrorKind },
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (expected.kind === "ACCEPTED") {
    if (actual.kind === "ACCEPTED") return { ok: true };
    return { ok: false, reason: `expected adapter ACCEPTED but adapter REJECTED(${actual.error_kind})` };
  }
  if (expected.kind === "LH04_HANDOFF") {
    return {
      ok: false,
      reason: `expected adapter disposition is LH04_HANDOFF (${expected.expected_outcome}); use compareScenarioWithHandoff instead`,
    };
  }
  if (actual.kind === "ACCEPTED") {
    return { ok: false, reason: `expected adapter REJECTED(${expected.expected_error_kind}) but adapter ACCEPTED` };
  }
  if (expected.expected_error_kind === actual.error_kind) return { ok: true };
  return { ok: false, reason: `expected adapter REJECTED(${expected.expected_error_kind}) but adapter REJECTED(${actual.error_kind})` };
}

/**
 * L05-C04 — Compare a typed LH-04 handoff result against
 * the catalog's expected handoff outcome. Only
 * LH04_HANDOFF_REJECTED_AS_EXPECTED can PASS; the other four
 * outcomes produce distinct, named failures.
 */
export function checkHandoffResult(
  expected: Extract<ExpectedAdapterDisposition, { kind: "LH04_HANDOFF" }>,
  actual: Lh04HandoffResult,
): { readonly ok: true; readonly rejection_kind: string | null } | { readonly ok: false; readonly reason: string } {
  if (actual.kind === "LH04_HANDOFF_REJECTED_AS_EXPECTED") {
    if (expected.expected_outcome !== "LH04_HANDOFF_REJECTED_AS_EXPECTED") {
      return {
        ok: false,
        reason: `LH-04 handoff rejected (${actual.rejection_kind}) but catalog expected ${expected.expected_outcome}`,
      };
    }
    if (
      expected.expected_rejection_kind !== undefined &&
      expected.expected_rejection_kind !== actual.rejection_kind
    ) {
      return {
        ok: false,
        reason: `LH-04 handoff rejected with ${actual.rejection_kind}; catalog pinned ${expected.expected_rejection_kind}`,
      };
    }
    return { ok: true, rejection_kind: actual.rejection_kind };
  }
  const detail =
    actual.kind === "LH04_HANDOFF_ESCAPED"
      ? "LH-04 frozen verifier ACCEPTED the mutated evidence (ESCAPED); LH-05 invariant cannot be proven"
      : actual.kind === "LH04_BASELINE_INVALID"
        ? "LH-04 frozen verifier REJECTED the unmutated canonical baseline; handoff substrate is broken"
        : actual.kind === "LH04_FAULT_NOT_FOUND"
          ? `LH-04 fault catalog does not contain '${actual.fault_id}'`
          : `LH-04 handoff threw: ${actual.kind} (${"message" in actual ? actual.message : ""})`;
  return {
    ok: false,
    reason: `LH-04 handoff produced ${actual.kind}; expected ${expected.expected_outcome}. ${detail}`,
  };
}