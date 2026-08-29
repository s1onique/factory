/**
 * Lifecycle runner (CORRECTION02).
 *
 * Architecture:
 *   1. ONE eager spawn resolution promise (spawned | spawn_failed).
 *      Constructed synchronously during supervisor construction.
 *      The lifecycle MUST consume this promise before settling.
 *
 *   2. ONE eager process-completion promise (close | spawn_error).
 *      Retained for the entire lifecycle. Used both as the
 *      normal exit signal AND as the post-termination close
 *      wait target. This prevents missing a 'close' that fires
 *      during escalation.
 *
 *   3. SEPARATE AbortControllers:
 *        - deadlineController: aborts the pending deadline sleep
 *          when termination wins.
 *        - closeWaitController: used ONLY to bound the
 *          post-termination close wait. Not aborted by
 *          termination.
 *
 *   4. cleanup_verified is emitted ONLY after
 *      finalGroupProbe.kind === "absent". Otherwise a
 *      cleanup_failed event is emitted.
 *
 *   5. Synchronous-spawn-throw emits process_spawn_failed BEFORE
 *      seal.
 *
 *   6. Stdio failures appear structurally in the final outcome.
 */

import type {
  EscalationEvidence,
  ProcessCompletion,
  ProcessFailure,
  ProcessId,
  ProcessResult,
  ProcessSpec,
  RuntimeEvent,
  SpawnResolution,
} from "./process-types.js";
import type { Clock, SpawnedChild } from "./process-ports.js";
import type { CreateSupervisorArgs } from "./supervisor-builder.js";

export type LifecycleInput = {
  args: CreateSupervisorArgs;
  id: ProcessId;
  child: SpawnedChild;
  spawnResolution: Promise<SpawnResolution>;
  processCompletion: Promise<ProcessCompletion>;
  stdoutSink: { readonly captured: () => ProcessResult["stdout"]; readonly stdioFailure: () => ProcessFailure | null };
  stderrSink: { readonly captured: () => ProcessResult["stderr"]; readonly stdioFailure: () => ProcessFailure | null };
  engine: ReturnType<typeof import("./termination.js").createTerminationEngine>;
  safeEmit: (e: RuntimeEvent) => void;
  startedAtMs: number;
  setSealed: () => void;
  resolveTermination: (cause: "deadline" | "cancelled") => void;
  terminationChannel: Promise<"deadline" | "cancelled">;
  deadlineController: AbortController;
  closeWaitController: AbortController;
  closeWaitTimeoutMs: number;
};

