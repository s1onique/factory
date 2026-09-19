/**
 * LH-05 adversarial lifecycle corpus — canonical catalog.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * The catalog is the SINGLE source of truth for the
 * LC01..LC12 scenario authority. Per ACT §4 the catalog
 * MUST NOT be duplicated in any other manually maintained
 * table — tests, expected values, and emitted qualification
 * artifacts all derive from here.
 *
 * Required invariant:
 *   LIFECYCLE_CORPUS_HAS_SINGLE_CONTRACT_AUTHORITY = TRUE
 *
 * Each scenario declares:
 *   - golden_predicates (test-side authority, hand-pinned)
 *   - expected_phase_e (precise Phase E projection state)
 *   - expected_lh02   (precise LH-02 metric predicates)
 *   - forbidden_outcomes (terminal / lifecycle MUST NOT)
 *
 * Golden predicates are NEVER derived by running the
 * production projector. See L05-M03.
 */
import type {
  LifecycleScenario,
  HarnessEligibility,
  ExpectedAdapterDisposition,
  ExpectedPhaseE,
  ExpectedLH02,
  ForbiddenOutcomes,
  GoldenPredicates,
  RawFixture,
} from "./types.js";

/* ====================================================================== *
 * Shared eligibility blocks                                               *
 * ====================================================================== */

const PI_ELIGIBLE: HarnessEligibility["pi"] = {
  eligible: true,
};
const CLINE_INELIGIBLE: HarnessEligibility["cline"] = {
  eligible: false,
  reason: "HALT_CLINE_NOT_INSTALLED",
};
const FAKE_REFERENCE_CONTROL: HarnessEligibility["fake_reference_control"] =
  {
    eligible: true,
  };
const FAKE_NOT_APPLICABLE: HarnessEligibility["fake_reference_control"] = {
  eligible: false,
  reason:
    "scenario exercises Pi-native wire vocabulary (compaction / meta events); the reference control adapter is script-only and cannot express these",
};

/* ====================================================================== *
 * Shared golden-predicate helper factories                                *
 * ====================================================================== */

function accepted(): ExpectedAdapterDisposition {
  return { kind: "ACCEPTED" };
}
function rejected(
  kind: "MALFORMED_NATIVE_EVENT" | "UNKNOWN_NATIVE_EVENT_KIND" | "EVIDENCE_CORRUPTION_DETECTED",
): ExpectedAdapterDisposition {
  return { kind: "REJECTED", expected_error_kind: kind };
}

function phaseE(args: {
  readonly lifecycle_state: "TERMINAL" | "INVALID_EVIDENCE" | "INCOMPLETE" | "ACTIVE";
  readonly terminal_outcome: string | null;
  readonly closure_authority_fresh?: boolean;
  readonly current_epoch_action_failure?: boolean;
  readonly current_epoch_review_failure?: boolean;
  readonly last_gate_pass?: boolean | null;
  readonly last_action_status?: "OK" | "ERROR" | null;
  readonly last_review_pass?: boolean | null;
  readonly action_failure_at_epoch?: number | null;
  readonly review_failure_at_epoch?: number | null;
}): ExpectedPhaseE {
  return {
    lifecycle_state: args.lifecycle_state,
    terminal_outcome: args.terminal_outcome,
    work_epoch_predicates: {
      closure_authority_fresh: args.closure_authority_fresh ?? false,
      current_epoch_action_failure:
        args.current_epoch_action_failure ?? false,
      current_epoch_review_failure:
        args.current_epoch_review_failure ?? false,
    },
    authority_predicates: {
      last_gate_pass: args.last_gate_pass ?? null,
      last_action_status: args.last_action_status ?? null,
      last_review_pass: args.last_review_pass ?? null,
    },
    negative_evidence_predicates: {
      action_failure_at_epoch: args.action_failure_at_epoch ?? null,
      review_failure_at_epoch: args.review_failure_at_epoch ?? null,
    },
  };
}

