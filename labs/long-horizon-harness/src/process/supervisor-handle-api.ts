/**
 * CORRECTION09 — Supervisor handle API.
 *
 * The handle returned to callers exposes the four lifecycle
 * methods (handle, cancel, await, awaitOuter) plus the
 * settlement-failure wrapper that the supervisor's lifecycle
 * rides through. Pulled out of supervisor-builder.ts to keep
 * that file under the 400 LOC discipline.
 *
 * CORRECTION04: the wrappedAwait wrapper turns a settlement
 * fsync failure into a typed evidence_persistence_failure
 * WITHOUT mutating the lifecycle's UNMUTATED ProcessResult.
 * CORRECTION05: awaitOuter surfaces the UNMUTATED lifecycle
 * outcome plus the settlement verdict.
 *
 * CORRECTION09: cancel() returns a closure capturing the
 * termination engine and channel — extracted here so the
 * supervisor-builder.ts orchestrator stays small.
 */

import type {
  EscalationEvidence,
  ProcessHandle,
  ProcessId,
  ProcessResult,
  RuntimeEvent,
} from "./process-types.js";
import type { OuterSupervisorResult } from "./outer-supervisor-result.js";
import type { CreateSupervisorArgs } from "./supervisor-builder.js";
import type { EvidenceRuntime } from "./supervisor-evidence-runtime.js";
import { requireCriticalCommit } from "./critical-commit.js";

export type SupervisorHandleInputs = {
  readonly id: ProcessId;
  readonly args: CreateSupervisorArgs;
  readonly lifecyclePromise: Promise<ProcessResult>;
  readonly closeObserved: { current: boolean };
  readonly lastCloseCode: { current: number | null };
  readonly lastCloseSignal: { current: NodeJS.Signals | null };
  readonly cachedPidRef: { current: number | null };
  readonly cachedPgidRef: { current: number | null };
  readonly evidenceRuntime: EvidenceRuntime | null;
  readonly emptyEscalationFn: () => EscalationEvidence;
};

export type SupervisorHandle = {
  readonly handle: () => ProcessHandle;
  readonly cancel: () => void;
  readonly await: () => Promise<ProcessResult>;
  readonly awaitOuter: () => Promise<OuterSupervisorResult>;
};

/**
 * CORRECTION09: build a `cancel()` closure from the engine
 * + termination channel + safe emit. Extracted so
 * supervisor-builder.ts doesn't need to carry this 8-line
 * block.
 */
export function makeCancelFn(args: {
  readonly id: ProcessId;
  readonly engine: {
    hasTerminalCause: () => boolean;
    requestCleanup: (cause: "deadline" | "cancelled") => void;
  };
  readonly safeEmit: (e: RuntimeEvent) => void;
  readonly deadlineController: { abort: () => void };
  readonly resolveTermination: (cause: "deadline" | "cancelled") => void;
}): () => void {
  return (): void => {
    if (args.engine.hasTerminalCause()) return;
    args.safeEmit({ kind: "cancellation_requested", processId: args.id });
    args.engine.requestCleanup("cancelled");
    args.deadlineController.abort();
    args.resolveTermination("cancelled");
  };
}

/**
 * Builds the supervisor handle (handle/cancel/await/awaitOuter)
 * for a wired supervisor. The handle is idempotent: every
 * `await()` call returns the same underlying promise.
 *
 * The settlement-failure wrapper (CORRECTION03 §40/§41,
 * CORRECTION04) is preserved: a settlement fsync failure is
 * surfaced as evidence_persistence_failure(stage=settlement)
 * without mutating the lifecycle's UNMUTATED ProcessResult.
 */
