/**
 * FOUNDATION04 — B0-CORR05 — LedgerWriter shutdown state
 * machine.
 *
 * Doctrine (B0-CORR04 + B0-CORR05):
 *
 *   **Deadline-effect law:** a timeout that does not
 *   alter control flow is not a deadline.
 *
 *   **Admission-closure law:** graceful shutdown begins
 *   by preventing new work from entering; draining before
 *   closing admission is not quiescence.
 *
 * The shutdown port separates two distinct facts:
 *
 *   1. requestClose() — synchronously initiate server
 *      close so admission stops. Returns whether the
 *      close request was accepted.
 *
 *   2. awaitClosed() — resolves only when the close
 *      boundary occurs.
 *
 * The state machine MUST invoke requestClose BEFORE
 * draining already-admitted handlers, and MUST NOT release
 * the lease before awaitClosed resolves.
 */

import type { Server } from "node:net";

export type CloseRequestError =
  | { readonly kind: "already_closed" }
  | { readonly kind: "io_error"; readonly message: string };

export type ShutdownServerPort = {
  /**
   * Synchronously request that the server stop accepting
   * new connections. Subsequent admission attempts MUST be
   * rejected. Returns ok=true if the request was accepted.
   */
  requestClose(): { readonly ok: true } | { readonly ok: false; readonly error: CloseRequestError };
  /**
   * Resolve when the close boundary has been observed.
   */
  awaitClosed(): Promise<void>;
};

export type ShutdownClockPort = {
  sleep(ms: number): Promise<void>;
};

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const realShutdownClockPort: ShutdownClockPort = {
  sleep: realSleep,
};

export type ShutdownPhase =
  | "shutdown_verified"
  | "admission_not_closable"
  | "drain_timeout"
  | "close_timeout"
  | "close_failed"
  | "lease_release_failed";

export type ShutdownResult =
  | { readonly ok: true; readonly phase: "shutdown_verified" }
  | {
      readonly ok: false;
      readonly phase: Exclude<ShutdownPhase, "shutdown_verified">;
      readonly reason: string;
    };

/**
 * Bounded shutdown. The lease is NEVER released if any
 * phase fails.
 *
 * Phases (each bounded by its own deadline):
 *
 *   0. requestClose — synchronously stop admission.
 *   1. drain — wait for waitForInFlight() to resolve.
 *   2. awaitClosed — wait for the close boundary.
 *   3. release — release the lease via the capability
 *      handle.
 *   4. shutdown_verified.
 *
 * Any phase failure returns a ShutdownResult with ok=false.
 * The lease remains held; the caller must NOT release it.
 */
export async function shutdownLedgerWriter(args: {
  readonly server: ShutdownServerPort;
  readonly waitForInFlight: () => Promise<void>;
  readonly leaseHandle: {
    readonly release: () => Promise<{ readonly ok: boolean }>;
  };
  readonly drainDeadlineMs?: number;
  readonly closeDeadlineMs?: number;
  readonly leaseReleaseDeadlineMs?: number;
  readonly clock?: ShutdownClockPort;
}): Promise<ShutdownResult> {
  const drainDeadlineMs = args.drainDeadlineMs ?? 5000;
  const closeDeadlineMs = args.closeDeadlineMs ?? 5000;
  const leaseReleaseDeadlineMs = args.leaseReleaseDeadlineMs ?? 5000;
  const clock = args.clock ?? realShutdownClockPort;

  // Phase 0: synchronously stop admission.
  const closeReq = args.server.requestClose();
  if (!closeReq.ok) {
    return {
      ok: false,
      phase: "admission_not_closable",
      reason: `requestClose failed: ${closeReq.error.kind}`,
    };
  }

  // Phase 1: drain already-admitted in-flight handlers.
  const drainResult = await Promise.race([
    args.waitForInFlight().then(() => "drained" as const),
    clock.sleep(drainDeadlineMs).then(() => "timeout" as const),
  ]);
  if (drainResult !== "drained") {
    return {
      ok: false,
      phase: "drain_timeout",
      reason: `in-flight handlers did not settle within ${drainDeadlineMs}ms`,
    };
  }

  // Phase 2: await the close boundary.
  const closeSettled = await Promise.race<
    { readonly kind: "closed" } | { readonly kind: "error"; readonly error: unknown } | { readonly kind: "timeout" }
  >([
    args.server.awaitClosed().then(
      () => ({ kind: "closed" } as const),
      (e: unknown) => ({ kind: "error" as const, error: e }),
    ),
    clock.sleep(closeDeadlineMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (closeSettled.kind === "timeout") {
    return {
      ok: false,
      phase: "close_timeout",
      reason: `server did not close within ${closeDeadlineMs}ms`,
    };
  }
  if (closeSettled.kind === "error") {
    const e = closeSettled.error;
    const errMsg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      phase: "close_failed",
      reason: errMsg,
    };
  }

  // Phase 3: release lease within deadline.
  const releaseSettled = await Promise.race<
    | { readonly kind: "released" }
    | { readonly kind: "release_failed"; readonly error: unknown }
    | { readonly kind: "timeout" }
  >([
    args.leaseHandle
      .release()
      .then(
        (r) =>
          ({
            kind: r.ok ? "released" : "release_failed",
            error: r.ok ? null : "ok=false",
          }) as { readonly kind: "released" | "release_failed"; readonly error: unknown },
        (e: unknown) => ({ kind: "release_failed" as const, error: e }),
      ),
    clock.sleep(leaseReleaseDeadlineMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (releaseSettled.kind === "timeout") {
    return {
      ok: false,
      phase: "lease_release_failed",
      reason: `lease release did not settle within ${leaseReleaseDeadlineMs}ms`,
    };
  }
  if (releaseSettled.kind === "release_failed") {
    const e = releaseSettled.error;
    const reason = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      phase: "lease_release_failed",
      reason,
    };
  }

  return { ok: true, phase: "shutdown_verified" };
}

/**
 * Adapter that turns a `net.Server` into a
 * ShutdownServerPort.
 */
export function asShutdownServerPort(server: Server): ShutdownServerPort {
  let closeRequested = false;
  let closeResolve: (() => void) | null = null;
  let closeReject: ((e: Error) => void) | null = null;
  const closed = new Promise<void>((resolve, reject) => {
    closeResolve = resolve;
    closeReject = reject;
  });
  return {
    requestClose: (): { readonly ok: true } | { readonly ok: false; readonly error: CloseRequestError } => {
      if (closeRequested) {
        return { ok: false, error: { kind: "already_closed" } };
      }
      closeRequested = true;
      try {
        server.close((err) => {
          if (err !== undefined && err !== null) {
            if (closeReject !== null) closeReject(err);
          } else {
            if (closeResolve !== null) closeResolve();
          }
        });
        return { ok: true };
      } catch (e: unknown) {
        return {
          ok: false,
          error: {
            kind: "io_error",
            message: e instanceof Error ? e.message : String(e),
          },
        };
      }
    },
    awaitClosed: (): Promise<void> => closed,
  };
}
