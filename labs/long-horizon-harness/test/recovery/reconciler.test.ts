import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../../src/recovery/process-reconciler.js";
import type { RecoveryProbe } from "../../src/recovery/recovery-ports.js";
import type { ExecutionRecoveryState } from "../../src/recovery/recovery-types.js";
import { makeProcessId } from "../../src/process/process-types.js";

const PID = makeProcessId("p-recover");

function stubProbe(pgid: number, kind: "alive" | "absent" | "permission_denied" | "probe_error"): RecoveryProbe {
  return {
    probeHistoricalGroup: (p: number) => {
      if (p !== pgid) throw new Error(`unexpected probe pgid ${p}`);
      if (kind === "alive") return { probe_kind: "alive" };
      if (kind === "absent") return { probe_kind: "absent" };
      if (kind === "permission_denied") return { probe_kind: "permission_denied", code: "EPERM" };
      return { probe_kind: "probe_error", message: "boom", code: "EIO" };
    },
  };
}

test("REC01 in_flight + probe alive -> historical_group_observed_alive", () => {
  const state: ExecutionRecoveryState = {
    kind: "in_flight_at_crash",
    processId: PID, pid: 100, pgid: 100, phase: "running",
  };
  const d = reconcile(state, stubProbe(100, "alive"));
  assert.equal(d.kind, "historical_group_observed_alive");
  if (d.kind === "historical_group_observed_alive") {
    assert.equal(d.processId, PID);
    assert.equal(d.historicalPgid, 100);
  }
});

test("REC02 in_flight + probe absent -> historical_group_absent", () => {
  const state: ExecutionRecoveryState = {
    kind: "in_flight_at_crash",
    processId: PID, pid: 100, pgid: 100, phase: "running",
  };
  const d = reconcile(state, stubProbe(100, "absent"));
  assert.equal(d.kind, "historical_group_absent");
  if (d.kind === "historical_group_absent") {
    assert.equal(d.historicalPgid, 100);
  }
});

test("REC03 in_flight + EPERM -> historical_group_probe_denied", () => {
  const state: ExecutionRecoveryState = {
    kind: "in_flight_at_crash",
    processId: PID, pid: 100, pgid: 100, phase: "running",
  };
  const d = reconcile(state, stubProbe(100, "permission_denied"));
  assert.equal(d.kind, "historical_group_probe_denied");
  if (d.kind === "historical_group_probe_denied") {
    assert.equal(d.code, "EPERM");
  }
});

test("REC04 in_flight + probe_error -> historical_group_probe_error", () => {
  const state: ExecutionRecoveryState = {
    kind: "in_flight_at_crash",
    processId: PID, pid: 100, pgid: 100, phase: "running",
  };
  const d = reconcile(state, stubProbe(100, "probe_error"));
  assert.equal(d.kind, "historical_group_probe_error");
  if (d.kind === "historical_group_probe_error") {
    assert.equal(d.code, "EIO");
  }
});

test("REC05 settled result -> no destructive reconciliation", () => {
  const state: ExecutionRecoveryState = {
    kind: "settled",
    processId: PID,
    result: { outcome_kind: "exited", exit_code: 0 },
    pid: 100, pgid: 100,
  };
  const d = reconcile(state, stubProbe(100, "alive"));
  assert.equal(d.kind, "execution_settled");
});

test("REC06 spawn_outcome_unknown -> cannot probe", () => {
  const state: ExecutionRecoveryState = {
    kind: "spawn_outcome_unknown",
    processId: PID,
  };
  const d = reconcile(state, stubProbe(0, "alive"));
  assert.equal(d.kind, "no_action");
  if (d.kind === "no_action") {
    assert.equal(d.reason, "spawn_outcome_unknown_cannot_probe");
  }
});

test("REC07 reused-PGID simulation never creates authority", () => {
  const state: ExecutionRecoveryState = {
    kind: "in_flight_at_crash",
    processId: PID, pid: 999, pgid: 1234, phase: "kill_sent",
  };
  const d = reconcile(state, stubProbe(1234, "alive"));
  assert.equal(d.kind, "historical_group_observed_alive");
});

test("REC08 result_unknown_after_cleanup still gets probe", () => {
  const state: ExecutionRecoveryState = {
    kind: "result_unknown_after_cleanup",
    processId: PID, pid: 100, pgid: 100,
    reason: "group_absent_close_no_result",
  };
  const d = reconcile(state, stubProbe(100, "alive"));
  assert.equal(d.kind, "historical_group_observed_alive");
});

/* placeholder */
