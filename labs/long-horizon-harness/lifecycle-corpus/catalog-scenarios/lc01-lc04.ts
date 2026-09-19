/**
 * LH-05 catalog scenarios (split for source-size discipline).
 *
 * L05-C08: parent catalog.ts is the SINGLE logical authority.
 */
import type {
  HarnessEligibility,
  LifecycleScenario,
  RawFixture,
} from "../types.js";
import { LIFECYCLE_CORPUS_CONTRACT_VERSION } from "../types.js";
import {
  CLINE_INELIGIBLE,
  FAKE_REFERENCE_CONTROL,
  PI_ELIGIBLE,
  accepted,
  forbidden,
  golden,
  lh02,
  phaseE,
} from "./helpers.js";


export function lc01(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc01-canonical-success/factory_external_events.json",
        kind: "factory_external_events_json",
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

export function lc02(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc02-premature-done/factory_external_events.json",
        kind: "factory_external_events_json",
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
        eligible_for_success_normalized_metrics: false,
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

export function lc03(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc03-gate-fail-then-done/factory_external_events.json",
        kind: "factory_external_events_json",
        description: "Phase E reference oracle: hand-pinned gate / terminal Phase E events closing the run.",
      }
    ],
    golden_predicates: golden({
      expected_adapter_disposition: accepted(),
      expected_phase_e: phaseE({
        lifecycle_state: "INVALID_EVIDENCE",
        terminal_outcome: null,
        closure_authority_fresh: false,
        current_epoch_action_failure: true,
        last_gate_pass: false,
        last_action_status: "ERROR",
        action_failure_at_epoch: 2,
      }),
      expected_lh02: lh02({
        terminal_outcome: null,
        eligible_for_success_normalized_metrics: false,
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

export function lc04(): LifecycleScenario {
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
          "lifecycle-corpus/fixtures/lc04-ineffective-repair/factory_external_events.json",
        kind: "factory_external_events_json",
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
        eligible_for_success_normalized_metrics: false,
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
