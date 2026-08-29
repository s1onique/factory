/**
 * Runtime event-stream and port types.
 *
 * Split from process-types.ts to keep each file under the 400-LOC
 * discipline while preserving a single conceptual boundary.
 */

import type {
  GroupProbe,
  ProcessId,
  SignalAttemptResult,
} from "./process-types.js";

export type RuntimeEvent =
  | { readonly kind: "process_spawn_started"; readonly processId: ProcessId }
  | {
      readonly kind: "process_spawned";
      readonly processId: ProcessId;
      readonly pid: number;
      readonly processGroupId: number;
    }
  | {
      readonly kind: "stdout_progress";
      readonly processId: ProcessId;
      readonly bytesSeen: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "stderr_progress";
      readonly processId: ProcessId;
      readonly bytesSeen: number;
      readonly truncated: boolean;
    }
  | { readonly kind: "deadline_reached"; readonly processId: ProcessId }
  | { readonly kind: "cancellation_requested"; readonly processId: ProcessId }
  | {
      readonly kind: "signal_sent";
      readonly processId: ProcessId;
      readonly signal: "SIGTERM" | "SIGKILL" | 0;
      readonly result: SignalAttemptResult;
    }
  | {
      readonly kind: "process_exit_observed";
      readonly processId: ProcessId;
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {
      readonly kind: "cleanup_probe";
      readonly processId: ProcessId;
      readonly probe: GroupProbe;
    }
  | { readonly kind: "cleanup_verified"; readonly processId: ProcessId };

export type RuntimeEventSink = (e: RuntimeEvent) => void;

export type Clock = {
  readonly nowMs: () => number;
  readonly nowMonotonicMs: () => number;
  readonly sleep: (
    ms: number,
    signal?: AbortSignal,
  ) => Promise<{ readonly kind: "completed" } | { readonly kind: "aborted" }>;
};

export type SignalPort = {
  signalGroup(
    pgid: number,
    signal: "SIGTERM" | "SIGKILL" | 0,
    immediateChildPid?: number,
  ): SignalAttemptResult;
  probeGroup(pgid: number): GroupProbe;
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
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SpawnedChild;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export type SpawnPort = {
  spawn(args: {
    readonly executable: string;
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly detached: boolean;
  }): SpawnedChild;
};
