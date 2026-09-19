/**
 * LH-05 adversarial lifecycle corpus — type authority.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * Single source of truth for the LH-05 lifecycle scenario
 * contract. Every other module in `lifecycle-corpus/`
 * imports its domain types from here.
 *
 * Doctrine:
 *   - No composite scenario score. A scenario either
 *     produces the expected state, the expected adapter
 *     rejection, or it is a corpus failure.
 *   - `golden_predicates` are HAND-PINNED. The production
 *     projector produces actuals; the test-side corpus
 *     declarations provide expecteds. Expected results
 *     are NEVER derived from the system under test.
 *   - `lifecycle_corpus.v1` is the closed-world contract
 *     version. Schema breakage requires a version bump.
 */
export const LIFECYCLE_CORPUS_CONTRACT_VERSION = "lh05.lifecycle.corpus.v1" as const;

export type HarnessKind = "pi" | "cline" | "fake";

export type ExpectedAdapterDisposition =
  | { readonly kind: "ACCEPTED" }
  | { readonly kind: "REJECTED"; readonly expected_error_kind: AdapterErrorKind }
  // L05-C04: the FAULT_LAB_HANDOFF scenarios (LC11) declare
  // the typed handoff outcome they expect. Only the
  // REJECTED_AS_EXPECTED variant can ever PASS.
  | {
      readonly kind: "LH04_HANDOFF";
      readonly expected_outcome:
        | "LH04_HANDOFF_REJECTED_AS_EXPECTED"
        | "LH04_HANDOFF_ESCAPED"
        | "LH04_BASELINE_INVALID"
        | "LH04_FAULT_NOT_FOUND"
        | "LH04_HANDOFF_INTERNAL_ERROR";
      readonly expected_rejection_kind?:
        | "EVIDENCE_ARTIFACT_MISSING"
        | "EVIDENCE_PATH_ESCAPE"
        | "EVIDENCE_HASH_MISMATCH"
        | "EVIDENCE_PARSE_FAILED"
        | "EVIDENCE_OBSERVATION_MISMATCH"
        | "EVIDENCE_ORACLE_FAILED"
        | "EVIDENCE_EXECUTION_MISMATCH";
    };

export type AdapterErrorKind =
  | "MALFORMED_NATIVE_EVENT"
  | "UNKNOWN_NATIVE_EVENT_KIND"
  | "EVIDENCE_CORRUPTION_DETECTED";

/**
 * L05-C04 — Typed LH-04 handoff result (LC11).
 *
 * The handoff to the LH-04 frozen verifier can end in five
 * mutually-exclusive dispositions. Only the FIRST can ever
 * make LC11 PASS:
 *
 *   LH04_HANDOFF_REJECTED_AS_EXPECTED
 *     The fault was applied; the LH-04 frozen verifier
 *     REJECTED the mutated evidence. This is the only
 *     success outcome.
 *
 *   LH04_HANDOFF_ESCAPED
 *     The mutated evidence escaped the verifier (verifier
 *     returned OK). LH-05 cannot prove its invariant.
 *
 *   LH04_BASELINE_INVALID
 *     The unmutated canonical baseline did NOT pass the
 *     verifier. The handoff substrate itself is broken.
 *
 *   LH04_FAULT_NOT_FOUND
 *     The marker file declared an unknown fault id.
 *
 *   LH04_HANDOFF_INTERNAL_ERROR
 *     The handoff threw before producing a verdict.
 *
 * The `rejection_kind` field carries the FROZEN LH-04
 * `EvidenceVerificationErrorKind` for the success case so
 * the catalog can pin the actual rejection kind (L05-C04).
 */
