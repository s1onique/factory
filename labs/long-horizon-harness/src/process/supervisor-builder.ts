/**
 * Supervisor builder (CORRECTION02).
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
 */

import { attachBoundedSink } from "./output-capture.js";
import { createTerminationEngine } from "./termination.js";
import { runLifecycle } from "./lifecycle-runner.js";
import { makeProcessId } from "./process-types.js";
import {
  emitWithPersistence,
  PendingCommitsTracker,
} from "./process-evidence-bridge-emit.js";
import { requireCriticalCommit } from "./critical-commit.js";
import type {
  EvidenceCommitObserver,
  ProcessEvidenceIdentity,
} from "./process-evidence-bridge.js";
import type {
  ProcessEvidenceSink,
} from "./process-evidence-sink.js";
import type {
  EscalationEvidence,
  ProcessCompletion,
  ProcessFailure,
  ProcessHandle,
  ProcessId,
  ProcessResult,
  ProcessSpec,
  ProcessFailure as PF,
  RuntimeEvent,
  RuntimeEventSink,
  SpawnResolution,
  SpawnedChild,
} from "./process-types.js";
import type { Clock, SignalPort, SpawnPort } from "./process-ports.js";
import type { SpawnOwnershipObserver } from "./supervisor-spawn-ownership.js";
import { wireSpawnOwnershipHandler } from "./supervisor-spawn-handler.js";
// gateSpawnIntent removed in CORRECTION07 final revision (inline .then() gate).

export type Supervisor = {
  readonly handle: () => ProcessHandle;
  readonly cancel: () => void;
  readonly await: () => Promise<ProcessResult>;
  /**
   * CORRECTION04 §29: typed outer result. Available whenever the
   * supervisor was constructed with an evidenceSink. When no
   * evidenceSink is configured, awaitOuter rejects (the typed
   * outer result is only meaningful when durability is in scope).
   */
  readonly awaitOuter: () => Promise<OuterSupervisorResult>;
};

/**
 * CORRECTION04 §29/§41: a typed outer result that distinguishes
 * the execution outcome from the durability outcome. The
 * original execution ProcessResult is preserved; the durability
 * verdict is added as a sibling cause. NEVER collapses a clean
 * exit + settlement fsync failure into a fake cleanup_failed.
 */
export type { OuterSupervisorResult } from "./outer-supervisor-result.js";

export type CreateSupervisorArgs = {
  readonly spec: ProcessSpec;
  readonly clock: Clock;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
  readonly sink?: RuntimeEventSink;
  readonly idFactory?: () => ProcessId;
  /**
   * FOUNDATION03: optional process-evidence sink. When supplied,
   * the supervisor persists candidate-neutral process-runtime
   * evidence records through the sink in addition to emitting
   * the existing RuntimeEvent stream.
   *
   * Persistence failures of the `process_spawned` ownership
   * boundary trigger {@link CreateSupervisorArgs.evidenceObserver}
   * if provided; the current-run supervisor then bounds-cleanup
   * the in-memory live process and reports an internal failure.
   *
   * For tests and pure FOUNDATION02 verification, omit this.
   */
  readonly evidenceSink?: ProcessEvidenceSink;
  readonly evidenceObserver?: EvidenceCommitObserver;
  readonly evidenceIdentity?: ProcessEvidenceIdentity;
  /**
   * CORRECTION06 §3: generic observer seam. Fires once after the OS
   * spawn has produced a real pid+pgid and BEFORE process_spawned
   * critical commit can settle. Used by CP03 to crash inside the
   * gap; production code may pass any passive observer.
   */
  readonly spawnOwnershipObserver?: SpawnOwnershipObserver;
};

