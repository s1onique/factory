/**
 * FOUNDATION04 — pure witness projector (state derivation).
 *
 * Walks a stream of witness evidence records in order and
 * derives the canonical {@link WitnessRecoveryState}.
 */

import type { ProcessId } from "../process/process-types.js";
import type { PersistedWitnessEvidence } from "./witness-types-persisted.js";
import type { WitnessId, WitnessInstanceId } from "./witness-types.js";

export type WitnessProjectorError =
  | { readonly kind: "ready_before_start" }
  | { readonly kind: "duplicate_public_key_for_instance" }
  | { readonly kind: "mismatched_instance_id" }
  | { readonly kind: "activation_without_ready" }
  | { readonly kind: "command_result_without_request" }
  | { readonly kind: "invalid_sequence" };

export type WitnessProjectorResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WitnessProjectorError };

export type WitnessRecoveryState =
  | { readonly kind: "no_witness" }
  | { readonly kind: "witness_historical_only" }
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
    };

export type WitnessEvidenceStream = ReadonlyArray<{
  readonly payload: PersistedWitnessEvidence;
  readonly observedAt: number;
  readonly seq: number;
}>;

/**
 * Project a stream of witness evidence records into the canonical
 * WitnessRecoveryState.
 */
export function projectWitness(stream: WitnessEvidenceStream): WitnessProjectorResult<WitnessRecoveryState> {
  let boundWitnessId: WitnessId | null = null;
  let boundInstanceId: WitnessInstanceId | null = null;
  let boundPublicKey: string | null = null;
  let startedSeen = false;
  let readySeen = false;
  let lastReady: Extract<WitnessRecoveryState, { kind: "witness_ready" }> | null = null;
  let lastActivated: Extract<WitnessRecoveryState, { kind: "witness_activated" }> | null = null;
  let lastRecovered: Extract<WitnessRecoveryState, { kind: "witness_execution_recovered" }> | null = null;
  const pendingCommands = new Set<string>();

  for (const { payload } of stream) {
    if (boundWitnessId === null) {
      boundWitnessId = payload.witness_id;
      boundInstanceId = payload.witness_instance_id;
    } else if (
      payload.witness_id !== boundWitnessId ||
      payload.witness_instance_id !== boundInstanceId
    ) {
      return { ok: false, error: { kind: "mismatched_instance_id" } };
    }

    switch (payload.kind) {
      case "witness_start_requested":
        if (startedSeen) {
          return { ok: false, error: { kind: "invalid_sequence" } };
        }
        startedSeen = true;
        break;
      case "witness_ready":
        if (!startedSeen) return { ok: false, error: { kind: "ready_before_start" } };
        if (readySeen) {
          if (boundPublicKey !== null && boundPublicKey !== payload.witness_public_key) {
            return { ok: false, error: { kind: "duplicate_public_key_for_instance" } };
          }
        } else {
          boundPublicKey = payload.witness_public_key;
        }
        readySeen = true;
        lastReady = {
          kind: "witness_ready",
          witnessId: payload.witness_id,
          witnessInstanceId: payload.witness_instance_id,
          historicalWitnessPid: payload.historical_witness_pid,
          socketPath: payload.socket_path,
          witnessPublicKey: payload.witness_public_key,
          witnessPublicKeyFingerprint: payload.witness_public_key_fingerprint,
          controllerPublicKeyFingerprint: payload.controller_public_key_fingerprint,
          protocolVersion: payload.protocol_version,
        };
        break;
      case "witness_activation_requested":
        if (!readySeen) return { ok: false, error: { kind: "activation_without_ready" } };
        pendingCommands.add(payload.command_id);
        break;
      case "witness_activated":
        if (!readySeen) return { ok: false, error: { kind: "activation_without_ready" } };
        lastActivated = {
          kind: "witness_activated",
          witnessId: payload.witness_id,
          witnessInstanceId: payload.witness_instance_id,
          witnessSequence: payload.witness_sequence,
        };
        break;
      case "witness_execution_recovered":
        if (!readySeen) return { ok: false, error: { kind: "invalid_sequence" } };
        lastRecovered = {
          kind: "witness_execution_recovered",
          witnessId: payload.witness_id,
          witnessInstanceId: payload.witness_instance_id,
          processId: payload.process_id,
          pid: payload.pid,
          pgid: payload.pgid,
          witnessSequence: payload.witness_sequence,
          attestationHash: payload.attestation_hash,
        };
        break;
      case "witness_command_requested":
        pendingCommands.add(payload.command_id);
        break;
      case "witness_command_result":
        if (!pendingCommands.has(payload.command_id)) {
          return { ok: false, error: { kind: "command_result_without_request" } };
        }
        pendingCommands.delete(payload.command_id);
        break;
      case "witness_lost":
        break;
    }
  }

  if (lastRecovered !== null) return { ok: true, value: lastRecovered };
  if (lastActivated !== null) return { ok: true, value: lastActivated };
  if (lastReady !== null) return { ok: true, value: lastReady };
  if (startedSeen) return { ok: true, value: { kind: "witness_historical_only" } };
  return { ok: true, value: { kind: "no_witness" } };
}

/**
 * Filter a ledger envelope stream to only the witness-evidence
 * records that target the given (WitnessId, WitnessInstanceId).
 */
export function filterWitnessStreamByInstance<S extends WitnessEvidenceStream>(
  stream: S,
  witnessId: WitnessId,
  witnessInstanceId: WitnessInstanceId,
): S {
  return stream.filter(({ payload }) => {
    if (payload.witness_id !== witnessId) return false;
    if (payload.witness_instance_id !== witnessInstanceId) return false;
    return true;
  }) as unknown as S;
}

/**
 * The set of command_ids that are pending: requested but not yet
 * acknowledged with a result record.
 */
export function pendingCommands(stream: WitnessEvidenceStream): ReadonlyArray<string> {
  const pending = new Set<string>();
  for (const { payload } of stream) {
    switch (payload.kind) {
      case "witness_command_requested":
      case "witness_activation_requested":
        pending.add(payload.command_id);
        break;
      case "witness_command_result":
        pending.delete(payload.command_id);
        break;
      default:
        break;
    }
  }
  return Array.from(pending);
}
