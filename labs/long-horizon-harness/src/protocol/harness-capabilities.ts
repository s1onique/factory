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
 * The capability document. Adapters MUST report at least
 * every key in CAPABILITY_KEYS, with `UNQUALIFIED` for any
 * probe that has not been run.
 */
export type HarnessCapabilities = {
  readonly identity: HarnessQualificationIdentity;
  readonly discovered_at_ms: number;
  readonly capabilities: Readonly<Record<CapabilityKey, CapabilityState>>;
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
  return {
    identity,
    discovered_at_ms,
    capabilities,
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
