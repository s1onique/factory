/**
 * FOUNDATION04 — PHASE A — REBURN-CORRECTION01-MICROFIX02
 *
 * Diagnostic-packet helpers for the WSTART live lane
 * and its adversarial oracles.
 *
 * The packet shape below is the authoritative schema
 * for the two orthogonal observation channels used by
 * `terminateAndProveWitness()`:
 *
 *   processExitObservation
 *     — driven by the `exit` and `error` events on the
 *       owned handle. This is process-lifecycle evidence.
 *
 *   bootstrapOutputBoundary
 *     — driven by `whenBootstrapOutputClosed()` (or a
 *       pre-resolved zero completion when the handle
 *       does not expose one). This is stdio-output
 *       accounting evidence.
 *
 * The two channels are kept orthogonal on purpose.
 * Node's `ChildProcess` may emit `'exit'` before
 * `'close'` (process terminated, stdio drains still
 * finalizing), or `'close'` while the process has long
 * since exited (Node also has a `'close'` that fires
 * after stdio is fully drained). Treating either as
 * proof of the other is a category error. See:
 *   https://nodejs.org/api/child_process.html
 *
 * Therefore:
 *
 *   - The packet's lifecycle classification (which
 *     feeds `proveChildAbsent`'s residue decision)
 *     derives from `processExitObservation` and from
 *     `errorEventObserved`, NEVER from
 *     `bootstrapOutputBoundary`.
 *
 *   - `bootstrapOutputBoundary` is recorded as an
 *     orthogonal fact about stdio accounting.
 *
 *   - The error-channel window starts at arming-time
 *     (BEFORE the kill request) and stays armed through
 *     the bounded process-observation deadline. It is
 *     not gated by a single-microtask `await
 *     Promise.resolve()` fence — Node does not give
 *     such a guarantee and the `WitnessSpawnHandle`
 *     exposes `on` without `removeListener`, so an
 *     artificial one-microtask window was unsound.
 */

export type ProcessExitObservation =
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {
      readonly kind: "error";
      readonly code?: string;
      readonly message?: string;
    }
  | {
      readonly kind: "timeout";
      readonly deadlineMs: number;
    }
  | {
      readonly kind: "unavailable";
    };

export type BootstrapOutputBoundary =
  | { readonly kind: "closed" }
  | { readonly kind: "timeout"; readonly deadlineMs: number }
  | { readonly kind: "no_barrier" }
  | { readonly kind: "error"; readonly code?: string };

export type SignalRequestOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "returned_false" }
  | { readonly kind: "threw"; readonly code?: string };

export type ErrorEventObserved =
  | { readonly seen: false }
  | {
      readonly seen: true;
      readonly code?: string;
      readonly message?: string;
    };

/**
 * Narrow surface the helper drives. Production
 * `WitnessSpawnHandle` exposes all of these (its `on`
 * covers both `exit` and `error`). Fakes may stub
 * only what they need — missing methods are treated
 * as "no information" rather than as an error.
 */
export type DiagnosticPort = {
  readonly pid?: number | null | undefined;
  readonly kill?: ((signal?: NodeJS.Signals) => boolean) | undefined;
  readonly exitInfo?: (() => {
    readonly exited: boolean;
    readonly code?: unknown;
    readonly signal?: unknown;
  }) | undefined;
  readonly on?: ((event: "exit", listener: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void) => unknown) | undefined;
  readonly onError?: ((event: "error", listener: (
    err: Error,
  ) => void) => unknown) | undefined;
  readonly whenBootstrapOutputClosed?: (() => Promise<unknown>) | undefined;
};

export type ExitInfoSnapshot = {
  readonly exited: boolean;
  readonly code?: unknown;
  readonly signal?: unknown;
} | null;

