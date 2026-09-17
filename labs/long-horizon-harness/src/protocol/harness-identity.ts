/**
 * Candidate-neutral harness identity types (LH-03 §4.1, H2).
 *
 * These types describe the qualification identity of a real
 * coding harness in a way that does NOT depend on the name of
 * the harness. Two harnesses whose display versions match but
 * whose identities differ in any other component are NOT the
 * same qualified subject (LH-03 §1.4 invariant).
 *
 * Doctrine (D08): no candidate-specific identifier names (e.g.
 * `clineSessionId`, `piRPCMessage`) appear here. All cross-
 * adapter identity vocabulary is closed-world and
 * candidate-neutral.
 */

import type { HarnessKind } from "./harness-adapter.js";

/**
 * The closed-world set of protocol modes the lab recognises.
 * `RPC` covers request/response framing; `JSONL_EVENTS` covers
 * line-delimited JSON event streaming; `HYBRID` covers harnesses
 * that mix RPC + event channels; `UNKNOWN` is the explicit
 * failure state for harnesses that do not declare a mode.
 */
export type ProtocolMode =
  | "RPC"
  | "JSONL_EVENTS"
  | "HYBRID"
  | "UNKNOWN";

export const PROTOCOL_MODES: readonly ProtocolMode[] = [
  "RPC",
  "JSONL_EVENTS",
  "HYBRID",
  "UNKNOWN",
] as const;

export function isProtocolMode(value: unknown): value is ProtocolMode {
  return (
    typeof value === "string" &&
    (PROTOCOL_MODES as readonly string[]).includes(value)
  );
}

/**
 * The complete HarnessQualificationIdentity tuple. Every
 * component must be supplied for a fully-qualified run;
 * `null` for any component means the run is
 * `qualified-with-limitations` (LH-03 §1.4).
 */
export type HarnessQualificationIdentity = {
  readonly harness_name: HarnessKind;
  readonly package_name: string | null;
  readonly package_version: string | null;
  readonly executable_path: string | null;
  readonly executable_sha256: string | null;
  readonly reported_cli_version: string | null;
  readonly protocol_mode: ProtocolMode;
  readonly native_schema_fingerprint: string | null;
};

/**
 * Required negative oracle (LH-03 §1.4):
 *
 *   SAME_DISPLAY_VERSION  !=  SAME_QUALIFIED_HARNESS
 *
 * unless the COMPLETE qualification identity agrees
 * component-by-component. `executable_sha256` and
 * `native_schema_fingerprint` are the two components that
 * MUST match — the others may legitimately match across
 * installations while the binary or schema has changed.
 */
export function qualificationIdentityEquals(
  a: HarnessQualificationIdentity,
  b: HarnessQualificationIdentity,
): boolean {
  return (
    a.harness_name === b.harness_name &&
    a.package_name === b.package_name &&
    a.package_version === b.package_version &&
    a.executable_path === b.executable_path &&
    a.executable_sha256 === b.executable_sha256 &&
    a.reported_cli_version === b.reported_cli_version &&
    a.protocol_mode === b.protocol_mode &&
    a.native_schema_fingerprint === b.native_schema_fingerprint
  );
}

/**
 * Whether a qualification identity is fully bound (no `null`
 * slots). A run with any null component is
 * `qualified-with-limitations` and cannot be treated as
 * fully-qualified.
 */
export function isFullyQualifiedIdentity(
  identity: HarnessQualificationIdentity,
): boolean {
  return (
    identity.package_name !== null &&
    identity.package_version !== null &&
    identity.executable_path !== null &&
    identity.executable_sha256 !== null &&
    identity.reported_cli_version !== null &&
    identity.native_schema_fingerprint !== null
  );
}

/**
 * Adapter-side identity. Always recorded alongside (never
 * folded into) the candidate's HarnessQualificationIdentity.
 * Adapters are versioned independently of the harnesses they
 * wrap; a Pi 0.85.1 adapter at revision X must be reportable
 * separately from a Pi 0.85.1 binary on disk.
 */
export type HarnessIdentity = {
  readonly adapter_name: string;
  readonly adapter_version: string;
  readonly adapter_revision: string | null;
  readonly qualification: HarnessQualificationIdentity;
  readonly captured_at_ms: number;
};
