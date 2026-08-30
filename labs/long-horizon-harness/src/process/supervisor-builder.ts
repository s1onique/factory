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
import type {
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

export type Supervisor = {
  readonly handle: () => ProcessHandle;
  readonly cancel: () => void;
  readonly await: () => Promise<ProcessResult>;
};

export type CreateSupervisorArgs = {
  readonly spec: ProcessSpec;
  readonly clock: Clock;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
  readonly sink?: RuntimeEventSink;
  readonly idFactory?: () => ProcessId;
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
  };
}
export function buildSupervisor(args: CreateSupervisorArgs): Supervisor {
  const id = (args.idFactory ?? defaultIdFactory)();
  const sink: RuntimeEventSink = args.sink ?? (() => {});
  let sealed = false;
  const safeEmit = (e: RuntimeEvent): void => { if (sealed) return; sink(e); };
  const startedAtMs = args.clock.nowMs();
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
    };
  }

  let resolveSpawnResolution!: (r: SpawnResolution) => void;
  const spawnResolution = new Promise<SpawnResolution>((resolve) => { resolveSpawnResolution = resolve; });
  let cachedPid: number | null = null;
  let cachedPgid: number | null = null;

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
  child.on("spawn", () => {
    spawnEventSeen = true;
    const pid = child.pid;
    const pgid = child.pgid !== null && child.pgid !== undefined ? child.pgid : (pid !== null && pid !== undefined ? pid : null);
    if (pid === null || pid === undefined) {
      resolveSpawnResolution({
        kind: "spawn_failed",
        failure: { kind: "internal_process_failure", message: "spawn event fired but pid is null" },
      });
      return;
    }
    cachedPid = pid;
    cachedPgid = pgid;
    safeEmit({ kind: "process_spawned", processId: id, pid, processGroupId: pgid ?? pid });
    resolveSpawnResolution({ kind: "spawned", pid, pgid: pgid ?? pid });
  });
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
    pid: cachedPid,
    processGroupId: cachedPgid,
  });

  return { handle, cancel, await: () => lifecyclePromise };
}
