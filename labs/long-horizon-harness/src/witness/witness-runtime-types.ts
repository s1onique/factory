/**
 * FOUNDATION04 — witness runtime types (state, ports).
 *
 * Defines the bounded inputs/outputs the runtime consumes and
 * produces. No node imports here.
 */

import type {
  ControllerCommand,
  WitnessBinding,
  WitnessCommandId,
  WitnessExecutionStatus,
  WitnessPersistedResult,
} from "./witness-types.js";
import type { WitnessSigner, WitnessVerifier } from "./witness-crypto.js";

/**
 * Identity-binding equality check used by both the runtime and
 * any caller verifying a witness response.
 */
export function sameBinding(a: WitnessBinding, b: WitnessBinding): boolean {
  return (
    a.runId === b.runId &&
    a.missionId === b.missionId &&
    a.attemptId === b.attemptId &&
    a.processId === b.processId &&
    a.witnessId === b.witnessId &&
    a.witnessInstanceId === b.witnessInstanceId
  );
}

export type CommandJournalEntry =
  | {
      readonly kind: "pending";
      readonly commandId: WitnessCommandId;
      readonly request: ControllerCommand;
      readonly requestFingerprint: string;
    }
  | {
      readonly kind: "completed";
      readonly commandId: WitnessCommandId;
      readonly request: ControllerCommand;
      readonly requestFingerprint: string;
      readonly responseBody:
        | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
        | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
        | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
        | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
        | { readonly kind: "authority_unavailable"; readonly reason: string }
        | { readonly kind: "ok"; readonly result: WitnessPersistedResult | null };
    };

/**
 * Per-binding runtime ports. The runtime is pure with respect to
 * the caller's I/O: it reads from these ports and writes through
 * the channels below.
 */
export type WitnessRuntimePorts = {
  readonly signer: WitnessSigner;
  /** Witness uses this to verify controller-signed destructive commands. */
  readonly controllerVerifier: WitnessVerifier;
  /** Spawn a candidate child process and return its pid/pgid/handle. */
  readonly spawnCandidate: () => Promise<{
    readonly pid: number;
    readonly pgid: number;
  }>;
  /** Send TERM, then KILL, then close; wait for child + group absence. */
  readonly terminateCandidate: () => Promise<WitnessPersistedResult>;
  /** Read the current state of the candidate owned by this witness. */
  readonly observeCandidate: () => Promise<{
    readonly status: WitnessExecutionStatus;
  }>;
  /**
   * Append a witness-evidence record to the durable ledger.
   * Must fsync before resolving.
   */
  readonly appendEvidence: (
    payload: import("./witness-types-persisted.js").PersistedWitnessEvidence,
  ) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
  /** Wall-clock now in ms. */
  readonly now: () => number;
  /** Monotonic clock in ms. */
  readonly monotonic: () => number;
  /** Exit the witness process. */
  readonly exitProcess: (code: number) => never;
};

/**
 * Boot-time binding configuration.
 */
export type WitnessBootstrapConfig = {
  readonly binding: WitnessBinding;
  readonly controllerPublicKeyFingerprint: string;
  readonly socketPath: string;
  readonly protocolVersion: number;
  readonly bootstrapLeaseMs: number;
};