function lh02(args: {
  readonly terminal_outcome: string | null;
  readonly eligible_for_success_normalized_metrics: boolean | null;
  readonly historical_authority_invalidation_count?: number | null;
  readonly metric_evidence_failure_observed?: boolean;
}): ExpectedLH02 {
  return {
    metric_contract_version: "convergence.metric.contract.v1",
    terminal_outcome: args.terminal_outcome,
    eligible_for_success_normalized_metrics:
      args.eligible_for_success_normalized_metrics,
    historical_authority_invalidation_count:
      args.historical_authority_invalidation_count ?? null,
    metric_evidence_failure_observed:
      args.metric_evidence_failure_observed ?? false,
  };
}

function forbidden(args: {
  readonly terminal_outcome_in?: readonly string[];
  readonly lifecycle_state_in?: readonly string[];
  readonly success_normalized_metrics_emitted?: boolean;
  readonly custom?: readonly string[];
}): ForbiddenOutcomes {
  return {
    terminal_outcome_in: args.terminal_outcome_in ?? null,
    lifecycle_state_in: args.lifecycle_state_in ?? null,
    success_normalized_metrics_emitted:
      args.success_normalized_metrics_emitted ?? false,
    custom: args.custom ?? [],
  };
}

function golden(d: GoldenPredicates): GoldenPredicates {
  return d;
}

/* ====================================================================== *
 * LC01 — Canonical success                                                *
 * ====================================================================== */
function lc01(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  const raw: RawFixture[] = [
    {
      repo_relative_path:
        "lifecycle-corpus/fixtures/lc01-canonical-success/pi.session.jsonl",
      kind: "pi_native_session_jsonl",
      description: "Pi JSONL native session recording a canonical happy-path lifecycle.",
    },
    {
      repo_relative_path:
        "lifecycle-corpus/fixtures/lc01-canonical-success/fake.script.json",
      kind: "scripted_fake_event_script",
      description: "Reference-control script that emits the same lifecycle vocabulary as the Pi fixture.",
    },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc01-canonical-success/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
  ];
  return {
    id: "LC01",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Canonical success: action completes, gate passes, harness stops, terminal SUCCESS",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "run starts; harness starts; action starts; action completes successfully; gate runs; gate PASS; harness stops; authoritative SUCCESS terminal",
    preconditions: [
      "fresh Phase E evidence stream",
      "no prior negative execution / review evidence",
      "no prior work has invalidated the closure authority",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL", "HEADLESS"],
    raw_fixture_set: raw,
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "SUCCESS",
        closure_authority_fresh: true,
        current_epoch_action_failure: false,
        current_epoch_review_failure: false,
        last_gate_pass: true,
        last_action_status: "OK",
        last_review_pass: null,
        action_failure_at_epoch: null,
        review_failure_at_epoch: null,
      }),
      expected_lh02: lh02({
        terminal_outcome: "SUCCESS",
        eligible_for_success_normalized_metrics: true,
        historical_authority_invalidation_count: 0,
        metric_evidence_failure_observed: false,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: [
          "VALID_FAILURE",
          "HARNESS_FAILURE",
          "MODEL_FAILURE",
          "ENVIRONMENT_FAILURE",
          "TIMEOUT",
          "CANCELLED",
          "EVIDENCE_FAILURE",
          "BUDGET_EXHAUSTED",
        ],
        lifecycle_state_in: ["INVALID_EVIDENCE", "INCOMPLETE", "ACTIVE"],
        custom: [
          "GATE_FINISHED(pass=true) must exist exactly once",
          "ACTION_FINISHED(status=OK) must exist exactly once",
          "no ACTION_FINISHED(status=ERROR) permitted",
        ],
      }),
    }),
    required_invariants: [
      "HARNESS_DONE_AUTHORISES_SUCCESS_WITHOUT_GATE = FALSE",
      "CURRENT_NEGATIVE_EVIDENCE_BLOCKS_SUCCESS = TRUE (no negative evidence observed)",
      "POST_GATE_WORK_PRESERVES_OLD_AUTHORITY = FALSE (no post-gate work in canonical success)",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC02 — Premature harness "done"                                         *
 * ====================================================================== */
function lc02(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC02",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Premature harness done: candidate reports done, no authoritative gate",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "run starts; harness starts; candidate reports done / agent_end; NO GATE_FINISHED event ever arrives",
    preconditions: [
      "no gate has been observed",
      "no ACTION_FINISHED event has been observed",
      "the harness self-report is OBSERVATION only",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc02-premature-done/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL native session ending in agent_end without any gate evidence.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc02-premature-done/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script that emits only candidate_started + candidate_reported_completion.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc02-premature-done/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "INCOMPLETE",
        terminal_outcome: null,
        closure_authority_fresh: false,
        last_gate_pass: null,
        last_action_status: null,
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: null,
        metric_evidence_failure_observed: false,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        lifecycle_state_in: ["TERMINAL"],
        success_normalized_metrics_emitted: true,
        custom: [
          "adapter MUST NOT manufacture GATE_FINISHED(pass=true) to satisfy the harness self-report",
          "harness self-report is observation only",
        ],
      }),
    }),
    required_invariants: [
      "HARNESS_DONE_AUTHORISES_SUCCESS = FALSE",
      "MISSING_EVIDENCE != ZERO (success-normalized metrics unavailable)",
    ],
    omit_run_started: true,
  };
}

