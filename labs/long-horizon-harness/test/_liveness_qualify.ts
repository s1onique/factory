/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01-CORRECTION01-MICROFIX02)
 *
 * Canonical qualification classifier for the
 * (teardown, parent_detach, residue) triple.
 *
 * This is the SINGLE seam LIV08 / LIV12 cross-check.
 *
 * MICROFIX02 P1-1 — REAL QUALIFICATION BINDING:
 *   Before MICROFIX02, this function was used only
 *   by the LIV08 oracle, not by the actual strict
 *   qualification matrix
 *   (`ledger-writer-live-qualification.test.ts`).
 *   That left two separate qualification algebras:
 *   one here, one in the matrix. A regression in
 *   one could leave the other green.
 *
 *   MICROFIX02 wires the real matrix through this
 *   function (the matrix's final disposition is
 *   derived from a (teardown, parent_detach,
 *   residue) triple built from observed post-suite
 *   state, then run through this classifier).
 *   LIV12 statically proves the matrix imports
 *   `classifyQualification` and that no duplicate
 *   `teardown === "closed" && residue === "gone" →
 *   PASS` algebra exists outside this module.
 *
 * Inputs (MICROFIX02 nomenclature):
 *
 *   teardown       : TerminateOutcome
 *                    The KERNEL's response to the
 *                    kill signal. `closed` is the
 *                    only path that licenses a
 *                    `residue = gone` classification.
 *
 *   parent_detach  : ParentDetachOutcome
 *                    The PARENT's view of the
 *                    child's handles. NEVER licenses
 *                    `residue = gone`; it is a
 *                    parent-liveness result only.
 *                    Carries `childLifecycleAtDetach`
 *                    (orthogonal to per-handle detach
 *                    evidence) and per-handle
 *                    evidence.
 *
 *   residue        : "alive" | "gone"
 *                    Whether the original child is
 *                    STILL alive in the kernel
 *                    (via the residue oracle's
 *                    ps / PID observation). The
 *                    residue oracle is the SOLE
 *                    authority on this dimension.
 *
 * Output:
 *
 *   "PASS" | "FAIL" + structured reason.
 *
 * Law (FOUNDATION04 PHASE A INVARIANT):
 *
 *   The ONLY thing that licenses PASS is the
 *   conjunction of
 *
 *     teardown.kind === "closed"
 *     residue === "gone"
 *
 *   Anything else is FAIL — including a successful
 *   parent_detach (every handle unrefed) combined
 *   with `teardown.kind === "signal_permission_denied"`.
 *   That is the canonical LIV08 shape.
 */
import type {
  TerminateOutcome,
} from "./ledger-writer/_writer_teardown.js";
import type {
  ParentDetachOutcome,
} from "./ledger-writer/_writer_teardown.js";

export type Residue = "alive" | "gone";

export type QualificationDisposition = "PASS" | "FAIL";

export type QualificationReason =
  | "canonical_clean"
  | "residue_alive"
  | "teardown_not_closed"
  | "inconsistent_residue_but_already_exited";

export type QualificationDiagnostic = {
  readonly disposition: QualificationDisposition;
  readonly reason: QualificationReason;
};

/**
 * Canonical join. Pure function. No I/O.
 *
 * Decision table (exhaustive):
 *
 *   teardown.kind      residue     → disposition  reason
 *   ─────────────────  ──────────  ────────────  ──────────────────────────
 *   "closed"           "gone"      PASS          canonical_clean
 *   "closed"           "alive"     FAIL          residue_alive
 *   "signal_permission_denied"  "alive"  FAIL   residue_alive
 *   "signal_permission_denied"  "gone"   FAIL   teardown_not_closed
 *   "signal_failed"    "alive"     FAIL          residue_alive
 *   "signal_failed"    "gone"      FAIL          teardown_not_closed
 *   "close_timeout"    "alive"     FAIL          residue_alive
 *   "close_timeout"    "gone"      FAIL          teardown_not_closed
 *
 * `parent_detach` is NEVER the reason for FAIL. Its
 * only contribution is the structural-consistency
 * cross-check: if the parent observed `already_exited`
 * while the residue oracle says the child is alive,
 * we emit `inconsistent_residue_but_already_exited`
 * rather than the plain `residue_alive` reason
 * (diagnostic granularity; both FAIL).
 */
export function classifyQualification(args: {
  readonly teardown: TerminateOutcome;
  readonly parent_detach: ParentDetachOutcome;
  readonly residue: Residue;
}): QualificationDiagnostic {
  const { teardown, parent_detach, residue } = args;

  // Canonical clean triple: only path to PASS.
  if (teardown.kind === "closed" && residue === "gone") {
    return {
      disposition: "PASS",
      reason: "canonical_clean",
    };
  }

  // Structural inconsistency: Node observed `exit`
  // (parent_detach.childLifecycleAtDetach ===
  // "already_exited") but the residue oracle says
  // the child is still alive in the kernel. This
  // can happen in transient races (PID recycled,
  // zombie, etc.) and MUST be FAILed rather than
  // silently passed.
  if (
    parent_detach.childLifecycleAtDetach === "already_exited" &&
    residue === "alive"
  ) {
    return {
      disposition: "FAIL",
      reason: "inconsistent_residue_but_already_exited",
    };
  }

  if (residue === "alive") {
    return {
      disposition: "FAIL",
      reason: "residue_alive",
    };
  }

  // residue === "gone" but teardown !== "closed".
  // Anything here is structurally unusual — fail it.
  return {
    disposition: "FAIL",
    reason: "teardown_not_closed",
  };
}

/**
 * Convenience wrapper that returns only the
 * disposition boolean. Tests / LIV08 callers that
 * only care about PASS/FAIL use this; tooling that
 * wants the diagnostic reason uses
 * `classifyQualification`.
 */
export function isQualificationPass(args: {
  readonly teardown: TerminateOutcome;
  readonly parent_detach: ParentDetachOutcome;
  readonly residue: Residue;
}): boolean {
  return classifyQualification(args).disposition === "PASS";
}

