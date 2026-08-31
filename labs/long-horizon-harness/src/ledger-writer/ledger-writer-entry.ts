#!/usr/bin/env node
/**
 * FOUNDATION04 — CORRECTION01 — LedgerWriter entry script.
 *
 * Runs as a detached child of the supervisor. Reads bootstrap
 * inputs from env vars (set by startLedgerWriter()), opens the
 * UDS, and serves append/ping/who_are_you requests.
 *
 * The script's ONLY responsibilities are:
 *   - bind the UDS at the requested path
 *   - service one-shot framed RPCs
 *   - own the dedup index for the run
 *
 * It deliberately has no concept of run state, witness state,
 * candidate execution, or cryptography. Those live elsewhere.
 *
 * This script is invoked as:
 *   node --import tsx src/ledger-writer/ledger-writer-entry.ts
 * with the FACTORY_LEDGER_WRITER_* env vars set by the parent.
 */
import { startWriterServer } from "./ledger-writer-server.js";
import {
  ENV_INSTANCE_ID,
  ENV_MISSION_ID,
  ENV_RUN_DIR,
  ENV_RUN_ID,
  ENV_SOCKET_PATH,
} from "./ledger-writer-process.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== "string" || v.length === 0) {
    // Refuse to start without bootstrap inputs. This is the
    // boot-time guarantee: no env, no writer.
    throw new Error(`missing required env var ${name}`);
  }
  return v;
}

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
    // We are detached, so we can't talk to the parent. Exit
    // non-zero with a descriptive message; the parent's
    // socket-poll will time out and the supervisor will see
    // `writer_not_ready`.
    const e = result.error;
    const msg =
      e.kind === "directory_wrong_mode"
        ? `${e.kind} mode=${e.observed}`
        : `${e.kind} ${e.message}`;
    console.error(`ledger-writer: failed to start: ${msg}`);
    process.exit(2);
  }
  // Stay alive. The supervisor may eventually kill us (clean
  // shutdown) or we may crash (unclean); either way, the
  // socket file disappears and any in-flight client retries
  // will see `writer_unavailable`.
  // Keep the process alive on its own. `server` is held in
  // the closure of the createServer callback; the only handle
  // keeping the event loop alive is the server itself.
  process.on("SIGTERM", () => {
    try {
      result.value.close();
    } catch {
      // best-effort
    }
    process.exit(0);
  });
  process.on("SIGINT", () => {
    try {
      result.value.close();
    } catch {
      // best-effort
    }
    process.exit(0);
  });
}

main().catch((e: unknown) => {
  console.error(`ledger-writer: fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(3);
});
