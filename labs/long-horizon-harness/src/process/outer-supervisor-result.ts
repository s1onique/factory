/**
 * FOUNDATION03 — typed outer result for the supervisor.
 *
 * CORRECTION04 §29: separates the execution outcome from the
 * settlement durability outcome. The original execution
 * ProcessResult is preserved alongside the typed
 * evidence_persistence_failure verdict.
 *
 * CORRECTION05 §18: awaitOuter() supplies the UNMUTATED lifecycle
 * ProcessResult as `process`, never collapsing it into
 * cleanup_failed.
 */

import type { ProcessResult } from "./process-types.js";

export type OuterSupervisorResult =
  | {
      kind: "durably_settled";
      process: ProcessResult;
      /** The OS process group ID actually observed for this execution. */
      observedPgid: number | null;
      /** The OS PID actually observed for this execution. */
      observedPid: number | null;
    }
  | {
      kind: "settlement_not_durable";
      process: ProcessResult;
      failure: { kind: "evidence_persistence_failure"; stage: "settlement"; message: string };
      observedPgid: number | null;
      observedPid: number | null;
    }
  | {
      kind: "ownership_not_durable";
      process: ProcessResult;
      failure: { kind: "evidence_persistence_failure"; stage: "ownership"; message: string };
      observedPgid: number | null;
      observedPid: number | null;
    };
