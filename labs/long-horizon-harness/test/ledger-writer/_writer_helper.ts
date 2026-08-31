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
 *
 * B0-C01-09: this helper MUST NOT blindly rm the socket
 * before starting a writer. The bind-time policy inside
 * the writer is the only authority on path collisions;
 * a test that pre-clears the socket defeats that policy.
 * Therefore `startWriterInTmpDir` does NOT pre-rm; the
 * caller is expected to provide a clean runDir (or to
 * expect the bind-time path-collision policy to fire).
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
  whoAreYouLedgerWriter,
} from "../../src/ledger-writer/ledger-writer-client.js";
import {
  canonicalContentHash,
} from "../../src/ledger-writer/ledger-writer-canonicalize.js";
import { makeLedgerWriterInstanceId } from "../../src/ledger-writer/ledger-writer-types.js";
import type {
  WriterEvent,
} from "../../src/ledger-writer/ledger-writer-protocol.js";

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
  whoAreYou(): ReturnType<typeof whoAreYouLedgerWriter>;
  append(args: {
    readonly commitId: string;
    readonly event: WriterEvent;
    readonly clientContentHash?: string;
  }): ReturnType<typeof appendToLedgerWriter>;
};

export async function startWriterInTmpDir(
  runDir: string,
  readyTimeoutMs = 5000,
): Promise<WriterHandle> {
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
  // B0-C01-09: we DO NOT rm the socket here. If a previous
  // writer died holding the socket, the new writer's
  // bind-time policy will detect stale-vs-live and
  // unlink appropriately; if a live writer holds it, the
  // policy will reject the second bind. The harness must
  // not silently defeat either path.

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
    const e = result.error;
    throw new Error(
      `startLedgerWriter failed: ${e.kind} ${e.message ?? "(no message)"}`,
    );
  }

  const handle: WriterHandle = {
    runDir,
    socketPath: result.socketPath,
    child: result.child,
    instanceId: result.binding.instanceId,
    async stop(): Promise<void> {
      // Kill the writer child. We send SIGKILL and wait
      // synchronously for exit (do not unref). The test
      // harness owns the child lifecycle; a leak here
      // exhausts UDS / fd resources across sequential test
      // files.
      try {
        result.child.kill("SIGKILL");
      } catch {
        // best-effort
      }
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && result.child.exitCode === null) {
        await new Promise((r) => setTimeout(r, 25));
      }
      // Belt-and-suspenders: explicitly unlink the socket
      // path if it still exists. macOS sometimes holds the
      // inode for a moment after the writer exits.
      try {
        await fs.rm(ledgerWriterSocketPath(runDir), { force: true });
      } catch {
        // best-effort
      }
      // Also clear the lease directory — SIGKILL does not
      // run the graceful shutdown handler. The test harness
      // is the operator here.
      try {
        await fs.rm(path.join(runDir, "ledger-writer-owner"), {
          recursive: true,
          force: true,
        });
      } catch {
        // best-effort
      }
    },
    ping() {
      return pingLedgerWriter({ socketPath: result.socketPath, timeoutMs: 5000 });
    },
    whoAreYou() {
      return whoAreYouLedgerWriter({
        socketPath: result.socketPath,
        timeoutMs: 5000,
      });
    },
    append(args) {
      const clientContentHash = args.clientContentHash ?? canonicalContentHash({
        runId: "test-run",
        missionId: "test-mission",
        event: args.event,
      });
      return appendToLedgerWriter(
        { socketPath: result.socketPath, timeoutMs: 10000 },
        {
          commitId: args.commitId,
          clientContentHash,
          event: args.event,
        },
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
  readonly crashCut?: boolean;
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
    FACTORY_LEDGER_WRITER_CRASH_CUT: args.crashCut ? "1" : "0",
  };
  const child = spawn(
    process.execPath,
    ["--import", "tsx", ENTRY_SCRIPT],
    {
      env,
      stdio: process.env["FACTORY_LEDGER_WRITER_DEBUG"] === "1" ? "pipe" : "ignore",
    },
  );
  if (process.env["FACTORY_LEDGER_WRITER_DEBUG"] === "1") {
    child.stderr?.on("data", (d: Buffer) => {
      process.stderr.write(`[writer-child] ${d.toString()}`);
    });
    child.on("exit", (code, signal) => {
      process.stderr.write(
        `[writer-child-exit] code=${code} signal=${signal}\n`,
      );
    });
  }
  // Do NOT detach/unref. The test harness owns the child
  // lifecycle: SIGKILL in handle.stop() must reach the child.
  // Detaching orphans the child to launchd on parent exit,
  // which leaks writers and exhausts UDS / fd resources
  // across sequential test files.
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