export type LifecycleObservationResult = {
  readonly signalRequestOutcome: SignalRequestOutcome;
  readonly errorEventObserved: ErrorEventObserved;
  readonly processExitObservation: ProcessExitObservation;
  readonly bootstrapOutputBoundary: BootstrapOutputBoundary;
  readonly exitInfoBeforeTermination: ExitInfoSnapshot;
  readonly exitInfoAfterProcessObservation: ExitInfoSnapshot;
  readonly exitInfoAfterOutputBoundaryWait: ExitInfoSnapshot;
};

export type LifecycleObservationOptions = {
  /** Bounded process-observation deadline (ms). */
  readonly processDeadlineMs: number;
  /** Bounded output-barrier deadline (ms). */
  readonly outputDeadlineMs: number;
};

function readExitInfo(port: DiagnosticPort): ExitInfoSnapshot {
  if (typeof port.exitInfo !== "function") return null;
  try {
    const raw = port.exitInfo() as {
      exited: boolean;
      code?: unknown;
      signal?: unknown;
    };
    return {
      exited: !!raw.exited,
      code: raw.code,
      signal: raw.signal,
    };
  } catch {
    return null;
  }
}
/** Tiny helper: race a promise against a settable timer
 * and always clean up the timer on settlement. Used for
 * both the process-observation deadline and the
 * output-barrier deadline so neither pins the test
 * process for longer than necessary.
 */
async function raceWithDeadline<T>(
  producer: () => Promise<T>,
  deadlineMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return await new Promise<T>((res) => {
    let settled = false;
    function finish(v: T): void {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      res(v);
    }
    timer = setTimeout(() => finish(onTimeout()), deadlineMs);
    producer().then(
      (v) => finish(v),
      () => finish(onTimeout()),
    );
  });
}

/**
 * Run the lifecycle observation sequence.
 *
 * Sequence (orthogonal channels, NEVER collapsed):
 *
 *   T0  readExitInfo  (provenance)
 *
 *   arm 'error' listener   ───── stays armed ────────────┐
 *   arm 'exit'  listener   ── fires first → settle       │
 *                                                      wait deadline
 *   request SIGTERM                                      │
 *   wait for:                                            │
 *     processExitObservation.kind === 'exit' | 'error'   │
 *     OR processDeadlineMs elapsed                       │
 *                                                      ──┘
 *
 *   T1a  readExitInfoAfterProcessObservation
 *   T1b  await bootstrapOutputClosed  (orthogonal)
 *   T1c  readExitInfoAfterOutputBoundaryWait
 *
 * The error listener is NOT removed at one microtask;
 * it stays armed until process observation settles.
 * `removeListener` is intentionally NOT used because
 * the `WitnessSpawnHandle` surface does not expose it.
 */
