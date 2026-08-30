/**
 * FOUNDATION03 — process-recovery projector (header).
 */

import type {
  EvidenceStream,
  ExecutionRecoveryState,
  RecoveryResult,
} from "./recovery-types.js";
import type { PersistedProcessEvidencePayload } from "../evidence/codec-types.js";
import type { ProcessId } from "../process/process-types.js";
import type { AttemptId } from "../domain/ids.js";
import { apply } from "./process-recovery-projector-apply.js";

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


function okState(s: ExecutionRecoveryState): RecoveryResult<ExecutionRecoveryState> {
  return { ok: true, value: s };
}

// apply() and its types were extracted to process-recovery-projector-apply.ts (CORRECTION04 §33).
export { apply, okResult } from "./process-recovery-projector-apply.js";
