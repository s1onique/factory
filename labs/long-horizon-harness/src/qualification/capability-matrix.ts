/**
 * LH-03 §21 — Capability matrix (machine-readable).
 *
 * The matrix is factual qualification evidence, NOT selection
 * evidence. There is no `score`, `rank`, `winner`, or
 * `preferred` column. The qualification_status field is the
 * only status column and it is closed-world.
 */

import type { HarnessKind, HarnessQualificationIdentity } from "../protocol/index.js";
import type { HarnessCapabilities, CapabilityKey } from "../protocol/index.js";

export type QualificationStatus =
  | "QUALIFIED"
  | "QUALIFIED_WITH_LIMITATIONS"
  | "DISCOVERY_ONLY"
  | "UNQUALIFIED"
  | "UNSUPPORTED_VERSION";

export const QUALIFICATION_STATUSES: readonly QualificationStatus[] = [
  "QUALIFIED",
  "QUALIFIED_WITH_LIMITATIONS",
  "DISCOVERY_ONLY",
  "UNQUALIFIED",
  "UNSUPPORTED_VERSION",
] as const;

/**
 * A single capability-matrix row. Pure data; the matrix is
 * just a JSON-serialisable list of these.
 */
export type CapabilityMatrixRow = {
  readonly candidate: HarnessKind;
  readonly qualification_identity: HarnessQualificationIdentity | null;
  readonly protocol: string;
  readonly headless: string;
  readonly streaming_events: string;
  readonly final_json: string;
  readonly jsonl: string;
  readonly rpc: string;
  readonly session_resume: string;
  readonly session_fork: string;
  readonly explicit_cwd: string;
  readonly isolated_state: string;
  readonly model_selection: string;
  readonly provider_selection: string;
  readonly timeout: string;
  readonly cancellation: string;
  readonly tool_visibility: string;
  readonly token_visibility: string;
  readonly resource_visibility: string;
  readonly replay_fixture: string;
  readonly qualification_status: QualificationStatus;
};

/**
 * Build a capability-matrix row from a HarnessCapabilities
 * document (if any) plus optional overrides.
 */
export function rowFromCapabilities(args: {
  readonly candidate: HarnessKind;
  readonly qualification_identity: HarnessQualificationIdentity | null;
  readonly capabilities: HarnessCapabilities | null;
  readonly replay_fixture: string;
  readonly qualification_status: QualificationStatus;
}): CapabilityMatrixRow {
  const c = args.capabilities?.capabilities ?? null;
  const lookup = (k: CapabilityKey): string => {
    if (c === null) return "UNQUALIFIED";
    const v = c[k];
    return v ?? "UNQUALIFIED";
  };
  return {
    candidate: args.candidate,
    qualification_identity: args.qualification_identity,
    protocol:
      args.qualification_identity?.protocol_mode ?? "UNKNOWN",
    headless: lookup("HEADLESS"),
    streaming_events: lookup("STREAMING_EVENTS"),
    final_json: lookup("FINAL_JSON"),
    jsonl: lookup("JSONL"),
    rpc: lookup("RPC"),
    session_resume: lookup("SESSION_RESUME"),
    session_fork: lookup("SESSION_FORK"),
    explicit_cwd: lookup("EXPLICIT_CWD"),
    isolated_state: lookup("ISOLATED_DATA_DIR"),
    model_selection: lookup("MODEL_SELECTION"),
    provider_selection: lookup("PROVIDER_SELECTION"),
    timeout: lookup("TIMEOUT"),
    cancellation: lookup("CANCELLATION"),
    tool_visibility: lookup("TOOL_EVENT_VISIBILITY"),
    token_visibility: lookup("TOKEN_USAGE"),
    resource_visibility: lookup("RESOURCE_USAGE"),
    replay_fixture: args.replay_fixture,
    qualification_status: args.qualification_status,
  };
}
