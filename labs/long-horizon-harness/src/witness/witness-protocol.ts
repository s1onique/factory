/**
 * FOUNDATION04 — witness wire protocol.
 *
 * Pure protocol ADTs. Defines the in-memory message shapes that
 * travel between the witness process and the supervisor over the
 * Unix-domain stream socket.
 *
 * - witness-types.ts defines the canonical *state* ADTs.
 * - witness-codec.ts handles encode/decode and framing.
 * - witness-protocol.ts (this file) defines the *protocol messages*
 *   and the canonical signing payload.
 *
 * No imports of fs, net, crypto, child_process, timers, or signals.
 * No mutations. No side effects.
 */

import type { AttemptId, RunId } from "../domain/ids.js";
import type { ProcessId } from "../process/process-types.js";
import type { WitnessAction } from "./witness-types-state.js";
import type { WitnessPersistedResult } from "./witness-types.js";
import type {
  WitnessCommandId,
  WitnessId,
  WitnessInstanceId,
} from "./witness-types.js";

// --------------------------------------------------------------------------
// Protocol version
// --------------------------------------------------------------------------

/** FOUNDATION04 protocol version. Bump on breaking changes. */
export const WITNESS_PROTOCOL_VERSION = 1 as const;

/** Maximum request/response frame size (F04-D78). */
export const WITNESS_MAX_FRAME_BYTES = 64 * 1024;

// --------------------------------------------------------------------------
// Client → witness messages
// --------------------------------------------------------------------------

/**
 * The supervisor's hello message. The witness responds with a
 * signed HandshakeResponse.
 */
export type WitnessHello = {
  readonly protocolVersion: number;
  readonly runId: RunId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
  readonly clientNonce: string;
};

/**
 * A signed controller command. The signature is over the canonical
 * bytes of `payload` (see canonicalControllerCommand) using the
 * controller's Ed25519 private key.
 */
export type WitnessSignedCommand = {
  readonly protocolVersion: number;
  readonly payload: ControllerCommandPayload;
  readonly signature: string;
};

/**
 * The canonical fields of a controller command.
 */
export type ControllerCommandPayload = {
  readonly commandId: WitnessCommandId;
  readonly runId: RunId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
  readonly action: WitnessAction;
  readonly nonce: string;
};

// --------------------------------------------------------------------------
// Witness → client messages
// --------------------------------------------------------------------------

/**
 * Signed response to a HELLO. Contains the witness state snapshot
 * required for a restarted supervisor to decide whether authority
 * has been recovered.
 */
export type WitnessHandshakeResponse = {
  readonly protocolVersion: number;
  readonly witnessState: WitnessStateSummary;
  readonly signature: string;
};

/**
 * Compact witness state fields. Keeping this small makes the
 * canonical signing payload short and deterministic.
 */
export type WitnessStateSummary = {
  readonly runId: RunId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
  readonly witnessPid: number;
  readonly witnessPublicKeyFingerprint: string;
  readonly controllerPublicKeyFingerprint: string;
  readonly clientNonce: string;
  readonly stateKind: string;
  readonly candidatePid: number | null;
  readonly candidatePgid: number | null;
  readonly witnessSequence: number;
};

// --------------------------------------------------------------------------
// Witness → client command responses
// --------------------------------------------------------------------------

/**
 * Signed response to a control command. The signature is over the
 * canonical bytes of `payload`.
 */
export type WitnessSignedCommandResponse = {
  readonly protocolVersion: number;
  readonly payload: WitnessCommandResponsePayload;
  readonly signature: string;
};

export type WitnessCommandResponsePayload = {
  readonly commandId: WitnessCommandId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
  readonly witnessSequence: number;
  readonly result: WitnessCommandResultBody;
};

export type WitnessCommandResultBody =
  | {
      readonly kind: "ok";
      readonly executionStatus: WitnessExecutionStatusSummary;
      readonly result: WitnessPersistedResult | null;
    }
  | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
  | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
  | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
  | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
  | { readonly kind: "authority_unavailable"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "pong" };

export type WitnessExecutionStatusSummary = {
  readonly kind: string;
  readonly pid: number | null;
  readonly pgid: number | null;
};

// --------------------------------------------------------------------------
// Protocol error envelope (control-plane)
// --------------------------------------------------------------------------

export type WitnessProtocolError =
  | { readonly kind: "protocol_version_mismatch"; readonly expected: number; readonly received: number }
  | { readonly kind: "oversize_frame"; readonly maxBytes: number; readonly observedBytes: number }
  | { readonly kind: "malformed_json"; readonly reason: string }
  | { readonly kind: "invalid_signature"; readonly reason: string }
  | { readonly kind: "identity_mismatch"; readonly reason: string }
  | { readonly kind: "unknown_command"; readonly reason: string }
  | { readonly kind: "session_closed"; readonly reason: string };
