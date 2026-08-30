/**
 * Supervisor builder (CORRECTION08).
 *
 * Eager single-shot lifecycle with:
 *   - eager 'spawn', 'error', 'exit', 'close', 'stdout',
 *     'stderr' listeners attached immediately after spawn();
 *   - exactly one lifecycle promise constructed at
 *     createSupervisor() time;
 *   - ONE spawn resolution promise (spawned | spawn_failed),
 *     the single source of truth for whether the child exists;
 *   - ONE process completion promise (close | spawn_error),
 *     retained for the entire lifecycle;
 *   - separate AbortControllers: deadlineController (aborts the
 *     pending deadline sleep) and closeWaitController (bounds
 *     the post-termination close wait, NEVER pre-aborted by
 *     termination).
 *
 * Synchronous spawn() throws: emit process_spawn_failed BEFORE
 * sealing.
 *
 * CORRECTION08 — pre-spawn durability gate:
 *   When `args.evidenceSink !== undefined`, the OS `spawn()`
 *   call is deferred until the durable intent record
 *   `process_spawn_requested` fsync ACK succeeds. This is
 *   enforced by `startSupervisor()` (async). The sync
 *   `buildSupervisor()` here is the FOUNDATION02 no-sink fast
 *   path AND the post-gate wiring step called by
 *   `startSupervisor()` once the gate has passed.
 *
 *   The CORRECTION07 `.then()` pseudo-gate is removed.
 *   There is no production execution path in which
 *   `args.spawner.spawn()` runs while the request commit is
 *   unresolved.
 */

import { attachBoundedSink } from "./output-capture.js";
import { createTerminationEngine } from "./termination.js";
import { runLifecycle } from "./lifecycle-runner.js";
import type {
  ProcessCompletion,
  ProcessFailure,
  ProcessId,
  ProcessResult,
  ProcessSpec,
  ProcessFailure as PF,
  RuntimeEvent,
  SpawnResolution,
  SpawnedChild,
} from "./process-types.js";
import type { Clock, SignalPort, SpawnPort } from "./process-ports.js";
import type { SpawnOwnershipObserver } from "./supervisor-spawn-ownership.js";
import { wireSpawnOwnershipHandler } from "./supervisor-spawn-handler.js";
import type { EvidenceCommitObserver, ProcessEvidenceIdentity } from "./process-evidence-bridge.js";
import type { ProcessEvidenceSink, ProcessEvidenceCommitResult } from "./process-evidence-sink.js";
import type { EvidenceRuntime } from "./supervisor-evidence-runtime.js";
import { createEvidenceRuntime } from "./supervisor-evidence-runtime.js";
import { buildSupervisorHandle, type SupervisorHandle } from "./supervisor-handle-api.js";
import {
  awaitSpawnIntent,
  spawnRequestFailureResult,
} from "./supervisor-spawn-gate.js";
import {
  buildSpawnFailure,
  emptyCaptured,
  emptyEscalation,
  invalidSpecSupervisorResult,
  defaultIdFactory as helperDefaultIdFactory,
} from "./supervisor-helpers.js";
import type { OuterSupervisorResult } from "./outer-supervisor-result.js";
import type { Result } from "../domain/result.js";

export type Supervisor = SupervisorHandle;

/**
 * CORRECTION04 §29/§41: a typed outer result that distinguishes
 * the execution outcome from the durability outcome.
 */
export type { OuterSupervisorResult } from "./outer-supervisor-result.js";

export type CreateSupervisorArgs = {
  readonly spec: ProcessSpec;
  readonly clock: Clock;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
  readonly sink?: (e: RuntimeEvent) => void;
  readonly idFactory?: () => ProcessId;
  readonly evidenceSink?: ProcessEvidenceSink;
  readonly evidenceObserver?: EvidenceCommitObserver;
  readonly evidenceIdentity?: ProcessEvidenceIdentity;
  readonly spawnOwnershipObserver?: SpawnOwnershipObserver;
};

