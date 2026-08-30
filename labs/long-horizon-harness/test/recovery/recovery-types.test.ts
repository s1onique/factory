import { test } from "node:test";
import assert from "node:assert/strict";
import { projectExecution } from "../../src/recovery/process-recovery-projector.js";
import { makeProcessId } from "../../src/process/process-types.js";
import type { EvidenceStream } from "../../src/recovery/recovery-types.js";
import type { PersistedProcessEvidencePayload } from "../../src/evidence/codec-types.js";

const PID = makeProcessId("p-test");

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
    streamOf([{ kind: "process_spawn_requested", process_id: PID }]),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.kind, "spawn_outcome_unknown");
});

test("RPL03 spawned no result -> in_flight_at_crash", () => {
  const r = projectExecution(
    streamOf([
      { kind: "process_spawn_requested", process_id: PID },
      { kind: "process_spawned", process_id: PID, pid: 7, pgid: 7 },
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
      { kind: "process_spawn_requested", process_id: PID },
      { kind: "process_spawned", process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_close_observed", process_id: PID, exit_code: 0, signal: null },
      { kind: "process_result_committed", process_id: PID, result: { outcome_kind: "exited", exit_code: 0 } },
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
      { kind: "process_spawn_requested", process_id: PID },
      { kind: "process_spawned", process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_spawned", process_id: PID, pid: 2, pgid: 2 },
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
      { kind: "process_spawn_requested", process_id: PID },
      { kind: "process_spawned", process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_spawn_requested", process_id: PID2 },
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
      { kind: "process_spawn_requested", process_id: PID },
      { kind: "process_spawned", process_id: PID, pid: 1, pgid: 1 },
      { kind: "process_group_probe", process_id: PID, probe: { probe_kind: "absent" } },
      { kind: "process_close_observed", process_id: PID, exit_code: 0, signal: null },
    ]),
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "result_unknown_after_cleanup");
  } else {
    assert.fail("expected result_unknown_after_cleanup");
  }
});