/* ====================================================================== *
 * LC03 — Gate FAIL + candidate done -> NOT SUCCESS                        *
 * ====================================================================== */
function lc03(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC03",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Gate failure followed by confident completion",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "action completes; gate FAIL; candidate reports task complete; SUCCESS claim follows",
    preconditions: [
      "exactly one ACTION_FINISHED(OK) observed",
      "exactly one GATE_FINISHED(pass=false) observed at the same work epoch",
      "no later work-epoch advance",
      "a RUN_FINISHED(SUCCESS) terminal claim is attempted",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc03-gate-fail-then-done/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL recording gate FAIL then a SUCCESS terminal claim.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc03-gate-fail-then-done/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script emitting gate_fail then candidate_reported_completion.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc03-gate-fail-then-done/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "INVALID_EVIDENCE",
        terminal_outcome: null,
        closure_authority_fresh: false,
        current_epoch_action_failure: false,
        last_gate_pass: false,
        last_action_status: "OK",
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: null,
        metric_evidence_failure_observed: true,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        lifecycle_state_in: ["TERMINAL"],
        success_normalized_metrics_emitted: true,
        custom: [
          "GATE_FAIL + HARNESS_DONE != SUCCESS",
        ],
      }),
    }),
    required_invariants: [
      "CURRENT_NEGATIVE_EVIDENCE_BLOCKS_SUCCESS = TRUE",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC04 — Ineffective repair                                               *
 * ====================================================================== */
function lc04(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC04",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Ineffective repair: repair without requalification is not SUCCESS",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "gate previously establishes authority; failure / work invalidates that authority; repair cycle executes; candidate claims fixed; NO fresh authoritative gate follows; SUCCESS is claimed",
    preconditions: [
      "an initial GATE_FINISHED(pass=true) has been observed",
      "a later ACTION_FINISHED or REPAIR_STARTED advances the work epoch",
      "a REPAIR_FINISHED closes the repair cycle without a fresh gate",
      "a SUCCESS terminal claim follows the repair",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc04-ineffective-repair/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL with initial pass gate, post-gate work, repair cycle, and unsupported SUCCESS claim.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc04-ineffective-repair/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script reproducing the same ineffective-repair narrative.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc04-ineffective-repair/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "INVALID_EVIDENCE",
        terminal_outcome: null,
        closure_authority_fresh: false,
        last_gate_pass: true,
        last_action_status: "OK",
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: null,
        historical_authority_invalidation_count: 1,
        metric_evidence_failure_observed: true,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        lifecycle_state_in: ["TERMINAL"],
        success_normalized_metrics_emitted: true,
        custom: [
          "REPAIR_WITHOUT_REQUALIFICATION != SUCCESS",
          "repair may close operational work scopes but MUST NOT recreate closure authority",
        ],
      }),
    }),
    required_invariants: [
      "REPAIR_WITHOUT_REQUALIFICATION_IS_SUCCESS = FALSE",
      "POST_GATE_WORK_PRESERVES_OLD_AUTHORITY = FALSE",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC05 — Malformed native output mid-run (adapter boundary rejection)    *
 * ====================================================================== */
function lc05(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_NOT_APPLICABLE,
  };
  return {
    id: "LC05",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Malformed native output mid-run",
    scenario_class: "ADAPTER_BOUNDARY_REJECTION",
    stimulus:
      "valid native events; malformed JSON / native record; more apparently valid events afterwards",
    preconditions: [
      "at least one well-formed event precedes the malformed record",
      "the malformed record is structurally invalid JSON or violates the closed-world key set",
      "additional valid records follow the malformed record",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc05-malformed-native/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL fixture containing one malformed JSON line in the middle of an otherwise valid stream.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc05-malformed-native/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Marker file only; reference control cannot simulate wire-level JSON corruption.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc05-malformed-native/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: rejected("MALFORMED_NATIVE_EVENT"),
      expected_phase_e: phaseE({
        lifecycle_state: "INCOMPLETE",
        terminal_outcome: null,
        closure_authority_fresh: false,
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: null,
        metric_evidence_failure_observed: true,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        lifecycle_state_in: ["TERMINAL"],
        custom: [
          "malformed event MUST NOT be silently skipped",
          "no terminal SUCCESS can be manufactured",
        ],
      }),
    }),
    required_invariants: [
      "ADAPTER_NORMALIZATION_INCOMPLETE_ON_MALFORMED_EVENT = TRUE",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC06 — Context pressure / compaction                                    *
 * ====================================================================== */
function lc06(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_NOT_APPLICABLE,
  };
  return {
    id: "LC06",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Context pressure / compaction events do not change authority",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "agent running; multiple message/tool updates; queue pressure; compaction_start; compaction_end; work continues; external gate eventually PASS; SUCCESS",
    preconditions: [
      "high-volume native message_update and queue_update meta events are present",
      "compaction_start / compaction_end session events bracket a context-pressure window",
      "no tool call overlaps the compaction window",
      "a real GATE_FINISHED(pass=true) closes the run",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc06-context-pressure/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL with queue_update, compaction_start, compaction_end, message_update events and a passing gate.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc06-context-pressure/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Marker file only; reference control cannot emit meta events.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc06-context-pressure/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "SUCCESS",
        closure_authority_fresh: true,
        last_gate_pass: true,
        last_action_status: "OK",
      }),
      expected_lh02: lh02({
        terminal_outcome: "SUCCESS",
        eligible_for_success_normalized_metrics: true,
        historical_authority_invalidation_count: 0,
      }),
      forbidden_outcomes: forbidden({
        custom: [
          "MESSAGE_UPDATE_COUNT != ACTION_COUNT",
          "COMPACTION_EVENT != REPAIR",
          "QUEUE_UPDATE != FACTORY_WORK",
        ],
      }),
    }),
    required_invariants: [
      "CONTEXT_PRESSURE_CHANGES_AUTHORITY = FALSE",
      "compaction does not create or close an ACTION",
      "compaction does not create gate authority",
      "compaction does not terminate the run",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC07 — Restart / recovery                                               *
 * ====================================================================== */
function lc07(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC07",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Restart / recovery: two execution segments bound to one logical lifecycle",
    scenario_class: "RECOVERY_LIFECYCLE",
    stimulus:
      "process boundary is interrupted and resumed; segment A then segment B share a logical run; later an external gate passes and SUCCESS is reached",
    preconditions: [
      "two execution-capture segments bind to one logical lifecycle",
      "logical SubjectId unchanged across segments",
      "logical RunId rules remain satisfied",
      "event sequence remains monotonic across the segment boundary",
      "no duplicate committed event ids across the boundary",
      "no evidence silently discarded at the segment boundary",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-A.jsonl",
        kind: "pi_native_session_jsonl",
        description: "First execution capture segment of a restarted Pi run.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-B.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Second execution capture segment of the restarted Pi run.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc07-restart-recovery/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script representing the unified lifecycle narrative.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc07-restart-recovery/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "SUCCESS",
        closure_authority_fresh: true,
        last_gate_pass: true,
        last_action_status: "OK",
      }),
      expected_lh02: lh02({
        terminal_outcome: "SUCCESS",
        eligible_for_success_normalized_metrics: true,
        historical_authority_invalidation_count: 0,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: [
          "VALID_FAILURE",
          "HARNESS_FAILURE",
          "MODEL_FAILURE",
          "ENVIRONMENT_FAILURE",
          "TIMEOUT",
          "CANCELLED",
          "EVIDENCE_FAILURE",
          "BUDGET_EXHAUSTED",
        ],
        lifecycle_state_in: ["INVALID_EVIDENCE", "INCOMPLETE", "ACTIVE"],
      }),
    }),
    required_invariants: [
      "PROCESS_RESTART != NEW_FACTORY_RUN",
      "SEGMENT_CONCATENATION_WITHOUT_EXPLICIT_BINDING = IMPOSSIBLE",
      "recovery may succeed only after normal Phase E authority is re-established",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC08 — Cancellation: RUN_CANCEL_REQUESTED is non-terminal               *
 * ====================================================================== */
function lc08(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC08",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Interruption / cancellation: request is non-terminal, abort is terminal",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "work active; RUN_CANCEL_REQUESTED; ordinary observations may still arrive; true abort/cancel terminal eventually arrives",
    preconditions: [
      "exactly one RUN_CANCEL_REQUESTED event observed",
      "subsequent observations may include ACTION_FINISHED or other activity",
      "a later RUN_ABORTED(CANCELLED) closes the run",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc08-cancel-request/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL with RUN_CANCEL_REQUESTED followed by a final RUN_ABORTED(CANCELLED).",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc08-cancel-request/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script representing the cancel-request + abort narrative.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc08-cancel-request/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "CANCELLED",
        closure_authority_fresh: false,
      }),
      expected_lh02: lh02({
        terminal_outcome: "CANCELLED",
        eligible_for_success_normalized_metrics: false,
        metric_evidence_failure_observed: false,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS", "VALID_FAILURE"],
        custom: [
          "RUN_CANCEL_REQUESTED is non-terminal; projection after cancel-request alone MUST be ACTIVE / nonterminal",
        ],
      }),
    }),
    required_invariants: [
      "CANCEL_REQUEST_IS_TERMINAL = FALSE",
      "no inferred cancellation from signal/exit code alone",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC09 — Dependency failure                                               *
 * ====================================================================== */
function lc09(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC09",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Dependency failure: terminal SUCCESS is impossible without recovery",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "action invokes required dependency; dependency unavailable; ACTION_FINISHED(ERROR); candidate reports inability / completion; no successful recovery",
    preconditions: [
      "an ACTION_FINISHED(ERROR) at the current work epoch",
      "no subsequent ACTION_STARTED / REPAIR_STARTED at a new work epoch",
      "no successful gate PASS at the current epoch",
      "the run terminates without requalification",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc09-dependency-failure/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL with dependency invocation, ACTION_FINISHED(ERROR), and no recovery.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc09-dependency-failure/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script reproducing the dependency-failure narrative.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc09-dependency-failure/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "HARNESS_FAILURE",
        closure_authority_fresh: false,
        current_epoch_action_failure: true,
        last_action_status: "ERROR",
        action_failure_at_epoch: 2,
      }),
      expected_lh02: lh02({
        terminal_outcome: "HARNESS_FAILURE",
        eligible_for_success_normalized_metrics: false,
        metric_evidence_failure_observed: false,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        custom: [
          "historical negative evidence MUST remain visible (action_failure_at_epoch NOT null)",
        ],
      }),
    }),
    required_invariants: [
      "FAILED_REVIEW_OR_FAILURE_CAN_BE_HISTORICAL = TRUE (visible after terminal)",
      "CURRENT_NEGATIVE_EVIDENCE_BLOCKS_SUCCESS = TRUE",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * LC10 — Destructive attempt denied (lifecycle / policy evidence)         *
 * ====================================================================== */
function lc10(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC10",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Destructive attempt denied: policy denial is visible lifecycle evidence",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "candidate/tool attempts a prohibited destructive action; lab-controlled policy denies execution; host sentinel remains unchanged; candidate continues or stops",
    preconditions: [
      "a host sentinel file (DO_NOT_CHANGE.txt) is hashed before and after the attempt",
      "the harness emits a tool_started then a candidate_error / denied event",
      "the candidate does not authoritatively complete work",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL with a denied destructive attempt; host sentinel unchanged.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/sentinel.before.txt",
        kind: "host_sentinel_text",
        description: "Host sentinel content before the attempt (used to prove no mutation).",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/sentinel.after.txt",
        kind: "host_sentinel_text",
        description: "Host sentinel content after the attempt (must equal the before content).",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script representing the denied destructive attempt.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "INCOMPLETE",
        terminal_outcome: null,
        closure_authority_fresh: false,
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: null,
        metric_evidence_failure_observed: false,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        lifecycle_state_in: ["TERMINAL"],
        custom: [
          "DESTRUCTIVE_ATTEMPT_EXECUTED = FALSE",
          "HOST_SENTINEL_MUTATED = FALSE",
          "POLICY_DENIAL_VISIBLE = TRUE",
        ],
      }),
    }),
    required_invariants: [
      "DESTRUCTIVE_ATTEMPT_EXECUTED = FALSE",
      "HOST_SENTINEL_MUTATED = FALSE",
      "before_hash == after_hash",
    ],
    omit_run_started: true,
  };
}