// Re-export helper utilities for backwards compat (tests import
// defaultIdFactory / emptyEscalation / etc. from supervisor-builder).
export const defaultIdFactory = helperDefaultIdFactory;
export { buildSpawnFailure, emptyCaptured, emptyEscalation, invalidSpecSupervisorResult };

/**
 * CORRECTION08 — async start function.
 *
 * Public entry point for the FOUNDATION03 evidence-enabled
 * supervisor. Awaits the durable intent ACK BEFORE the OS
 * spawn. Returns a typed Result.
 *
 * Path:
 *   - emits process_spawn_started (critical boundary)
 *   - awaits the fsync ACK
 *   - on failure/rejection → typed evidence_persistence_failure
 *     (stage: spawn_request); no spawn, no cleanup, return
 *     synthetic Supervisor whose await() reports the failure
 *   - on success → calls buildSupervisor(args), which spawns
 *     the child synchronously and wires the lifecycle
 *
 * No-sink fast path: when args.evidenceSink is undefined the
 * gate trivially resolves to `spawn`; the OS spawn runs
 * synchronously (FOUNDATION02 behavior preserved).
 */
export async function startSupervisor(
  args: CreateSupervisorArgs,
): Promise<Result<Supervisor, ProcessFailure>> {
  const id = (args.idFactory ?? helperDefaultIdFactory)();
  const startedAtMs = args.clock.nowMs();

  const evidenceRuntime: EvidenceRuntime | null =
    args.evidenceSink !== undefined && args.evidenceIdentity !== undefined
      ? createEvidenceRuntime({
          processId: id,
          evidenceSink: args.evidenceSink,
          evidenceIdentity: args.evidenceIdentity,
          ...(args.evidenceObserver !== undefined
            ? { evidenceObserver: args.evidenceObserver }
            : {}),
        })
      : null;

  const intentCommit =
    evidenceRuntime !== null
      ? evidenceRuntime.safeEmit({
          kind: "process_spawn_started",
          processId: id,
        })
      : null;

  const gate = await awaitSpawnIntent(intentCommit);
  if (gate.kind !== "spawn") {
    const finishedAtMs = args.clock.nowMs();
    const failure = gate.failure;
    if (evidenceRuntime !== null) evidenceRuntime.seal();
    const synthetic = makeSpawnRequestFailureSupervisor({
      id,
      spec: args.spec,
      startedAtMs,
      finishedAtMs,
      failure,
    });
    return { ok: true, value: synthetic };
  }

  return { ok: true, value: buildSupervisor(args) };
}

/**
 * Build a Supervisor handle for a spawn_request persistence
 * failure. The result is durable: the spawn_requested record
 * is NOT durable, so restart-from-ledger will see `not_started`.
 * This Supervisor reports a typed `spawn_failed` outcome with
 * `evidence_persistence_failure(spawn_request)` as the cause.
 */
function makeSpawnRequestFailureSupervisor(args: {
  readonly id: ProcessId;
  readonly spec: ProcessSpec;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly failure: ProcessFailure;
}): Supervisor {
  const result = spawnRequestFailureResult({
    id: args.id,
    spec: args.spec,
    startedAtMs: args.startedAtMs,
    finishedAtMs: args.finishedAtMs,
    failure: args.failure,
  });
  return {
    handle: () => ({
      processId: args.id,
      pid: null,
      processGroupId: null,
    }),
    cancel: () => {},
    await: () => Promise.resolve(result),
    awaitOuter: () =>
      Promise.resolve({
        kind: "durably_settled",
        process: result,
        observedPgid: null,
        observedPid: null,
      } satisfies OuterSupervisorResult),
  };
}