export type Lh04HandoffResult =
  | {
      readonly kind: "LH04_HANDOFF_REJECTED_AS_EXPECTED";
      readonly rejection_kind:
        | "EVIDENCE_ARTIFACT_MISSING"
        | "EVIDENCE_PATH_ESCAPE"
        | "EVIDENCE_HASH_MISMATCH"
        | "EVIDENCE_PARSE_FAILED"
        | "EVIDENCE_OBSERVATION_MISMATCH"
        | "EVIDENCE_ORACLE_FAILED"
        | "EVIDENCE_EXECUTION_MISMATCH";
      readonly rejection_keys: readonly string[];
    }
  | { readonly kind: "LH04_HANDOFF_ESCAPED" }
  | { readonly kind: "LH04_BASELINE_INVALID" }
  | { readonly kind: "LH04_FAULT_NOT_FOUND"; readonly fault_id: string }
  | { readonly kind: "LH04_HANDOFF_INTERNAL_ERROR"; readonly message: string };

export type ExpectedPhaseE = {
  readonly lifecycle_state:
    | "TERMINAL"
    | "INVALID_EVIDENCE"
    | "INCOMPLETE"
    | "ACTIVE";
  readonly terminal_outcome: string | null;
  readonly work_epoch_predicates: {
    readonly closure_authority_fresh: boolean;
    readonly current_epoch_action_failure: boolean;
    readonly current_epoch_review_failure: boolean;
  };
  readonly authority_predicates: {
    readonly last_gate_pass: boolean | null;
    readonly last_action_status: "OK" | "ERROR" | null;
    readonly last_review_pass: boolean | null;
  };
  readonly negative_evidence_predicates: {
    readonly action_failure_at_epoch: number | null;
    readonly review_failure_at_epoch: number | null;
  };
};

export type ExpectedLH02 = {
  readonly metric_contract_version: string;
  readonly terminal_outcome: string | null;
  readonly eligible_for_success_normalized_metrics: boolean | null;
  readonly historical_authority_invalidation_count: number | null;
  readonly metric_evidence_failure_observed: boolean;
};

export type ForbiddenOutcomes = {
  readonly terminal_outcome_in: readonly string[] | null;
  readonly lifecycle_state_in: readonly string[] | null;
  readonly success_normalized_metrics_emitted: boolean;
  readonly custom: readonly string[];
};

export type GoldenPredicates = {
  readonly expected_adapter_disposition: ExpectedAdapterDisposition;
  readonly expected_phase_e: ExpectedPhaseE;
  readonly expected_lh02: ExpectedLH02;
  readonly forbidden_outcomes: ForbiddenOutcomes;
};

export type HarnessEligibility = {
  readonly pi: HarnessEligibilityState;
  readonly cline: HarnessEligibilityState;
  readonly fake_reference_control: HarnessEligibilityState;
};

export type HarnessEligibilityState =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

export type HarnessQualificationIdentity = {
  readonly kind: HarnessKind;
  readonly provider: string;
  readonly version: string;
  readonly protocol: string;
  readonly role: "QUALIFIED_HARNESS" | "REFERENCE_CONTROL" | "INELIGIBLE_HALT";
};

export type LifecycleScenarioClass =
  | "VALID_ADVERSARIAL_LIFECYCLE"
  | "ADAPTER_BOUNDARY_REJECTION"
  | "FAULT_LAB_HANDOFF"
  | "RECOVERY_LIFECYCLE";

export type LifecycleScenario = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly scenario_class: LifecycleScenarioClass;
  readonly stimulus: string;
  readonly preconditions: readonly string[];
  readonly eligible_harnesses: HarnessEligibility;
  readonly required_capabilities: readonly string[];
  readonly raw_fixture_set: readonly RawFixture[];
  readonly golden_predicates: GoldenPredicates;
  readonly required_invariants: readonly string[];
  readonly omit_run_started?: boolean;
  readonly fault_lab_handoff?: {
    readonly fault_id: string;
    readonly fault_klass: "F01_byte_drift" | "F02_unbound_subject" | "F03_unbound_attempt";
  };
  /**
   * L05-C10 — closed-world ordered segment declaration.
   *
   * LC07 (restart / recovery) MUST declare its segments in
   * `ordinal` order (segment A = 0, segment B = 1, etc.).
   * The runner reads this list, validates the chain
   * (predecessor / capture_id / shared_session_id /
   * ordinal monotonicity / duplicate fixture paths) via
   * `validateLifecycleSegmentChain`, and feeds each segment
   * into the loader with explicit binding metadata. No
   * "guess from filename" inference.
   */
  readonly segments?: ReadonlyArray<LifecycleSegmentBinding>;
};