/* ====================================================================== *
 * LC11 — Evidence corruption handoff to LH-04                              *
 * ====================================================================== */
function lc11(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_NOT_APPLICABLE,
  };
  return {
    id: "LC11",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Evidence corruption handoff to LH-04 frozen verifier",
    scenario_class: "FAULT_LAB_HANDOFF",
    stimulus:
      "canonical raw lifecycle fixture; exactly one already-frozen LH-04 corruption primitive (F01 byte drift without rebinding) is applied at its boundary; LH-04 frozen verifier rejects the evidence",
    preconditions: [
      "a canonical raw lifecycle fixture is selected",
      "exactly one frozen LH-04 fault primitive is applied",
      "the LH-04 frozen verifier MUST reject the mutated evidence",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc11-evidence-corruption-handoff/pi.session.canonical.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Canonical Pi JSONL lifecycle fixture used as the corruption handoff subject.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc11-evidence-corruption-handoff/lh04_fault_id.txt",
        kind: "corruption_handoff_fixture",
        description: "Marker file declaring which frozen LH-04 fault primitive is applied (F01).",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc11-evidence-corruption-handoff/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Marker file only; reference control cannot drive LH-04 fault primitives.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc11-evidence-corruption-handoff/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: rejected("EVIDENCE_CORRUPTION_DETECTED"),
      expected_phase_e: phaseE({
        lifecycle_state: "INCOMPLETE",
        terminal_outcome: null,
        closure_authority_fresh: false,
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: null,
        metric_evidence_failure_observed: true,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        lifecycle_state_in: ["TERMINAL"],
        custom: [
          "LH05 does not interpret untrustworthy evidence",
          "CORRUPT_EVIDENCE != FAILED_TASK",
          "handoff_phase = LH04",
          "expected_error_kind = EVIDENCE_HASH_MISMATCH",
          "no new fault F18 is introduced",
        ],
      }),
    }),
    required_invariants: [
      "LH05_DOES_NOT_INTERPRET_UNTRUSTWORTHY_EVIDENCE = TRUE",
      "corrupt evidence MUST NOT become a lifecycle result",
    ],
    omit_run_started: true,
    fault_lab_handoff: {
      fault_id: "lc11-f01-byte-drift",
      fault_klass: "F01_byte_drift",
    },
  };
}

