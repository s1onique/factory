/**
 * Supervised-process runtime.
 */

import { err, ok, type Result } from "../domain/result.js";
import {
  makeProcessId,
  validateProcessSpec,
  type CapturedOutput,
  type EscalationEvidence,
  type ProcessFailure,
  type ProcessHandle,
  type ProcessResult,
  type ProcessSpec,
} from "./process-types.js";
import type {
  Clock,
  RuntimeEvent,
  RuntimeEventSink,
  SignalPort,
  SpawnedChild,
  SpawnPort,
} from "./process-ports.js";
import { attachBoundedSink } from "./output-capture.js";
import { createTerminationEngine } from "./termination.js";
import {
  drainStdIO,
  waitForChildClose,
  buildOutOutcomeResult,
  buildOutCleanupFailure,
} from "./lifecycle-helpers.js";

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
};

function emptyOutput(): CapturedOutput {
  return {
    bytesSeen: 0,
    bytesRetained: 0,
    truncated: false,
    buffer: Buffer.alloc(0),
  };
}

function emptyEscalation(): EscalationEvidence {
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

function buildSpawnFailure(e: unknown): ProcessFailure {
  if (typeof e === "object" && e !== null) {
    const o = e as { code?: unknown; syscall?: unknown; path?: unknown; message?: unknown };
    const base = { kind: "spawn_failure" as const, message: typeof o.message === "string" ? o.message : String(e) };
    return {
      ...base,
      ...(typeof o.code === "string" ? { code: o.code } : {}),
      ...(typeof o.syscall === "string" ? { syscall: o.syscall } : {}),
      ...(typeof o.path === "string" ? { path: o.path } : {}),
    };
  }
  return { kind: "spawn_failure", message: String(e) };
}
function invalidSpecSupervisor(spec: ProcessSpec, failure: ProcessFailure): Supervisor {
  const id = makeProcessId(`invalid-${Date.now()}-${Math.random()}`);
  const handle = (): ProcessHandle => ({ processId: id, pid: null, processGroupId: null });
  const cancel = (): void => {};
  const awaitFn = async (): Promise<ProcessResult> => {
    const now = Date.now();
    return {
      processId: id,
      spec,
      outcome: { kind: "cleanup_failed", failure, escalation: emptyEscalation() },
      stdout: emptyOutput(),
      stderr: emptyOutput(),
      startedAtMs: now,
      finishedAtMs: now,
      escalation: emptyEscalation(),
    };
  };
  return { handle, cancel, await: awaitFn };
}

export function createSupervisor(args: CreateSupervisorArgs): Supervisor {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) {
    return invalidSpecSupervisor(args.spec, v.error);
  }
  return buildSupervisor(args);
}

