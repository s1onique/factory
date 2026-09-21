/**
 * LH-06 supervisor tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *   - heartbeat-driven watchdog
 *   - SOAK_HANG on missing heartbeats
 *   - terminal result on every path
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import {
  createSupervisorState,
  recordHeartbeat,
  checkHang,
  checkQualificationDeadline,
  buildHangFailure,
  persistFailurePacket,
  LH06_HEARTBEAT_TIMEOUT_MS,
} from "../../soak/supervisor.js";

test("LH-06 supervisor: default heartbeat timeout is 60 s", () => {
  assert.equal(LH06_HEARTBEAT_TIMEOUT_MS, 60_000);
});

test("LH-06 supervisor: fresh state has not received any heartbeats", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 12345,
    started_at_ms: 1_000_000,
  });
  assert.equal(s.lastEpoch, -1);
  assert.equal(s.completedRuns, 0);
  assert.equal(s.workerHangFlagged, false);
});

test("LH-06 supervisor: recordHeartbeat advances lastEpoch on each new epoch", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 1,
    started_at_ms: 0,
    heartbeat_timeout_ms: 1000,
  });
  assert.equal(recordHeartbeat(s, { epoch: 5, completed_runs: 100 }, 100), true);
  assert.equal(recordHeartbeat(s, { epoch: 5, completed_runs: 100 }, 200), false);
  assert.equal(recordHeartbeat(s, { epoch: 6, completed_runs: 200 }, 300), true);
  assert.equal(s.lastEpoch, 6);
});

test("LH-06 supervisor: checkHang flags hang after timeout", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 1,
    started_at_ms: 0,
    heartbeat_timeout_ms: 100,
  });
  recordHeartbeat(s, { epoch: 0, completed_runs: 0 }, 0);
  // At t=50 — no hang
  assert.equal(checkHang({ state: s, now_ms: 50 }).hang, false);
  // At t=200 — hang (timeout = 100)
  const r = checkHang({ state: s, now_ms: 200 });
  assert.equal(r.hang, true);
});

test("LH-06 supervisor: checkHang is idempotent (does not flag twice)", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 1,
    started_at_ms: 0,
    heartbeat_timeout_ms: 100,
  });
  recordHeartbeat(s, { epoch: 0, completed_runs: 0 }, 0);
  // The first call sets workerHangFlagged.
  checkHang({ state: s, now_ms: 200 });
  assert.equal(s.workerHangFlagged, true);
  // Subsequent calls return hang=true with reason "already flagged".
  const r = checkHang({ state: s, now_ms: 300 });
  assert.equal(r.hang, true);
  assert.equal(r.reason, "already flagged");
});

test("LH-06 supervisor: checkQualificationDeadline detects overshoot", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 1,
    started_at_ms: 0,
    qualification_deadline_ms: 100,
  });
  assert.equal(
    checkQualificationDeadline({ state: s, now_ms: 50 }).deadline_hit,
    false,
  );
  assert.equal(
    checkQualificationDeadline({ state: s, now_ms: 200 }).deadline_hit,
    true,
  );
});

test("LH-06 supervisor: buildHangFailure records heartbeat timing", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 1,
    started_at_ms: 0,
    heartbeat_timeout_ms: 100,
  });
  recordHeartbeat(s, { epoch: 3, completed_runs: 10 }, 0);
  const f = buildHangFailure({ state: s, now_ms: 1000 });
  assert.equal(f.kind, "WORKER_HANG");
  assert.equal(f.epoch, 3);
  assert.equal(
    (f.minimal_diff as Record<string, number>)["heartbeat_timeout_ms"],
    100,
  );
});

test("LH-06 supervisor: persistFailurePacket writes a bounded JSON file", () => {
  const s = createSupervisorState({
    profile: "CI_SMOKE",
    workerPid: 99,
    started_at_ms: 0,
    heartbeat_timeout_ms: 100,
  });
  recordHeartbeat(s, { epoch: 1, completed_runs: 10 }, 50);
  const packetPath = `/tmp/factory-lh06-test/failure-${Date.now()}.json`;
  persistFailurePacket({
    packet_path: packetPath,
    state: s,
    failure: {
      kind: "WORKER_HANG",
      epoch: 1,
      last_completed_case: "F01",
      minimal_diff: { x: 1 },
      message: "test",
    },
    last_telemetry: [],
    env: {
      os: "linux/x64",
      arch: "x64",
      node_version: "v20.0.0",
      cpu_count: 1,
      total_memory_bytes: 0,
      contract_version: "lh06.soak.contract.v1",
      profile: "CI_SMOKE",
      soak_run_id: "test",
    },
    result: null,
  });
  assert.equal(existsSync(packetPath), true);
  rmSync(`/tmp/factory-lh06-test`, { recursive: true, force: true });
});
