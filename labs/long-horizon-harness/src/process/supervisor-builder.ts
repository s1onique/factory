/**
 * Supervisor builder (CORRECTION09).
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
 * CORRECTION08/09 — pre-spawn durability gate:
 *   `startSupervisor()` (async) is the evidence-enabled
 *   entry point. It mints ProcessId once, emits ONE
 *   `process_spawn_started`, awaits the fsync ACK, and only
 *   then calls `buildStartedSupervisor(ctx)` which performs
 *   the OS spawn. `buildSupervisor()` (sync) is the
 *   FOUNDATION02 no-sink fast path.
 */

import { attachBoundedSink } from "./output-capture.js";
import { createTerminationEngine } from "./termination.js";
import { runLifecycle } from "./lifecycle-runner.js";
import { validateProcessSpec } from "./process-types.js";
import { err, ok } from "../domain/result.js";
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
import { buildSupervisorHandle, makeCancelFn, type SupervisorHandle } from "./supervisor-handle-api.js";
import {
  awaitSpawnIntent,
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

// CORRECTION09: identity-continuity context. `startSupervisor()`
// mints a single ProcessId once, creates the EvidenceRuntime once,
// and emits exactly one durable `process_spawn_requested`. On
// gate-pass it calls `buildStartedSupervisor()` passing the
// preminted ID and the existing runtime through.
type StartedSupervisorContext = {
  readonly processId: ProcessId;
  readonly evidenceRuntime: EvidenceRuntime;
};

/**
 * CORRECTION09 — Async start function (FOUNDATION03 evidence path).
 *
 * Path:
 *   1. validateProcessSpec; on invalid spec, returns
 *      Result.error(invalid_process_spec). NO evidence commit.
 *   2. Mints ProcessId, creates EvidenceRuntime bound to it.
 *   3. Emits ONE `process_spawn_started` (critical boundary).
 *   4. Awaits the fsync ACK.
 *   5a. ok:true  → buildStartedSupervisor(ctx) — preserves
 *       ProcessId + EvidenceRuntime; OS spawn happens here.
 *   5b. {ok:false}|rejection → Result.error with
 *       evidence_persistence_failure(stage=spawn_request).
 *       No supervisor, no OS process.
 *
 * No-sink callers go through sync `buildSupervisor()` (FOUNDATION02).
 */
export async function startSupervisor(
  args: CreateSupervisorArgs,
): Promise<Result<Supervisor, ProcessFailure>> {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) return err(v.error);
  if (args.evidenceSink === undefined || args.evidenceIdentity === undefined) {
    return ok(buildSupervisor(args));
  }

  const processId: ProcessId = (args.idFactory ?? helperDefaultIdFactory)();
  const evidenceRuntime: EvidenceRuntime = createEvidenceRuntime({
    processId,
    evidenceSink: args.evidenceSink,
    evidenceIdentity: args.evidenceIdentity,
    ...(args.evidenceObserver !== undefined
      ? { evidenceObserver: args.evidenceObserver }
      : {}),
  });

  const intentCommit = evidenceRuntime.safeEmit({
    kind: "process_spawn_started",
    processId,
  });

  const gate = await awaitSpawnIntent(intentCommit);
  if (gate.kind !== "spawn") {
    evidenceRuntime.seal();
    return err(gate.failure);
  }

  return ok(buildStartedSupervisor(args, { processId, evidenceRuntime }));
}

/**
 * CORRECTION09 — Post-gate supervisor builder. Used by
 * `startSupervisor` after the durability gate has passed.
 * Contract:
 *   - `idFactory` is NEVER called again.
 *   - `process_spawn_started` is NEVER emitted again.
 *   - The EvidenceRuntime is reused (tracker + sealed + observer).
 */
export function buildStartedSupervisor(
  args: CreateSupervisorArgs,
  ctx: StartedSupervisorContext,
): Supervisor {
  return buildSupervisorInternal({
    args,
    processId: ctx.processId,
    evidenceRuntime: ctx.evidenceRuntime,
    emitSpawnStarted: false,
  });
}

export function buildSupervisor(args: CreateSupervisorArgs): Supervisor {
  const id = (args.idFactory ?? helperDefaultIdFactory)();
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
  // The sync buildSupervisor() entry-point emits ONE
  // process_spawn_started (FOUNDATION02 behavior preserved)
  // and does NOT wait for the gate. The async startSupervisor()
  // path uses buildStartedSupervisor() which omits the
  // process_spawn_started emit (because the caller already
  // emitted one and awaited its ACK).
  return buildSupervisorInternal({
    args,
    processId: id,
    evidenceRuntime,
    emitSpawnStarted: true,
  });
}

/**
 * CORRECTION09 — Internal builder used by both
 * `buildSupervisor` (sync, FOUNDATION02 fast path) and
 * `buildStartedSupervisor` (post-gate, evidence-enabled path).
 *
 * The optional `emitSpawnStarted` flag determines whether this
 * function emits `process_spawn_started` (and the underlying
 * `process_spawn_requested` critical commit). The async
 * `startSupervisor` path sets it to `false` because the caller
 * already emitted the pre-spawn intent and awaited its ACK.
 */
function buildSupervisorInternal(input: {
  readonly args: CreateSupervisorArgs;
  readonly processId: ProcessId;
  readonly evidenceRuntime: EvidenceRuntime | null;
  readonly emitSpawnStarted: boolean;
}): Supervisor {
  const args = input.args;
  const id = input.processId;
  const evidenceRuntime = input.evidenceRuntime;
  const sink: (e: RuntimeEvent) => void = args.sink ?? (() => {});
  const ownershipCommitRef = { current: null as Promise<unknown> | null };

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

  // Emit process_spawn_started EXACTLY ONCE. The sync
  // buildSupervisor() entry-point emits it (FOUNDATION02
  // preservation). The async startSupervisor() path skips it
  // because it has already emitted and awaited the ACK before
  // calling buildStartedSupervisor().
  if (input.emitSpawnStarted) {
    safeEmit({ kind: "process_spawn_started", processId: id });
  }

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

  const cancel = makeCancelFn({
    id,
    engine,
    safeEmit,
    deadlineController,
    resolveTermination,
  });

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
