/**
 * FOUNDATION04 — PHASE A — Live-test scaffolding for the
 * witness-start gate.
 *
 * Boots a frozen LedgerWriter in a fresh tmpDir; exposes
 * helpers to read the durable ledger and to construct a
 * valid WitnessStartSpec with the right entry paths.
 *
 * Used by witness-start-live.test.ts. Phase A is unable to
 * pass the strict live lane on hosts where the UDS socket
 * path exceeds 100 bytes (the runtime limit on macOS
 * sandbox: /var/folders/.../T/.../s exceeds 100). On those
 * hosts the live lane SKIPs honestly.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  startLedgerWriter,
  ledgerWriterSocketPath,
  type StartLedgerWriterOptions,
} from "../../src/ledger-writer/ledger-writer-process.js";
import {
  type WriterHandle,
} from "../ledger-writer/_writer_helper.js";
import { registerWriterSpawn } from "../ledger-writer/_live_registry.js";
import type { WitnessStartSpec } from "../../src/witness-start/witness-start-types.js";

export type LiveRunHandle = {
  readonly runDir: string;
  readonly controlDir: string;
  readonly writer: WriterHandle;
  readonly socketPath: string;
  readonly writerSocketPath: string;
};

export function tmpBase(): string {
  return os.tmpdir();
}

export async function mkTmp(prefix: string): Promise<string> {
  // Short prefix to keep UDS path under 100 bytes even on
  // hosts with deep tmpdirs.
  return fs.mkdtemp(path.join(tmpBase(), "." + prefix + "-"));
}

export async function startLiveWriter(
  runDir: string,
  readyTimeoutMs = 5000,
): Promise<WriterHandle> {
  const opts: StartLedgerWriterOptions = {
    runDir,
    runId: "test-run",
    missionId: "test-mission",
    entryScript: path.join(
      process.cwd(),
      "src",
      "ledger-writer",
      "ledger-writer-entry.ts",
    ),
    tsxLoader: "tsx",
  };
  const r = await startLedgerWriter(opts, readyTimeoutMs);
  if (!r.ok) {
    throw new Error("startLedgerWriter failed: " + JSON.stringify(r.error));
  }
  const handle: WriterHandle = {
    runDir,
    socketPath: r.socketPath,
    child: r.child,
    instanceId: r.binding.instanceId,
    async stop(): Promise<void> {
      if (r.child.exitCode === null && r.child.signalCode === null) {
        try { r.child.kill("SIGKILL"); } catch { /* */ }
      }
      const deadline = Date.now() + 2000;
      while (
        Date.now() < deadline &&
        r.child.exitCode === null &&
        r.child.signalCode === null
      ) {
        await new Promise((res) => setTimeout(res, 25));
      }
      try {
        await fs.rm(ledgerWriterSocketPath(runDir), { force: true });
      } catch { /* */ }
      try {
        await fs.rm(path.join(runDir, "ledger-writer-owner"), {
          recursive: true,
          force: true,
        });
      } catch { /* */ }
    },
    ping: () => {
      throw new Error("ping not implemented in live scaffolding");
    },
    whoAreYou: () => {
      throw new Error("whoAreYou not implemented in live scaffolding");
    },
    append: () => {
      throw new Error("append not implemented in live scaffolding");
    },
  };
  registerWriterSpawn({
    child: r.child,
    runDir,
    socketPath: r.socketPath,
  });
  return handle;
}

/**
 * Build a valid WitnessStartSpec that points at the actual
 * witness helper script in this repo.
 */
export function mkLiveSpec(args: {
  readonly runDir: string;
  readonly controlDir: string;
  readonly socketPath: string;
  readonly writerSocketPath: string;
}): WitnessStartSpec {
  return {
    runDir: args.runDir,
    controlDir: args.controlDir,
    suggestedWitnessId: "w-start-live" as never,
    socketPath: args.socketPath,
    runId: "run-live" as never,
    missionId: "mis-live" as never,
    attemptId: "att-live" as never,
    processId: "proc-live" as never,
    protocolVersion: 1,
    bootstrapLeaseMs: 1000,
    ledgerWriterSocketPath: args.writerSocketPath,
    witnessesEntry: path.join(
      process.cwd(),
      "test",
      "witness",
      "_witness_helper.ts",
    ),
    tsxLoader: "tsx",
    nodePath: process.execPath,
  };
}

/**
 * Read every line of the durable events.jsonl as parsed JSON.
 * Used by the live lane to assert intent + child presence.
 */
export async function readLedger(
  runDir: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const p = path.join(runDir, "events.jsonl");
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as Record<string, unknown>);
  }
  return out;
}

/**
 * Return true if a UDS path would exceed the 100-byte budget
 * on this host. Used by live tests to SKIP honestly on hosts
 * that cannot satisfy the production constraint.
 */
export function udsPathTooLong(p: string): boolean {
  return p.length > 100;
}

/**
 * Find a witness_start_requested entry in the ledger.
 */
export function findStartIntent(
  ledger: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> | null {
  for (const env of ledger) {
    if (
      env["kind"] === "witness_evidence" &&
      env["witness_evidence"] !== undefined &&
      (env["witness_evidence"] as Record<string, unknown>)["kind"]
        === "witness_start_requested"
    ) {
      return env;
    }
  }
  return null;
}

/**
 * Check whether a child process is alive by signal 0.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