/* ====================================================================== *
 * LC12 — Terminal disagreement: Phase E wins                              *
 * ====================================================================== */
function lc12(): LifecycleScenario {
  const elig: HarnessEligibility = {
    pi: PI_ELIGIBLE,
    cline: CLINE_INELIGIBLE,
    fake_reference_control: FAKE_REFERENCE_CONTROL,
  };
  return {
    id: "LC12",
    version: LIFECYCLE_CORPUS_CONTRACT_VERSION,
    title: "Terminal disagreement: harness self-report and process exit disagree with Phase E",
    scenario_class: "VALID_ADVERSARIAL_LIFECYCLE",
    stimulus:
      "agent_end says done; process exits 0; external gate FAIL; Phase E terminal evidence disagrees",
    preconditions: [
      "harness self-report observation is present",
      "process exit observation is present (exit=0)",
      "external authoritative gate FAIL closes the run",
      "Phase E terminal evidence derives from the gate",
    ],
    eligible_harnesses: elig,
    required_capabilities: ["JSONL"],
    raw_fixture_set: [
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc12-terminal-disagreement/pi.session.jsonl",
        kind: "pi_native_session_jsonl",
        description: "Pi JSONL exhibiting terminal disagreement: agent_end + process exit 0 + gate FAIL.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc12-terminal-disagreement/fake.script.json",
        kind: "scripted_fake_event_script",
        description: "Reference-control script reproducing the disagreement narrative.",
      },
      {
        repo_relative_path:
          "lifecycle-corpus/fixtures/lc12-terminal-disagreement/phase_e_oracle.json",
        kind: "phase_e_oracle_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "VALID_FAILURE",
        closure_authority_fresh: false,
        last_gate_pass: false,
        last_action_status: "OK",
      }),
      expected_lh02: lh02({
        terminal_outcome: "VALID_FAILURE",
        eligible_for_success_normalized_metrics: false,
        metric_evidence_failure_observed: false,
      }),
      forbidden_outcomes: forbidden({
        terminal_outcome_in: ["SUCCESS"],
        custom: [
          "PHASE_E_TERMINAL_AUTHORITY > HARNESS_SELF_REPORT > PROCESS_EXIT_OBSERVATION",
          "LH-02 MUST inherit the Phase E terminal result and MUST NOT replace it with harness-native completion",
        ],
      }),
    }),
    required_invariants: [
      "PROCESS_EXIT_0_AUTHORISES_SUCCESS = FALSE",
      "HARNESS_DONE_AUTHORISES_SUCCESS = FALSE",
      "Phase E projector owns terminal outcome",
    ],
    omit_run_started: false,
  };
}

/* ====================================================================== *
 * Catalog assembly                                                        *
 * ====================================================================== */

/** Re-export for callers that want the contract version without importing types.ts */
import { LIFECYCLE_CORPUS_CONTRACT_VERSION } from "./types.js";

export const LIFECYCLE_CORPUS_CATALOG: readonly LifecycleScenario[] =
  Object.freeze([
    lc01(),
    lc02(),
    lc03(),
    lc04(),
    lc05(),
    lc06(),
    lc07(),
    lc08(),
    lc09(),
    lc10(),
    lc11(),
    lc12(),
  ]);

export function findScenario(id: string): LifecycleScenario | undefined {
  return LIFECYCLE_CORPUS_CATALOG.find((s) => s.id === id);
}
