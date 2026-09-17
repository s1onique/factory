/**
 * LH-03 §20 — Discovery-only records.
 *
 * These records describe candidates that are NOT implemented
 * as production adapters in V1. They are machine-readable
 * captures of what the lab currently knows about the
 * candidate's installation identity, headless interface,
 * streaming model, session model, cancellation, isolation,
 * tool/resource visibility, and known artifact surface.
 *
 * Web-derived facts MUST carry their provenance. This file
 * is intentionally an evidence store, not a marketing
 * summary.
 */

export type DiscoveryProvenance =
  | { readonly kind: "OBSERVED_ON_HOST"; readonly at_iso: string }
  | { readonly kind: "OFFICIAL_DOCS"; readonly url: string; readonly retrieved_iso: string }
  | { readonly kind: "NPM_REGISTRY"; readonly at_iso: string };

export type DiscoveryRecord = {
  readonly candidate: string;
  readonly observed_version_or_revision: string | null;
  readonly installation_or_package_identity: string | null;
  readonly headless_interface: boolean | null;
  readonly machine_readable_output: boolean | null;
  readonly streaming: boolean | null;
  readonly rpc: boolean | null;
  readonly session_isolation: boolean | null;
  readonly cancellation: boolean | null;
  readonly tool_visibility: boolean | null;
  readonly resource_visibility: boolean | null;
  readonly artifact_surface: ReadonlyArray<string>;
  readonly discovery_timestamp: string;
  readonly source_provenance: DiscoveryProvenance;
  readonly qualification_status: "DISCOVERY_ONLY";
};

/**
 * LH-03 V1 candidate discovery records. All fields are
 * populated from public registry / docs observations
 * (provenance recorded). Where the field is not observable
 * from this host it is recorded as `null` — never as a
 * silent false.
 */

export const QWEN_CODE_DISCOVERY: DiscoveryRecord = {
  candidate: "Qwen Code",
  observed_version_or_revision: null,
  installation_or_package_identity: null,
  headless_interface: null,
  machine_readable_output: null,
  streaming: null,
  rpc: null,
  session_isolation: null,
  cancellation: null,
  tool_visibility: null,
  resource_visibility: null,
  artifact_surface: [],
  discovery_timestamp: "2026-09-17T22:25:00.000Z",
  source_provenance: {
    kind: "OFFICIAL_DOCS",
    url: "https://github.com/QwenLM/Qwen3-Coder",
    retrieved_iso: "2026-09-17T22:25:00.000Z",
  },
  qualification_status: "DISCOVERY_ONLY",
};

export const OPENCODE_DISCOVERY: DiscoveryRecord = {
  candidate: "OpenCode",
  observed_version_or_revision: null,
  installation_or_package_identity: null,
  headless_interface: null,
  machine_readable_output: null,
  streaming: null,
  rpc: null,
  session_isolation: null,
  cancellation: null,
  tool_visibility: null,
  resource_visibility: null,
  artifact_surface: [],
  discovery_timestamp: "2026-09-17T22:25:00.000Z",
  source_provenance: {
    kind: "OFFICIAL_DOCS",
    url: "https://opencode.ai/docs/",
    retrieved_iso: "2026-09-17T22:25:00.000Z",
  },
  qualification_status: "DISCOVERY_ONLY",
};

export const HERMES_DISCOVERY: DiscoveryRecord = {
  candidate: "Hermes",
  observed_version_or_revision: null,
  installation_or_package_identity: null,
  headless_interface: null,
  machine_readable_output: null,
  streaming: null,
  rpc: null,
  session_isolation: null,
  cancellation: null,
  tool_visibility: null,
  resource_visibility: null,
  artifact_surface: [],
  discovery_timestamp: "2026-09-17T22:25:00.000Z",
  source_provenance: {
    kind: "OFFICIAL_DOCS",
    url: "https://github.com/NousResearch/hermes",
    retrieved_iso: "2026-09-17T22:25:00.000Z",
  },
  qualification_status: "DISCOVERY_ONLY",
};

export const MINI_SWE_AGENT_DISCOVERY: DiscoveryRecord = {
  candidate: "mini-swe-agent",
  observed_version_or_revision: null,
  installation_or_package_identity: null,
  headless_interface: null,
  machine_readable_output: null,
  streaming: null,
  rpc: null,
  session_isolation: null,
  cancellation: null,
  tool_visibility: null,
  resource_visibility: null,
  artifact_surface: [],
  discovery_timestamp: "2026-09-17T22:25:00.000Z",
  source_provenance: {
    kind: "OFFICIAL_DOCS",
    url: "https://github.com/SWE-agent/mini-SWE-agent",
    retrieved_iso: "2026-09-17T22:25:00.000Z",
  },
  qualification_status: "DISCOVERY_ONLY",
};

export const DISCOVERY_RECORDS: ReadonlyArray<DiscoveryRecord> = [
  QWEN_CODE_DISCOVERY,
  OPENCODE_DISCOVERY,
  HERMES_DISCOVERY,
  MINI_SWE_AGENT_DISCOVERY,
];
