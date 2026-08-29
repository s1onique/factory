/**
 * Supervisor builder.
 *
 * Extracted from supervised-process.ts to keep that file under
 * the 400 LOC discipline. Wires the eager lifecycle: listeners
 * attached at spawn, a single lifecycle promise, a shared
 * termination channel, and an AbortController that the cancel
 * path can fire to abort the pending deadline timer.
 */

import { attachBoundedSink } from "./output-capture.js";
import { createTerminationEngine } from "./termination.js";
import { runLifecycle } from "./lifecycle-runner.js";
import { makeProcessId } from "./process-types.js";
import type {
  ProcessFailure,
  ProcessHandle,
  ProcessId,
  ProcessResult,
  ProcessSpec,
  RuntimeEvent,
  RuntimeEventSink,
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


export function buildSupervisor(args: CreateSupervisorArgs): Supervisor {
  const id = (args.idFactory ?? defaultIdFactory)();
  const sink: RuntimeEventSink = args.sink ?? (() => {});
  let sealed = false;
  const safeEmit = (e: RuntimeEvent): void => {
    if (sealed) return;
    sink(e);
  };
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
    sealed = true;
    const failure = buildSpawnFailure(e);
    const now = args.clock.nowMs();
    safeEmit({
      kind: "process_spawn_failed",
      processId: id,
      failure,
    });
    const result: ProcessResult = {
      processId: id,
      spec: args.spec,
      outcome: { kind: "spawn_failed", failure },
      stdout: emptyCaptured(),
      stderr: emptyCaptured(),
      startedAtMs: now,
      finishedAtMs: now,
      escalation: emptyEscalation(),
    };
    return {
      handle: () => ({ processId: id, pid: null, processGroupId: null }),
      cancel: () => {},
      await: () => Promise.resolve(result),
    };
  }

  let resolveTermination!: (cause: "deadline" | "cancelled") => void;
  const terminationChannel = new Promise<"deadline" | "cancelled">((resolve) => { resolveTermination = resolve; });

  const deadlineController = new AbortController();
  const combinedController = new AbortController();
  const onTerminate = (): void => { if (!combinedController.signal.aborted) combinedController.abort(); };

  const engine = createTerminationEngine({
    clock: args.clock,
    signals: args.signals,
    termGraceMs: args.spec.termGraceMs,
    killGraceMs: args.spec.killGraceMs,
    emit: (signal, result) => safeEmit({ kind: "signal_sent", processId: id, signal, result }),
    emitProbe: (probe) => safeEmit({ kind: "cleanup_probe", processId: id, probe }),
  });

  const setSealed = (): void => { if (!sealed) { sealed = true; deadlineController.abort(); combinedController.abort(); } };

  const stdoutSink = attachBoundedSink({
    stream: child.stdout, limitBytes: args.spec.stdoutLimitBytes, streamKind: "stdout", processId: id,
    onProgress: (bytesSeen, bytesRetained, truncated) => safeEmit({ kind: "stdout_progress", processId: id, bytesSeen, bytesRetained, truncated }),
    onStdioError: () => {},
    onClosed: (stdioFailure) => safeEmit({ kind: "stdout_closed", processId: id, ...(stdioFailure !== null ? { stdioFailure } : {}) }),
  });
  const stderrSink = attachBoundedSink({
    stream: child.stderr, limitBytes: args.spec.stderrLimitBytes, streamKind: "stderr", processId: id,
    onProgress: (bytesSeen, bytesRetained, truncated) => safeEmit({ kind: "stderr_progress", processId: id, bytesSeen, bytesRetained, truncated }),
    onStdioError: () => {},
    onClosed: (stdioFailure) => safeEmit({ kind: "stderr_closed", processId: id, ...(stdioFailure !== null ? { stdioFailure } : {}) }),
  });

  let spawnedPid: number | null = null;
  let spawnedPgid: number | null = null;
  let spawnError: ProcessFailure | null = null;

  child.on("spawn", () => {
    const pid = child.pid;
    const pgid = child.pgid !== null && child.pgid !== undefined ? child.pgid : pid !== null && pid !== undefined ? pid : null;
    if (pid === null || pid === undefined) return;
    spawnedPid = pid; spawnedPgid = pgid;
    safeEmit({ kind: "process_spawned", processId: id, pid, processGroupId: pgid ?? pid });
  });
  child.on("error", (e) => { spawnError = buildSpawnFailure(e); });
  child.on("exit", (code, signal) => safeEmit({ kind: "process_exit_observed", processId: id, exitCode: code, signal }));

  const lifecyclePromise: Promise<ProcessResult> = runLifecycle({
    args, id, child, stdoutSink, stderrSink, engine, safeEmit, startedAtMs,
    setSealed, resolveTermination, terminationChannel, combinedController,
    onTerminate, deadlineController, hasSpawnPgid: () => spawnedPgid,
  });

  const cancel = (): void => {
    if (engine.hasTerminalCause()) return;
    safeEmit({ kind: "cancellation_requested", processId: id });
    engine.requestCleanup("cancelled");
    onTerminate(); resolveTermination("cancelled");
  };

  const handle = (): ProcessHandle => ({ processId: id, pid: spawnedPid, processGroupId: spawnedPgid });
  void spawnError;
  return { handle, cancel, await: () => lifecyclePromise };
}
