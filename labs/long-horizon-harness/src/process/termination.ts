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
 * EPERM / permission_denied taxonomy (CORRECTION10):
 *
 *   - EPERM returned by the actual `signalGroup(TERM|KILL)`
 *     operation  -> capability_unavailable, fail closed.
 *     (This is a pre-authority observation; the kernel
 *     refused our signal attempt outright.)
 *
 *   - EPERM returned by a null-signal group probe BEFORE
 *     successful signal authority has been established
 *     (e.g. a preflight capability probe, or the probe
 *     issued after a `signalGroup(TERM)` EPERM)
 *     -> capability_unavailable, fail closed.
 *
 *   - EPERM returned by a null-signal group probe AFTER
 *     this exact owned group has already accepted a
 *     TERM/KILL signal (-> signalGroup returned `sent`)
 *     -> indeterminate non-absence observation. The
 *     grace loop must CONTINUE bounded polling and
 *     only ESRCH closes ownership. Darwin's `kill(2)`
 *     documents that process-group signalling may
 *     return EPERM if any member of the group could
 *     not be signalled; during the death/reap window
 *     a still-visible zombie can therefore produce
 *     EPERM rather than ESRCH. Treating EPERM as
 *     terminal capability_unavailable in this context
 *     mis-classifies a successful hard-kill.
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
 *
 * CORRECTION10: combine CORRECTION09's reap tolerance with
 * post-successful-signal EPERM tolerance. Neither weakening
 * any other failure mode. Only `signalGroup()`-level EPERM
 * and pre-authority-probe EPERM remain terminal.
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
  // CORRECTION12 §1: truthful neutral is `not_observed`.
  // We have not run any probe yet.
  return {
    termRequested: false,
    termSent: false,
    termResult: null,
    killRequested: false,
    killSent: false,
    killResult: null,
    finalGroupProbe: { kind: "not_observed" },
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
      //
      // postSuccessfulSignal=true: TERM was just sent to
      // this exact owned group. A later EPERM probe is
      // indeterminate (CORRECTION10 Darwin semantics) and
      // must not collapse the loop into capability denial.
      const waited = await waitForGroupGoneWithClose({
        pgid,
        graceMs: args.termGraceMs,
        clock: args.clock,
        signals: args.signals,
        directChildCompletion: args.directChildCompletion ?? null,
        postSuccessfulSignal: true,
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

    // KILL signalGroup EPERM is the actual-signal-operation
    // form of permission_denied: terminal, fail closed.
    if (killResult.kind === "permission_denied") {
      const finalProbe = args.signals.probeGroup(pgid);
      const effectiveProbe = finalProbe.kind === "alive" || finalProbe.kind === "absent"
        ? { kind: "permission_denied" as const }
        : finalProbe;
      evidence = { ...evidence, finalGroupProbe: effectiveProbe };
      args.emitProbe(effectiveProbe);
      return evidence;
    }

    // KILL grace: this is the path where the zombie race
    // AND the post-SIGKILL EPERM window manifest. The
    // direct child has been signalled but may remain
    // visible (zombie) or probe-EPERM until Node's reap.
    // We MUST observe that reap and the convergence to
    // ESRCH before declaring the group absent, otherwise
    // we mis-classify a successful hard-kill as
    // cleanup_failed(phase=kill).
    //
    // postSuccessfulSignal=true: KILL was just sent to
    // this exact owned group. Transient EPERM probes
    // (Darwin) and transient zombie visibility (any
    // POSIX) are tolerated; ONLY ESRCH closes ownership.
    const waited = await waitForGroupGoneWithClose({
      pgid,
      graceMs: args.killGraceMs,
      clock: args.clock,
      signals: args.signals,
      directChildCompletion: args.directChildCompletion ?? null,
      postSuccessfulSignal: true,
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
 *   - On "permission_denied" probe:
 *        * `postSuccessfulSignal=false` (pre-authority):
 *          return permission_denied immediately. This is
 *          the legacy behaviour for capability preflight
 *          and for the probe issued after a signalGroup()
 *          EPERM. Fail closed.
 *        * `postSuccessfulSignal=true` (after this exact
 *          owned group has accepted our TERM/KILL):
 *          treat as indeterminate non-absence. Continue
 *          bounded polling. ONLY ESRCH closes ownership.
 *          This is CORRECTION10.
 *   - On "probe_error" probe:
 *        * `postSuccessfulSignal=false`: return immediately.
 *        * `postSuccessfulSignal=true`: continue bounded
 *          polling (the next probe may recover).
 *   - If `directChildCompletion` has resolved since the
 *     previous iteration, re-probe. The reap removes the
 *     zombie that was making the probe look "alive". A
 *     re-probe after close distinguishes:
 *        * genuine cleanup success (group now absent)
 *        * a real surviving descendant (group still alive)
 *        * a transient EPERM that will converge to ESRCH
 *          after the next reap iteration.
 *     All three are reported truthfully.
 *
 * Without the close-race and the EPERM-tolerance this loop
 * would mis-report cleanup_failed(phase=kill) on hosts that
 * expose transient zombie visibility (any POSIX) or
 * post-SIGKILL EPERM (Darwin specifically) before Node's
 * reap completes.
 */
async function waitForGroupGoneWithClose(args: {
  pgid: number;
  graceMs: number;
  clock: Clock;
  signals: SignalPort;
  directChildCompletion: Promise<ProcessCompletion> | null;
  postSuccessfulSignal: boolean;
  signal?: AbortSignal;
}): Promise<GroupProbe> {
  const { pgid, graceMs, clock, signals, signal, postSuccessfulSignal } = args;
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
    if (probe.kind === "permission_denied" && !postSuccessfulSignal) {
      // Pre-authority EPERM (or EPERM at the signalGroup()
      // level): fail closed immediately.
      return probe;
    }
    if (closeObserved) {
      // The direct child has been reaped. Re-probe to
      // distinguish "descendants also gone" (now absent)
      // from "a descendant is still alive" (still alive)
      // from "transient EPERM that has not yet converged
      // to ESRCH" (Darwin post-SIGKILL window).
      const reprobe = signals.probeGroup(pgid);
      if (reprobe.kind === "absent") {
        return reprobe;
      }
      if (reprobe.kind === "permission_denied" && !postSuccessfulSignal) {
        return reprobe;
      }
      // For postSuccessfulSignal=true, EPERM from the
      // re-probe is also indeterminate; keep polling.
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
