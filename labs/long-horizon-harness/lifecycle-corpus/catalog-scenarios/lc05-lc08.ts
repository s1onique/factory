/**
 * LH-05 catalog scenarios (split for source-size discipline).
 *
 * L05-C08: parent catalog.ts is the SINGLE logical authority.
 */
import type {
  HarnessEligibility,
  LifecycleScenario,
} from "../types.js";
import { LIFECYCLE_CORPUS_CONTRACT_VERSION } from "../types.js";
import {
  CLINE_INELIGIBLE,
  FAKE_NOT_APPLICABLE,
  FAKE_REFERENCE_CONTROL,
  PI_ELIGIBLE,
  accepted,
  forbidden,
  golden,
  lh02,
  phaseE,
  rejected,
} from "./helpers.js";


export function lc05(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc05-malformed-native/factory_external_events.json",
        kind: "factory_external_events_json",
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
        eligible_for_success_normalized_metrics: false,
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

export function lc06(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc06-context-pressure/factory_external_events.json",
        kind: "factory_external_events_json",
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

export function lc07(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc07-restart-recovery/factory_external_events.json",
        kind: "factory_external_events_json",
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
    // L05-C10: closed-world ordered segment declaration.
    //
    // Segment A is the cold-start segment; it owns the
    // native `session` header that pins the shared session
    // identity for the whole chain. Segment B is a
    // continuation: it does NOT carry its own native
    // session header (and MUST NOT supply a conflicting
    // one if it does); it MUST declare segment A as its
    // predecessor.
    //
    // Both segments share a single capture_id and
    // shared_session_id. The runner validates the chain
    // (predecessor, ordinal, capture_id, shared_session_id)
    // BEFORE invoking the loader.
    //
    // The `shared_session_id` below MUST equal the
    // `id` field of the native `session` header in
    // segment-A.jsonl. This is enforced mechanically by
    // the loader (L05-C10) and the
    // `lc07_segment_binding_session_id` test.
    segments: [
      {
        capture_id: "lc07-capture-001",
        segment_id: "A",
        ordinal: 0,
        shared_session_id:
          "lc05-fixed-session-id-fixed-session-id-fixed-session-id-fixed",
        previous_segment_id: null,
        fixture_path:
          "lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-A.jsonl",
      },
      {
        capture_id: "lc07-capture-001",
        segment_id: "B",
        ordinal: 1,
        shared_session_id:
          "lc05-fixed-session-id-fixed-session-id-fixed-session-id-fixed",
        previous_segment_id: "A",
        fixture_path:
          "lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-B.jsonl",
      },
    ],
  };
}

export function lc08(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc08-cancel-request/factory_external_events.json",
        kind: "factory_external_events_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "TERMINAL",
        terminal_outcome: "CANCELLED",
        // L05-C01 fallout: the harness mapper is now the
        // SOLE authority for ACTION_*/RUN_* events and
        // emits a fresh, authoritative GATE_FINISHED
        // before RUN_ABORTED in this scenario, so
        // closure_authority_fresh is true and last_gate_pass
        // records the true result of that fresh gate.
        closure_authority_fresh: true,
        last_gate_pass: true,
        last_action_status: "OK",
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