export function buildSupervisorHandle(
  inputs: SupervisorHandleInputs,
  cancelFn: () => void,
): SupervisorHandle {
  const awaitExecution = (): Promise<ProcessResult> =>
    inputs.lifecyclePromise;

  const wrappedAwait: () => Promise<ProcessResult> = (() => {
    let cached: Promise<ProcessResult> | null = null;
    return () => {
      if (cached !== null) return cached;
      cached = (async (): Promise<ProcessResult> => {
        const r = await inputs.lifecyclePromise;
        const isOwnershipFailure =
          r.outcome.kind === "cleanup_failed" &&
          r.outcome.failure.kind === "evidence_persistence_failure" &&
          r.outcome.failure.stage === "ownership";
        // CORRECTION12 §4: identity loss is a TYPED outcome
        // kind. Never infer from ProcessFailure.message.
        // The handle layer pattern-matches on outcome.kind.
        const isSpawnFailed = r.outcome.kind === "spawn_failed";
        const isIdentityLost = r.outcome.kind === "identity_unavailable";
        if (
          inputs.evidenceRuntime !== null &&
          !isOwnershipFailure &&
          !isSpawnFailed &&
          !isIdentityLost
        ) {
          await inputs.evidenceRuntime.tracker.waitAll();
          inputs.evidenceRuntime.safeEmit({
            kind: "process_close_observed",
            processId: inputs.id,
            exitCode: inputs.closeObserved.current
              ? inputs.lastCloseCode.current
              : null,
            signal: inputs.closeObserved.current
              ? inputs.lastCloseSignal.current
              : null,
          });
          const settlement = inputs.evidenceRuntime.safeEmit({
            kind: "process_result_committed",
            processId: inputs.id,
            result: r,
          });
          if (settlement !== null) {
            const outcome = await requireCriticalCommit(settlement);
            if (outcome.kind !== "ok") {
              const message =
                outcome.stage === "internal_malfunction"
                  ? "process_result_committed commit threw: " + outcome.message
                  : "process_result_committed commit failed: " + outcome.message;
              const noCleanupAttempted: EscalationEvidence =
                inputs.emptyEscalationFn();
              return {
                processId: inputs.id,
                spec: inputs.args.spec,
                outcome: {
                  kind: "cleanup_failed",
                  failure: {
                    kind: "evidence_persistence_failure",
                    stage: "settlement",
                    message,
                  },
                  escalation: noCleanupAttempted,
                  stdoutFailure: null,
                  stderrFailure: null,
                },
                stdout: r.stdout,
                stderr: r.stderr,
                startedAtMs: r.startedAtMs,
                finishedAtMs: r.finishedAtMs,
                escalation: noCleanupAttempted,
              };
            }
          }
          await inputs.evidenceRuntime.tracker.waitAll();
        }
        return r;
      })();
      return cached;
    };
  })();

  const handle = (): ProcessHandle => ({
    processId: inputs.id,
    pid: inputs.cachedPidRef.current,
    processGroupId: inputs.cachedPgidRef.current,
  });

  const awaitOuter = async (): Promise<OuterSupervisorResult> => {
    if (inputs.evidenceRuntime === null) {
      throw new Error("awaitOuter requires an evidenceSink");
    }
    const verdict = await wrappedAwait();
    const execution = await awaitExecution();
    if (
      verdict.outcome.kind === "cleanup_failed" &&
      verdict.outcome.failure.kind === "evidence_persistence_failure"
    ) {
      if (verdict.outcome.failure.stage === "ownership") {
        return {
          kind: "ownership_not_durable",
          process: execution,
          failure: {
            kind: "evidence_persistence_failure",
            stage: "ownership",
            message: verdict.outcome.failure.message,
          },
          observedPgid: inputs.cachedPgidRef.current,
          observedPid: inputs.cachedPidRef.current,
        };
      }
      return {
        kind: "settlement_not_durable",
        process: execution,
        failure: {
          kind: "evidence_persistence_failure",
          stage: "settlement",
          message: verdict.outcome.failure.message,
        },
        observedPgid: inputs.cachedPgidRef.current,
        observedPid: inputs.cachedPidRef.current,
      };
    }
    return {
      kind: "durably_settled",
      process: execution,
      observedPgid: inputs.cachedPgidRef.current,
      observedPid: inputs.cachedPidRef.current,
    };
  };

  return { handle, cancel: cancelFn, await: wrappedAwait, awaitOuter };
}
