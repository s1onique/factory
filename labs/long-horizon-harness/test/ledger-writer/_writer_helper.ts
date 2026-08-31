/**
 * Phase B0 — subprocess harness for LedgerWriter live tests.
 *
 * Spawns the writer as a detached child via
 * startLedgerWriter(), returns a handle with helpers:
 *   - stop(): kill -SIGKILL the writer
 *   - ping(): ping the writer over its UDS
 *   - append(): submit an appendEvidence request
 *   - restart(): stop + start a fresh writer; returns new handle
 *
 * The harness deliberately does NOT generate its own
 * commitIds — that is the caller's responsibility, so
 * tests can exercise dedup correctly.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  startLedgerWriter,
  ledgerWriterSocketPath,
} from "../../src/ledger-writer/ledger-writer-process.js";
import {
  appendToLedgerWriter,
  pingLedgerWriter,
} from "../../src/ledger-writer/ledger-writer-client.js";
import { makeLedgerWriterInstanceId } from "../../src/ledger-writer/ledger-writer-types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const ENTRY_SCRIPT = path.join(REPO_ROOT, "src", "ledger-writer", "ledger-writer-entry.ts");
const TSX_LOADER = "tsx";

export type WriterHandle = {
  readonly runDir: string;
  readonly socketPath: string;
  readonly child: ChildProcess;
  readonly instanceId: ReturnType<typeof makeLedgerWriterInstanceId>;
  stop(): Promise<void>;
  ping(): ReturnType<typeof pingLedgerWriter>;
  append(args: { commitId: string; envelopeBytes: string; contentHash: string }): ReturnType<typeof appendToLedgerWriter>;
};

export async function startWriterInTmpDir(
  runDir: string,
  readyTimeoutMs = 5000,
): Promise<WriterHandle> {
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  // Always start from a clean socket + state.
  try {
    await fs.rm(ledgerWriterSocketPath(runDir), { force: true });
  } catch {
    // best-effort
  }

  const result = await startLedgerWriter(
    {
      runDir,
      runId: "test-run",
      missionId: "test-mission",
      entryScript: ENTRY_SCRIPT,
      tsxLoader: TSX_LOADER,
    },
    readyTimeoutMs,
  );
  if (!result.ok) {
    throw new Error(`startLedgerWriter failed: ${result.error.message}`);
  }

  const handle: WriterHandle = {
    runDir,
    socketPath: result.socketPath,
    child: result.child,
    instanceId: result.binding.instanceId,
    async stop(): Promise<void> {
      try {
        result.child.kill("SIGKILL");
      } catch {
        // best-effort
      }
      // Wait for socket to disappear; clean up if not.
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try {
          await fs.lstat(ledgerWriterSocketPath(runDir));
          await new Promise((r) => setTimeout(r, 25));
        } catch {
          return;
        }
      }
      try {
        await fs.rm(ledgerWriterSocketPath(runDir), { force: true });
      } catch {
        // best-effort
      }
    },
    ping() {
      return pingLedgerWriter({ socketPath: result.socketPath, timeoutMs: 5000 });
    },
    append(args) {
      return appendToLedgerWriter(
        { socketPath: result.socketPath, timeoutMs: 10000 },
        args,
      );
    },
  };
  return handle;
}

/**
 * Spawn the writer entry directly (not via startLedgerWriter).
 * Used by tests that want to inject env vars or control the
 * entry path precisely. Returns the child process; the test
 * is responsible for waiting on socket readiness.
 */
export function spawnWriterEntry(args: {
  readonly runDir: string;
  readonly runId?: string;
  readonly missionId?: string;
  readonly socketPath?: string;
  readonly instanceId?: string;
}): { readonly child: ChildProcess } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FACTORY_LEDGER_WRITER_RUN_DIR: args.runDir,
    FACTORY_LEDGER_WRITER_RUN_ID: args.runId ?? "test-run",
    FACTORY_LEDGER_WRITER_MISSION_ID: args.missionId ?? "test-mission",
    FACTORY_LEDGER_WRITER_SOCKET_PATH:
      args.socketPath ?? ledgerWriterSocketPath(args.runDir),
    FACTORY_LEDGER_WRITER_INSTANCE_ID:
      args.instanceId ??
      makeLedgerWriterInstanceId(`lw-test-${process.pid}-${Date.now()}`),
  };
  const child = spawn(
    process.execPath,
    ["--import", "tsx", ENTRY_SCRIPT],
    { env, detached: true, stdio: "ignore" },
  );
  try {
    child.unref();
  } catch {
    // best-effort
  }
  return { child };
}

/**
 * Wait until the writer's UDS is bindable, or fail.
 */
export async function waitForWriterSocket(
  socketPath: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const st = await fs.lstat(socketPath);
      if (st.isSocket()) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`writer socket did not appear at ${socketPath}`);
}
