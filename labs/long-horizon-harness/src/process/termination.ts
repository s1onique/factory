/**
 * Termination escalation engine.
 *
 * One state machine; two triggers (deadline, cancel). The first
 * terminal trigger wins; later triggers are recorded as ignored.
 *
 *   running
 *     ├─ on deadline_reached      → terminal = "deadline"
 *     └─ on cancellation_requested → terminal = "cancelled"
 *
 *   terminating:
 *     TERM sent to group
 *       ├─ group absent within termGrace
 *       │     → cleanup_verified
 *       └─ group still alive
 *             → KILL sent to group
 *             ├─ group absent within killGrace
 *             │     → cleanup_verified
 *             └─ group still alive
 *                   → cleanup_failed
 *
 * Idempotent: requesting TERM twice in a row only sends the
 * signal once.
 */

import type {
  EscalationEvidence,
  GroupProbe,
  ProcessFailure,
  SignalAttemptResult,
} from "./process-types.js";
import type { Clock, SignalPort } from "./process-ports.js";

export type TerminationCause = "deadline" | "cancelled" | "exited" | "signaled";

export type TerminationEngine = {
  requestCleanup: (cause: "deadline" | "cancelled") => void;
  hasTerminalCause: () => boolean;
  terminalCause: () => TerminationCause | null;
  runEscalation: (
    pgid: number,
    immediateChildPid?: number,
  ) => Promise<EscalationEvidence>;
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

export function createTerminationEngine(args: {
  clock: Clock;
  signals: SignalPort;
  termGraceMs: number;
  killGraceMs: number;
  emit: (signal: "SIGTERM" | "SIGKILL" | 0, result: SignalAttemptResult) => void;
  emitProbe: (probe: GroupProbe) => void;
}): TerminationEngine {
  let terminal: TerminationCause | null = null;
  let evidence: EscalationEvidence = emptyEscalation();
  let escalationPromise: Promise<EscalationEvidence> | null = null;

  const requestCleanup = (cause: "deadline" | "cancelled"): void => {
    if (terminal === null) {
      terminal = cause;
    }
  };

  const hasTerminalCause = (): boolean => terminal !== null;
  const terminalCause = (): TerminationCause | null => terminal;

  const runEscalation = (
    pgid: number,
    immediateChildPid?: number,
  ): Promise<EscalationEvidence> => {
    if (escalationPromise !== null) {
      return escalationPromise;
    }
    escalationPromise = doEscalate(pgid, immediateChildPid);
    return escalationPromise;
  };

  async function doEscalate(
    pgid: number,
    immediateChildPid?: number,
  ): Promise<EscalationEvidence> {
    evidence = { ...evidence, termRequested: true };
    const termResult = args.signals.signalGroup(pgid, "SIGTERM", immediateChildPid);
    args.emit("SIGTERM", termResult);
    evidence = {
      ...evidence,
      termSent: termResult.kind === "sent",
      termResult,
    };
    if (termResult.kind === "sent") {
      const waited = await waitForGroupGone(
        pgid,
        args.termGraceMs,
        args.clock,
        args.signals,
      );
      evidence = { ...evidence, finalGroupProbe: waited };
      args.emitProbe(waited);
      if (waited.kind === "absent") {
        return evidence;
      }
    } else if (termResult.kind === "group_absent") {
      evidence = {
        ...evidence,
        finalGroupProbe: { kind: "absent" },
      };
      args.emitProbe({ kind: "absent" });
      return evidence;
    }

    evidence = { ...evidence, killRequested: true };
    const killResult = args.signals.signalGroup(pgid, "SIGKILL", immediateChildPid);
    args.emit("SIGKILL", killResult);
    evidence = {
      ...evidence,
      killSent: killResult.kind === "sent",
      killResult,
    };
    const waited = await waitForGroupGone(
      pgid,
      args.killGraceMs,
      args.clock,
      args.signals,
    );
    evidence = { ...evidence, finalGroupProbe: waited };
    args.emitProbe(waited);
    return evidence;
  }

  return {
    requestCleanup,
    hasTerminalCause,
    terminalCause,
    runEscalation,
  };
}

async function waitForGroupGone(
  pgid: number,
  graceMs: number,
  clock: Clock,
  signals: SignalPort,
): Promise<GroupProbe> {
  if (graceMs <= 0) {
    return signals.probeGroup(pgid);
  }
  const start = clock.nowMonotonicMs();
  while (clock.nowMonotonicMs() - start < graceMs) {
    const probe = signals.probeGroup(pgid);
    if (probe.kind === "absent") {
      return probe;
    }
    await clock.sleep(20);
  }
  return signals.probeGroup(pgid);
}

export function cleanupTimeoutFailure(
  phase: "term" | "kill",
  message: string,
): ProcessFailure {
  return { kind: "cleanup_timeout", phase, message };
}
