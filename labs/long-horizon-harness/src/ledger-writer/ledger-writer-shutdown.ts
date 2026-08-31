/**
 * FOUNDATION04 — B0-CORR04 — LedgerWriter shutdown state
 * machine.
 *
 * Doctrine (B0-CORR04):
 *   **Deadline-effect law:** a timeout that does not
 *   alter control flow is not a deadline.
 */

import type { Server } from "node:net";

export type ShutdownServerPort = {
  close(): Promise<void>;
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
 *   1. drain — wait for waitForInFlight() to resolve
 *   2. close — wait for server.close() to settle
 *   3. release — release the lease via the capability handle
 *   4. shutdown_verified
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

  // Phase 1: drain in-flight handlers within deadline.
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

  // Phase 2: server.close() within deadline.
  const closeSettled = await Promise.race<
    { readonly kind: "closed" } | { readonly kind: "error"; readonly error: unknown } | { readonly kind: "timeout" }
  >([
    args.server.close().then(
      () => ({ kind: "closed" } as const),
      (e: unknown) => ({ kind: "error" as const, error: e }),
    ),
    clock.sleep(closeDeadlineMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (closeSettled.kind === "timeout") {
    return {
      ok: false,
      phase: "close_timeout",
      reason: `server.close did not settle within ${closeDeadlineMs}ms`,
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
        (r) => ({ kind: r.ok ? "released" : "release_failed", error: r.ok ? null : "ok=false" } as { readonly kind: "released" | "release_failed"; readonly error: unknown }),
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
 * `ShutdownServerPort`.
 */
export function asShutdownServerPort(server: Server): ShutdownServerPort {
  return {
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err !== undefined && err !== null) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}