/**
 * L05-C10 — closed-world LC07 segment binding.
 *
 * Each entry is a single, fully-declared capture segment.
 * `ordinal` is the source of truth for ordering; the loader
 * MUST NOT infer ordering from filenames.
 */
export type LifecycleSegmentBinding = {
  readonly capture_id: string;
  readonly segment_id: string;
  readonly ordinal: number;
  readonly shared_session_id: string;
  readonly previous_segment_id: string | null;
  readonly fixture_path: string;
};

/**
 * L05-C10 — closed-world segment-binding failure reasons.
 *
 * The validator returns the FIRST applicable failure it
 * detects; downstream consumers MUST treat the reason as
 * machine-visible (not a free-text string).
 */
export type SegmentBindingFailure =
  | "DUPLICATE_SEGMENT"
  | "SEGMENT_ORDER_INVALID"
  | "MISSING_PREDECESSOR"
  | "CAPTURE_ID_MISMATCH"
  | "SESSION_ID_MISMATCH"
  | "UNBOUND_CONTINUATION"
  | "DUPLICATE_FIXTURE"
  | "MISSING_SESSION_HEADER"
  // L05-C18 (CORRECTION03): process-bound segment MUST
  // place native `session` header at the first record.
  | "NATIVE_HEADER_NOT_AT_FIRST_RECORD";

/**
 * L05-C11 — typed Pi fixture loader result. Closed-world
 * failure reasons are machine-visible. Continuation lifecycle
 * violations (header dropped or placed after events) are
 * REJECTED, not silently dropped.
 *
 * L05-C16 (CORRECTION03): continuation `agent_start` is
 * permitted; the harness mapper deduplicates RUN_STARTED via
 * its `emittedRunStarted` flag, so the second candidate_started
 * is a process-restart observation, not a duplicate Factory
 * run start. This proves `PROCESS_RESTART != NEW_FACTORY_RUN`.
 */
export type PiFixtureLoadResult =
  | { readonly ok: true; readonly events: ReadonlyArray<import("../src/protocol/harness-adapter.js").HarnessEvent> }
  | {
      readonly ok: false;
      readonly reason:
        | "MALFORMED_NATIVE_EVENT"
        | "UNKNOWN_NATIVE_EVENT_KIND"
        | "SEGMENT_BINDING_INVALID"
        | "MISSING_SESSION_HEADER"
        | "NATIVE_HEADER_NOT_AT_FIRST_RECORD"
        | "SESSION_ID_MISMATCH";
    };

export type RawFixture = {
  readonly repo_relative_path: string;
  readonly kind:
    | "pi_native_session_jsonl"
    | "scripted_fake_event_script"
    | "corruption_handoff_fixture"
    | "host_sentinel_text"
    | "factory_external_events_json";
  readonly description: string;
};

export type LifecycleReplayResult = {
  readonly scenario_id: string;
  readonly scenario_version: string;
  readonly scenario_class: LifecycleScenarioClass;
  readonly harness: HarnessQualificationIdentity;
  readonly execution_mode: "REPLAY";
  readonly adapter_disposition: ExpectedAdapterDisposition;
  readonly adapter_error_kind: AdapterErrorKind | null;
  readonly phase_e_lifecycle_state: string | null;
  readonly phase_e_terminal_outcome: string | null;
  /**
   * L05-C12: full authority predicate shape, candidate-neutral.
   * `null` when the adapter was rejected before projection.
   */
  readonly phase_e_predicates: PhaseEPredicates | null;
  readonly lh02_predicates: LH02ActualPredicates;
  readonly forbidden_outcomes: ForbiddenOutcomesActual;
  readonly success_normalized_metrics_emitted: boolean;
  readonly disposition:
    | "PASS"
    | "WRONG_ADAPTER_STATE"
    | "WRONG_PHASE_E_STATE"
    | "WRONG_METRIC_STATE"
    | "FORBIDDEN_OUTCOME"
    | "UNEXPECTED_ACCEPTANCE"
    | "UNEXPECTED_REJECTION";
  readonly notes: string;
};

