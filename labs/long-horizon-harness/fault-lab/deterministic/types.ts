/**
 * LH-04 deterministic fault laboratory — fault experiment
 * model (ACT-FACTORY-LONG-HORIZON-LAB-LH04-DETERMINISTIC-FAULT-LABORATORY01).
 *
 * A fault experiment is a controlled mutation applied to a
 * fresh copy of the canonical LH-03 fixture tree. The
 * runner verifies the closed-world verifier rejects the
 * mutation at the expected authority / error kind.
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
 *   mutation_taxonomy        — honest classification of the
 *                              mutation shape; see below.
 *   fixture_source           — which fixture tree the
 *                              experiment copies
 *
 * `mutation_taxonomy` (L04-C04 — review pass 1):
 *
 *   SINGLE_DIMENSION
 *     The fault tampers with exactly one verifier
 *     authority (e.g. one byte in one artifact) and
 *     leaves every other authority dimension identical
 *     to the canonical baseline. The rejection must be
 *     at that single axis or the experiment is wrong.
 *
 *   GUARD_REACHABILITY_CONSTRUCTION
 *     The fault tampers with one verifier authority,
 *     but also re-binds recorded SHAs/identifiers so
 *     earlier guards agree and the verifier reaches the
 *     intended later guard. The mutation still
 *     *targets* one axis; the rewires are bookkeeping.
 *     (F01, F02, F12, F15, F16 use `postBuild` for this.)
 *
 *   COMPOUND_FORGERY
 *     The fault must construct a multi-axis adversarial
 *     state to reach a guard that is not reachable via
 *     a single byte change (e.g. F06 cross-capability
 *     manifest reuse requires rewriting the captured
 *     capabilities document after the workspace mutation
 *     so that the verifier agrees the axes are
 *     internally consistent before the capability
 *     mismatch fires).
 *
 *   COMPOUND_AXIS_SPLICE
 *     The fault intentionally reassigns a relationship
 *     between two axes that each remain internally
 *     valid (e.g. F05 execution_id splice, F11
 *     hash-valid unauthorized path, F17 oracle
 *     observation mismatch).
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

export type MutationTaxonomy =
  | "SINGLE_DIMENSION"
  | "GUARD_REACHABILITY_CONSTRUCTION"
  | "COMPOUND_FORGERY"
  | "COMPOUND_AXIS_SPLICE";

export interface FaultExperiment {
  readonly id: string;
  readonly description: string;
  readonly target: string;
  readonly fault: string;
  readonly expected_authority: Authority;
  readonly expected_error_kind: ExpectedErrorKind;
  readonly mutated_dimension: string;
  readonly preserved_dimensions: readonly string[];
  readonly mutation_taxonomy: MutationTaxonomy;
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
  readonly mutation_taxonomy: MutationTaxonomy;
  /**
   * The structured `EvidenceVerificationErrorKind` the
   * frozen LH-03 verifier emitted as its first failure.
   * This is the authoritative measurement: it comes
   * directly from the verifier, not from message parsing.
   */
  readonly observed_error_kind: ExpectedErrorKind | "VERIFIER_OK" | "VERIFIER_PARSED_NULL";
  /**
   * The verifier authority under which the first
   * rejection occurred. This is *classified* by the lab,
   * not directly emitted by the verifier (the frozen
   * verifier returns only the typed `errorKind`; the
   * lab maps `errorKind` + axis context into an
   * authority label). The mapping is explicit and
   * reproducible; see `runner.classifyAuthority`.
   *
   * The renamed field reflects this honestly: it is the
   * lab's classification of the verifier's first
   * rejection, not a structured verifier field.
   */
  readonly classified_authority: Authority | "verifier_ok";
  readonly classified_authority_method:
    | "structured_error_kind"
    | "structured_error_kind_plus_axis_context"
    | "message_prefix_inference";
  readonly observed_first_rejection_message: string | null;
  readonly disposition: FaultDisposition;
  readonly baseline_passed: boolean;
  readonly notes: string;
}