function freshEscalation(): EscalationEvidence {
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
export async function runLifecycle(input: LifecycleInput): Promise<ProcessResult> {
  const { args, id, child, spawnResolution, processCompletion, stdoutSink, stderrSink, engine, safeEmit, startedAtMs, setSealed, resolveTermination, terminationChannel, deadlineController, closeWaitController, closeWaitTimeoutMs } = input;
  const clock: Clock = args.clock;
  const spec: ProcessSpec = args.spec;

  // ----------------------------------------------------------------
  // (1) Deadline path.
  // The timer is wired through deadlineController so the combined
  // abort can cancel it the moment another terminal trigger wins.
  // ----------------------------------------------------------------
  const deadlinePromise = (async (): Promise<"deadline"> => {
    const r = await clock.sleep(spec.deadlineMs, deadlineController.signal);
    if (r.kind === "aborted") return "deadline";
    // Defer one macrotask so a concurrent close/spawn_error has
    // a chance to mark the engine settled first.
    await new Promise<void>((res) => setImmediate(res));
    if (engine.hasTerminalCause()) return "deadline";
    safeEmit({ kind: "deadline_reached", processId: id });
    engine.requestCleanup("deadline");
    resolveTermination("deadline");
    return "deadline";
  })();

  // ----------------------------------------------------------------
  // (2) Lifecycle race.
  // The race resolves when ANY of these becomes authoritative:
  //   - spawnResolution  (spawn resolved BEFORE deadline/cancel)
  //   - processCompletion (close fired for a normal exit, or
  //                        spawn_error fired for a spawn failure
  //                        that occurred AFTER any clean exit
  //                        attempt — but in practice we only get
  //                        here once spawnResolution has resolved
  //                        if the lifecycle chose to use it.)
  // We race spawnResolution against termination (deadline + cancel)
  // and processCompletion (post-spawn normal close).
  // ----------------------------------------------------------------
  const raceWinner = await Promise.race<
    { kind: "spawn_resolution"; resolution: SpawnResolution } |
    { kind: "completion"; completion: ProcessCompletion } |
    { kind: "terminate"; cause: "deadline" | "cancelled" }
  >([
    spawnResolution.then((resolution) => ({ kind: "spawn_resolution", resolution } as const)),
    processCompletion.then((completion) => ({ kind: "completion", completion } as const)),
    terminationChannel.then((cause) => ({ kind: "terminate", cause } as const)),
    deadlinePromise.then(() => ({ kind: "terminate", cause: "deadline" } as const)),
  ]);

  // ----------------------------------------------------------------
  // (3) Branch: spawn_resolution.
  // If termination won first, we still wait for spawn to resolve
  // so we can either cleanup the spawned child or report definitive
  // spawn_failed.
  // ----------------------------------------------------------------
  if (raceWinner.kind === "spawn_resolution") {
    const res = raceWinner.resolution;
    if (res.kind === "spawn_failed") {
      setSealed();
      return {
        processId: id, spec,
        outcome: { kind: "spawn_failed", failure: res.failure },
        stdout: stdoutSink.captured(),
        stderr: stderrSink.captured(),
        startedAtMs, finishedAtMs: clock.nowMs(),
        escalation: freshEscalation(),
      };
    }
    // Spawned. If termination has already become authoritative,
    // escalate against the freshly known pgid.
    if (engine.hasTerminalCause()) {
      return cleanupPath({ id, spec, engine, safeEmit, setSealed, child, spawnResolution, processCompletion, stdoutSink, stderrSink, startedAtMs, clock, closeWaitController, closeWaitTimeoutMs, pgid: res.pgid });
    }
    // No termination yet. Wait for natural close OR termination.
    const next = await Promise.race<
      { kind: "completion"; completion: ProcessCompletion } | { kind: "terminate" }
    >([
      processCompletion.then((c) => ({ kind: "completion" as const, completion: c })),
      terminationChannel.then(() => ({ kind: "terminate" as const })),
      deadlinePromise.then(() => ({ kind: "terminate" as const })),
    ]);
    if (next.kind === "terminate") {
      return cleanupPath({ id, spec, engine, safeEmit, setSealed, child, spawnResolution, processCompletion, stdoutSink, stderrSink, startedAtMs, clock, closeWaitController, closeWaitTimeoutMs, pgid: res.pgid });
    }
    if (next.completion.kind === "spawn_error") {
      setSealed();
      return {
        processId: id, spec,
        outcome: { kind: "spawn_failed", failure: { kind: "spawn_failure", message: next.completion.error.message } },
        stdout: stdoutSink.captured(),
        stderr: stderrSink.captured(),
        startedAtMs, finishedAtMs: clock.nowMs(),
        escalation: freshEscalation(),
      };
    }
    setSealed();
    return buildNormalOutcome({ id, spec, stdoutSink, stderrSink, startedAtMs, clock, close: next.completion });
  }

  if (raceWinner.kind === "completion") {
    // Natural close happened. If termination won earlier we still
    // need to run cleanup (rare race). Otherwise treat as normal.
    if (raceWinner.completion.kind === "spawn_error") {
      setSealed();
      const failure: ProcessFailure = { kind: "spawn_failure", message: raceWinner.completion.error.message };
      return {
        processId: id, spec,
        outcome: { kind: "spawn_failed", failure },
        stdout: stdoutSink.captured(),
        stderr: stderrSink.captured(),
        startedAtMs, finishedAtMs: clock.nowMs(),
        escalation: freshEscalation(),
      };
    }
    setSealed();
    return buildNormalOutcome({ id, spec, stdoutSink, stderrSink, startedAtMs, clock, close: raceWinner.completion });
  }

  // raceWinner.kind === "terminate". Cancellation or deadline won.
  // We MUST still wait for spawn resolution before settling, so we
  // can cleanup a spawned child or report spawn_failed.
  return await settleAfterTermination({
    id, spec, args, child, spawnResolution, processCompletion, stdoutSink, stderrSink, engine, safeEmit, startedAtMs, setSealed, deadlineController, closeWaitController, closeWaitTimeoutMs, clock,
  });
}

type SinkLike = { readonly captured: () => ProcessResult["stdout"]; readonly stdioFailure: () => ProcessFailure | null };

function buildNormalOutcome(p: {
  id: ProcessId; spec: ProcessSpec; stdoutSink: SinkLike; stderrSink: SinkLike; startedAtMs: number; clock: Clock;
  close: { kind: "close"; code: number | null; signal: NodeJS.Signals | null };
}): ProcessResult {
  const soF = p.stdoutSink.stdioFailure();
  const seF = p.stderrSink.stdioFailure();
  let outcome: ProcessResult["outcome"];
  if (p.close.signal !== null) {
    outcome = { kind: "signaled", signal: p.close.signal, exitCode: p.close.code, stdoutFailure: soF, stderrFailure: seF };
  } else if (p.close.code !== null) {
    outcome = { kind: "exited", exitCode: p.close.code, stdoutFailure: soF, stderrFailure: seF };
  } else {
    outcome = { kind: "signaled", signal: null, exitCode: null, stdoutFailure: soF, stderrFailure: seF };
  }
  return {
    processId: p.id, spec: p.spec, outcome,
    stdout: p.stdoutSink.captured(),
    stderr: p.stderrSink.captured(),
    startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(),
    escalation: freshEscalation(),
  };
}

async function cleanupPath(p: {
  id: ProcessId; spec: ProcessSpec; engine: ReturnType<typeof import("./termination.js").createTerminationEngine>; safeEmit: (e: RuntimeEvent) => void; setSealed: () => void; child: SpawnedChild; spawnResolution: Promise<SpawnResolution>; processCompletion: Promise<ProcessCompletion>; stdoutSink: SinkLike; stderrSink: SinkLike; startedAtMs: number; clock: Clock; closeWaitController: AbortController; closeWaitTimeoutMs: number; pgid: number;
}): Promise<ProcessResult> {
  // We have a pgid. Escalate, then await the ORIGINAL process
  // completion promise with a SEPARATE close-wait controller.
  const escalation = await p.engine.runEscalation(p.pgid);
  const finalProbe = escalation.finalGroupProbe;
  // cleanup_verified / cleanup_failed events are exclusive.
  if (finalProbe.kind === "absent") {
    p.safeEmit({ kind: "cleanup_verified", processId: p.id });
  } else {
    p.safeEmit({ kind: "cleanup_failed", processId: p.id, failure: classifyCleanupFailure(finalProbe) });
  }
  // Await the ORIGINAL process-completion promise so we never miss
  // a close that fired during escalation.
  const closeOrTimeout = await waitForCompletionOrBound(
    p.processCompletion, p.clock, p.closeWaitController.signal, p.closeWaitTimeoutMs,
  );
  p.setSealed();
  const cause = p.engine.terminalCause();
  const soF = p.stdoutSink.stdioFailure();
  const seF = p.stderrSink.stdioFailure();
  if (closeOrTimeout.kind === "spawn_error") {
    return {
      processId: p.id, spec: p.spec,
      outcome: { kind: "spawn_failed", failure: { kind: "spawn_failure", message: closeOrTimeout.error.message } },
      stdout: p.stdoutSink.captured(), stderr: p.stderrSink.captured(),
      startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(),
      escalation,
    };
  }
  // Successful deadline / cancelled requires BOTH group absence AND
  // an actual Node 'close' observation. Without the close event
  // we cannot truthfully claim stdio closure. A group going
  // absent before Node catches up is a distinct failure mode.
  if (finalProbe.kind === "absent" && closeOrTimeout.kind === "close" && cause !== null) {
    if (cause === "cancelled") {
      return { processId: p.id, spec: p.spec, outcome: { kind: "cancelled", escalation, stdoutFailure: soF, stderrFailure: seF }, stdout: p.stdoutSink.captured(), stderr: p.stderrSink.captured(), startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(), escalation };
    }
    if (cause === "deadline") {
      return { processId: p.id, spec: p.spec, outcome: { kind: "deadline", escalation, stdoutFailure: soF, stderrFailure: seF }, stdout: p.stdoutSink.captured(), stderr: p.stderrSink.captured(), startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(), escalation };
    }
  }
  // Group absent but Node 'close' never arrived within the bounded
  // close wait. This is a real failure: the OS reaped the process
  // but Node did not observe the close boundary we depend on.
  if (finalProbe.kind === "absent" && closeOrTimeout.kind === "close_timeout") {
    return {
      processId: p.id, spec: p.spec,
      outcome: {
        kind: "cleanup_failed",
        failure: { kind: "cleanup_timeout", phase: "close", message: "group absent but Node close never arrived within bounded wait" },
        escalation,
        stdoutFailure: soF,
        stderrFailure: seF,
      },
      stdout: p.stdoutSink.captured(), stderr: p.stderrSink.captured(),
      startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(),
      escalation,
    };
  }
  // Final probe was NOT absent OR no terminal cause OR close failed
  // (spawn_error after spawn): real cleanup failure.
  return {
    processId: p.id, spec: p.spec,
    outcome: { kind: "cleanup_failed", failure: classifyCleanupFailure(finalProbe), escalation, stdoutFailure: soF, stderrFailure: seF },
    stdout: p.stdoutSink.captured(), stderr: p.stderrSink.captured(),
    startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(),
    escalation,
  };
}

async function settleAfterTermination(p: {
  id: ProcessId; spec: ProcessSpec; args: CreateSupervisorArgs; child: SpawnedChild;
  spawnResolution: Promise<SpawnResolution>;
  processCompletion: Promise<ProcessCompletion>;
  stdoutSink: SinkLike; stderrSink: SinkLike; engine: ReturnType<typeof import("./termination.js").createTerminationEngine>; safeEmit: (e: RuntimeEvent) => void; startedAtMs: number; setSealed: () => void; deadlineController: AbortController; closeWaitController: AbortController; closeWaitTimeoutMs: number; clock: Clock;
}): Promise<ProcessResult> {
  // Wait for spawn to resolve. Do NOT settle before then.
  const res = await p.spawnResolution;
  if (res.kind === "spawn_failed") {
    p.setSealed();
    return {
      processId: p.id, spec: p.spec,
      outcome: { kind: "spawn_failed", failure: res.failure },
      stdout: p.stdoutSink.captured(), stderr: p.stderrSink.captured(),
      startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(),
      escalation: freshEscalation(),
    };
  }
  // Child is live. Run cleanup against the spawned pgid.
  return await cleanupPath({
    id: p.id, spec: p.spec, engine: p.engine, safeEmit: p.safeEmit, setSealed: p.setSealed, child: p.child, spawnResolution: p.spawnResolution, processCompletion: p.processCompletion, stdoutSink: p.stdoutSink, stderrSink: p.stderrSink, startedAtMs: p.startedAtMs, clock: p.clock, closeWaitController: p.closeWaitController, closeWaitTimeoutMs: p.closeWaitTimeoutMs, pgid: res.pgid,
  });
}

async function waitForCompletionOrBound(
  completion: Promise<ProcessCompletion>,
  clock: Clock,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ProcessCompletion | { kind: "close_timeout" }> {
  if (signal.aborted) return { kind: "close_timeout" };
  // Yield one macrotask so any in-flight close promise has a
  // chance to settle before the bounded timer is even armed.
  // Without this, manual-clock setups (which resolve sleep
  // synchronously) would let the timer win the race even
  // though close is about to fire.
  await new Promise<void>((res) => setImmediate(res));
  if (signal.aborted) return { kind: "close_timeout" };
  const t = clock.sleep(timeoutMs, signal);
  const r = await Promise.race([completion, t.then(() => ({ kind: "close_timeout" as const }))]);
  if (r.kind === "close_timeout") {
    return { kind: "close_timeout" };
  }
  return r;
}

function classifyCleanupFailure(probe: EscalationEvidence["finalGroupProbe"]): ProcessFailure {
  if (probe.kind === "permission_denied") {
    return { kind: "capability_unavailable", message: "process-group signalling permission denied" };
  }
  if (probe.kind === "probe_error") {
    return { kind: "cleanup_timeout", phase: "kill", message: `group probe error: ${probe.kind}` };
  }
  if (probe.kind === "alive") {
    return { kind: "cleanup_timeout", phase: "kill", message: "group still alive after escalation" };
  }
  return { kind: "internal_process_failure", message: `unknown probe result: ${probe.kind}` };
}
