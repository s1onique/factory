#!/usr/bin/env node
/**
 * FOUNDATION04 — CORRECTION03 — LedgerWriter entry script.
 *
 * Lifetime contract (B0-CORR03 §1..2):
 *
 *   1. Bind UDS (acquire run-scoped lease first).
 *   2. Service requests.
 *   3. SIGTERM/SIGINT → orderly shutdown:
 *        a. server.close() (stop accepting new connections)
 *        b. wait for server 'close' event and in-flight
 *           handlers to settle
 *        c. ONLY THEN release the lease via the capability
 *           handle
 *        d. process.exit(0)
 *      Bounded by a deadline; if the deadline expires, the
 *      lease is RETAINED and process.exit(1) — an external
 *      SIGKILL is required to remove the writer.
 */
import { startWriterServer } from "./ledger-writer-server.js";
import {
  ENV_INSTANCE_ID,
  ENV_MISSION_ID,
  ENV_RUN_DIR,
  ENV_RUN_ID,
  ENV_SOCKET_PATH,
} from "./ledger-writer-process.js";
import type { Server } from "node:net";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing required env var ${name}`);
  }
  return v;
}

const SHUTDOWN_DEADLINE_MS = 5000;

async function main(): Promise<void> {
  const args = {
    runDir: requireEnv(ENV_RUN_DIR),
    runId: requireEnv(ENV_RUN_ID),
    missionId: requireEnv(ENV_MISSION_ID),
    socketPath: requireEnv(ENV_SOCKET_PATH),
    instanceId: requireEnv(ENV_INSTANCE_ID),
  };
  const result = await startWriterServer(args);
  if (!result.ok) {
    const e = result.error;
    const msg =
      e.kind === "directory_wrong_mode"
        ? `${e.kind} mode=${e.observed}`
        : `${e.kind} ${e.message}`;
    console.error(`ledger-writer: failed to start: ${msg}`);
    process.exit(2);
  }
  const handle = result.value;
  let shutdownInProgress = false;
  const onShutdownSignal = (): void => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    void shutdownGracefully(handle);
  };
  process.on("SIGTERM", onShutdownSignal);
  process.on("SIGINT", onShutdownSignal);
}

main().catch((e: unknown) => {
  console.error(`ledger-writer: fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(3);
});

/**
 * B0-CORR04: ordered, bounded shutdown. The lease is NEVER
 * released if any phase fails. Repeated signals are
 * coalesced.
 *
 * The state machine lives in ledger-writer-shutdown.ts.
 */
async function shutdownGracefully(handle: {
  readonly server: Server;
  readonly leaseHandle: { readonly release: () => Promise<unknown> };
  readonly waitForInFlight: () => Promise<void>;
}): Promise<void> {
  const { shutdownLedgerWriter, asShutdownServerPort } = await import(
    "./ledger-writer-shutdown.js"
  );
  const releaseAdapter = async (): Promise<{ readonly ok: boolean }> => {
    const r = await handle.leaseHandle.release();
    if (
      typeof r === "object" &&
      r !== null &&
      "ok" in r &&
      typeof (r as { ok: unknown }).ok === "boolean"
    ) {
      return { ok: (r as { ok: boolean }).ok };
    }
    return { ok: false };
  };
  const result = await shutdownLedgerWriter({
    server: asShutdownServerPort(handle.server),
    waitForInFlight: handle.waitForInFlight,
    leaseHandle: { release: releaseAdapter },
    drainDeadlineMs: SHUTDOWN_DEADLINE_MS,
    closeDeadlineMs: SHUTDOWN_DEADLINE_MS,
    leaseReleaseDeadlineMs: SHUTDOWN_DEADLINE_MS,
  });
  if (result.ok) {
    process.exit(0);
  }
  // Fail closed: retain the lease and exit non-zero. An
  // external SIGKILL is required to remove the writer.
  process.stderr.write(
    `ledger-writer: shutdown failed in phase=${result.phase}: ${result.reason}\n`,
  );
  process.exit(1);
}
