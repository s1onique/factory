/**
 * Candidate-neutral harness capability types (LH-03 §4.1, H3).
 *
 * Capabilities describe what an adapter can actually probe
 * against the binary it discovered, not what the harness's
 * documentation claims. Each capability is bound to a
 * closed-world key list so that adding a capability is a
 * schema-visible, contract-bound change.
 *
 * CapabilityState distinguishes SUPPORTED / UNSUPPORTED /
 * UNAVAILABLE / UNQUALIFIED. UNAVAILABLE means the harness
 * does not expose the capability at all (so LH-02 metrics
 * that depend on it become unavailable, not zero).
 * UNQUALIFIED means the adapter has not yet run the probe
 * for this capability against the installed binary.
 *
 * Doctrine (D08): no candidate-specific capability names
 * (e.g. `clineToolStreaming`) appear here.
 */

import type { HarnessQualificationIdentity } from "./harness-identity.js";

/**
 * Closed-world capability states (LH-03 §4.1). The contract
 * never uses `false` to mean "missing"; absence/unknown is
 * always `UNAVAILABLE` or `UNQUALIFIED`, distinct from
 * `UNSUPPORTED` (probe ran and got `false`).
 */
export type CapabilityState =
  | "SUPPORTED"
  | "UNSUPPORTED"
  | "UNAVAILABLE"
  | "UNQUALIFIED";

export const CAPABILITY_STATES: readonly CapabilityState[] = [
  "SUPPORTED",
  "UNSUPPORTED",
  "UNAVAILABLE",
  "UNQUALIFIED",
] as const;

export function isCapabilityState(value: unknown): value is CapabilityState {
  return (
    typeof value === "string" &&
    (CAPABILITY_STATES as readonly string[]).includes(value)
  );
}

/**
 * Closed-world list of candidate-neutral capability keys.
 * Adding a key is a contract change (LH-03 H3).
 */
