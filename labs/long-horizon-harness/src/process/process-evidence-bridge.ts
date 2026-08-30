/**
 * FOUNDATION03 process-evidence bridge — type definitions.
 *
 * The bridge is the narrow seam between the FOUNDATION02 supervisor
 * (which speaks RuntimeEvent) and the durable ledger (which speaks
 * PersistedProcessEvidencePayload). This file declares only types
 * and observers; the dispatch logic lives in
 * process-evidence-bridge-emit.ts to keep this file under the
 * 400 LOC discipline.
 */

import type {
  AttemptId,
  EventId,
  MissionId,
  RunId,
} from "../domain/ids.js";
import type { PersistedProcessEvidencePayload } from "../evidence/codec-types.js";
import type { ProcessEvidenceCommitResult } from "./process-evidence-sink.js";
import type {
  CapturedOutput,
  ProcessId,
  ProcessResult,
} from "./process-types.js";

export type ProcessEvidenceIdentity = {
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly attemptId: AttemptId;
  readonly eventIdFactory: () => EventId;
};

export type EvidenceCommitObserver = {
  readonly onOwnershipDurableCommitFailed: (
    payload: PersistedProcessEvidencePayload,
    result: Extract<ProcessEvidenceCommitResult, { ok: false }>,
  ) => void;
  readonly onNonCriticalCommitFailed: (
    payload: PersistedProcessEvidencePayload,
    result: Extract<ProcessEvidenceCommitResult, { ok: false }>,
  ) => void;
};

export type SyntheticRuntimeEvent =
  | {
      readonly kind: "process_close_observed";
      readonly processId: ProcessId;
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {
      readonly kind: "process_output_summary";
      readonly processId: ProcessId;
      readonly stdout: CapturedOutput;
      readonly stderr: CapturedOutput;
    }
  | {
      readonly kind: "process_result_committed";
      readonly processId: ProcessId;
      readonly result: ProcessResult;
    };
