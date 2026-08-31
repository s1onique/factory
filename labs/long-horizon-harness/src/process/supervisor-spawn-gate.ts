/**
 * CORRECTION08 — supervisor spawn gate.
 *
 * The pre-spawn durability gate. When a process-evidence sink
 * is configured, the durable intent record
 * `process_spawn_requested` MUST be acknowledged
 * (fsync ACK SUCCESS) BEFORE the OS `spawn()` call is
 * performed. Without this guarantee, an early crash between
 * intent emission and OS reality creation can leave a real OS
 * process with no spawn_requested record — the recovery
 * projector would then classify the next run as
 * `not_started` while an orphan PGID lives in the kernel,
 * violating the crash triangle.
 *
 * CORRECTION07 attempted to enforce this with a post-spawn
 * `.then()` callback, but a `.then()` is always asynchronous:
 * it runs only after the current stack unwinds. That means
 * the OS spawn always won the race against the gate.
 *
 * CORRECTION08 closes the gap with `await`. The supervisor's
 * spawn gate is now:
 *
 *   const gateCritical = safeEmit({ kind: "process_spawn_started", ... });
 *   // ↑ returns the critical-boundary Promise for process_spawn_requested.
 *   const outcome = await requireCriticalCommit(gateCritical);
 *   if (outcome.kind !== "ok") {
 *     // SPAWN MUST NOT HAPPEN. Return typed persistence failure.
 *   }
 *   child = args.spawner.spawn(...);  // ← ONLY after the gate passed.
 *
 * The function below exposes that primitive as a typed gate.
 */

import type { ProcessEvidenceCommitResult } from "./process-evidence-sink.js";
import type {
  ProcessFailure,
  ProcessId,
  ProcessSpec,
} from "./process-types.js";
import { requireCriticalCommit } from "./critical-commit.js";

/**
 * Outcome of the pre-spawn durability gate.
 *
 *   - `spawn`           → durable intent ACK SUCCESS; the
 *                         caller MAY now call spawner.spawn().
 *   - `persistence_failed` → the durable intent record
 *                         returned `{ok:false}`. The caller
 *                         MUST NOT spawn anything. Return
 *                         the typed ProcessFailure.
 *   - `internal_malfunction` → the sink Promise rejected.
 *                         The caller MUST NOT spawn anything.
 *                         Return the typed ProcessFailure with
 *                         the internal_malfunction semantics
 *                         preserved.
 */
export type SpawnGateOutcome =
  | { readonly kind: "spawn" }
  | {
      readonly kind: "persistence_failed";
      readonly failure: ProcessFailure;
    }
  | {
      readonly kind: "internal_malfunction";
      readonly failure: ProcessFailure;
    };

/**
 * Awaits the durable intent ACK and returns the gate outcome.
 * Caller MUST NOT perform any side effects (notably the OS
 * spawn) until the outcome is `spawn`.
 *
 * `noGate` (no evidence path) callers SHOULD treat this
 * function as `Promise.resolve({kind:"spawn"})`.
 */
export async function awaitSpawnIntent(
  intent: Promise<ProcessEvidenceCommitResult> | null,
): Promise<SpawnGateOutcome> {
  if (intent === null) {
    return { kind: "spawn" };
  }
  const r = await requireCriticalCommit(intent);
  if (r.kind === "ok") {
    return { kind: "spawn" };
  }
  const stage = "spawn_request" as const;
  if (r.stage === "internal_malfunction") {
    return {
      kind: "internal_malfunction",
      failure: {
        kind: "evidence_persistence_failure",
        stage,
        message: r.message,
      },
    };
  }
  const message = `process_spawn_requested commit failed: ${r.message}`;
  return {
    kind: "persistence_failed",
    failure: {
      kind: "evidence_persistence_failure",
      stage,
      message,
    },
  };
}

/**
 * Builds the synthetic ProcessResult for a spawn_request
 * persistence failure. No OS process was created; there is
 * nothing to clean up. The result preserves the original
 * spec/processId/timestamps so callers can correlate it with
 * the failed supervisor.
 */
export function spawnRequestFailureResult(args: {
  readonly id: ProcessId;
  readonly spec: ProcessSpec;
  readonly failure: ProcessFailure;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}): import("./process-types.js").ProcessResult {
  return {
    processId: args.id,
    spec: args.spec,
    outcome: {
      kind: "spawn_failed",
      failure: args.failure,
    },
    stdout: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
    stderr: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
    startedAtMs: args.startedAtMs,
    finishedAtMs: args.finishedAtMs,
    escalation: {
      termRequested: false,
      termSent: false,
      termResult: null,
      killRequested: false,
      killSent: false,
      killResult: null,
      // CORRECTION12 §1: truthful neutral is `not_observed`.
      finalGroupProbe: { kind: "not_observed" as const },
    },
  };
}