export type CapabilityKey =
  | "HEADLESS"
  | "STREAMING_EVENTS"
  | "FINAL_JSON"
  | "JSONL"
  | "RPC"
  | "SESSION_RESUME"
  | "SESSION_FORK"
  | "EXPLICIT_CWD"
  | "ISOLATED_DATA_DIR"
  | "MODEL_SELECTION"
  | "PROVIDER_SELECTION"
  | "TIMEOUT"
  | "CANCELLATION"
  | "AUTO_APPROVAL"
  | "TOOL_EVENT_VISIBILITY"
  | "TOKEN_USAGE"
  | "RESOURCE_USAGE"
  | "SESSION_ARTIFACTS";

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  "HEADLESS",
  "STREAMING_EVENTS",
  "FINAL_JSON",
  "JSONL",
  "RPC",
  "SESSION_RESUME",
  "SESSION_FORK",
  "EXPLICIT_CWD",
  "ISOLATED_DATA_DIR",
  "MODEL_SELECTION",
  "PROVIDER_SELECTION",
  "TIMEOUT",
  "CANCELLATION",
  "AUTO_APPROVAL",
  "TOOL_EVENT_VISIBILITY",
  "TOKEN_USAGE",
  "RESOURCE_USAGE",
  "SESSION_ARTIFACTS",
] as const;

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return (
    typeof value === "string" &&
    (CAPABILITY_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Live qualification state (LH-03 CORRECTION01, H-C06).
 *
 * Distinct from `CapabilityState`. A capability can be
 * declared as `SUPPORTED` (the harness exposes it) but
 * still be `LIVE_UNQUALIFIED` (the V1 adapter has not yet
 * run a live probe for it). Conflating these axes is the
 * bug the original LH-03 closure made for `SESSION_RESUME`
 * and `SESSION_FORK`.
 */
export type LiveQualificationState =
  | "LIVE_QUALIFIED"
  | "LIVE_UNQUALIFIED"
  | "LIVE_HALT"
  | "NOT_APPLICABLE";

export const LIVE_QUALIFICATION_STATES: readonly LiveQualificationState[] = [
  "LIVE_QUALIFIED",
  "LIVE_UNQUALIFIED",
  "LIVE_HALT",
  "NOT_APPLICABLE",
] as const;

export function isLiveQualificationState(
  value: unknown,
): value is LiveQualificationState {
  return (
    typeof value === "string" &&
    (LIVE_QUALIFICATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * Per-capability axis binding (LH-03 CORRECTION01, H-C06).
 *
 * Each entry pairs a `CapabilityState` (HARNESS_CAPABILITY
 * — does the harness itself expose the feature?) with a
 * `LiveQualificationState` (did the V1 adapter actually
 * probe it during this qualification campaign?).
 *
 * The contract never mixes the two meanings in a single
 * field. A capability may be:
 *
 *   - SUPPORTED + LIVE_QUALIFIED        — adapter exercised it
 *   - SUPPORTED + LIVE_UNQUALIFIED      — known supported but
 *                                          not probed in this run
 *   - SUPPORTED + LIVE_HALT             — probe was attempted
 *                                          but halted (e.g.
 *                                          HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE)
 *   - UNSUPPORTED                       — harness does not expose
 *   - UNAVAILABLE                       — harness cannot expose
 *   - UNQUALIFIED + LIVE_UNQUALIFIED    — probe not run
 */
export type CapabilityAxis = {
  readonly harness_capability: CapabilityState;
  readonly live_qualification: LiveQualificationState;
  readonly probe_evidence_path: string | null;
};

/**
 * The capability document. Adapters MUST report at least
 * every key in CAPABILITY_KEYS, with `UNQUALIFIED` for any
 * probe that has not been run.
 *
 * CORRECTION01 (H-C06): the document carries the
 * `live_qualification_by_key` axis as well as the
 * closed-world `capabilities` map. Both are bound to the
 * same identity tuple. The two axes MUST NOT be derived
 * from each other.
 */
export type HarnessCapabilities = {
  readonly identity: HarnessQualificationIdentity;
  readonly discovered_at_ms: number;
  readonly capabilities: Readonly<Record<CapabilityKey, CapabilityState>>;
  readonly live_qualification_by_key: Readonly<
    Record<CapabilityKey, LiveQualificationState>
  >;
  readonly capability_axes: Readonly<Record<CapabilityKey, CapabilityAxis>>;
};

export function emptyCapabilities(
  identity: HarnessQualificationIdentity,
  discovered_at_ms: number,
): HarnessCapabilities {
  const capabilities: Record<CapabilityKey, CapabilityState> = {
    HEADLESS: "UNQUALIFIED",
    STREAMING_EVENTS: "UNQUALIFIED",
    FINAL_JSON: "UNQUALIFIED",
    JSONL: "UNQUALIFIED",
    RPC: "UNQUALIFIED",
    SESSION_RESUME: "UNQUALIFIED",
    SESSION_FORK: "UNQUALIFIED",
    EXPLICIT_CWD: "UNQUALIFIED",
    ISOLATED_DATA_DIR: "UNQUALIFIED",
    MODEL_SELECTION: "UNQUALIFIED",
    PROVIDER_SELECTION: "UNQUALIFIED",
    TIMEOUT: "UNQUALIFIED",
    CANCELLATION: "UNQUALIFIED",
    AUTO_APPROVAL: "UNQUALIFIED",
    TOOL_EVENT_VISIBILITY: "UNQUALIFIED",
    TOKEN_USAGE: "UNQUALIFIED",
    RESOURCE_USAGE: "UNQUALIFIED",
    SESSION_ARTIFACTS: "UNQUALIFIED",
  };
  const live: Record<CapabilityKey, LiveQualificationState> = {
    HEADLESS: "LIVE_UNQUALIFIED",
    STREAMING_EVENTS: "LIVE_UNQUALIFIED",
    FINAL_JSON: "LIVE_UNQUALIFIED",
    JSONL: "LIVE_UNQUALIFIED",
    RPC: "LIVE_UNQUALIFIED",
    SESSION_RESUME: "LIVE_UNQUALIFIED",
    SESSION_FORK: "LIVE_UNQUALIFIED",
    EXPLICIT_CWD: "LIVE_UNQUALIFIED",
    ISOLATED_DATA_DIR: "LIVE_UNQUALIFIED",
    MODEL_SELECTION: "LIVE_UNQUALIFIED",
    PROVIDER_SELECTION: "LIVE_UNQUALIFIED",
    TIMEOUT: "LIVE_UNQUALIFIED",
    CANCELLATION: "LIVE_UNQUALIFIED",
    AUTO_APPROVAL: "LIVE_UNQUALIFIED",
    TOOL_EVENT_VISIBILITY: "LIVE_UNQUALIFIED",
    TOKEN_USAGE: "LIVE_UNQUALIFIED",
    RESOURCE_USAGE: "LIVE_UNQUALIFIED",
    SESSION_ARTIFACTS: "LIVE_UNQUALIFIED",
  };
  const axes: Record<CapabilityKey, CapabilityAxis> = {} as Record<
    CapabilityKey,
    CapabilityAxis
  >;
  for (const k of CAPABILITY_KEYS) {
    axes[k] = {
      harness_capability: capabilities[k],
      live_qualification: live[k],
      probe_evidence_path: null,
    };
  }
  return {
    identity,
    discovered_at_ms,
    capabilities,
    live_qualification_by_key: live,
    capability_axes: axes,
  };
}

/**
 * Frozen-set check used by capability-document tests. Adapters
 * MUST NOT silently omit a key from the document; omission is
 * a contract violation.
 */
export function assertCapabilitiesComplete(
  caps: HarnessCapabilities,
): { readonly ok: true } | { readonly ok: false; readonly missing: readonly CapabilityKey[] } {
  const missing: CapabilityKey[] = [];
  for (const k of CAPABILITY_KEYS) {
    if (!(k in caps.capabilities)) {
      missing.push(k);
    }
  }
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}
