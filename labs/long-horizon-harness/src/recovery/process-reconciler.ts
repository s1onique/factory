/**
 * FOUNDATION03 — process reconciler (header).
 */

import type {
  ExecutionRecoveryState,
  RecoveryDecision,
} from "./recovery-types.js";
import type { RecoveryProbe } from "./recovery-ports.js";
import type { ProcessId } from "../process/process-types.js";

export function reconcile(
  state: ExecutionRecoveryState,
  probe: RecoveryProbe,
): RecoveryDecision {
  switch (state.kind) {
    case "not_started":
      return { kind: "no_action", reason: "no_execution_observed", state };
    case "spawn_outcome_unknown":
      return {
        kind: "no_action",
        reason: "spawn_outcome_unknown_cannot_probe",
        state,
      };
    case "settled":
      return { kind: "execution_settled", state };
    case "result_unknown_after_cleanup":
      return probeOne(probe, state.processId, state.pgid);
    case "in_flight_at_crash":
      return probeOne(probe, state.processId, state.pgid);
  }
}

function probeOne(
  probe: RecoveryProbe,
  processId: ProcessId,
  pgid: number,
): RecoveryDecision {
  const p = probe.probeHistoricalGroup(pgid);
  switch (p.probe_kind) {
    case "alive":
      return {
        kind: "historical_group_observed_alive",
        processId,
        historicalPid: -1,
        historicalPgid: pgid,
      };
    case "absent":
      return {
        kind: "historical_group_absent",
        processId,
        historicalPgid: pgid,
      };
    case "permission_denied":
      return {
        kind: "historical_group_probe_denied",
        processId,
        historicalPgid: pgid,
        ...(p.code !== undefined ? { code: p.code } : {}),
      };
    case "probe_error":
      return {
        kind: "historical_group_probe_error",
        processId,
        historicalPgid: pgid,
        message: p.message,
        ...(p.code !== undefined ? { code: p.code } : {}),
      };
  }
}