/**
 * L05-C12 — bounded, candidate-neutral Phase E predicate surface.
 *
 * This is the full authority shape that the parity comparator
 * MUST compare. Adding new fields here requires a schema
 * version bump.
 */
export type PhaseEPredicates = {
  readonly lifecycle_state: string;
  readonly terminal_outcome: string | null;
  readonly closure_authority_fresh: boolean;
  readonly current_epoch_action_failure: boolean;
  readonly current_epoch_review_failure: boolean;
  readonly last_gate_pass: boolean | null;
  readonly last_action_status: "OK" | "ERROR" | null;
  readonly last_review_pass: boolean | null;
  readonly action_failure_at_epoch: number | null;
  readonly review_failure_at_epoch: number | null;
};

export type LH02ActualPredicates = {
  readonly passed: boolean;
  readonly failed: readonly string[];
  readonly metric_contract_version: string | null;
  readonly terminal_outcome: string | null;
  readonly eligible_for_success_normalized_metrics: boolean | null;
  readonly historical_authority_invalidation_count: number | null;
  readonly metric_evidence_failure_observed: boolean | null;
};

export type ForbiddenOutcomesActual = {
  readonly all_absent: boolean;
  readonly observed: readonly string[];
};

export type LifecycleCorpusResult = {
  readonly schema: "lh05-adversarial-lifecycle-corpus/v1";
  readonly emitted_at: string;
  readonly lh03_frozen_commit: string;
  readonly lh04_frozen_commit: string;
  readonly corpus_contract_version: typeof LIFECYCLE_CORPUS_CONTRACT_VERSION;
  readonly eligible_harnesses: readonly HarnessQualificationIdentity[];
  readonly halted_harnesses: readonly HarnessQualificationIdentity[];
  readonly scenario_count: 12;
  readonly per_scenario: readonly LifecycleReplayResult[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly unexpected_acceptance: number;
    readonly unexpected_rejection: number;
    readonly wrong_phase_e_state: number;
    readonly wrong_metric_state: number;
    readonly wrong_adapter_state: number;
    readonly forbidden_outcome: number;
  };
  readonly two_run_semantic_repeatability: boolean;
  readonly live_execution_performed: false;
  readonly byte_identical_result_artifact: boolean;
};

export type NegativeCorpusCode =
  | "LH05-N01"
  | "LH05-N02"
  | "LH05-N03"
  | "LH05-N04"
  | "LH05-N05"
  | "LH05-N06"
  | "LH05-N07"
  | "LH05-N08"
  | "LH05-N09"
  | "LH05-N10";

/**
 * The raw native-event vocabulary consumed by
 * `reference-control.ts` and `pi-fixtures.ts`. These
 * are script-side primitives; the runner feeds them
 * to the adapter to obtain normalized Phase E events.
 */
export type RawLifecycleEvent =
  | { readonly kind: "raw_native_event"; readonly native_type: string; readonly native_record: Readonly<Record<string, unknown>> }
  | { readonly kind: "candidate_started" }
  | { readonly kind: "candidate_reported_completion"; readonly summary: string }
  | { readonly kind: "candidate_error"; readonly code: string; readonly message: string };

/**
 * The four phases the lifecycle runner traverses for
 * each (scenario, harness) pair.
 */
export type RunnerPhase =
  | "ADAPTER_NORMALIZATION"
  | "ADAPTER_REJECTION"
  | "PHASE_E_PROJECTION"
  | "LH02_METRICS";
