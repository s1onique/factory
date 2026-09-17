/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Public re-exports for the Phase E contract.
 *
 * Consumers (runners, UIs, tests) MUST import from this barrel
 * rather than from individual modules. The barrel is the single
 * author-named import surface; renaming or refactoring an
 * internal module MUST NOT change the names exposed here
 * without a corresponding bump of
 * RUN_MANIFEST_SCHEMA_VERSION / RUN_EVENT_SCHEMA_VERSION
 * and an explicit compatibility note.
 */

export type {
  AttemptId,
  CommittedRunEvent,
  GateId,
  ProjectionFailure,
  ProjectionResult,
  RepairCycleId,
  ReviewCycleId,
  RunEvent,
  RunEventId,
  RunId,
  RunManifest,
  RunProjection,
  TerminalSemantic,
  ResourceObservation,
  AgentSelfReport,
  LifecycleState,
  CurrentAttemptView,
  CurrentGateView,
  RunEventType,
  ActionStatus,
  RunRepetition,
} from "./run-types.js";

export {
  FIRST_SEQUENCE,
  RUN_EVENT_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  computeRunId,
  isRunEventType,
  isTerminalSemantic,
  makeAttemptId,
  makeGateId,
  makeRepairCycleId,
  makeReviewCycleId,
  makeRunEventId,
  makeRunId,
} from "./run-types.js";

export {
  snapshotJsonValue,
  validateJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type JsonValidation,
} from "./run-json.js";

export {
  decodeRunEventEnvelope,
} from "./run-decode-envelope.js";

export { decodeRunEventPayload } from "./run-decode-payload.js";

export { decodeRunManifest } from "./run-decode-manifest.js";

export {
  projectRun,
  projectEmptyRun,
  successEvidencePredicateSatisfied,
} from "./run-projector.js";

export {
  applyLegality,
  emptyTracker,
  type LegalityTracker,
  type LegalityResult,
} from "./run-events.js";

export {
  InMemoryRunStore,
  makeContentBoundEventIdSource,
  makeInMemoryRunStore,
  type Clock,
  type EventIdSource,
  type StoreFailure,
  type StoreResult,
} from "./run-store.js";

export {
  encodeRunEventEnvelope,
  encodeRunEventLine,
  encodeRunManifest,
  snapshotRunEventEnvelope,
} from "./run-serialize.js";
