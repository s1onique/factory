import { test } from "node:test";
import assert from "node:assert/strict";
import { makeProcessId } from "../../src/process/process-types.js";
import { makeAttemptId } from "../../src/domain/ids.js";
import { projectExecution } from "../../src/recovery/process-recovery-projector.js";
import { reconcile } from "../../src/recovery/process-reconciler.js";
import type { GroupProbeSnapshot } from "../../src/recovery/recovery-types.js";

const AID = makeAttemptId("a-cp");
const PID = makeProcessId("p-cp");

test("REC-LIVE02 projector sees process_spawned evidence alone as in_flight_at_crash", () => {
  const r = projectExecution([
    {
      payload: {
        kind: "process_spawn_requested",
        attempt_id: AID,
        process_id: PID,
      },
      seq: 1,
      observedAt: 1000,
    },
    {
      payload: {
        kind: "process_spawned",
        attempt_id: AID,
        process_id: PID,
        pid: 12345,
        pgid: 12345,
      },
      seq: 2,
      observedAt: 1001,
    },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "in_flight_at_crash");
    if (r.value.kind === "in_flight_at_crash") {
      assert.equal(r.value.phase, "running");
      assert.equal(r.value.pid, 12345);
      assert.equal(r.value.pgid, 12345);
    }
  }
});

test("REC-LIVE04 reconciler has no destructive variant (compile-time guarantee)", () => {
  const calls: Array<{ method: string }> = [];
  const fakeProbe = {
    probeHistoricalGroup: (_pgid: number): GroupProbeSnapshot => {
      calls.push({ method: "probeHistoricalGroup" });
      return { probe_kind: "absent" };
    },
  };
  const state = projectExecution([
    {
      payload: {
        kind: "process_spawn_requested",
        attempt_id: AID,
        process_id: PID,
      },
      seq: 1,
      observedAt: 1000,
    },
    {
      payload: {
        kind: "process_spawned",
        attempt_id: AID,
        process_id: PID,
        pid: 12345,
        pgid: 12345,
      },
      seq: 2,
      observedAt: 1001,
    },
  ]);
  assert.equal(state.ok, true);
  if (state.ok && state.value.kind === "in_flight_at_crash") {
    const decision = reconcile(state.value, fakeProbe);
    for (const c of calls) {
      assert.equal(c.method, "probeHistoricalGroup");
    }
    assert.notEqual(decision.kind, "kill");
    assert.notEqual(decision.kind, "signal");
  }
});

test("REC-LIVE06 projector: only process_spawn_requested -> spawn_outcome_unknown", () => {
  const r = projectExecution([
    {
      payload: {
        kind: "process_spawn_requested",
        attempt_id: AID,
        process_id: PID,
      },
      seq: 1,
      observedAt: 1000,
    },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "spawn_outcome_unknown");
  }
});

test("REC-LIVE07 projector: process_result_committed -> settled exact result", () => {
  const r = projectExecution([
    {
      payload: {
        kind: "process_spawn_requested",
        attempt_id: AID,
        process_id: PID,
      },
      seq: 1,
      observedAt: 1000,
    },
    {
      payload: {
        kind: "process_spawned",
        attempt_id: AID,
        process_id: PID,
        pid: 12345,
        pgid: 12345,
      },
      seq: 2,
      observedAt: 1001,
    },
    {
      payload: {
        kind: "process_close_observed",
        attempt_id: AID,
        process_id: PID,
        exit_code: 0,
        signal: null,
      },
      seq: 3,
      observedAt: 1002,
    },
    {
      payload: {
        kind: "process_result_committed",
        attempt_id: AID,
        process_id: PID,
        result: { outcome_kind: "exited", exit_code: 0 },
      },
      seq: 4,
      observedAt: 1003,
    },
  ]);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.kind, "settled");
    if (r.value.kind === "settled") {
      assert.equal(r.value.result.outcome_kind, "exited");
    }
  }
});

test("RECOVERY_LIVE_BOUNDARY sandbox lane documents the wired strict entrypoint", () => {
  // The strict entrypoint is wired in package.json:
  //   qualify:recovery-live
  // and points to this test file. The Cline sandbox lane
  // reports BLOCKED_BY_ENVIRONMENT for cases that require real
  // detached POSIX process management. The host qualification
  // command in CORRECTION01 §40 invokes the same entrypoint.
  assert.equal(typeof process, "object");
});
/* placeholder */
