/**
 * LH-06 deterministic long-duration soak laboratory —
 * public module surface.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Consumers (supervisor, scripts, tests) import from this
 * module. The internal modules remain re-exported for direct
 * testing only.
 */
export {
  LH06_CONTRACT,
  LH06_PROFILES,
  LH06_HEAP_ABSOLUTE_TOLERANCE_BYTES,
  LH06_HEAP_RELATIVE_TOLERANCE_FRACTION,
  LH06_HEAP_SLOPE_MAX_BYTES_PER_EPOCH,
  LH06_HEAP_WINDOW_SIZE,
  LH06_LATENCY_RATIO_MAX,
  LH06_LATENCY_ABSOLUTE_TOLERANCE_MS,
  LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS,
  LH06_FULL_DIAGNOSTIC_EVERY_N_EPOCHS,
  LH06_IN_MEMORY_TELEMETRY_CAP,
  LH06_FROZEN_TREE_PATHS,
  LH06_FROZEN_SUBSTRATE_FILES,
} from "./contract.js";

export {
  LH06_RESULT_SCHEMA,
  LH06_SOAK_CONTRACT_VERSION,
  LH06_SCHEDULE_VERSION,
  LH06_LH05_CASE_IDS,
  LH06_LH04_CASE_IDS,
  LH06_EPOCH_LIFECYCLE_COUNT,
  LH06_EPOCH_FAULT_COUNT,
  LH06_EPOCH_CANARY_COUNT,
  LH06_EPOCH_INTEGRITY_CHECKPOINT_COUNT,
  LH06_EPOCH_CLEANUP_CHECKPOINT_COUNT,
  type LH06SoakProfile,
  type LH06FailureKind,
  type LH06Verdict,
  type SoakFaultInjection,
} from "./types.js";

export {
  scheduleForEpoch,
  buildCanonicalEpoch,
  rotateLeft,
  reverseStable,
  SCHEDULE_VERSION,
  type ScheduledCase,
} from "./schedule.js";

export {
  deterministicJson,
  semanticDigest,
  stripVolatile,
  SemanticLedger,
  type SemanticObservation,
  type SemanticLedgerVerdict,
} from "./semantic-ledger.js";

export {
  ResourceLedger,
  injectionAllowedForProfile,
  type OwnedResourceSnapshot,
  type OwnedResourceBalance,
} from "./resource-ledger.js";

export {
  BoundedTelemetryBuffer,
  JsonlTelemetryStream,
  cadenceHit,
  type TelemetryLine,
  type TelemetryKind,
} from "./telemetry.js";

export {
  median,
  olsSlope,
  takeFirst,
  takeLast,
  evaluateHeapStability,
  evaluateLatencyStability,
  type HeapStabilityVerdict,
  type LatencyStabilityVerdict,
} from "./thresholds.js";

export {
  EMPTY_STATE_DIGEST,
  allocateEpochWorkspace,
  closeEpochWorkspace,
  stateResetDigest,
  verifyStateReset,
  LH06_WORKSPACE_ROOT_BASE,
  type SoakWorkspace,
} from "./cleanup.js";

export {
  type LH06EnvironmentIdentity,
  type LH06SubstrateBinding,
  type LH06ResourceSection,
  type LH06LatencySection,
  type LH06FrozenTreeSection,
  type LH06SemanticSection,
  type LH06FailureRecord,
  type LH06Result,
  writeResult,
  writeSupervisorResult,
  publishReconciledJson,
  verdictForFailure,
  DurabilityReconciliationError,
  type PublicationDurability,
} from "./result.js";

export {
  createWorkerState,
  makeRunId,
  type SoakWorkerState,
} from "./worker-state.js";

export {
  defaultRepoRoot,
  envIdentity,
  computeFrozenTreeDigest,
  readRepoCommit,
  substrateBindingFromFiles,
  readJson,
  maybeGc,
} from "./substrate-binding.js";

export { runEpoch, restoreLeak06, prepareLeak06 } from "./epoch.js";
export {
  qualificationMet,
  emitHeartbeat,
  emitFailure,
  captureResourceSample,
  applyInjectionAtEpochStart,
  integrityCheckpoint,
  cleanupCheckpoint,
  emitDiagnosticLine,
} from "./epoch-helpers.js";
export {
  runLh05Case,
  runLh04Case,
  runCanaryBefore,
  runCanaryAfter,
} from "./case-runner.js";

export {
  buildResult,
  parseInjection,
  readOwnedSnapshot,
  type LH06RunLoopArgs,
} from "./result-builder.js";

export {
  buildResourceSection,
  buildLatencySection,
  buildSemanticSection,
  buildFrozenTreeSection,
} from "./section-builders.js";

export {
  runSoakWorker,
  runSoakFromEnv,
  LH06_CORPUS_COUNTS,
} from "./worker-runner.js";

export {
  LH06_COMMIT_WITNESS_SCHEMA,
  publishCommitWitness,
  checkCommitWitness,
  type LH06CommitWitness,
  type WitnessCheckOk,
  type WitnessCheckFail,
} from "./commit-witness.js";

export {
  checkResultShape,
  type ShapeCheckOk,
  type ShapeCheckFail,
} from "./result-shape.js";