export function buildSupervisor(args: CreateSupervisorArgs): Supervisor {

  const id = (args.idFactory ?? helperDefaultIdFactory)();
  const sink: (e: RuntimeEvent) => void = args.sink ?? (() => {});
  const ownershipCommitRef = { current: null as Promise<unknown> | null };

  const evidenceRuntime: EvidenceRuntime | null =
    args.evidenceSink !== undefined && args.evidenceIdentity !== undefined
      ? createEvidenceRuntime({
          processId: id,
          evidenceSink: args.evidenceSink,
          evidenceIdentity: args.evidenceIdentity,
          ...(args.evidenceObserver !== undefined
            ? { evidenceObserver: args.evidenceObserver }
            : {}),
        })
      : null;

  const sealedRef = { current: false };
  const safeEmit = (e: RuntimeEvent): Promise<ProcessEvidenceCommitResult> | null => {
    if (sealedRef.current) return null;
    sink(e);
    if (evidenceRuntime === null) return null;
    const critical = evidenceRuntime.safeEmit(e);
    if (critical !== null && e.kind === "process_spawned") {
      ownershipCommitRef.current = critical;
    }
    return critical;
  };

  const startedAtMs = args.clock.nowMs();

  // CORRECTION08: emit process_spawn_started. The event is
  // ALWAYS sent to the user-supplied sink (FOUNDATION02
  // behavior). For the evidence-enabled path, the gate has
  // ALREADY passed by the time we get here; the post-gate
  // `process_spawned` commit is the next critical boundary
  // the supervisor must observe.
  safeEmit({ kind: "process_spawn_started", processId: id });

  let child: SpawnedChild;
  try {
    child = args.spawner.spawn({
      executable: args.spec.executable,
      argv: args.spec.args,
      cwd: args.spec.cwd,
      env: args.spec.env,
      detached: true,
    });
  } catch (e: unknown) {
    const failure = buildSpawnFailure(e);
    safeEmit({ kind: "process_spawn_failed", processId: id, failure });
    sealedRef.current = true;
    if (evidenceRuntime !== null) evidenceRuntime.seal();
    const now = args.clock.nowMs();
    const result: ProcessResult = {
      processId: id, spec: args.spec,
      outcome: { kind: "spawn_failed", failure },
      stdout: emptyCaptured(), stderr: emptyCaptured(),
      startedAtMs: now, finishedAtMs: now,
      escalation: emptyEscalation(),
    };
    return {
      handle: () => ({ processId: id, pid: null, processGroupId: null }),
      cancel: () => {},
      await: () => Promise.resolve(result),
      awaitOuter: () => Promise.resolve({ kind: "durably_settled", process: result, observedPgid: null, observedPid: null } satisfies OuterSupervisorResult),
    };
  }

  // State containers used by the lifecycle wiring.
  let resolveSpawnResolution!: (r: SpawnResolution) => void;
  const spawnResolution = new Promise<SpawnResolution>((resolve) => { resolveSpawnResolution = resolve; });
  const cachedPidRef = { current: null as number | null };
  const cachedPgidRef = { current: null as number | null };

  let resolveCompletion!: (c: ProcessCompletion) => void;
  const processCompletion = new Promise<ProcessCompletion>((resolve) => { resolveCompletion = resolve; });
  let completionSettled = false;
  const settleCompletionOnce = (c: ProcessCompletion): void => {
    if (completionSettled) return;
    completionSettled = true;
    resolveCompletion(c);
  };

  let resolveTermination!: (cause: "deadline" | "cancelled") => void;
  const terminationChannel = new Promise<"deadline" | "cancelled">((resolve) => { resolveTermination = resolve; });

  const deadlineController = new AbortController();
  const closeWaitController = new AbortController();
  const closeWaitTimeoutMs = Math.max(args.spec.termGraceMs, args.spec.killGraceMs, 500);

  const engine = createTerminationEngine({
    clock: args.clock,
    signals: args.signals,
    termGraceMs: args.spec.termGraceMs,
    killGraceMs: args.spec.killGraceMs,
    directChildCompletion: processCompletion,
    emit: (signal, result) => safeEmit({ kind: "signal_sent", processId: id, signal, result }),
    emitProbe: (probe) => safeEmit({ kind: "cleanup_probe", processId: id, probe }),
  });

  const setSealed = (): void => {
    if (!sealedRef.current) {
      sealedRef.current = true;
      deadlineController.abort();
    }
  };

  const stdoutSink = attachBoundedSink({
    stream: child.stdout, limitBytes: args.spec.stdoutLimitBytes, streamKind: "stdout", processId: id,
    onProgress: (bytesSeen, bytesRetained, truncated) => safeEmit({ kind: "stdout_progress", processId: id, bytesSeen, bytesRetained, truncated }),
    onStdioError: (code, message) => {
      const failure: PF = { kind: "stdio_failure", stream: "stdout", message, ...(typeof code === "string" ? { code } : {}) };
      safeEmit({ kind: "stdio_failure", processId: id, stream: "stdout", failure });
    },
    onClosed: (stdioFailure) => {
      safeEmit({ kind: "stdout_closed", processId: id, ...(stdioFailure !== null ? { stdioFailure } : {}) });
    },
  });
  const stderrSink = attachBoundedSink({
    stream: child.stderr, limitBytes: args.spec.stderrLimitBytes, streamKind: "stderr", processId: id,
    onProgress: (bytesSeen, bytesRetained, truncated) => safeEmit({ kind: "stderr_progress", processId: id, bytesSeen, bytesRetained, truncated }),
    onStdioError: (code, message) => {
      const failure: PF = { kind: "stdio_failure", stream: "stderr", message, ...(typeof code === "string" ? { code } : {}) };
      safeEmit({ kind: "stdio_failure", processId: id, stream: "stderr", failure });
    },
    onClosed: (stdioFailure) => {
      safeEmit({ kind: "stderr_closed", processId: id, ...(stdioFailure !== null ? { stdioFailure } : {}) });
    },
  });
  let spawnEventSeen = false;
  const closeObservedRef = { current: false };
  const lastCloseCodeRef = { current: null as number | null };
  const lastCloseSignalRef = { current: null as NodeJS.Signals | null };

  wireSpawnOwnershipHandler({ id, child, safeEmit, cachedPidRef, cachedPgidRef, resolveSpawnResolution, ownershipCommitRef, spawnOwnershipObserver: args.spawnOwnershipObserver, setSpawnEventSeen: (v) => { spawnEventSeen = v; } });

  // CORRECTION08 §28: ensure the async spawn listener body
  // never produces an unhandled rejection.
  child.on("error", (e) => {
    if (spawnEventSeen) return;
    const failure = buildSpawnFailure(e);
    safeEmit({ kind: "process_spawn_failed", processId: id, failure });
    resolveSpawnResolution({ kind: "spawn_failed", failure });
    settleCompletionOnce({ kind: "spawn_error", error: e });
  });
  child.on("exit", (code, signal) => {
    safeEmit({ kind: "process_exit_observed", processId: id, exitCode: code, signal });
  });
  child.on("close", (code, signal) => {
    lastCloseCodeRef.current = code;
    lastCloseSignalRef.current = signal;
    closeObservedRef.current = true;
    settleCompletionOnce({ kind: "close", code, signal });
  });

  const lifecyclePromise: Promise<ProcessResult> = runLifecycle({
    args, id, child,
    spawnResolution, processCompletion,
    stdoutSink, stderrSink, engine,
    safeEmit, startedAtMs, setSealed,
    resolveTermination, terminationChannel,
    deadlineController, closeWaitController, closeWaitTimeoutMs,
  });

  const cancel = (): void => {
    if (engine.hasTerminalCause()) return;
    safeEmit({ kind: "cancellation_requested", processId: id });
    engine.requestCleanup("cancelled");
    deadlineController.abort();
    resolveTermination("cancelled");
  };

  return buildSupervisorHandle(
    {
      id,
      args,
      lifecyclePromise,
      closeObserved: closeObservedRef,
      lastCloseCode: lastCloseCodeRef,
      lastCloseSignal: lastCloseSignalRef,
      cachedPidRef,
      cachedPgidRef,
      evidenceRuntime,
      emptyEscalationFn: emptyEscalation,
    },
    cancel,
  );
}
