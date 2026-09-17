/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Pure types, branded identifiers, schema versions, manifest /
 * envelope / projection shapes, and closed-world key constants.
 * The RunEvent vocabulary + supporting union types live in
 * run-event-types.ts (split out for SOURCE_SIZE_DISCIPLINE) and
 * are re-exported below so the public surface is unchanged.
 *
 * Doctrine (E2, E13): the harness/model is NEVER authoritative
 * about success; state derives from owned, versioned evidence.
 *
 * This module is pure: no I/O.
 */

import { createHash } from "node:crypto";

import { IDENTIFIER_GRAMMAR, type SubjectId } from "../subject/index.js";

export { IDENTIFIER_GRAMMAR as RUN_IDENTIFIER_GRAMMAR };

export type {
  RunEvent,
  RunEventType,
  ActionTarget,
  ActionStatus,
  ResourceObservation,
  ResourceObservationKind,
  TerminalSemantic,
  RunFinishedSemantic,
  RunTimeoutSemantic,
  RunAbortedSemantic,
  AgentSelfReport,
  Failure,
} from "./run-event-types.js";
export {
  RUN_EVENT_TYPES,
  TERMINAL_OUTCOMES,
  RUN_FINISHED_SEMANTICS,
  RUN_TIMEOUT_SEMANTICS,
  RUN_ABORTED_SEMANTICS,
  isRunEventType,
  isTerminalSemantic,
  isRunFinishedSemantic,
  isRunTimeoutSemantic,
  isRunAbortedSemantic,
} from "./run-event-types.js";
// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

/**
 * Schema version for the Phase E RunManifest. Bumping this value is a
 * wire-protocol-breaking change for the manifest.
 */
export const RUN_MANIFEST_SCHEMA_VERSION = "phase-e.run.manifest.v1" as const;
export type RunManifestSchemaVersion = typeof RUN_MANIFEST_SCHEMA_VERSION;

/**
 * Schema version for the Phase E RunEvent envelope. Bumping this value
 * is a wire-protocol-breaking change for the event envelope.
 */
export const RUN_EVENT_SCHEMA_VERSION = "phase-e.run.event.v1" as const;
export type RunEventSchemaVersion = typeof RUN_EVENT_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Branded identifier primitives
// ---------------------------------------------------------------------------

declare const __runBrand: unique symbol;

type RunBrand<T, B> = T & { readonly [__runBrand]: B };

/**
 * RunId. Content-bound (see E2): a RunId is a deterministic function
 * of (subject_id, run_schema_version, repetition identity). Two runs
 * whose (subject, schema_version, repetition) tuples match MUST produce
 * the same RunId.
 */
export type RunId = RunBrand<string, "RunId">;

/**
 * RunEventId. Stable opaque token (E-C06):
 *
 *   EVENT_ID_STABLE                      — id does not change
 *                                          once assigned.
 *   EVENT_ID_UNIQUE                      — no two events in the
 *                                          same run share an id.
 *   SAME_ID_DIFFERENT_CONTENT_FAILS_CLOSED
 *                                       — store rejects a retry
 *                                          whose canonical
 *                                          content differs.
 *
 * The default event-id factory in run-store.ts is content-derived
 * (sha-256 of run + sequence + canonical bytes); callers may
 * supply their own factory. Phase E does NOT recompute event-ids
 * at every boundary; the closed-world schema forbids arbitrary
 * caller-supplied ids from bypassing uniqueness tracking.
 */
export type RunEventId = RunBrand<string, "RunEventId">;

/**
 * AttemptId. Identifies one attempt within a run.
 */
export type AttemptId = RunBrand<string, "AttemptId">;

/**
 * GateId. Identifies one gate within a run.
 */
export type GateId = RunBrand<string, "GateId">;

/**
 * RepairCycleId. Identifies one repair cycle within a run.
 */
export type RepairCycleId = RunBrand<string, "RepairCycleId">;

/**
 * ReviewCycleId. Identifies one review cycle within a run.
 */
export type ReviewCycleId = RunBrand<string, "ReviewCycleId">;

// ---------------------------------------------------------------------------
// Brand factories and validators (trust-boundary safe)
// ---------------------------------------------------------------------------

function checkIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_GRAMMAR.test(value)) {
    throw new Error(`Invalid ${label}: must match ${IDENTIFIER_GRAMMAR}`);
  }
}

export function makeRunId(value: string): RunId {
  checkIdentifier(value, "RunId");
  return value as RunId;
}

export function makeRunEventId(value: string): RunEventId {
  checkIdentifier(value, "RunEventId");
  return value as RunEventId;
}

export function makeAttemptId(value: string): AttemptId {
  checkIdentifier(value, "AttemptId");
  return value as AttemptId;
}

export function makeGateId(value: string): GateId {
  checkIdentifier(value, "GateId");
  return value as GateId;
}

export function makeRepairCycleId(value: string): RepairCycleId {
  checkIdentifier(value, "RepairCycleId");
  return value as RepairCycleId;
}

export function makeReviewCycleId(value: string): ReviewCycleId {
  checkIdentifier(value, "ReviewCycleId");
  return value as ReviewCycleId;
}

// ---------------------------------------------------------------------------
// RunEvent vocabulary (type-only re-import for CommittedRunEvent and
// RunProjection shape definitions that follow). The values
// RUN_EVENT_TYPES / TERMINAL_OUTCOMES / isRunEventType / isTerminalSemantic
// are re-exported at the top of this file.
// ---------------------------------------------------------------------------

import type { RunEvent, TerminalSemantic } from "./run-event-types.js";

// ---------------------------------------------------------------------------
// Run-level identity
// ---------------------------------------------------------------------------

/**
 * Repetition identity. `index` is the zero-based repetition number
 * within an experiment; `seed` is an opaque string the experiment
 * optionally supplies. Both fields participate in the RunId derivation.
 */
export type RunRepetition = {
  readonly index: number;
  readonly seed?: string;
};

/**
 * Build the canonical content-bound RunId for a given (subject,
 * schema_version, repetition) tuple.
 *
 * The repetition identity is bound into the hash so that two
 * repetitions of the same subject produce different RunIds. The
 * `seed` field is included when present.
 *
 * Pure: no I/O.
 */
export function computeRunId(args: {
  readonly subjectId: SubjectId;
  readonly runSchemaVersion: RunManifestSchemaVersion;
  readonly repetition: RunRepetition;
}): RunId {
  if (!Number.isInteger(args.repetition.index) || args.repetition.index < 0) {
    throw new Error(
      `RunRepetition.index must be a non-negative integer; got ${args.repetition.index}`,
    );
  }
  const seedPart = args.repetition.seed !== undefined
    ? `|seed:${args.repetition.seed}`
    : "";
  const mat = `run:${args.subjectId}|v=${args.runSchemaVersion}|rep=${args.repetition.index}${seedPart}`;
  const hex = createHash("sha256")
    .update("factory:phase-e:run:id:v1\u0000", "utf8")
    .update(mat, "utf8")
    .digest("hex");
  return ("run:" + hex) as RunId;
}

// ---------------------------------------------------------------------------
// Closed-world keys for the RunManifest
// ---------------------------------------------------------------------------

/**
 * Closed-world list of the top-level keys a RunManifest MUST contain.
 * Unknown top-level keys fail closed at the decoder.
 */
export const RUN_MANIFEST_KEYS = [
  "schema_version",
  "run_id",
  "subject_id",
  "run_protocol_version",
  "runner_revision",
  "started_by",
  "created_at",
  "repetition",
] as const;
export type RunManifestKey = typeof RUN_MANIFEST_KEYS[number];

/**
 * Closed-world list of keys RunRepetition MUST contain.
 */
export const RUN_REPETITION_KEYS = ["index", "seed"] as const;

// ---------------------------------------------------------------------------
// RunManifest
// ---------------------------------------------------------------------------

/**
 * The immutable, versioned RunManifest. Wall-clock fields (created_at,
 * observed_at on events) are observations/metadata, not identity
 * material. Run identity derives from (subject_id, schema_version,
 * repetition identity) per E2.
 */
export type RunManifest = {
  readonly schema_version: RunManifestSchemaVersion;
  readonly run_id: RunId;
  readonly subject_id: SubjectId;
  readonly run_protocol_version: string;
  readonly runner_revision: string;
  readonly started_by: string;
  readonly created_at: number;
  readonly repetition: RunRepetition;
};

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// CommittedRunEvent (envelope + metadata stamped by the append store)
// ---------------------------------------------------------------------------

