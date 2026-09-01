/**
 * FOUNDATION04 — witness live harness helper.
 *
 * Invoked as a Node executable:
 *   node --import tsx test/witness/_witness_helper.ts \
 *     --run-dir <dir> --control-dir <dir> \
 *     --witness-id <w> --witness-instance-id <wi> \
 *     --socket-path <sock> --run-id <r> --mission-id <m> \
 *     --attempt-id <a> --process-id <p> --bootstrap-lease-ms <n> \
 *     --protocol-version 1 --ledger-writer-socket-path <lw>
 *
 * CORRECTION04: --ledger-writer-socket-path is REQUIRED
 * because the witness runtime exits 2 if
 * `ledgerWriterSocketPath` is missing (B0-C01-11). The
 * bootstrap argv MUST carry the exact binding the
 * Phase A live setup captured (endpoint-binding law).
 *
 * Each line written to stdout is a JSON record. The supervisor
 * wrapper parses these records to verify behaviour.
 */

import { runWitnessProcess } from "../../src/witness/witness-runtime.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { generateEd25519Keypair } from "../../src/witness/witness-crypto.js";

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

function parseArgs(): {
  runDir: string;
  controlDir: string;
  witnessId: string;
  witnessInstanceId: string;
  socketPath: string;
  runId: string;
  missionId: string;
  attemptId: string;
  processId: string;
  bootstrapLeaseMs: number;
  protocolVersion: number;
  ledgerWriterSocketPath: string;
} {
  const argv = process.argv.slice(2);
  const m: Record<string, string> = {};
  for (let i = 0; i + 1 < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k !== undefined && v !== undefined) m[k.slice(2)] = v;
  }
  const lw = m["ledger-writer-socket-path"] ?? "";
  // CORRECTION04: if the bootstrap argv doesn't carry the
  // LedgerWriter binding, fail closed loudly — the runtime
  // would do the same but with a less informative message.
  if (lw.length === 0) {
    process.stderr.write(
      "FATAL: --ledger-writer-socket-path missing in bootstrap argv\n",
    );
    process.exit(2);
  }
  return {
    runDir: m["run-dir"] ?? "/tmp",
    controlDir: m["control-dir"] ?? "/tmp",
    witnessId: m["witness-id"] ?? "w",
    witnessInstanceId: m["witness-instance-id"] ?? "wi",
    socketPath: m["socket-path"] ?? "/tmp/w.sock",
    runId: m["run-id"] ?? "r",
    missionId: m["mission-id"] ?? "m",
    attemptId: m["attempt-id"] ?? "a",
    processId: m["process-id"] ?? "p",
    bootstrapLeaseMs: parseInt(m["bootstrap-lease-ms"] ?? "30000", 10),
    protocolVersion: parseInt(m["protocol-version"] ?? "1", 10),
    ledgerWriterSocketPath: lw,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  // Write a controller.pub file so the witness can verify signed
  // commands. Use a deterministic test key for repeatable
  // qualification.
  const ctrl = generateEd25519Keypair();
  try {
    await fs.mkdir(args.controlDir, { mode: 0o700, recursive: true });
  } catch {
    // may already exist; ensure mode
  }
  try {
    await fs.chmod(args.controlDir, 0o700);
  } catch {
    // chmod may fail on some platforms; the runtime check below
    // will catch the mismatch.
  }
  // F04-D14: the witness socket directory must be mode 0700.
  const socketDir = path.dirname(path.resolve(args.socketPath));
  try {
    await fs.mkdir(socketDir, { mode: 0o700, recursive: true });
  } catch {
    // may already exist
  }
  try {
    await fs.chmod(socketDir, 0o700);
  } catch {
    // ignore
  }
  const pubPath = path.join(args.controlDir, "controller.pub");
  await fs.writeFile(
    pubPath,
    JSON.stringify({ version: 1, public_key: ctrl.publicKeyHex }),
    { mode: 0o600 },
  );
  emit({ kind: "witness_helper_ready", witness_pid: process.pid });
  try {
    await runWitnessProcess(args);
    emit({ kind: "witness_helper_exit" });
  } catch (e: unknown) {
    emit({ kind: "witness_helper_error", message: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  }
}

void main();
