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
 *
 * CORRECTION09: the KILL grace loop races against the direct
 * ChildProcess lifecycle. POSIX guarantees that a successfully
 * signalled process can remain a zombie in the process table
 * until its parent reaps it; during that window
 * `kill(-pgid, 0)` still reports "alive". A naive group-probe
 * loop would therefore report cleanup_failed(phase=kill)
 * even though the immediate child is gone. The engine races
 * a `directChildCompletion` promise alongside the probe and
 * re-probes after the close boundary so we DO NOT report
 * cleanup_failed on transient zombie visibility.
 */

import type {
  EscalationEvidence,
  GroupProbe,
  ProcessCompletion,
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
  /**
   * Eagerly-constructed direct-ChildProcess completion
   * promise. When provided, the KILL grace loop races
   * this promise alongside the group probe so that zombie
   * visibility (a still-referenced killed child) is not
   * misclassified as a surviving process. Optional so that
   * older / hand-rolled tests can omit it.
   *
   * Pass the SAME promise that the supervisor's
   * settleCompletionOnce() resolves on 'close' / spawn_error.
   */
  directChildCompletion?: Promise<ProcessCompletion>;
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
      // TERM grace: race group-absence probe against direct
      // child completion. A cooperative handler will close
      // promptly, after which the group becomes absent.
      const waited = await waitForGroupGoneWithClose({
        pgid,
        graceMs: args.termGraceMs,
        clock: args.clock,
        signals: args.signals,
        directChildCompletion: args.directChildCompletion ?? null,
      });
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
    // KILL grace: this is the path where the zombie race
    // manifests. The direct child has been signalled but
    // may remain visible in the process table until Node's
    // reap. We MUST observe that reap before declaring the
    // group absent, otherwise we mis-classify a successful
    // hard-kill as cleanup_failed(phase=kill).
    const waited = await waitForGroupGoneWithClose({
      pgid,
      graceMs: args.killGraceMs,
      clock: args.clock,
      signals: args.signals,
      directChildCompletion: args.directChildCompletion ?? null,
    });
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

/**
 * Wait for the PGID to become absent, with the following
 * semantics:
 *
 *   - Probe the group every ~20ms until graceMs elapses.
 *   - On "absent" probe              -> return absent.
 *   - On "permission_denied" probe   -> return permission_denied.
 *   - If `directChildCompletion` has resolved since the
 *     previous iteration, re-probe. The reap removes the
 *     zombie that was making the probe look "alive". A
 *     re-probe after close distinguishes:
 *        * genuine cleanup success (group now absent)
 *        * a real surviving descendant (group still alive)
 *     Both cases are reported truthfully.
 *
 * Without the close-race this loop would mis-report
 * cleanup_failed(phase=kill) whenever SIGKILL races the
 * kernel's reap — a race that exists in the wild and is
 * not under our control.
 */
async function waitForGroupGoneWithClose(args: {
  pgid: number;
  graceMs: number;
  clock: Clock;
  signals: SignalPort;
  directChildCompletion: Promise<ProcessCompletion> | null;
  signal?: AbortSignal;
}): Promise<GroupProbe> {
  const { pgid, graceMs, clock, signals, signal } = args;
  const completion = args.directChildCompletion;
  let closeObserved = false;

  // Poll the close promise via a side-channel boolean. We
  // intentionally do NOT block the loop on close; the loop
  // is bounded by graceMs and we just want to know whether
  // close has fired so we can re-probe on the next iteration.
  if (completion !== null) {
    void completion.then(() => {
      closeObserved = true;
    });
  }

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
    if (closeObserved) {
      // The direct child has been reaped. Re-probe to
      // distinguish "descendants also gone" (now absent)
      // from "a descendant is still alive" (still alive).
      const reprobe = signals.probeGroup(pgid);
      if (reprobe.kind === "absent") {
        return reprobe;
      }
      if (reprobe.kind === "permission_denied") {
        return reprobe;
      }
      // Descendants surviving — continue bounded probing
      // for the remainder of the grace.
    }
    const r = await clock.sleep(20, signal);
    if (r.kind === "aborted") {
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