export type CommittedRunEvent = {
  readonly schema_version: RunEventSchemaVersion;
  readonly event_id: RunEventId;
  readonly run_id: RunId;
  readonly subject_id: SubjectId;
  readonly sequence: number;
  readonly event: RunEvent;
  readonly observed_at: number;
};

/**
 * Closed-world key set for the persisted envelope. Used by the
 * envelope decoder to reject unknown keys.
 */
export const COMMITTED_RUN_EVENT_KEYS = [
  "schema_version",
  "event_id",
  "run_id",
  "subject_id",
  "sequence",
  "event",
  "observed_at",
] as const;

// ---------------------------------------------------------------------------
// RunProjection
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a run as projected from its evidence stream.
 *
 * - ACTIVE             : a terminal event has not been observed.
 * - TERMINAL           : at least one compatible terminal event has been
 *                        observed and the projector derived a single
 *                        terminal_outcome from it.
 * - INCOMPLETE         : the projector was given an empty stream OR a
 *                        stream ending without a terminal event.
 * - INVALID_EVIDENCE   : the projector observed two or more incompatible
 *                        terminal claims, an unknown event type, a
 *                        sequence / identity violation it cannot ignore,
 *                        or a structural event it cannot recover from.
 */
export type LifecycleState =
  | "ACTIVE"
  | "TERMINAL"
  | "INCOMPLETE"
  | "INVALID_EVIDENCE";

export type CurrentAttemptView =
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly attempt_id: AttemptId }
  | { readonly kind: "closed" };

export type CurrentGateView =
  | { readonly kind: "none" }
  | {
      readonly kind: "running";
      readonly gate_id: GateId;
      readonly attempt_id: AttemptId;
    }
  | {
      readonly kind: "finished";
      readonly gate_id: GateId;
      readonly attempt_id: AttemptId;
      readonly pass: boolean;
    };

export type RunProjection = {
  readonly run_id: RunId;
  readonly subject_id: SubjectId;
  readonly lifecycle_state: LifecycleState;
  readonly terminal_outcome: TerminalSemantic | null;
  readonly current_attempt: CurrentAttemptView;
  readonly current_gate: CurrentGateView;
  readonly repair_count: number;
  readonly review_count: number;
  readonly last_sequence: number;
  readonly event_count: number;
};

export type ProjectionFailure =
  | { readonly kind: "identity_mismatch"; readonly field: string; readonly reason: string }
  | { readonly kind: "illegal_sequence"; readonly reason: string }
  | { readonly kind: "illegal_event"; readonly reason: string }
  | { readonly kind: "conflicting_terminal"; readonly reason: string }
  | { readonly kind: "evidence_failure"; readonly reason: string };

export type ProjectionResult =
  | { readonly ok: true; readonly value: RunProjection }
  | { readonly ok: false; readonly failure: ProjectionFailure };

// ---------------------------------------------------------------------------
// Sequence constants
// ---------------------------------------------------------------------------

/**
 * The fixed first sequence number for a run. Per E4.
 */
export const FIRST_SEQUENCE = 1 as const;

// ---------------------------------------------------------------------------
// Closed-world payload keys (used by the decoder to reject unknown
// fields). These live with the RunEvent vocabulary in
// run-event-types.ts so that any vocabulary change forces a
// co-located change to the closed-world key list. They are
// re-exported below for callers that prefer to import from
// "./run-types.js".
// ---------------------------------------------------------------------------

export {
  ACTION_TARGET_KEYS,
  ACTION_STARTED_KEYS,
  ACTION_FINISHED_KEYS,
  GATE_STARTED_KEYS,
  GATE_FINISHED_KEYS,
  REPAIR_STARTED_KEYS,
  REPAIR_FINISHED_KEYS,
  REVIEW_STARTED_KEYS,
  REVIEW_FINISHED_KEYS,
  RUN_CANCEL_REQUESTED_KEYS,
  RUN_TIMEOUT_KEYS,
  RUN_FINISHED_KEYS,
  RUN_ABORTED_KEYS,
  AGENT_SELF_REPORT_KEYS,
  RESOURCE_OBSERVATION_KEYS,
} from "./run-event-types.js";
