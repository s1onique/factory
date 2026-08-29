/**
 * Termination escalation engine.
 *
 * One state machine; two triggers (deadline, cancel). First
 * terminal trigger wins; later triggers are recorded but cannot
 * replace the chosen cause.
 *
 * Idempotent: runEscalation runs exactly once per engine
 * instance.
 *
 * On EPERM or other errors attempting negative-pgid signalling,
 * the engine surfaces permission_denied and the supervisor must
 * fail closed (NOT silently degrade to immediate-child PID
 * signalling).
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
  /**
   * Mark that a non-deadline/cancelled path (e.g. child exited
   * or spawn failed) has reached terminal state. Subsequent
   * deadline checks will observe hasTerminalCause() === true
   * and skip emission.
   */
  markSettled: () => void;
  runEscalation: (pgid: number) => Promise<EscalationEvidence>;
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
  const markSettled = (): void => {
    if (terminal === null) {
      terminal = "exited";
    }
  };

  const runEscalation = (
    pgid: number,
  ): Promise<EscalationEvidence> => {
    if (escalationPromise !== null) {
      return escalationPromise;
    }
    escalationPromise = doEscalate(pgid);
    return escalationPromise;
  };

  async function doEscalate(
    pgid: number,
  ): Promise<EscalationEvidence> {
    evidence = { ...evidence, termRequested: true };
    const termResult = args.signals.signalGroup(pgid, "SIGTERM");
    args.emit("SIGTERM", termResult);
    evidence = {
      ...evidence,
      termSent: termResult.kind === "sent",
      termResult,
    };

    if (termResult.kind === "permission_denied") {
      // Fail closed: do not fall back to immediate child. The
      // group probe may itself be denied; if so, propagate the
      // permission_denied result truthfully.
      const finalProbe = args.signals.probeGroup(pgid);
      const effectiveProbe = finalProbe.kind === "alive" || finalProbe.kind === "absent"
        ? { kind: "permission_denied" as const }
        : finalProbe;
      evidence = { ...evidence, finalGroupProbe: effectiveProbe };
      args.emitProbe(effectiveProbe);
      return evidence;
    }

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
    const killResult = args.signals.signalGroup(pgid, "SIGKILL");
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
    markSettled,
    runEscalation,
  };
}

async function waitForGroupGone(
  pgid: number,
  graceMs: number,
  clock: Clock,
  signals: SignalPort,
  signal?: AbortSignal,
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
    if (probe.kind === "permission_denied") {
      return probe;
    }
    const r = await clock.sleep(20, signal);
    if (r.kind === "aborted") {
      // Aborted mid-grace; record final probe and return.
      return signals.probeGroup(pgid);
    }
  }
  return signals.probeGroup(pgid);
}

export function cleanupTimeoutFailure(
  phase: "term" | "kill",
  message: string,
): ProcessFailure {
  return { kind: "cleanup_timeout", phase, message };
}
