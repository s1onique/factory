/**
 * FOUNDATION04 — pure witness projector (header).
 *
 * Consumes a stream of witness evidence records and derives the
 * canonical witness recovery state. No sockets, no crypto, no
 * filesystem. This is the read-only side of the witness layer.
 *
 * Doctrine F04-D85: pure projector. No side effects, no I/O.
 * Doctrine F04-D86: rejects invalid histories (e.g. ready before
 * start_requested, second public key for same instance, command
 * result without intent).
 */

import type { ProcessId } from "../process/process-types.js";
import type { WitnessPersistedResult } from "./witness-types.js";

// Types are re-exported from sibling projector files.
export {
  type WitnessProjectorError,
  type WitnessProjectorResult,
  type WitnessRecoveryState,
  type WitnessEvidenceStream,
  projectWitness,
  pendingCommands,
  filterWitnessStreamByInstance,
} from "./witness-projector-state.js";

export type { WitnessAuthorityState } from "./witness-types-state.js";

/**
 * Authority state derived from the projector + a successful
 * (post-handshake) witness QUERY result.
 *
 * This is the function a restarted supervisor uses to decide
 * whether it can re-acquire execution authority.
 */
export function projectAuthority(args: {
  readonly recovery: import("./witness-projector-state.js").WitnessRecoveryState;
  readonly authentication: "authenticated" | "unauthenticated" | "endpoint_unreachable";
  readonly queryExecutionStatus:
    | { readonly kind: "not_started" }
    | { readonly kind: "running"; readonly pid: number; readonly pgid: number }
    | { readonly kind: "settled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
    | null;
}): import("./witness-types-state.js").WitnessAuthorityState {
  if (args.recovery.kind === "no_witness") {
    return { kind: "no_witness" };
  }
  if (args.authentication === "endpoint_unreachable") {
    if (args.recovery.kind === "witness_ready") {
      return { kind: "witness_endpoint_unreachable", socketPath: args.recovery.socketPath };
    }
    if (args.recovery.kind === "witness_activated") {
      // The activated witness state does not retain socketPath in
      // the recovery state (only ready does). For the live witness
      // the supervisor still knows the path from its own
      // pre-restart context; the projector surfaces a generic
      // historical-only state.
      return { kind: "witness_historical_only" };
    }
    return { kind: "witness_historical_only" };
  }
  if (args.authentication === "unauthenticated") {
    if (args.recovery.kind === "witness_ready") {
      return {
        kind: "witness_authentication_failed",
        reason: "handshake failed",
        socketPath: args.recovery.socketPath,
      };
    }
    return { kind: "witness_historical_only" };
  }
  // authenticated. Extract witness id+instance from any state that has them.
  const witnessId = extractWitnessId(args.recovery);
  const instanceId = extractWitnessInstanceId(args.recovery);
  if (witnessId === null || instanceId === null) {
    return { kind: "witness_historical_only" };
  }
  if (args.queryExecutionStatus === null) {
    return {
      kind: "witness_authenticated_idle",
      witnessId,
      instanceId,
    };
  }
  switch (args.queryExecutionStatus.kind) {
    case "running":
      return {
        kind: "execution_authority_recovered",
        witnessId,
        instanceId,
        processId: ("?" as ProcessId),
        historicalPid: args.queryExecutionStatus.pid,
        historicalPgid: args.queryExecutionStatus.pgid,
      };
    case "settled":
    case "cleanup_failed":
      return {
        kind: "witness_reports_settled",
        witnessId,
        instanceId,
        result: args.queryExecutionStatus.result,
      };
    case "not_started":
      return {
        kind: "witness_authenticated_idle",
        witnessId,
        instanceId,
      };
  }
}

function extractWitnessId(
  r: import("./witness-projector-state.js").WitnessRecoveryState,
): import("./witness-types.js").WitnessId | null {
  switch (r.kind) {
    case "no_witness":
    case "witness_historical_only":
      return null;
    case "witness_ready":
    case "witness_activated":
    case "witness_execution_recovered":
      return r.witnessId;
  }
}

function extractWitnessInstanceId(
  r: import("./witness-projector-state.js").WitnessRecoveryState,
): import("./witness-types.js").WitnessInstanceId | null {
  switch (r.kind) {
    case "no_witness":
    case "witness_historical_only":
      return null;
    case "witness_ready":
    case "witness_activated":
    case "witness_execution_recovered":
      return r.witnessInstanceId;
  }
}
