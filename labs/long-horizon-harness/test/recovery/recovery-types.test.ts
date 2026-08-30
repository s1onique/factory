/**
 * RPL01..RPL14 — pure recovery projector tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectExecution } from "../../src/recovery/process-recovery-projector.js";
import { makeProcessId } from "../../src/process/process-types.js";
import { makeAttemptId } from "../../src/domain/ids.js";
import type { EvidenceStream } from "../../src/recovery/recovery-types.js";
import type { PersistedProcessEvidencePayload } from "../../src/evidence/codec-types.js";

const PID = makeProcessId("p-test");
const AID = makeAttemptId("a-test");

function ev(p: PersistedProcessEvidencePayload, seq: number) {
  return { payload: p, seq, observedAt: 1000 + seq };
}

function streamOf(
  ps: ReadonlyArray<PersistedProcessEvidencePayload>,
): EvidenceStream {
  return ps.map((p, i) => ev(p, i + 1));
}

test("RPL01 empty -> not_started", () => {
  const r = projectExecution(streamOf([]));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "not_started");
});

test("RPL02 spawn_requested alone -> spawn_outcome_unknown", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "spawn_outcome_unknown");
});

test("RPL03 spawned no result -> in_flight_at_crash", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 7, pgid: 7 },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok && r.value.kind === "in_flight_at_crash") {
    assert.equal(r.value.phase, "running");
    assert.equal(r.value.pid, 7);
  } else {
    assert.fail("expected in_flight_at_crash");
  }
});

test("RPL04 result_committed -> settled", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "exited", exit_code: 0 } },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok && r.value.kind === "settled") {
    assert.equal(r.value.result.outcome_kind, "exited");
  } else {
    assert.fail("expected settled");
  }
});

test("RPL05 duplicate process_spawned -> inconsistent_history", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 2, pgid: 2 },
    ]),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.kind, "inconsistent_history");
  }
});

test("RPL06 mixed ProcessIds -> mixed_process_identity", () => {
  const PID2 = makeProcessId("p-other");
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID2 },
    ]),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.kind, "mixed_process_identity");
  }
});

test("RPL07 group absent + close -> result_unknown_after_cleanup", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_group_probe", attempt_id: AID, process_id: PID, probe: { probe_kind: "absent" } },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "result_unknown_after_cleanup");
  } else {
    assert.fail("expected result_unknown_after_cleanup");
  }
});

test("RPL11 spawn_failed observed without result_commit -> spawn_failure_observed", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawn_failed", attempt_id: AID, process_id: PID, failure: { kind: "spawn_failure", message: "no entry" } },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "spawn_failure_observed");
  } else {
    assert.fail("expected spawn_failure_observed");
  }
});

test("RPL12 TERM EPERM result does NOT promote to term_sent", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 7, pgid: 7 },
      { kind: "process_signal_attempted", attempt_id: AID, process_id: PID, signal: "SIGTERM" },
      { kind: "process_signal_result", attempt_id: AID, process_id: PID, signal: "SIGTERM", result: { result_kind: "permission_denied" } },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok && r.value.kind === "in_flight_at_crash") {
    assert.equal(r.value.phase, "term_requested");
  } else {
    assert.fail("expected in_flight_at_crash with term_requested phase");
  }
});

test("RPL13 result_committed(spawn_failed) requires spawn_failure_observed", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "spawn_failed", failure: { kind: "spawn_failure", message: "x" } } },
    ]),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.kind, "inconsistent_history");
  }
});

test("RPL14 impossible result history: result_committed(deadline) without deadline evidence -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "deadline", escalation: { term_requested: false, term_sent: false, term_result: null, kill_requested: false, kill_sent: false, kill_result: null, final_group_probe: { probe_kind: "absent" } } } },
    ]),
  );
  // CORRECTION03 §7 (RPL14): a deadline outcome WITHOUT a
  // preceding process_deadline_reached evidence MUST be
  // rejected as inconsistent_history. The previous acceptance
  // was a doctrine violation.
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "inconsistent_history");
});

test("RPL14b deadline result WITH deadline_reached evidence -> accept", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_deadline_reached", attempt_id: AID, process_id: PID },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "deadline", escalation: { term_requested: true, term_sent: false, term_result: null, kill_requested: true, kill_sent: true, kill_result: { result_kind: "sent", signal: "SIGKILL" }, final_group_probe: { probe_kind: "absent" } } } },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "settled");
});

test("RPL15 cancelled without cancel evidence -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "cancelled", escalation: { term_requested: true, term_sent: true, term_result: { result_kind: "sent", signal: "SIGTERM" }, kill_requested: true, kill_sent: true, kill_result: { result_kind: "sent", signal: "SIGKILL" }, final_group_probe: { probe_kind: "absent" } } } },
    ]),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "inconsistent_history");
});

test("RPL15b cancelled WITH cancel_requested evidence -> accept", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_cancel_requested", attempt_id: AID, process_id: PID },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "cancelled", escalation: { term_requested: true, term_sent: true, term_result: { result_kind: "sent", signal: "SIGTERM" }, kill_requested: true, kill_sent: true, kill_result: { result_kind: "sent", signal: "SIGKILL" }, final_group_probe: { probe_kind: "absent" } } } },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "settled");
});

test("RPL16 close0 + exited0 -> accept", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "exited", exit_code: 0 } },
    ]),
  );
  assert.equal(r.ok, true);
});

test("RPL17 close0 + exited42 -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "exited", exit_code: 42 } },
    ]),
  );
  assert.equal(r.ok, false);
});

test("RPL18 closeSIGTERM + exited0 -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: null, signal: "SIGTERM" },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "exited", exit_code: 0 } },
    ]),
  );
  assert.equal(r.ok, false);
});

test("RPL19 closeSIGKILL + signaledSIGKILL -> accept", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: null, signal: "SIGKILL" },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "signaled", signal: "SIGKILL", exit_code: null } },
    ]),
  );
  assert.equal(r.ok, true);
});

test("RPL20 closeSIGKILL + signaledSIGTERM -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: null, signal: "SIGKILL" },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "signaled", signal: "SIGTERM", exit_code: null } },
    ]),
  );
  assert.equal(r.ok, false);
});

test("RPL21 close0 + signaledSIGTERM -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "signaled", signal: "SIGTERM", exit_code: null } },
    ]),
  );
  assert.equal(r.ok, false);
});

test("RPL22 closeSIGTERM + exited -> reject", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", attempt_id: AID, process_id: PID },
      { kind: "process_spawned", attempt_id: AID, process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", attempt_id: AID, process_id: PID, exit_code: null, signal: "SIGTERM" },
      { kind: "process_result_committed", attempt_id: AID, process_id: PID, result: { outcome_kind: "exited", exit_code: 0 } },
    ]),
  );
  assert.equal(r.ok, false);
});



test("ATT01 Attempt A + Process P then Attempt B + Process P -> reject mixed_attempt_identity", () => {
  const r = projectExecution([
    {
      payload: { kind: "process_spawn_requested", attempt_id: makeAttemptId("a-A"), process_id: PID },
      seq: 1, observedAt: 1000,
    },
    {
      payload: {
        kind: "process_spawned",
        attempt_id: makeAttemptId("a-A"),
        process_id: PID,
        pid: 7,
        pgid: 7,
      },
      seq: 2, observedAt: 1001,
    },
    {
      payload: { kind: "process_spawn_requested", attempt_id: makeAttemptId("a-B"), process_id: PID },
      seq: 3, observedAt: 1002,
    },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "mixed_attempt_identity");
});

test("ATT02 Attempt A + P then Attempt A + Q -> reject mixed_process_identity", () => {
  const r = projectExecution([
    {
      payload: { kind: "process_spawn_requested", attempt_id: makeAttemptId("a-A"), process_id: makeProcessId("p-1") },
      seq: 1, observedAt: 1000,
    },
    {
      payload: { kind: "process_spawn_requested", attempt_id: makeAttemptId("a-A"), process_id: makeProcessId("p-2") },
      seq: 2, observedAt: 1001,
    },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "mixed_process_identity");
});

test("ATT03 identical AttemptId+ProcessId stream -> accept", () => {
  const r = projectExecution([
    {
      payload: { kind: "process_spawn_requested", attempt_id: makeAttemptId("a-A"), process_id: PID },
      seq: 1, observedAt: 1000,
    },
    {
      payload: {
        kind: "process_spawned",
        attempt_id: makeAttemptId("a-A"),
        process_id: PID,
        pid: 7,
        pgid: 7,
      },
      seq: 2, observedAt: 1001,
    },
    {
      payload: { kind: "process_deadline_reached", attempt_id: makeAttemptId("a-A"), process_id: PID },
      seq: 3, observedAt: 1002,
    },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "in_flight_at_crash");
});
