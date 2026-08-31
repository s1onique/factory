/**
 * FOUNDATION04 — witness state machine and authority ADTs.
 *
 * Split from witness-types.ts to keep that file under 400 LOC.
 * Pure types only. No imports of fs, child_process, crypto, timers.
 */

import type { ProcessId } from "../process/process-types.js";
import type {
  WitnessBinding,
  WitnessPersistedResult,
} from "./witness-types.js";
import type { WitnessId, WitnessInstanceId } from "./witness-types.js";

// --------------------------------------------------------------------------
// Witness state ADT (F04-D07)
// --------------------------------------------------------------------------

/**
 * The witness state machine.
 *
 * Each variant is a deliberately distinct protocol phase. State
 * transitions are explicit. There is no implicit "are we alive"
 * boolean; the state kind IS the answer.
 */
export type WitnessState =
  | {
      readonly kind: "bootstrapping";
      readonly binding: WitnessBinding;
      readonly historicalWitnessPid: number | null;
    }
  | {
      readonly kind: "ready_not_activated";
      readonly binding: WitnessBinding;
      readonly historicalWitnessPid: number | null;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
    }
  | {
      readonly kind: "active_idle";
      readonly binding: WitnessBinding;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
      readonly witnessSequence: number;
    }
  | {
      readonly kind: "execution_starting";
      readonly binding: WitnessBinding;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
      readonly witnessSequence: number;
    }
  | {
      readonly kind: "execution_running";
      readonly binding: WitnessBinding;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
      readonly witnessSequence: number;
      readonly pid: number;
      readonly pgid: number;
    }
  | {
      readonly kind: "execution_settled";
      readonly binding: WitnessBinding;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
      readonly witnessSequence: number;
      readonly result: WitnessPersistedResult;
    }
  | {
      readonly kind: "failed";
      readonly binding: WitnessBinding;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly socketPath: string;
      readonly protocolVersion: number;
      readonly witnessSequence: number;
      readonly reason: string;
    };

// --------------------------------------------------------------------------
// Authority state ADT (F04-D09 / D41 / D115)
// --------------------------------------------------------------------------

/**
 * Authority over the candidate execution.
 *
 * Restarted supervisors start with `none`. Authority NEVER comes from
 * a remembered PID/PGID. Authority NEVER comes from a successful
 * socket connect. Authority NEVER comes from a signature alone.
 */
export type ExecutionAuthority =
  | { readonly kind: "none" }
  | { readonly kind: "current_supervisor" }
  | {
      readonly kind: "authenticated_witness";
      readonly witnessId: WitnessId;
      readonly instanceId: WitnessInstanceId;
      readonly witnessPublicKeyFingerprint: string;
    };

/**
 * Authority-recovery state ADT (F04-D41).
 */
export type WitnessAuthorityState =
  | { readonly kind: "no_witness" }
  | { readonly kind: "witness_historical_only" }
  | { readonly kind: "witness_endpoint_unreachable"; readonly socketPath: string }
  | {
      readonly kind: "witness_authentication_failed";
      readonly reason: string;
      readonly socketPath: string;
    }
  | {
      readonly kind: "witness_authenticated_idle";
      readonly witnessId: WitnessId;
      readonly instanceId: WitnessInstanceId;
    }
  | {
      readonly kind: "execution_authority_recovered";
      readonly witnessId: WitnessId;
      readonly instanceId: WitnessInstanceId;
      readonly processId: ProcessId;
      readonly historicalPid: number;
      readonly historicalPgid: number;
    }
  | {
      readonly kind: "witness_reports_settled";
      readonly witnessId: WitnessId;
      readonly instanceId: WitnessInstanceId;
      readonly result: WitnessPersistedResult;
    };

// --------------------------------------------------------------------------
// Control command ADT (F04-D44)
// --------------------------------------------------------------------------

export type WitnessAction = "QUERY" | "PING" | "CANCEL" | "TERMINATE";

export type ControllerCommand = {
  readonly protocolVersion: number;
  readonly commandId: import("./witness-types.js").WitnessCommandId;
  readonly runId: import("../domain/ids.js").RunId;
  readonly attemptId: import("../domain/ids.js").AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
  readonly action: WitnessAction;
  readonly nonce: string;
};

// --------------------------------------------------------------------------
// Cancellation/termination results (F04-D46)
// --------------------------------------------------------------------------

export type CommandOutcome =
  | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
  | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
  | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
  | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
  | { readonly kind: "authority_unavailable"; readonly reason: string };

