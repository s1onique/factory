/**
 * FOUNDATION03 — process-recovery projector (header).
 */

import type {
  PersistedProcessEvidencePayload,
} from "../evidence/codec-types.js";
import { areCloseAndResultCompatible, deadlineCompatible, cancelCompatible } from "./process-result-compatibility.js";
import type { ProcessId } from "../process/process-types.js";
import type { AttemptId } from "../domain/ids.js";
import type {
  EvidenceStream,
  ExecutionRecoveryState,
  RecoveredExecutionPhase,
  RecoveryResult,
} from "./recovery-types.js";

export function projectExecution(
  stream: EvidenceStream,
): RecoveryResult<ExecutionRecoveryState> {
  let state: ExecutionRecoveryState = { kind: "not_started" };
  let boundPid: ProcessId | null = null;
  let boundAId: AttemptId | null = null;
  let lastPid: number | null = null;
  let lastPgid: number | null = null;
  let closedSeen = false;
  let groupAbsentSeen = false;
  let deadlineSeen = false;
  let cancelSeen = false;
  let lastCloseCode: number | null = null;
  let lastCloseSignal: string | null = null;

  for (const { payload } of stream) {
    const pid = payloadProcessId(payload);
    if (pid === null) continue;
    if (boundPid === null) {
      boundPid = pid;
    } else if (boundPid !== pid) {
      return errMixed(pid);
    }
    // CORRECTION02 §6 (A08): every process-evidence record
    // carries an attempt_id. The projector binds on the first
    // record's attempt_id and rejects any mismatch. Two records
    // that share a process_id but differ in attempt_id belong
    // to different attempts and MUST NOT be reconciled together.
    if (boundAId === null) {
      boundAId = pid === pid ? payloadAttemptId(payload) : null;
      // ^ always assigned; payloadAttemptId returns AttemptId|null
    } else {
      const aid = payloadAttemptId(payload);
      if (aid !== null && aid !== boundAId) {
        return errMixedAttempt(aid, pid);
      }
    }

    const r = apply(state, payload, {
      lastPid,
      lastPgid,
      closedSeen,
      groupAbsentSeen,
      deadlineSeen,
      cancelSeen,
      closeCode: lastCloseCode,
      closeSignal: lastCloseSignal,
    });
    if (r.ok === false) return r;
    state = r.value.state;
    lastPid = r.value.lastPid;
    lastPgid = r.value.lastPgid;
    closedSeen = r.value.closedSeen;
    groupAbsentSeen = r.value.groupAbsentSeen;
    deadlineSeen = r.value.deadlineSeen;
    cancelSeen = r.value.cancelSeen;
    lastCloseCode = r.value.lastCloseCode;
    lastCloseSignal = r.value.lastCloseSignal;
  }

  if (state.kind === "settled") return okState(state);
  if (boundPid === null) return okState({ kind: "not_started" });
  if (
    state.kind === "result_unknown_after_cleanup" ||
    state.kind === "spawn_outcome_unknown" ||
    state.kind === "in_flight_at_crash" ||
    state.kind === "spawn_failure_observed"
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

function errMixedAttempt(
  aid: AttemptId,
  pid: ProcessId,
): RecoveryResult<ExecutionRecoveryState> {
  return {
    ok: false,
    error: {
      kind: "mixed_attempt_identity",
      attemptId: String(aid),
      processId: String(pid),
    },
  };
}

function payloadAttemptId(
  p: PersistedProcessEvidencePayload,
): AttemptId | null {
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
      return p.attempt_id;
  }
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
  readonly deadlineSeen: boolean;
  readonly cancelSeen: boolean;
  readonly closeCode: number | null;
  readonly closeSignal: string | null;
};

type ApplyResult = {
  readonly state: ExecutionRecoveryState;
  readonly lastPid: number | null;
  readonly lastPgid: number | null;
  readonly closedSeen: boolean;
  readonly groupAbsentSeen: boolean;
  readonly deadlineSeen: boolean;
  readonly cancelSeen: boolean;
  readonly lastCloseCode: number | null;
  readonly lastCloseSignal: string | null;
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
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
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
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
      });
    }
    case "process_spawn_failed": {
      if (state.kind !== "spawn_outcome_unknown") {
        return errInconsistent(`process_spawn_failed while state=${state.kind}`);
      }
      // CORRECTION01 §15: ONLY process_result_committed produces
      // settled. Spawn-failure observation moves to a distinct
      // "spawn_failure_observed" state; the actual durable
      // settlement requires a later process_result_committed record.
      return okResult({
        state: {
          kind: "spawn_failure_observed",
          processId: p.process_id,
          failure: p.failure,
        },
        lastPid: null,
        lastPgid: null,
        closedSeen: ctx.closedSeen,
       groupAbsentSeen: ctx.groupAbsentSeen,
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
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
       deadlineSeen: true,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
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
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: true,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
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
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
      });
    }
    case "process_signal_result": {
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(`process_signal_result while state=${state.kind}`);
      }
      // CORRECTION01 §16: only `result_kind === "sent"` may promote
      // the recovery phase to `*_sent`. group_absent / permission_denied
      // / error results leave the phase at the corresponding
      // `*_requested` so we do NOT invent post-crash signal
      // delivery facts.
      const phase: RecoveredExecutionPhase =
        p.result.result_kind === "sent"
          ? p.signal === "SIGTERM"
            ? "term_sent"
            : "kill_sent"
          : p.signal === "SIGTERM"
            ? "term_requested"
            : "kill_requested";
      return okResult({
        state: { ...state, phase },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
       groupAbsentSeen: ctx.groupAbsentSeen,
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
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
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
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
         deadlineSeen: ctx.deadlineSeen,
         cancelSeen: ctx.cancelSeen,
         lastCloseCode: ctx.closeCode,
         lastCloseSignal: ctx.closeSignal,
        });
      }
      // CORRECTION03 §9/§10 (A11/A12): capture the close
      // fields so the result-committed gate can verify
      // exit_code/signal compatibility.
      return okResult({
        state: { ...state, phase: "close_seen" },
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: true,
       groupAbsentSeen: ctx.groupAbsentSeen,
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: p.exit_code,
       lastCloseSignal: p.signal,
      });
    }
    case "process_output_summary": {
      return okResult({
        state,
        lastPid: ctx.lastPid,
        lastPgid: ctx.lastPgid,
        closedSeen: ctx.closedSeen,
       groupAbsentSeen: ctx.groupAbsentSeen,
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
      });
    }
    case "process_result_committed": {
      // CORRECTION01 §15 + §19: result_committed is the ONLY
      // settlement boundary. The committed result must be
      // compatible with the durable history.
      if (
        state.kind !== "in_flight_at_crash" &&
        state.kind !== "spawn_outcome_unknown" &&
        state.kind !== "spawn_failure_observed"
      ) {
        return errInconsistent(
          `process_result_committed while state=${state.kind}`,
        );
      }
      // spawn_failed result requires a preceding
      // process_spawn_failed observation.
      if (p.result.outcome_kind === "spawn_failed") {
        if (state.kind !== "spawn_failure_observed") {
          return errInconsistent(
            "spawn_failed result requires spawn_failure_observed state",
          );
        }
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
         deadlineSeen: ctx.deadlineSeen,
         cancelSeen: ctx.cancelSeen,
         lastCloseCode: ctx.closeCode,
         lastCloseSignal: ctx.closeSignal,
        });
      }
      // exited / signaled / deadline / cancelled / cleanup_failed
      // require an in_flight_at_crash state (i.e. a spawned
      // observation).
      if (state.kind !== "in_flight_at_crash") {
        return errInconsistent(
          `${p.result.outcome_kind} result requires in_flight_at_crash state`,
        );
      }
      // CORRECTION03 §7-§10 (A09/A10/A11/A12): deadline / cancelled
      // outcomes require their trigger evidence; exited /
      // signaled outcomes must be compatible with the close
      // observation.
      if (!deadlineCompatible(p.result, ctx.deadlineSeen)) {
        return errInconsistent(
          "deadline result requires process_deadline_reached evidence",
        );
      }
      if (!cancelCompatible(p.result, ctx.cancelSeen)) {
        return errInconsistent(
          "cancelled result requires process_cancel_requested evidence",
        );
      }
      if (ctx.closedSeen && !areCloseAndResultCompatible(p.result, ctx.closeCode, ctx.closeSignal)) {
        return errInconsistent(
          `close ${ctx.closeCode}/${ctx.closeSignal} incompatible with result ${p.result.outcome_kind}`,
        );
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
       deadlineSeen: ctx.deadlineSeen,
       cancelSeen: ctx.cancelSeen,
       lastCloseCode: ctx.closeCode,
       lastCloseSignal: ctx.closeSignal,
      });
    }
  }
}
