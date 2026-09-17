/**
 * Extended candidate-neutral harness adapter contract
 * (LH-03 §4 — H1, §4.1).
 *
 * Doctrine:
 *   - The existing V1 contract (`harness-adapter.ts`,
 *     `kind/start/events/interrupt/status`) remains stable.
 *     D08 callers and the scripted fake adapter MUST continue
 *     to type-check and pass tests.
 *   - V2 is an OPT-IN extension. Adapters that need richer
 *     lifecycle access implement `HarnessAdapterV2`. Adapters
 *     that don't (e.g. the scripted fake) remain V1-only and
 *     expose richer behaviour through the existing V1 surface.
 *   - V2 introduces the candidate-neutral lifecycle
 *     vocabulary required by H4 (raw evidence), H5
 *     (deterministic normalisation), H11 (cancellation
 *     semantics), H13 (environment capture), and H22 (version
 *     drift fail-closed).
 *
 *   - No candidate-specific terms appear here. Cline and Pi
 *     adapters implement this surface; their candidate-
 *     specific types stay inside their own packages.
 */

import type { HarnessHandle } from "../domain/ids.js";
import type {
  HarnessIdentity,
  ProtocolMode,
} from "./harness-identity.js";
import type {
  HarnessCapabilities,
  CapabilityKey,
} from "./harness-capabilities.js";
import type {
  HarnessProcessResult,
  HarnessRawArtifact,
  HarnessCancellationResult,
  PreparedHarnessRun,
} from "./harness-run.js";
import type { HarnessAdapterError } from "./harness-adapter-errors.js";

/**
 * The extended V2 port. An adapter that implements V2 MUST
 * still implement the V1 surface (`kind`, `start`, `events`,
 * `interrupt`, `status`).
 *
 * The new methods are candidate-neutral and never invent
 * terminal authority: they expose raw evidence and lifecycle
 * facts; Phase E decides what those mean.
 */
export interface HarnessAdapterV2 {
  /**
   * Static identity of the adapter instance, including the
   * complete HarnessQualificationIdentity tuple.
   */
  identity(): HarnessIdentity;

  /**
   * Capability document for the discovered harness binary.
   * MUST include every key in CAPABILITY_KEYS, with
   * `UNQUALIFIED` for any probe not yet run.
   */
  capabilities(): HarnessCapabilities;

  /**
   * Build a PreparedHarnessRun. Pure: no subprocess spawn,
   * no I/O beyond reading captured identity from the
   * discovery step.
   */
  prepareRun(input: {
    readonly handle: HarnessHandle;
    readonly args: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly timeout_ms: number | null;
  }): PreparedHarnessRun;

  /**
   * Ask the harness to cancel. Distinct from "process
   * exited" — the cancellation result records whether the
   * candidate acknowledged the request, not whether the
   * process is gone.
   */
  requestCancel(handle: HarnessHandle): Promise<HarnessCancellationResult>;

  /**
   * Wait for the harness process to exit and return the
   * observed lifecycle result. NEVER maps the result to a
   * terminal outcome.
   */
  awaitExit(handle: HarnessHandle): Promise<HarnessProcessResult>;

  /**
   * Collect raw artifacts (stdout, stderr, native events,
   * selected session files). MUST be deterministic over the
   * same captured raw evidence.
   */
  collectArtifacts(handle: HarnessHandle): Promise<ReadonlyArray<HarnessRawArtifact>>;

  /**
   * Free per-run resources. Adapters MUST be safe to call
   * this exactly once per handle; subsequent calls are no-ops.
   */
  cleanup(handle: HarnessHandle): Promise<void>;
}

/**
 * Closed-world decoder keys for unknown native events. Used
 * by tests and negative-oracle probes.
 */
export const CAPABILITY_KEY_LIST = "CapabilityKey" as const;
export const PROTOCOL_MODE_LIST = "ProtocolMode" as const;

/**
 * Test-time helper. Compute the V2-capability coverage for a
 * given adapter. An adapter is "fully V2-capable" iff every
 * capability key has been resolved (SUPPORTED, UNSUPPORTED,
 * or UNAVAILABLE — i.e. NOT UNQUALIFIED).
 */
export function isCapabilitiesResolved(
  caps: HarnessCapabilities,
): boolean {
  for (const k of Object.keys(caps.capabilities) as CapabilityKey[]) {
    if (caps.capabilities[k] === "UNQUALIFIED") {
      return false;
    }
  }
  return true;
}

/**
 * V2 adapter constructor input. Identity is captured at
 * construction; the adapter refuses to start a run if the
 * bound identity cannot be reproduced (LH-03 H22).
 */
export type AdapterV2Init = {
  readonly identity: HarnessIdentity;
  readonly protocol_mode: ProtocolMode;
  readonly capabilities: HarnessCapabilities;
};

/**
 * Common V2 error envelope used by adapters for "the harness
 * reported something we don't recognise". The error carries
 * the raw record for replay / diagnostics.
 */
export type UnknownNativeEventError = {
  readonly kind: "unknown_native_event";
  readonly raw_record: Readonly<Record<string, unknown>>;
  readonly fingerprint: string | null;
} & HarnessAdapterError;
