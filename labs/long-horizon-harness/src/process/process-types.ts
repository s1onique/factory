/**
 * Typed model for the supervised-process runtime.
 * Pure data: no Node built-ins imported.
 */
import type { Result } from "../domain/result.js";

declare const processIdBrand: unique symbol;
export type ProcessId = string & { readonly [processIdBrand]: true };
export function makeProcessId(s: string): ProcessId {
  return s as ProcessId;
}

export type ProcessSpec = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly deadlineMs: number;
  readonly termGraceMs: number;
  readonly killGraceMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
};

function ok<T>(v: T): Result<T, never> {
  return { ok: true, value: v };
}
function err<E>(e: E): Result<never, E> {
  return { ok: false, error: e };
}
function isIntGE0(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

export function validateProcessSpec(
  spec: ProcessSpec,
): Result<ProcessSpec, ProcessFailure> {
  if (typeof spec.executable !== "string" || spec.executable.length === 0) {
    return err({ kind: "invalid_process_spec", message: "executable must be a non-empty string" });
  }
  if (!Array.isArray(spec.args)) return err({ kind: "invalid_process_spec", message: "args must be an array of strings" });
  for (const a of spec.args) {
    if (typeof a !== "string") return err({ kind: "invalid_process_spec", message: "each arg must be a string" });
  }
  if (typeof spec.cwd !== "string" || spec.cwd.length === 0) return err({ kind: "invalid_process_spec", message: "cwd must be a non-empty string" });
  if (!isIntGE0(spec.deadlineMs) || spec.deadlineMs <= 0) return err({ kind: "invalid_process_spec", message: `deadlineMs must be a positive integer; got ${spec.deadlineMs}` });
  if (!isIntGE0(spec.termGraceMs)) return err({ kind: "invalid_process_spec", message: `termGraceMs must be a non-negative integer; got ${spec.termGraceMs}` });
  if (!isIntGE0(spec.killGraceMs)) return err({ kind: "invalid_process_spec", message: `killGraceMs must be a non-negative integer; got ${spec.killGraceMs}` });
  if (!isIntGE0(spec.stdoutLimitBytes)) return err({ kind: "invalid_process_spec", message: `stdoutLimitBytes must be a non-negative integer; got ${spec.stdoutLimitBytes}` });
  if (!isIntGE0(spec.stderrLimitBytes)) return err({ kind: "invalid_process_spec", message: `stderrLimitBytes must be a non-negative integer; got ${spec.stderrLimitBytes}` });
  return ok(spec);
}

export type ProcessFailure =
  | { readonly kind: "invalid_process_spec"; readonly message: string }
  | { readonly kind: "spawn_failure"; readonly code?: string; readonly syscall?: string; readonly path?: string; readonly message: string }
  | { readonly kind: "signal_failure"; readonly signal: "SIGTERM" | "SIGKILL" | 0; readonly code?: string; readonly message: string }
  | { readonly kind: "cleanup_timeout"; readonly phase: "term" | "kill"; readonly message: string }
  | { readonly kind: "stdio_failure"; readonly stream: "stdout" | "stderr"; readonly code?: string; readonly message: string }
  | { readonly kind: "internal_process_failure"; readonly message: string }
  | { readonly kind: "capability_unavailable"; readonly message: string };

export type SignalAttemptResult =
  | { readonly kind: "sent"; readonly signal: "SIGTERM" | "SIGKILL" | 0 }
  | { readonly kind: "group_absent" }
  | { readonly kind: "permission_denied"; readonly code?: string }
  | { readonly kind: "error"; readonly code?: string; readonly message: string };

export type GroupProbe =
  | { readonly kind: "alive" }
  | { readonly kind: "absent" }
  | { readonly kind: "permission_denied"; readonly code?: string }
  | { readonly kind: "probe_error"; readonly code?: string; readonly message: string };

export type CapturedOutput = {
  readonly bytesSeen: number;
  readonly bytesRetained: number;
  readonly truncated: boolean;
  readonly buffer: Buffer;
};

export type EscalationEvidence = {
  readonly termRequested: boolean;
  readonly termSent: boolean;
  readonly termResult: SignalAttemptResult | null;
  readonly killRequested: boolean;
  readonly killSent: boolean;
  readonly killResult: SignalAttemptResult | null;
  readonly finalGroupProbe: GroupProbe;
};

export type ProcessOutcome =
  | { readonly kind: "exited"; readonly exitCode: number | null; readonly stdoutFailure: ProcessFailure | null; readonly stderrFailure: ProcessFailure | null }
  | { readonly kind: "signaled"; readonly signal: NodeJS.Signals | null; readonly exitCode: number | null; readonly stdoutFailure: ProcessFailure | null; readonly stderrFailure: ProcessFailure | null }
  | { readonly kind: "deadline"; readonly escalation: EscalationEvidence; readonly stdoutFailure: ProcessFailure | null; readonly stderrFailure: ProcessFailure | null }
  | { readonly kind: "cancelled"; readonly escalation: EscalationEvidence; readonly stdoutFailure: ProcessFailure | null; readonly stderrFailure: ProcessFailure | null }
  | { readonly kind: "spawn_failed"; readonly failure: ProcessFailure }
  | { readonly kind: "cleanup_failed"; readonly failure: ProcessFailure; readonly escalation: EscalationEvidence; readonly stdoutFailure: ProcessFailure | null; readonly stderrFailure: ProcessFailure | null };

/**
 * Spawn resolution is a first-class state. Established eagerly
 * during supervisor construction. Resolves when Node has
 * definitively told us whether the child exists:
 *
 *   - spawned(pid, pgid)  — Node "spawn" event fired.
 *   - spawn_failed(failure) — Node "error" event fired BEFORE
 *     "spawn", or the spawn port threw synchronously.
 */
export type SpawnResolution =
  | { readonly kind: "spawned"; readonly pid: number; readonly pgid: number }
  | { readonly kind: "spawn_failed"; readonly failure: ProcessFailure };

/**
 * Final state of the eager process-completion promise:
 *
 *   - close(code, signal)  — Node "close" event fired (after
 *     exit and stdio streams).
 *   - spawn_error(error)  — Node "error" event fired BEFORE
 *     "close" (spawn failure).
 */
export type ProcessCompletion =
  | { readonly kind: "close"; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly kind: "spawn_error"; readonly error: Error };

export type ProcessHandle = {
  readonly processId: ProcessId;
  readonly pid: number | null;
  readonly processGroupId: number | null;
};

export type ProcessResult = {
  readonly processId: ProcessId;
  readonly spec: ProcessSpec;
  readonly outcome: ProcessOutcome;
  readonly stdout: CapturedOutput;
  readonly stderr: CapturedOutput;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly escalation: EscalationEvidence;
};

export type RuntimeEvent =
  | { readonly kind: "process_spawn_started"; readonly processId: ProcessId }
  | { readonly kind: "process_spawned"; readonly processId: ProcessId; readonly pid: number; readonly processGroupId: number }
  | { readonly kind: "process_spawn_failed"; readonly processId: ProcessId; readonly failure: ProcessFailure }
  | { readonly kind: "stdout_progress"; readonly processId: ProcessId; readonly bytesSeen: number; readonly bytesRetained: number; readonly truncated: boolean }
  | { readonly kind: "stderr_progress"; readonly processId: ProcessId; readonly bytesSeen: number; readonly bytesRetained: number; readonly truncated: boolean }
  | { readonly kind: "stdout_closed"; readonly processId: ProcessId; readonly stdioFailure?: ProcessFailure }
  | { readonly kind: "stderr_closed"; readonly processId: ProcessId; readonly stdioFailure?: ProcessFailure }
  | { readonly kind: "deadline_reached"; readonly processId: ProcessId }
  | { readonly kind: "cancellation_requested"; readonly processId: ProcessId }
  | { readonly kind: "signal_sent"; readonly processId: ProcessId; readonly signal: "SIGTERM" | "SIGKILL" | 0; readonly result: SignalAttemptResult }
  | { readonly kind: "process_exit_observed"; readonly processId: ProcessId; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly kind: "cleanup_probe"; readonly processId: ProcessId; readonly probe: GroupProbe }
  | { readonly kind: "cleanup_verified"; readonly processId: ProcessId }
  | { readonly kind: "cleanup_failed"; readonly processId: ProcessId; readonly failure: ProcessFailure }
  | { readonly kind: "stdio_failure"; readonly processId: ProcessId; readonly stream: "stdout" | "stderr"; readonly failure: ProcessFailure };

export type RuntimeEventSink = (e: RuntimeEvent) => void;

export type Clock = {
  readonly nowMs: () => number;
  readonly nowMonotonicMs: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<{ kind: "completed" } | { kind: "aborted" }>;
};

export type SignalPort = {
  signalGroup: (pgid: number, signal: "SIGTERM" | "SIGKILL" | 0) => SignalAttemptResult;
  probeGroup: (pgid: number) => GroupProbe;
};

export type SpawnedChild = {
  readonly pid: number | null;
  readonly pgid: number | null;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: "spawn", listener: () => void): SpawnedChild;
  on(
    event: "error",
    listener: (e: Error & { code?: string; syscall?: string; path?: string }) => void,
  ): SpawnedChild;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedChild;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedChild;
  once(event: "spawn", listener: () => void): SpawnedChild;
  once(
    event: "error",
    listener: (e: Error & { code?: string; syscall?: string; path?: string }) => void,
  ): SpawnedChild;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedChild;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedChild;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export type SpawnPort = {
  spawn: (args: {
    readonly executable: string;
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly detached: boolean;
  }) => SpawnedChild;
};

export type IdFactory = () => ProcessId;
