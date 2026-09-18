/**
 * LH-04 deterministic fault laboratory — fault experiment
 * model (ACT-FACTORY-LONG-HORIZON-LAB-LH04-DETERMINISTIC-FAULT-LABORATORY01).
 *
 * A fault experiment is a single controlled mutation
 * applied to a fresh copy of the canonical LH-03 fixture
 * tree. The runner verifies the closed-world verifier
 * rejects the mutation at the expected authority / error
 * kind.
 *
 * Every fault experiment carries:
 *
 *   id                       — F01..F17 (matches the catalog)
 *   target                   — name of the artifact the
 *                              fault mutates
 *   fault                    — short description of the
 *                              controlled mutation
 *   expected_authority       — which verifier authority
 *                              the fault is designed to
 *                              test
 *   expected_error_kind      — the closed-world
 *                              EvidenceVerificationErrorKind
 *                              the verifier is expected to
 *                              emit as its FIRST failure
 *   mutated_dimension        — exact authority dimension
 *                              the mutation tampers with
 *   preserved_dimensions     — list of authority dimensions
 *                              left intact (so the rejection
 *                              cannot be a downstream side
 *                              effect of a multi-axis break)
 *   fixture_source           — which fixture tree the
 *                              experiment copies
 */
export type Authority =
  | "byte_hash"
  | "invocation_byte_hash"
  | "execution_relationship"
  | "execution_id_relationship"
  | "manifest_capability_binding"
  | "manifest_origin_discriminator"
  | "path"
  | "oracle_semantic"
  | "invocation_derivation";

export type FaultDisposition =
  | "PASS"
  | "ESCAPED"
  | "WRONG_AUTHORITY"
  | "INVALID_EXPERIMENT"
  | "BASELINE_REGRESSION";

export type ExpectedErrorKind =
  | "EVIDENCE_ARTIFACT_MISSING"
  | "EVIDENCE_PATH_ESCAPE"
  | "EVIDENCE_HASH_MISMATCH"
  | "EVIDENCE_PARSE_FAILED"
  | "EVIDENCE_OBSERVATION_MISMATCH"
  | "EVIDENCE_ORACLE_FAILED"
  | "EVIDENCE_EXECUTION_MISMATCH";

export interface FaultExperiment {
  readonly id: string;
  readonly description: string;
  readonly target: string;
  readonly fault: string;
  readonly expected_authority: Authority;
  readonly expected_error_kind: ExpectedErrorKind;
  readonly mutated_dimension: string;
  readonly preserved_dimensions: readonly string[];
  readonly fixture_source: string;
  /**
   * Apply the controlled mutation. The mutation receives
   * a fresh workspace (canonical fixtures already copied)
   * and MUST mutate exactly the intended authority
   * dimension. The mutation may read canonical fixture
   * bytes to produce a hash-correct unauthorized path
   * (see F11).
   */
  readonly mutate: (workspace_root: string) => Promise<void>;
  /**
   * Some faults (F05, F06, F07, F11, F17) cannot be
   * expressed as a pure workspace mutation: they require
   * the captured `HarnessCapabilities` document to be
   * rewritten after the workspace mutation. When set,
   * this hook rewrites the post-mutation document.
   * It is invoked AFTER `mutate` and BEFORE the
   * verifier sees the document.
   *
   * The hook receives the canonical baseline built from
   * the post-mutation workspace and returns the
   * forged document.
   */
  readonly postBuild?: (
    workspaceRoot: string,
    canonical: import("../../src/protocol/index.js").HarnessCapabilities,
    preMutationCanonical: import("../../src/protocol/index.js").HarnessCapabilities,
  ) => import("../../src/protocol/index.js").HarnessCapabilities;
}

export interface FaultExperimentResult {
  readonly id: string;
  readonly description: string;
  readonly expected_authority: Authority;
  readonly expected_error_kind: ExpectedErrorKind;
  readonly mutated_dimension: string;
  readonly preserved_dimensions: readonly string[];
  readonly observed_error_kind: ExpectedErrorKind | "VERIFIER_OK" | "VERIFIER_PARSED_NULL";
  readonly observed_authority: Authority | "verifier_ok";
  readonly observed_first_rejection_message: string | null;
  readonly disposition: FaultDisposition;
  readonly baseline_passed: boolean;
  readonly notes: string;
}

/**
 * The closed mapping the catalog asserts:
 *   fault id -> authority -> error kind.
 */
export const FAULT_AUTHORITY_KIND: Readonly<
  Record<string, { readonly authority: Authority; readonly error_kind: ExpectedErrorKind }>
> = Object.freeze({
  F01: { authority: "byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F02: { authority: "invocation_byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F03: { authority: "invocation_derivation", error_kind: "EVIDENCE_PARSE_FAILED" },
  F04: { authority: "execution_relationship", error_kind: "EVIDENCE_EXECUTION_MISMATCH" },
  F05: { authority: "execution_id_relationship", error_kind: "EVIDENCE_EXECUTION_MISMATCH" },
  F06: { authority: "manifest_capability_binding", error_kind: "EVIDENCE_EXECUTION_MISMATCH" },
  F07: { authority: "manifest_origin_discriminator", error_kind: "EVIDENCE_EXECUTION_MISMATCH" },
  F08: { authority: "path", error_kind: "EVIDENCE_PATH_ESCAPE" },
  F09: { authority: "path", error_kind: "EVIDENCE_PATH_ESCAPE" },
  F10: { authority: "path", error_kind: "EVIDENCE_PATH_ESCAPE" },
  F11: { authority: "path", error_kind: "EVIDENCE_PATH_ESCAPE" },
  F12: { authority: "byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F13: { authority: "byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F14: { authority: "byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F15: { authority: "byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F16: { authority: "byte_hash", error_kind: "EVIDENCE_HASH_MISMATCH" },
  F17: { authority: "oracle_semantic", error_kind: "EVIDENCE_ORACLE_FAILED" },
});
