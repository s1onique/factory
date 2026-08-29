/**
 * Typed model for the supervised-process runtime.
 *
 * This file is intentionally pure data: no Node built-ins are
 * imported. The runtime layer (supervised-process.ts,
 * process-group.ts, output-capture.ts, termination.ts, clock.ts)
 * implements against these types.
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

function isFiniteNonNegativeInt(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n >= 0
  );
}

export function validateProcessSpec(
  spec: ProcessSpec,
): Result<ProcessSpec, ProcessFailure> {
  if (typeof spec.executable !== "string" || spec.executable.length === 0) {
    return err({
      kind: "invalid_process_spec",
      message: "executable must be a non-empty string",
    });
  }
  if (!Array.isArray(spec.args)) {
    return err({
      kind: "invalid_process_spec",
      message: "args must be an array of strings",
    });
  }
  for (const a of spec.args) {
    if (typeof a !== "string") {
      return err({
        kind: "invalid_process_spec",
        message: "each arg must be a string",
      });
    }
  }
  if (typeof spec.cwd !== "string" || spec.cwd.length === 0) {
    return err({
      kind: "invalid_process_spec",
      message: "cwd must be a non-empty string",
    });
  }
  if (!isFiniteNonNegativeInt(spec.deadlineMs) || spec.deadlineMs <= 0) {
    return err({
      kind: "invalid_process_spec",
      message: `deadlineMs must be a positive integer; got ${spec.deadlineMs}`,
    });
  }
  if (!isFiniteNonNegativeInt(spec.termGraceMs)) {
    return err({
      kind: "invalid_process_spec",
      message: `termGraceMs must be a non-negative integer; got ${spec.termGraceMs}`,
    });
  }
  if (!isFiniteNonNegativeInt(spec.killGraceMs)) {
    return err({
      kind: "invalid_process_spec",
      message: `killGraceMs must be a non-negative integer; got ${spec.killGraceMs}`,
    });
  }
  if (!isFiniteNonNegativeInt(spec.stdoutLimitBytes)) {
    return err({
      kind: "invalid_process_spec",
      message: `stdoutLimitBytes must be a non-negative integer; got ${spec.stdoutLimitBytes}`,
    });
  }
  if (!isFiniteNonNegativeInt(spec.stderrLimitBytes)) {
    return err({
      kind: "invalid_process_spec",
      message: `stderrLimitBytes must be a non-negative integer; got ${spec.stderrLimitBytes}`,
    });
  }
  return ok(spec);
}

export type ProcessFailure =
  | { readonly kind: "invalid_process_spec"; readonly message: string }
  | {
      readonly kind: "spawn_failure";
      readonly code?: string;
      readonly syscall?: string;
      readonly path?: string;
      readonly message: string;
    }
  | {
      readonly kind: "signal_failure";
      readonly signal: "SIGTERM" | "SIGKILL" | 0;
      readonly code?: string;
      readonly message: string;
    }
  | {
      readonly kind: "cleanup_timeout";
      readonly phase: "term" | "kill";
      readonly message: string;
    }
  | {
      readonly kind: "stdio_failure";
      readonly stream: "stdout" | "stderr";
      readonly code?: string;
      readonly message: string;
    }
  | {
      readonly kind: "internal_process_failure";
      readonly message: string;
    };

export type SignalAttemptResult =
  | { readonly kind: "sent"; readonly signal: "SIGTERM" | "SIGKILL" | 0 }
  | { readonly kind: "group_absent" }
  | { readonly kind: "permission_denied"; readonly code?: string }
  | { readonly kind: "error"; readonly code?: string; readonly message: string };

export type GroupProbe =
  | { readonly kind: "alive" }
  | { readonly kind: "absent" }
  | { readonly kind: "permission_denied"; readonly code?: string }
  | {
      readonly kind: "probe_error";
      readonly code?: string;
      readonly message: string;
    };

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
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | {
      readonly kind: "signaled";
      readonly signal: NodeJS.Signals | null;
      readonly exitCode: number | null;
    }
  | { readonly kind: "deadline"; readonly escalation: EscalationEvidence }
  | { readonly kind: "cancelled"; readonly escalation: EscalationEvidence }
  | { readonly kind: "spawn_failed"; readonly failure: ProcessFailure }
  | {
      readonly kind: "cleanup_failed";
      readonly failure: ProcessFailure;
      readonly escalation: EscalationEvidence;
    };

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
