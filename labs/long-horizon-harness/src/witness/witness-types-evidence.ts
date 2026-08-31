/**
 * FOUNDATION04 — witness evidence ADT.
 *
 * Pure types only. The persisted (snake_case) shape lives in
 * witness-types-persisted.ts.
 */

import type { ProcessId } from "../process/process-types.js";
import type {
  CommandOutcome,
  WitnessAction,
} from "./witness-types-state.js";
import type {
  WitnessCommandId,
  WitnessId,
  WitnessInstanceId,
} from "./witness-types.js";

/**
 * The persisted evidence shapes emitted by the witness.
 *
 * Each shape is durably appended to the run's events.jsonl via
 * the existing JsonlLedger. There is no second JSONL writer.
 *
 * Private key material is NEVER persisted.
 */
export type WitnessEvidence =
  | {
      readonly kind: "witness_start_requested";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
    }
  | {
      readonly kind: "witness_ready";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly historicalWitnessPid: number;
      readonly socketPath: string;
      readonly witnessPublicKey: string;
      readonly witnessPublicKeyFingerprint: string;
      readonly controllerPublicKeyFingerprint: string;
      readonly protocolVersion: number;
    }
  | {
      readonly kind: "witness_activation_requested";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly commandId: WitnessCommandId;
    }
  | {
      readonly kind: "witness_activated";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly witnessSequence: number;
    }
  | {
      readonly kind: "witness_execution_recovered";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly processId: ProcessId;
      readonly pid: number;
      readonly pgid: number;
      readonly witnessSequence: number;
      readonly attestationHash: string;
    }
  | {
      readonly kind: "witness_command_requested";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly commandId: WitnessCommandId;
      readonly action: WitnessAction;
    }
  | {
      readonly kind: "witness_command_result";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly commandId: WitnessCommandId;
      readonly outcome: CommandOutcome;
      readonly witnessSequence: number;
    }
  | {
      readonly kind: "witness_lost";
      readonly witnessId: WitnessId;
      readonly witnessInstanceId: WitnessInstanceId;
      readonly reason: string;
    };
