/**
 * FOUNDATION04 — persisted (snake_case) witness evidence shapes.
 *
 * Kept separate from witness-types.ts to keep both files under
 * the 400 LOC source-size discipline (FOUNDATION03 §29).
 *
 * These types are the on-disk shape of witness evidence records.
 * They participate in the existing JSONL ledger as
 * `kind === "process_evidence"` envelopes. A separate
 * `process_evidence_kind` discriminator inside the payload tells
 * the decoder whether the record is a witness record or a
 * FOUNDATION02 process-runtime record.
 */

import type { ProcessId } from "../process/process-types.js";
import type {
  WitnessAction,
  WitnessCommandId,
  WitnessId,
  WitnessInstanceId,
} from "./witness-types.js";

export type PersistedWitnessEvidence =
  | {
      readonly kind: "witness_start_requested";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
    }
  | {
      readonly kind: "witness_ready";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly historical_witness_pid: number;
      readonly socket_path: string;
      readonly witness_public_key: string;
      readonly witness_public_key_fingerprint: string;
      readonly controller_public_key_fingerprint: string;
      readonly protocol_version: number;
    }
  | {
      readonly kind: "witness_activation_requested";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly command_id: WitnessCommandId;
    }
  | {
      readonly kind: "witness_activated";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly witness_sequence: number;
    }
  | {
      readonly kind: "witness_execution_recovered";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly process_id: ProcessId;
      readonly pid: number;
      readonly pgid: number;
      readonly witness_sequence: number;
      readonly attestation_hash: string;
    }
  | {
      readonly kind: "witness_command_requested";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly command_id: WitnessCommandId;
      readonly action: WitnessAction;
    }
  | {
      readonly kind: "witness_command_result";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly command_id: WitnessCommandId;
      readonly outcome: PersistedCommandOutcome;
      readonly witness_sequence: number;
    }
  | {
      readonly kind: "witness_lost";
      readonly witness_id: WitnessId;
      readonly witness_instance_id: WitnessInstanceId;
      readonly reason: string;
    };

export type PersistedCommandOutcome =
  | {
      readonly kind: "cancelled";
      readonly result: PersistedWitnessPersistedResult;
    }
  | {
      readonly kind: "terminated";
      readonly result: PersistedWitnessPersistedResult;
    }
  | {
      readonly kind: "already_settled";
      readonly result: PersistedWitnessPersistedResult;
    }
  | {
      readonly kind: "cleanup_failed";
      readonly result: PersistedWitnessPersistedResult;
    }
  | {
      readonly kind: "authority_unavailable";
      readonly reason: string;
    };

export type PersistedWitnessPersistedResult =
  | {
      readonly outcome_kind: "exited";
      readonly exit_code: number | null;
    }
  | {
      readonly outcome_kind: "signaled";
      readonly signal: string | null;
      readonly exit_code: number | null;
    }
  | { readonly outcome_kind: "deadline" }
  | { readonly outcome_kind: "cancelled" }
  | { readonly outcome_kind: "spawn_failed"; readonly message: string }
  | { readonly outcome_kind: "cleanup_failed"; readonly message: string }
  | { readonly outcome_kind: "still_running" };
