/**
 * Candidate-neutral lifecycle and raw-evidence types
 * (LH-03 §4.1, §8, §14).
 *
 * These types carry the observed raw harness lifecycle as
 * STRUCTURED evidence, separately from any normalisation to
 * Phase E events. The adapter layer never collapses
 * "process_exit_code == 0" into "harness succeeded"; the lab
 * keeps the raw distinction (LH-03 §14).
 *
 * Doctrine (D08): no candidate-specific terms appear here.
 */

import type { HarnessQualificationIdentity } from "./harness-identity.js";
import type { HarnessCapabilities } from "./harness-capabilities.js";
import type { HarnessAdapterError } from "./harness-adapter-errors.js";

/**
 * A prepared harness run. Carries the inputs the adapter
 * received (raw, not yet normalised), the identity of the
 * binary it will execute against, and the lifecycle state
 * before execution begins.
 *
 * The handle is the candidate-neutral correlation token used
 * to attach lifecycle observations back to the run.
 */
export type PreparedHarnessRun = {
  readonly handle: string;
  readonly identity: HarnessQualificationIdentity;
  readonly capabilities: HarnessCapabilities;
  readonly command: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdin?: string;
  readonly started_at_ms: number | null;
  readonly timeout_ms: number | null;
};

/**
 * The observed harness process lifecycle outcome. These
 * facts are preserved independently before normalisation
 * (LH-03 §14):
 *
 *   process_spawned       — the subprocess was created
 *   process_exit_code     — exit code, if available
 *   process_exit_signal   — signal name, if killed by signal
 *   cancel_requested      — adapter received a cancel
 *   timeout_initiated     — adapter hit its timeout deadline
 *   external_kill_used    — adapter had to externally kill
 *   native_abort_observed — harness declared an abort
 *
 * The mapping `SIGTERM => CANCELLED` is FORBIDDEN; the
 * distinction lives here so Phase E can decide.
 */
export type HarnessProcessResult = {
  readonly process_spawned: boolean;
  readonly process_exit_code: number | null;
  readonly process_exit_signal: string | null;
  readonly cancel_requested: boolean;
  readonly timeout_initiated: boolean;
  readonly external_kill_used: boolean;
  readonly native_abort_observed: boolean;
  readonly exit_at_ms: number | null;
  readonly adapter_errors: ReadonlyArray<HarnessAdapterError>;
};

/**
 * Raw artifact kind. Closed-world so adapters cannot smuggle
 * candidate-specific kinds past Phase E.
 *
 * CORRECTION01 (H-C05): added `RAW_ARGV` and `RAW_ENV`
 * kinds so the durable live-capture path can surface the
 * redacted argv/env material to the artifact collector.
 * Without these kinds, argv/env live in the private
 * `run.command` / `run.env` and the live-capture
 * secret-leak oracle cannot inspect them.
 */
export type HarnessRawArtifactKind =
  | "STDOUT_BYTES"
  | "STDERR_BYTES"
  | "STDOUT_LINES"
  | "STDERR_LINES"
  | "NATIVE_EVENT"
  | "SELECTED_SESSION_FILE"
  | "RAW_ARGV"
  | "RAW_ENV";

export type HarnessRawArtifact = {
  readonly kind: HarnessRawArtifactKind;
  readonly name: string;
  readonly captured_at_ms: number;
  readonly bytes?: Uint8Array;
  readonly text?: string;
  readonly record?: Readonly<Record<string, unknown>>;
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly sha256?: string;
};

/**
 * Result of a candidate cancel request. Distinct from
 * "process exited", which is a HarnessProcessResult fact.
 */
export type HarnessCancellationResult = {
  readonly cancel_requested: boolean;
  readonly cancel_acknowledged: boolean;
  readonly adapter_error: HarnessAdapterError | null;
};
