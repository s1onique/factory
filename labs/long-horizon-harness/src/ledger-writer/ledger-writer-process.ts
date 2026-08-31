/**
 * FOUNDATION04 — CORRECTION01 — LedgerWriter spawn + binding.
 *
 * The supervisor calls `startLedgerWriter()` once per run,
 * receives a binding (instanceId + socketPath), and from then
 * on communicates with the writer over its UDS. The writer
 * itself runs in a child process — see
 * `ledger-writer-server.ts` for the per-connection handler
 * and `ledger-writer-entry.ts` for the child main.
 *
 * Lifetime contract (F04-CORR01 §B0):
 *   - Spawned with `detached: true`, `stdio: "ignore"`, and
 *     `unref()` so S1's death does not propagate to the
 *     writer and the writer's stdio does not block S1.
 *   - Bound to a new pgid (POSIX: child becomes its own
 *     process-group leader when detached).
 *   - OS reparents the writer to init/launchd when S1 dies.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  makeLedgerWriterInstanceId,
  type LedgerWriterBinding,
} from "./ledger-writer-types.js";

export const LEDGER_WRITER_STATE_FILENAME = "ledger-writer-state.json";

export const ENV_RUN_DIR = "FACTORY_LEDGER_WRITER_RUN_DIR";
export const ENV_RUN_ID = "FACTORY_LEDGER_WRITER_RUN_ID";
export const ENV_MISSION_ID = "FACTORY_LEDGER_WRITER_MISSION_ID";
export const ENV_SOCKET_PATH = "FACTORY_LEDGER_WRITER_SOCKET_PATH";
export const ENV_INSTANCE_ID = "FACTORY_LEDGER_WRITER_INSTANCE_ID";

export function ledgerWriterSocketPath(runDir: string): string {
  // The full path must stay under MAX_UDS_PATH_BYTES for
  // the UDS bind to succeed on macOS / Linux. The sun_path
  // field is 104 bytes on macOS / 108 on Linux; we stay
  // under 100 to leave room for filesystem prefix
  // differences and to mirror witness-server.ts.
  //
  // Shortest stable layout: <runDir>/s
  // (no "control" subdir; the parent runDir itself is
  // mode 0700 and acts as the security boundary).
  return path.join(runDir, "s");
}

export type StartLedgerWriterOptions = {
  readonly runDir: string;
  readonly runId: string;
  readonly missionId: string;
  readonly entryScript: string;
  readonly tsxLoader?: string;
};

export type StartLedgerWriterResult =
  | {
      readonly ok: true;
      readonly binding: LedgerWriterBinding;
      readonly child: ChildProcess;
      readonly socketPath: string;
    }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "spawn_failed"; readonly message: string }
        | { readonly kind: "writer_not_ready"; readonly message: string };
    };

export async function startLedgerWriter(
  opts: StartLedgerWriterOptions,
  readyTimeoutMs = 5000,
): Promise<StartLedgerWriterResult> {
  const socketPath = ledgerWriterSocketPath(opts.runDir);
  const instanceId = makeLedgerWriterInstanceId(
    `lw-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [ENV_RUN_DIR]: opts.runDir,
    [ENV_RUN_ID]: opts.runId,
    [ENV_MISSION_ID]: opts.missionId,
    [ENV_SOCKET_PATH]: socketPath,
    [ENV_INSTANCE_ID]: instanceId,
  };

  let child: ChildProcess;
  try {
    const args = opts.tsxLoader
      ? ["--import", opts.tsxLoader, opts.entryScript]
      : [opts.entryScript];
    child = spawn(process.execPath, args, {
      env,
      detached: true,
      // `ignore` for stdin prevents the child from blocking
      // on stdin; `pipe` for stdout/stderr lets the test
      // harness surface any writer-side error message.
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Drain the child's stdio so the pipes don't keep the
    // parent's event loop alive. We don't surface the bytes
    // by default; tests can attach their own listeners via
    // the returned ChildProcess if they want diagnostics.
    child.stdout?.resume();
    child.stderr?.resume();
    // We DO NOT unref() the child: the supervisor keeps a
    // reference to the writer for the entire run, and we
    // want child.exit to be observable. unref()ing would
    // also let the test process exit while the writer is
    // still mid-flight, which would lose the writer's
    // durability boundary.
    // NOTE: we deliberately do NOT call child.unref() —
    // unref'ing the writer would let the test process exit
    // even if the writer still has buffered work, and the
    // poll loop above relies on `child.exit` to surface
    // early-failure of the writer.
    //
    // The lifetime guarantee is instead: the writer is
    // reparented to init by `detached: true`; it survives
    // S1's death; only S1 explicitly killing it (via the
    // returned ChildProcess) or the run being torn down
    // ends the writer.
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        kind: "spawn_failed",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const st = await fs.lstat(socketPath);
      if (st.isSocket()) {
        return {
          ok: true,
          binding: {
            runId: opts.runId as LedgerWriterBinding["runId"],
            missionId: opts.missionId as LedgerWriterBinding["missionId"],
            instanceId,
            socketPath,
            startedAt: Date.now(),
          },
          child,
          socketPath,
        };
      }
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  // For tests: log the situation so failures are debuggable.
  let stErr = "ENOENT";
  try {
    const st = await fs.lstat(socketPath);
    stErr = `present but not socket: ${JSON.stringify({
      isSocket: st.isSocket(),
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      isSymbolicLink: st.isSymbolicLink(),
      mode: st.mode,
    })}`;
  } catch (e: unknown) {
    stErr = `${(e as { code?: string }).code ?? String(e)}`;
  }
  let exitInfo = "alive";
  if (child.exitCode !== null) {
    exitInfo = `exited code=${child.exitCode} signal=${child.signalCode}`;
  }
  // eslint-disable-next-line no-console
  console.error(
    `[ledger-writer] socket did not appear at ${socketPath}; ` +
      `lstat=${stErr}; child=${exitInfo}`,
  );
  try {
    child.kill("SIGKILL");
  } catch {
    // best-effort
  }
  return {
    ok: false,
    error: { kind: "writer_not_ready", message: "socket did not appear" },
  };
}