export async function observeLifecycle(
  port: DiagnosticPort,
  opts: LifecycleObservationOptions,
): Promise<LifecycleObservationResult> {
  const exitInfoBeforeTermination = readExitInfo(port);

  let signalRequestOutcome: SignalRequestOutcome = { kind: "accepted" };
  let errorEventObserved: ErrorEventObserved = { seen: false };
  let processExitObservation: ProcessExitObservation = {
    kind: "unavailable",
  };

  const exitResolveRef: { value: (() => void) | null } = { value: null };
  const errorResolveRef: { value: (() => void) | null } = { value: null };
  const exitSettled = new Promise<void>((res) => { exitResolveRef.value = res; });
  const errorSettled = new Promise<void>((res) => { errorResolveRef.value = res; });

  // Arm process observation channels BEFORE the kill.
  //
  // PRE-EXITED HANDLE: if the owned handle's exitInfo
  // already reports `exited: true` at arming time,
  // the process exited BEFORE we got a chance to
  // register a listener. Production wrapChild mutates
  // exitInfo on the 'exit' event; we cannot observe
  // an event that already fired. Seed the observation
  // from the handle's authoritative exitInfo() so
  // a pre-exited child is still classified correctly.
  if (
    exitInfoBeforeTermination !== null &&
    exitInfoBeforeTermination.exited === true
  ) {
    processExitObservation = {
      kind: "exit",
      code:
        typeof exitInfoBeforeTermination.code === "number"
          ? exitInfoBeforeTermination.code
          : null,
      signal:
        typeof exitInfoBeforeTermination.signal === "string"
          ? (exitInfoBeforeTermination.signal as NodeJS.Signals)
          : null,
    };
    exitResolveRef.value?.();
  }
  if (typeof port.on === "function") {
    try {
      port.on("exit", (code, signal) => {
        processExitObservation = { kind: "exit", code, signal };
        if (exitResolveRef.value) exitResolveRef.value();
      });
    } catch {
      /* adapter didn't accept listener */
      processExitObservation = { kind: "unavailable" };
    }
  }
  if (typeof port.onError === "function") {
    try {
      port.onError("error", (err) => {
        const e = err as NodeJS.ErrnoException;
        errorEventObserved = {
          seen: true,
          ...(typeof e?.code === "string" ? { code: e.code } : {}),
          ...(typeof e?.message === "string" ? { message: e.message } : {}),
        };
        // An `error` event without an `exit` event is
        // its own observation channel.
        if (processExitObservation.kind !== "exit") {
          processExitObservation = {
            kind: "error",
            ...(typeof e?.code === "string" ? { code: e.code } : {}),
            ...(typeof e?.message === "string" ? { message: e.message } : {}),
          };
        }
        if (errorResolveRef.value) errorResolveRef.value();
      });
    } catch {
      /* adapter didn't accept error listener */
    }
  }

  // Send the signal AFTER both listeners are armed.
  if (typeof port.kill === "function") {
    try {
      const r = port.kill("SIGTERM");
      if (r === false) {
        signalRequestOutcome = { kind: "returned_false" };
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      signalRequestOutcome = {
        kind: "threw",
        ...(typeof err?.code === "string" ? { code: err.code } : {}),
      };
    }
  } else {
    signalRequestOutcome = { kind: "returned_false" };
  }

  // Wait for process observation OR the bounded deadline.
  await raceWithDeadline<void>(
    async () => { await Promise.race([exitSettled, errorSettled]); },
    opts.processDeadlineMs,
    () => undefined,
  );

  if (processExitObservation.kind === "unavailable") {
    processExitObservation = {
      kind: "timeout",
      deadlineMs: opts.processDeadlineMs,
    };
  }

  const exitInfoAfterProcessObservation = readExitInfo(port);

  // ─────────────────────────────────────────────
  // Bootstrap-output-accounting barrier
  // (orthogonal to process observation). The output
  // boundary is reported separately and NEVER
  // promoted to lifecycle authority.
  // ─────────────────────────────────────────────
  let bootstrapOutputBoundary: BootstrapOutputBoundary;
  if (typeof port.whenBootstrapOutputClosed === "function") {
    const boundaryResult = await raceWithDeadline<
      | { kind: "closed" }
      | { kind: "error"; code?: string }
      | { kind: "timeout" }
    >(
      () => port.whenBootstrapOutputClosed!()
        .then(() => ({ kind: "closed" as const }))
        .catch((e: unknown) => {
          const err = e as NodeJS.ErrnoException;
          return {
            kind: "error" as const,
            ...(typeof err?.code === "string" ? { code: err.code } : {}),
          };
        }),
      opts.outputDeadlineMs,
      () => ({ kind: "timeout" as const }),
    );
    if (boundaryResult.kind === "timeout") {
      bootstrapOutputBoundary = {
        kind: "timeout",
        deadlineMs: opts.outputDeadlineMs,
      };
    } else {
      bootstrapOutputBoundary = boundaryResult;
    }
  } else {
    bootstrapOutputBoundary = { kind: "no_barrier" };
  }

  const exitInfoAfterOutputBoundaryWait = readExitInfo(port);

  return {
    signalRequestOutcome,
    errorEventObserved,
    processExitObservation,
    bootstrapOutputBoundary,
    exitInfoBeforeTermination,
    exitInfoAfterProcessObservation,
    exitInfoAfterOutputBoundaryWait,
  };
}