function buildSupervisor(args: CreateSupervisorArgs): Supervisor {
  const id = makeProcessId(`p-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const sink: RuntimeEventSink = args.sink ?? (() => {});
  const emit = (e: RuntimeEvent): void => sink(e);
  const startedAtMs = args.clock.nowMs();
  emit({ kind: "process_spawn_started", processId: id });

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
    const now = args.clock.nowMs();
    const failure = buildSpawnFailure(e);
    const result: ProcessResult = {
      processId: id,
      spec: args.spec,
      outcome: { kind: "spawn_failed", failure },
      stdout: emptyOutput(),
      stderr: emptyOutput(),
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

  const pid = child.pid;
  const pgid = child.pgid ?? (child.pid !== null ? child.pid : null);

  const stdoutSink = attachBoundedSink({
    stream: child.stdout,
    limitBytes: args.spec.stdoutLimitBytes,
    streamKind: "stdout",
    onProgress: (bytesSeen, truncated) => {
      emit({ kind: "stdout_progress", processId: id, bytesSeen, truncated });
    },
    onStdioError: () => {},
    onClose: () => {},
  });
  const stderrSink = attachBoundedSink({
    stream: child.stderr,
    limitBytes: args.spec.stderrLimitBytes,
    streamKind: "stderr",
    onProgress: (bytesSeen, truncated) => {
      emit({ kind: "stderr_progress", processId: id, bytesSeen, truncated });
    },
    onStdioError: () => {},
    onClose: () => {},
  });

  emit({ kind: "process_spawned", processId: id, pid: pid ?? -1, processGroupId: pgid ?? -1 });

  const engine = createTerminationEngine({
    clock: args.clock,
    signals: args.signals,
    termGraceMs: args.spec.termGraceMs,
    killGraceMs: args.spec.killGraceMs,
    emit: (signal, result) => {
      emit({ kind: "signal_sent", processId: id, signal, result });
    },
    emitProbe: (probe) => {
      emit({ kind: "cleanup_probe", processId: id, probe });
    },
  });

  const cancel = (): void => {
    if (engine.hasTerminalCause()) return;
    emit({ kind: "cancellation_requested", processId: id });
    engine.requestCleanup("cancelled");
  };

  const awaitFn = (): Promise<ProcessResult> =>
    runLifecycle({
      child,
      stdoutSink,
      stderrSink,
      engine,
      emit,
      args,
      id,
      pid,
      pgid,
      startedAtMs,
    });

  return {
    handle: () => ({ processId: id, pid, processGroupId: pgid }),
    cancel,
    await: awaitFn,
  };
}

async function runLifecycle(input: {
  child: SpawnedChild;
  stdoutSink: ReturnType<typeof attachBoundedSink>;
  stderrSink: ReturnType<typeof attachBoundedSink>;
  engine: ReturnType<typeof createTerminationEngine>;
  emit: RuntimeEventSink;
  args: CreateSupervisorArgs;
  id: ReturnType<typeof makeProcessId>;
  pid: number | null;
  pgid: number | null;
  startedAtMs: number;
}): Promise<ProcessResult> {
  const { child, stdoutSink, stderrSink, engine, emit, args, id, pid, pgid, startedAtMs } = input;

  const closePromise = new Promise<
    | { kind: "close"; code: number | null; signal: NodeJS.Signals | null }
    | { kind: "spawn_error"; error: Error }
  >((resolveClose) => {
    let settled = false;
    const settle = (v: { kind: "close"; code: number | null; signal: NodeJS.Signals | null } | { kind: "spawn_error"; error: Error }): void => {
      if (settled) return;
      settled = true;
      resolveClose(v);
    };
    child.on("error", (e: Error) => {
      settle({ kind: "spawn_error", error: e });
    });
    child.once("close", (code, signal) => {
      settle({ kind: "close", code, signal });
    });
    child.on("exit", (code, signal) => {
      emit({ kind: "process_exit_observed", processId: id, exitCode: code, signal });
    });
  });

  const deadlinePromise = (async () => {
    const r = await args.clock.sleep(args.spec.deadlineMs);
    if (r.kind === "completed" && !engine.hasTerminalCause()) {
      emit({ kind: "deadline_reached", processId: id });
      engine.requestCleanup("deadline");
    }
    return r;
  })();

  const deadlineBranch: Promise<{ kind: "deadline_or_cancel"; cause: "deadline" | "cancelled" }> = deadlinePromise.then(() => {
    const cause = engine.terminalCause();
    const narrow: "deadline" | "cancelled" = cause === "cancelled" ? "cancelled" : "deadline";
    return { kind: "deadline_or_cancel", cause: narrow };
  });

  const winner = await Promise.race<
    | { kind: "close"; code: number | null; signal: NodeJS.Signals | null }
    | { kind: "spawn_error"; error: Error }
    | { kind: "deadline_or_cancel"; cause: "deadline" | "cancelled" }
  >([closePromise, deadlineBranch]);

  if (winner.kind === "close") {
    await drainStdIO(stdoutSink, stderrSink, args.clock);
    return buildOutOutcomeResult({
      spec: args.spec,
      processId: id,
      stdoutSink,
      stderrSink,
      closeObserved: winner,
      startedAtMs,
    });
  }

  if (winner.kind === "spawn_error") {
    const failure = buildSpawnFailure(winner.error);
    return {
      processId: id,
      spec: args.spec,
      outcome: { kind: "spawn_failed", failure },
      stdout: stdoutSink.captured(),
      stderr: stderrSink.captured(),
      startedAtMs,
      finishedAtMs: args.clock.nowMs(),
      escalation: emptyEscalation(),
    };
  }

  // Cleanup path.
  if (pgid === null) {
    return buildOutCleanupFailure({
      spec: args.spec,
      processId: id,
      stdoutSink,
      stderrSink,
      failure: {
        kind: "internal_process_failure",
        message: "no process group id available for cleanup",
      },
      escalation: emptyEscalation(),
      startedAtMs,
      finishedAtMs: args.clock.nowMs(),
    });
  }

  const escalation = await engine.runEscalation(pgid, pid ?? undefined);
  emit({ kind: "cleanup_verified", processId: id });

  await waitForChildClose(child, args.clock, 500);

  const cause = engine.terminalCause();
  if (cause === null) {
    return buildOutCleanupFailure({
      spec: args.spec,
      processId: id,
      stdoutSink,
      stderrSink,
      failure: {
        kind: "internal_process_failure",
        message: "cleanup ran but no terminal cause recorded",
      },
      escalation,
      startedAtMs,
      finishedAtMs: args.clock.nowMs(),
    });
  }

  if (escalation.finalGroupProbe.kind !== "absent") {
    return buildOutCleanupFailure({
      spec: args.spec,
      processId: id,
      stdoutSink,
      stderrSink,
      failure: {
        kind: "cleanup_timeout",
        phase: "kill",
        message: `final group probe after escalation: ${escalation.finalGroupProbe.kind}`,
      },
      escalation,
      startedAtMs,
      finishedAtMs: args.clock.nowMs(),
    });
  }

  return {
    processId: id,
    spec: args.spec,
    outcome: cause === "cancelled"
      ? { kind: "cancelled", escalation }
      : { kind: "deadline", escalation },
    stdout: stdoutSink.captured(),
    stderr: stderrSink.captured(),
    startedAtMs,
    finishedAtMs: args.clock.nowMs(),
    escalation,
  };
}

export function startSupervised(args: {
  spec: ProcessSpec;
  clock: Clock;
  signals: SignalPort;
  spawner: SpawnPort;
  sink?: RuntimeEventSink;
}): Result<Supervisor, ProcessFailure> {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) return err(v.error);
  return ok(createSupervisor(args));
}
