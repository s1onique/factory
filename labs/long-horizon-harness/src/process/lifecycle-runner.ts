/**
 * Lifecycle runner.
 *
 * Extracted from supervised-process.ts to keep that file under
 * the 400 LOC discipline. Runs the supervisor's race between
 * child close, spawn error, deadline, and cancellation.
 */

import { attachBoundedSink } from "./output-capture.js";
import { createTerminationEngine } from "./termination.js";
import { drainStdIO } from "./lifecycle-helpers.js";
import {
  buildOutCleanupFailure,
  buildOutOutcomeResult,
} from "./lifecycle-helpers.js";
import type {
  EscalationEvidence,
  ProcessFailure,
  ProcessResult,
  ProcessSpec,
  RuntimeEvent,
  SpawnedChild,
} from "./process-types.js";
import type { Clock } from "./process-ports.js";
import type { CreateSupervisorArgs } from "./supervisor-builder.js";

export type LifecycleInput = {
  args: CreateSupervisorArgs;
  id: ReturnType<typeof import("./process-types.js").makeProcessId>;
  child: SpawnedChild;
  stdoutSink: ReturnType<typeof attachBoundedSink>;
  stderrSink: ReturnType<typeof attachBoundedSink>;
  engine: ReturnType<typeof createTerminationEngine>;
  safeEmit: (e: RuntimeEvent) => void;
  startedAtMs: number;
  setSealed: () => void;
  resolveTermination: (cause: "deadline" | "cancelled") => void;
  terminationChannel: Promise<"deadline" | "cancelled">;
  combinedController: AbortController;
  onTerminate: () => void;
  deadlineController: AbortController;
  hasSpawnPgid: () => number | null;
};

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


export async function runLifecycle(input: LifecycleInput): Promise<ProcessResult> {
  const { args, id, child, stdoutSink, stderrSink, engine, safeEmit, startedAtMs, setSealed, resolveTermination, terminationChannel, combinedController, onTerminate, deadlineController, hasSpawnPgid } = input;
  const clock = args.clock;
  const spec: ProcessSpec = args.spec;

  let settledClose: (v: { kind: "close"; code: number | null; signal: NodeJS.Signals | null } | { kind: "spawn_error"; error: Error }) => void = () => {};
  const closePromise = new Promise<{ kind: "close"; code: number | null; signal: NodeJS.Signals | null } | { kind: "spawn_error"; error: Error }>((resolve) => { settledClose = resolve; });
  child.once("close", (code, signal) => { settledClose({ kind: "close", code, signal }); });
  child.once("error", (e) => { settledClose({ kind: "spawn_error", error: e }); });

  const deadlinePromise = (async (): Promise<"deadline"> => {
    const r = await clock.sleep(spec.deadlineMs, deadlineController.signal);
    if (r.kind === "aborted") return "deadline";
    // Defer the deadline decision via setImmediate so that any
    // concurrent close/spawn_error microtask (e.g. from the
    // test's queueMicrotask(fireClose)) runs first and marks the
    // engine settled. Under a real clock the close path runs
    // long after the deadline fires anyway; under manualClock the
    // microtask ordering can put the deadline path first, so we
    // yield a full event-loop tick to let close win.
    await new Promise<void>((res) => setImmediate(res));
    if (engine.hasTerminalCause()) return "deadline";
    safeEmit({ kind: "deadline_reached", processId: id });
    engine.requestCleanup("deadline");
    onTerminate();
    resolveTermination("deadline");
    return "deadline";
  })();

  const winner = await Promise.race<
    { kind: "close"; code: number | null; signal: NodeJS.Signals | null } | { kind: "spawn_error"; error: Error } | { kind: "terminate"; cause: "deadline" | "cancelled" }
  >([
    closePromise,
    terminationChannel.then((cause) => ({ kind: "terminate", cause } as const)),
    deadlinePromise.then(() => ({ kind: "terminate", cause: "deadline" } as const)),
  ]);

  if (winner.kind === "close") {
    engine.markSettled();
    setSealed();
    deadlineController.abort();
    return buildOutOutcomeResult({ spec, processId: id, stdoutSink, stderrSink, closeObserved: winner, startedAtMs });
  }

  if (winner.kind === "spawn_error") {
    engine.markSettled();
    const failure: ProcessFailure = {
      kind: "spawn_failure",
      message: winner.error.message,
      ...(typeof (winner.error as unknown as { code?: unknown }).code === "string"
        ? { code: (winner.error as unknown as { code: string }).code }
        : {}),
    };
    safeEmit({ kind: "process_spawn_failed", processId: id, failure });
    setSealed();
    return {
      processId: id,
      spec,
      outcome: { kind: "spawn_failed", failure },
      stdout: stdoutSink.captured(),
      stderr: stderrSink.captured(),
      startedAtMs,
      finishedAtMs: clock.nowMs(),
      escalation: emptyEscalation(),
    };
  }

  const pgid = hasSpawnPgid();
  if (pgid === null) {
    setSealed();
    return buildOutCleanupFailure({
      spec, processId: id, stdoutSink, stderrSink,
      failure: { kind: "internal_process_failure", message: "no process group id available for cleanup" },
      escalation: emptyEscalation(), startedAtMs, finishedAtMs: clock.nowMs(),
    });
  }

  const escalation = await engine.runEscalation(pgid);
  safeEmit({ kind: "cleanup_verified", processId: id });

  await waitForChildClose(child, clock, combinedController.signal, 1000);

  const cause = engine.terminalCause();
  setSealed();

  if (cause === null) {
    return buildOutCleanupFailure({ spec, processId: id, stdoutSink, stderrSink, failure: { kind: "internal_process_failure", message: "no terminal cause" }, escalation, startedAtMs, finishedAtMs: clock.nowMs() });
  }

  if (escalation.termResult?.kind === "permission_denied" || escalation.killResult?.kind === "permission_denied" || escalation.finalGroupProbe.kind === "permission_denied") {
    return buildOutCleanupFailure({ spec, processId: id, stdoutSink, stderrSink, failure: { kind: "capability_unavailable", message: "process-group signalling permission denied" }, escalation, startedAtMs, finishedAtMs: clock.nowMs() });
  }
  if (escalation.finalGroupProbe.kind !== "absent") {
    return buildOutCleanupFailure({ spec, processId: id, stdoutSink, stderrSink, failure: { kind: "cleanup_timeout", phase: "kill", message: "final probe not absent" }, escalation, startedAtMs, finishedAtMs: clock.nowMs() });
  }

  await drainStdIO(stdoutSink, stderrSink, clock, combinedController.signal);

  return {
    processId: id, spec,
    outcome: cause === "cancelled" ? { kind: "cancelled", escalation } : { kind: "deadline", escalation },
    stdout: stdoutSink.captured(),
    stderr: stderrSink.captured(),
    startedAtMs, finishedAtMs: clock.nowMs(),
    escalation,
  };
}

async function waitForChildClose(child: SpawnedChild, clock: Clock, signal: AbortSignal, budgetMs: number): Promise<void> {
  const deadline = clock.nowMonotonicMs() + budgetMs;
  let closed = false;
  child.once("close", () => { closed = true; });
  while (!closed && clock.nowMonotonicMs() < deadline && !signal.aborted) {
    await clock.sleep(10, signal);
  }
}