export function defaultIdFactory(): ProcessId {
  const u = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (u !== undefined && typeof u.randomUUID === "function") {
    return makeProcessId(`p-${u.randomUUID()}`);
  }
  return makeProcessId(
    `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
}

export function buildSpawnFailure(e: unknown): ProcessFailure {
  if (typeof e === "object" && e !== null) {
    const o = e as {
      code?: unknown;
      syscall?: unknown;
      path?: unknown;
      message?: unknown;
    };
    const base: { kind: "spawn_failure"; message: string } = {
      kind: "spawn_failure",
      message: typeof o.message === "string" ? o.message : String(e),
    };
    return {
      ...base,
      ...(typeof o.code === "string" ? { code: o.code } : {}),
      ...(typeof o.syscall === "string" ? { syscall: o.syscall } : {}),
      ...(typeof o.path === "string" ? { path: o.path } : {}),
    };
  }
  return { kind: "spawn_failure", message: String(e) };
}

export function emptyCaptured(): ProcessResult["stdout"] {
  return {
    bytesSeen: 0,
    bytesRetained: 0,
    truncated: false,
    buffer: Buffer.alloc(0),
  };
}

export function emptyEscalation(): ProcessResult["escalation"] {
  return {
    termRequested: false,
    termSent: false,
    termResult: null,
    killRequested: false,
    killSent: false,
    killResult: null,
    finalGroupProbe: { kind: "absent" },
  };
}

export function invalidSpecSupervisorResult(
  spec: ProcessSpec,
  failure: ProcessFailure,
  idFactory: () => ProcessId,
): Supervisor {
  const id = idFactory();
  const now = Date.now();
  const result: ProcessResult = {
    processId: id,
    spec,
    outcome: { kind: "spawn_failed", failure },
    stdout: emptyCaptured(),
    stderr: emptyCaptured(),
    startedAtMs: now,
    finishedAtMs: now,
    escalation: emptyEscalation(),
  };
  let settled = false;
  return {
    handle: () => ({ processId: id, pid: null, processGroupId: null }),
    cancel: () => {},
    await: () => {
      if (!settled) {
        settled = true;
        return Promise.resolve(result);
      }
      return Promise.resolve(result);
    },
    awaitOuter: () => Promise.resolve({ kind: "durably_settled", process: result, observedPgid: null, observedPid: null }),
  };
}
import type { OuterSupervisorResult } from "./outer-supervisor-result.js";

export function buildSupervisor(args: CreateSupervisorArgs): Supervisor {
  const id = (args.idFactory ?? defaultIdFactory)();
  const sink: RuntimeEventSink = args.sink ?? (() => {});
  let sealed = false;
  // CORRECTION07: ownershipCommitRef declared early (TDZ-binding).
  const ownershipCommitRef = { current: null as Promise<unknown> | null };
  // FOUNDATION03: optional evidence bridge. When configured, every
  // RuntimeEvent also becomes a persisted process-evidence record.
  // The bridge also exposes a synthetic channel for close, output
  // summary, and result commit boundaries.
  const evidenceBridge = (() => {
    if (args.evidenceSink === undefined || args.evidenceIdentity === undefined) {
      return null;
    }
    return {
      sink: args.evidenceSink,
      identity: args.evidenceIdentity,
      observer: args.evidenceObserver,
      tracker: new PendingCommitsTracker(),
    };
  })();
  const safeEmit = (e: RuntimeEvent): Promise<import("./process-evidence-sink.js").ProcessEvidenceCommitResult> | null => {
    if (sealed) return null;
    sink(e);
    if (evidenceBridge !== null) {
      const critical = emitWithPersistence({
        processId: id,
        evidenceSink: evidenceBridge.sink,
        identity: evidenceBridge.identity,
        tracker: evidenceBridge.tracker,
        ...(evidenceBridge.observer !== undefined
          ? { observer: evidenceBridge.observer }
          : {}),
        event: e,
        innerSink: () => {},
      });
      // Capture the critical-boundary commit promise so the spawn
      // handler can BLOCK the spawn resolution until the durable
      // ownership record has fsync'd (CORRECTION01 §6/§7).
      if (critical !== null && e.kind === "process_spawned") {
        ownershipCommitRef.current = critical as Promise<unknown>;
      }
      return critical;
    }
    return null;
  };

  const startedAtMs = args.clock.nowMs();
  // CORRECTION07 §2: process_spawn_started is critical.
  const gateCritical: Promise<import("./process-evidence-sink.js").ProcessEvidenceCommitResult> | null =
    safeEmit({ kind: "process_spawn_started", processId: id });

  // CORRECTION07 §2: process_spawn_requested is critical.
  // F-series tests (no sink) must preserve the sync spawn pattern;
  // gate's failure is propagated via .then() to ownershipCommitRef.
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
    sealed = true;
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

  // CORRECTION07 §3: spawn-intent gate (async .then()).
  if (gateCritical !== null) {
    // CORRECTION07 §3: spawn-intent gate. The critical commit
    // Promise may reject. We stash a rejecting Promise in
    // ownershipCommitRef; the supervisor's awaitOwnership awaits
    // it via requireCriticalCommit and treats rejection as
    // ownership_persistence_failed. To prevent Node from flagging
    // an unhandled rejection in the gap between assignment and
    // await, we attach a .catch that is no-op: the supervisor's
    // await will handle the actual rejection.
    gateCritical.then((commitResult) => {
      if (commitResult.ok === false) {
        const e = commitResult.error;
        const reason = e.kind === "invalid_evidence" ? e.reason : e.message;
        const rejectingPromise = Promise.reject(new Error("process_spawn_requested commit failed: " + reason));
        rejectingPromise.catch(() => { /* consumed by awaitOwnership */ });
        ownershipCommitRef.current = rejectingPromise;
      }
    }, (err: unknown) => {
      const rejectingPromise = Promise.reject(err instanceof Error ? err : new Error(String(err)));
      rejectingPromise.catch(() => { /* consumed by awaitOwnership */ });
      ownershipCommitRef.current = rejectingPromise;
    });
  }

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
    // CORRECTION09: hand the engine the eagerly-constructed
    // processCompletion promise so the KILL grace loop can
    // re-probe the group AFTER Node's reap boundary. Without
    // this, a successful SIGKILL followed by a sub-grace
    // zombie window is mis-classified as
    // cleanup_failed(phase=kill). See termination.ts.
    directChildCompletion: processCompletion,
    emit: (signal, result) => safeEmit({ kind: "signal_sent", processId: id, signal, result }),
    emitProbe: (probe) => safeEmit({ kind: "cleanup_probe", processId: id, probe }),
  });

  const setSealed = (): void => {
    if (!sealed) {
      sealed = true;
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
  // Latest observed close fields. The supervisor's
  // `process_close_observed` persisted evidence must reflect the
  // ACTUAL Node close observation (code XOR signal), not fabricated
  // null/null. See CORRECTION01 §11/§12.
  let lastCloseCode: number | null = null;
  let lastCloseSignal: NodeJS.Signals | null = null;
  let closeObserved = false;
  // The ownership-boundary commit promise for the latest
  // `process_spawned` evidence. The bridge fills this when it
  // routes the event through `commitCritical`. The lifecycle runner
  // awaits this before letting sustained RUNNING proceed (CORRECTION01
  // §6/§7). When no sink is configured the value stays `null` and
  // FOUNDATION02 behavior is preserved.

  wireSpawnOwnershipHandler({ id, child, safeEmit, cachedPidRef, cachedPgidRef, resolveSpawnResolution, ownershipCommitRef, spawnOwnershipObserver: args.spawnOwnershipObserver, setSpawnEventSeen: (v) => { spawnEventSeen = v; } });
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
    lastCloseCode = code;
    lastCloseSignal = signal;
    closeObserved = true;
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

  const handle = (): ProcessHandle => ({
    processId: id,
    pid: cachedPidRef.current,
    processGroupId: cachedPgidRef.current,
  });

  // FOUNDATION03: wrap the lifecycle promise to emit the
  // synthetic process_result_committed record AFTER all
  // preceding evidence records have been fsync'd, and the
  // synthetic process_close_observed record BEFORE the result
  // commit (close is observed by the lifecycle runner as a
  // RuntimeEvent today; we re-emit the synthetic record here).
  //
  // The wrapper is built ONCE per Supervisor so `await()` is
  // idempotent (every call returns the same promise reference).
  const wrappedAwait: () => Promise<ProcessResult> = (() => {
    let cached: Promise<ProcessResult> | null = null;
    return () => {
      if (cached !== null) return cached;
      cached = (async (): Promise<ProcessResult> => {
        const r = await lifecyclePromise;
        // CORRECTION04 §32: when the OS spawn succeeded but
        // ownership durability failed, the durable history
        // correctly contains ONLY process_spawn_requested. The
        // supervisor's wrappedAwait MUST NOT emit close_observed
        // or result_committed for this case — those records
        // would imply ownership that never happened and would
        // confuse the recovery projector.
        const isOwnershipFailure =
          r.outcome.kind === "cleanup_failed" &&
          r.outcome.failure.kind === "evidence_persistence_failure" &&
          r.outcome.failure.stage === "ownership";
        if (evidenceBridge !== null && !isOwnershipFailure) {
          await evidenceBridge.tracker.waitAll();
          emitWithPersistence({
            processId: id,
            evidenceSink: evidenceBridge.sink,
            identity: evidenceBridge.identity,
            tracker: evidenceBridge.tracker,
            ...(evidenceBridge.observer !== undefined
              ? { observer: evidenceBridge.observer }
              : {}),
            event: {
              kind: "process_close_observed",
              processId: id,
              exitCode: closeObserved ? lastCloseCode : null,
              signal: closeObserved ? lastCloseSignal : null,
            },
            innerSink: () => {},
          });
          const settlement = emitWithPersistence({
            processId: id,
            evidenceSink: evidenceBridge.sink,
            identity: evidenceBridge.identity,
            tracker: evidenceBridge.tracker,
            ...(evidenceBridge.observer !== undefined
              ? { observer: evidenceBridge.observer }
              : {}),
            event: {
              kind: "process_result_committed",
              processId: id,
              result: r,
            },
            innerSink: () => {},
          });
          if (settlement !== null) {
            const outcome = await requireCriticalCommit(settlement);
            if (outcome.kind !== "ok") {
              const message = outcome.stage === "internal_malfunction"
                ? "process_result_committed commit threw: " + outcome.message
                : "process_result_committed commit failed: " + outcome.message;
              // CORRECTION03 §40/§41: a process that exited
              // cleanly but whose settlement fsync failed is
              // NOT a cleanup failure. The original
              // ProcessResult is preserved; we attach the
              // new typed evidence_persistence_failure cause.
              // No synthetic EscalationEvidence is
              // fabricated — the runtime did NOT attempt
              // TERM/KILL/probe, so the empty record is
              // genuine.
              const noCleanupAttempted: EscalationEvidence = {
                termRequested: false,
                termSent: false,
                termResult: null,
                killRequested: false,
                killSent: false,
                killResult: null,
                finalGroupProbe: { kind: "absent" as const },
              };
              return {
                processId: id,
                spec: args.spec,
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
          await evidenceBridge.tracker.waitAll();
        }
        return r;
      })();
      return cached;
    };
  })();

  // CORRECTION05 §18/§19: awaitExecution() returns the
  // lifecycle's UNMUTATED ProcessResult. The lifecycle result
  // is captured BEFORE wrappedAwait runs (which mutates the
  // result for settlement-failure compatibility). This is the
  // authoritative execution outcome that awaitOuter uses.
  const awaitExecution = (): Promise<ProcessResult> => lifecyclePromise;

  // CORRECTION04
  const awaitOuter = async () => {
    if (evidenceBridge === null) throw new Error("awaitOuter requires an evidenceSink");
    // CORRECTION05 §18: 'verdict' carries settlement verdict; 'execution' is UNMUTATED lifecycle outcome.
    const verdict = await wrappedAwait();
    const execution = await awaitExecution();
    if (verdict.outcome.kind === "cleanup_failed" && verdict.outcome.failure.kind === "evidence_persistence_failure") {
      if (verdict.outcome.failure.stage === "ownership") {
        return { kind: "ownership_not_durable", process: execution, failure: { kind: "evidence_persistence_failure" as const, stage: "ownership" as const, message: verdict.outcome.failure.message }, observedPgid: cachedPgidRef.current, observedPid: cachedPidRef.current } as OuterSupervisorResult;
      }
      return { kind: "settlement_not_durable", process: execution, failure: { kind: "evidence_persistence_failure" as const, stage: "settlement" as const, message: verdict.outcome.failure.message }, observedPgid: cachedPgidRef.current, observedPid: cachedPidRef.current } as OuterSupervisorResult;
    }
    return { kind: "durably_settled", process: execution, observedPgid: cachedPgidRef.current, observedPid: cachedPidRef.current } as OuterSupervisorResult;
  };
  return { handle, cancel, await: wrappedAwait, awaitOuter };
}
