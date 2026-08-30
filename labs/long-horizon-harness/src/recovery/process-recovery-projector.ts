/**
 * FOUNDATION03 — process-recovery projector (header).
 */

import type {
  PersistedProcessEvidencePayload,
} from "../evidence/codec-types.js";
import type { ProcessId } from "../process/process-types.js";
import type {
  EvidenceStream,
  ExecutionRecoveryState,
  RecoveryResult,
} from "./recovery-types.js";

export function projectExecution(
  stream: EvidenceStream,
): RecoveryResult<ExecutionRecoveryState> {
  let state: ExecutionRecoveryState = { kind: "not_started" };
  let boundPid: ProcessId | null = null;
  let lastPid: number | null = null;
  let lastPgid: number | null = null;
  let closedSeen = false;
  let groupAbsentSeen = false;

  for (const { payload } of stream) {
    const pid = payloadProcessId(payload);
    if (pid === null) continue;
    if (boundPid === null) {
      boundPid = pid;
    } else if (boundPid !== pid) {
      return errMixed(pid);
    }

    const r = apply(state, payload, {
      lastPid,
      lastPgid,
      closedSeen,
      groupAbsentSeen,
    });
    if (r.ok === false) return r;
    state = r.value.state;
    lastPid = r.value.lastPid;
    lastPgid = r.value.lastPgid;
    closedSeen = r.value.closedSeen;
    groupAbsentSeen = r.value.groupAbsentSeen;
  }

  if (state.kind === "settled") return okState(state);
  if (boundPid === null) return okState({ kind: "not_started" });
  if (
    state.kind === "result_unknown_after_cleanup" ||
    state.kind === "spawn_outcome_unknown" ||
    state.kind === "in_flight_at_crash"
  ) {
    return okState(state);
  }
  return okState({ kind: "spawn_outcome_unknown", processId: boundPid });
}

function payloadProcessId(
  p: PersistedProcessEvidencePayload,
): ProcessId | null {
  switch (p.kind) {
    case "process_spawn_requested":
    case "process_spawned":
    case "process_spawn_failed":
    case "process_deadline_reached":
    case "process_cancel_requested":
    case "process_signal_attempted":
    case "process_signal_result":
    case "process_group_probe":
    case "process_close_observed":
    case "process_output_summary":
    case "process_result_committed":
      return p.process_id;
  }
}

function errMixed(pid: ProcessId): RecoveryResult<ExecutionRecoveryState> {
  return { ok: false, error: { kind: "mixed_process_identity", processId: String(pid) } };
}

function errInconsistent(reason: string): RecoveryResult<never> {
  return { ok: false, error: { kind: "inconsistent_history", reason } };
}

function okState(s: ExecutionRecoveryState): RecoveryResult<ExecutionRecoveryState> {
  return { ok: true, value: s };
}

type ApplyCtx = {
  readonly lastPid: number | null;
  readonly lastPgid: number | null;
  readonly closedSeen: boolean;
  readonly groupAbsentSeen: boolean;
};

type ApplyResult = {
  readonly state: ExecutionRecoveryState;
  readonly lastPid: number | null;
  readonly lastPgid: number | null;
  readonly closedSeen: boolean;
  readonly groupAbsentSeen: boolean;
};

function okResult(r: ApplyResult): RecoveryResult<ApplyResult> {
  return { ok: true, value: r };
}

function apply(
  state: ExecutionRecoveryState,
  p: PersistedProcessEvidencePayload,
  ctx: ApplyCtx,
): RecoveryResult<ApplyResult> {
  if (state.kind === "settled") {
    return errInconsistent(
      `received '${p.kind}' after process_result_committed`,
    );
  }

  switch (p.kind) {
    case "process_spawn_requested": {
      if (state.kind !== "not_started") {
        return errInconsistent("process_spawn_requested after state advanced");
      }
      return okResult({
        state: { kind: "spawn_outcome_unknown", processId: p.process_id },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_spawned": {
      if (state.kind !== "spawn_outcome_unknown") {
        return errInconsistent(`process_spawned while state=${state.kind}`);
      }
      return okResult({
        state: {
          kind: "in_flight_at_crash",
          processId: p.process_id,
          pid: p.pid,
          pgid: p.pgid,
          phase: "running",
        },
        lastPid: p.pid,
        lastPgid: p.pgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_spawn_failed": {
      if (state.kind !== "spawn_outcome_unknown") {
        return errInconsistent(`process_spawn_failed while state=${state.kind}`);
      }
      return okResult({
        state: {
          kind: "settled",
          processId: p.process_id,
          result: { outcome_kind: "spawn_failed", failure: p.failure },
          pid: null,
          pgid: null,
        },
        lastPid: null,
        lastPgid: null,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_deadline_reached": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_deadline_reached while state=${state.kind}`);
      }
      return okResult({
        state: { ...state, phase: "term_requested" },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_cancel_requested": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_cancel_requested while state=${state.kind}`);
      }
      return okResult({
        state: { ...state, phase: "term_requested" },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_signal_attempted": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_signal_attempted while state=${state.kind}`);
      }
      const phase =
        p.signal === "SIGTERM" ? "term_requested" : "kill_requested";
      return okResult({
        state: { ...state, phase },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_signal_result": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_signal_result while state=${state.kind}`);
      }
      const phase =
        p.signal === "SIGTERM" ? "term_sent" : "kill_sent";
      return okResult({
        state: { ...state, phase },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_group_probe": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_group_probe while state=${state.kind}`);
      }
      const groupAbsentNow =
        ctx.groupAbsentSeen || p.probe.probe_kind === "absent";
      return okResult({
        state: {
          ...state,
          phase: groupAbsentNow ? "group_absence_seen" : state.phase,
        },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: groupAbsentNow,
      });
    }
    case "process_close_observed": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_close_observed while state=${state.kind}`);
      }
      if (ctx.groupAbsentSeen) {
        return okResult({
          state: {
            kind: "result_unknown_after_cleanup",
            processId: state.processId,
            pid: state.pid,
            pgid: state.pgid,
            reason: "group_absent_close_no_result",
          },
          lastPid: ctx.lastPid,
          lastPgid: ctx.lastPgid,
          closedSeen: true,
          groupAbsentSeen: ctx.groupAbsentSeen,
        });
      }
      return okResult({
        state: { ...state, phase: "close_seen" },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: true,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_output_summary": {
      return okResult({
        state,
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
    case "process_result_committed": {
      if (state.kind === "spawn_outcome_unknown") {
        return okResult({
          state: {
            kind: "settled",
            processId: p.process_id,
            result: p.result,
            pid: null,
            pgid: null,
          },
          lastPid: null,
          lastPgid: null,
          closedSeen: ctx.closedSeen,
          groupAbsentSeen: ctx.groupAbsentSeen,
        });
      }
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_result_committed while state=${state.kind}`);
      }
      return okResult({
        state: {
          kind: "settled",
          processId: p.process_id,
          result: p.result,
          pid: state.pid,
          pgid: state.pgid,
        },
        lastPid: state.pid,
        lastPgid: state.pgid,
        closedSeen: ctx.closedSeen,
        groupAbsentSeen: ctx.groupAbsentSeen,
      });
    }
  }
}
