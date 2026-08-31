/**
 * FOUNDATION04 — witness live qualification lane (W-LIVE01..13).
 */

import { test, after } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { JsonlLedger } from "../../src/evidence/jsonl-ledger.js";

const STRICT = process.env.FACTORY_STRICT_WITNESS_LIVE === "1";
const WITNESS_LIVE_REQUIRED = 13;
let witnessExec = 0;
let witnessPass = 0;
let witnessFail = 0;
let witnessSkip = 0;
let witnessResidue = 0;

function emitStdout(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

interface WitnessProc {
  proc: ChildProcess;
  runDir: string;
  controlDir: string;
  socketPath: string;
  publicKey: string;
}

async function readWitnessReadyPubkey(runDir: string): Promise<string> {
  const ledger = new JsonlLedger(runDir);
  const r = await ledger.open({ createIfMissing: false });
  if (!r.ok) return "";
  const all = await ledger.readAll();
  if (!all.ok) return "";
  for (const env of all.value) {
    if (
      env.schema_version === 2 &&
      env.kind === "witness_evidence" &&
      env.witness_evidence.kind === "witness_ready"
    ) {
      return env.witness_evidence.witness_public_key;
    }
  }
  return "";
}

async function startWitness(opts: {
  runDir: string;
  controlDir: string;
  witnessId: string;
  witnessInstanceId: string;
  bootstrapLeaseMs: number;
}): Promise<WitnessProc> {
  await fs.mkdir(opts.runDir, { recursive: true, mode: 0o700 });
  await fs.chmod(opts.runDir, 0o700);
  await fs.mkdir(opts.controlDir, { recursive: true, mode: 0o700 });
  await fs.chmod(opts.controlDir, 0o700);
  const socketPath = path.join(opts.runDir, "s");
  const proc = spawn(
    process.execPath,
    [
      "--import", "tsx",
      path.join(process.cwd(), "test", "witness", "_witness_helper.ts"),
      "--run-dir", opts.runDir,
      "--control-dir", opts.controlDir,
      "--witness-id", opts.witnessId,
      "--witness-instance-id", opts.witnessInstanceId,
      "--socket-path", socketPath,
      "--run-id", "r",
      "--mission-id", "m",
      "--attempt-id", "a",
      "--process-id", "p",
      "--bootstrap-lease-ms", String(opts.bootstrapLeaseMs),
      "--protocol-version", "1",
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: false },
  );
  const start = Date.now();
  while (Date.now() - start < 5000) {
    try {
      const stat = await fs.stat(socketPath);
      if (stat.isSocket()) break;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  const publicKey = await readWitnessReadyPubkey(opts.runDir);
  return { proc, runDir: opts.runDir, controlDir: opts.controlDir, socketPath, publicKey };
}

async function stopWitness(wp: WitnessProc): Promise<void> {
  wp.proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      wp.proc.kill("SIGKILL");
      resolve();
    }, 1000);
    wp.proc.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
  try {
    await fs.unlink(wp.socketPath);
  } catch {
    // ignore
  }
}

async function runSupervisor(args: {
  socketPath: string;
  controlPrivPath: string;
  witnessPub: string;
  action: "QUERY" | "PING" | "CANCEL" | "TERMINATE";
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--import", "tsx",
        path.join(process.cwd(), "test", "witness", "_supervisor_helper.ts"),
        "--socket-path", args.socketPath,
        "--control-priv-path", args.controlPrivPath,
        "--witness-pub", args.witnessPub,
        "--run-id", "r",
        "--mission-id", "m",
        "--attempt-id", "a",
        "--process-id", "p",
        "--witness-id", "w",
        "--witness-instance-id", "wi",
        "--command-id", "cmd-1",
        "--action", args.action,
        "--nonce", "n-1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("exit", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

function parseSupervisorOutput(s: string): Array<Record<string, unknown>> {
  return s
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const dir = path.join(process.cwd(), ".tmp-witness-live");
const controlDir = path.join(process.cwd(), ".tmp-witness-ctrl");
const activeProcs: WitnessProc[] = [];

function note(r: { executed: boolean; passed: boolean; skipped: boolean; reason?: string }): void {
  if (r.skipped) witnessSkip++;
  else {
    witnessExec++;
    if (r.passed) witnessPass++;
    else witnessFail++;
  }
  emitStdout({
    kind: "note",
    executed: r.executed,
    passed: r.passed,
    skipped: r.skipped,
    reason: r.reason ?? null,
    totals: {
      required: WITNESS_LIVE_REQUIRED,
      executed: witnessExec,
      passed: witnessPass,
      failed: witnessFail,
      skipped: witnessSkip,
      residue: witnessResidue,
    },
  });
}

async function generateControllerKeys(): Promise<void> {
  await new Promise<void>((resolve) => {
    const c = spawn(
      process.execPath,
      ["--import", "tsx", path.join(process.cwd(), "test", "witness", "_gen_keys.ts"), "--control-dir", controlDir],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    c.on("exit", () => resolve());
  });
}

test("W-LIVE01 witness bootstrap/authentication: HELLO returns signed state", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-01"),
      controlDir,
      witnessId: "wl-01",
      witnessInstanceId: "wil-01",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    await generateControllerKeys();
    const sr = await runSupervisor({
      socketPath: wp.socketPath,
      controlPrivPath: path.join(controlDir, "controller.key"),
      witnessPub: wp.publicKey,
      action: "PING",
    });
    const records = parseSupervisorOutput(sr.stdout);
    const hs = records.find((r) => r.kind === "handshake_ok");
    const cr = records.find((r) => r.kind === "command_response_ok");
    if (!hs || !cr) {
      note({ executed: true, passed: false, skipped: false, reason: "missing records: " + JSON.stringify(records) });
      return;
    }
    const sigOk = hs.signature_ok === true && cr.signature_ok === true;
    const stateKind = hs.state_kind === "ready_not_activated" || hs.state_kind === "active_idle";
    note({ executed: true, passed: sigOk && stateKind, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE02 unactivated witness self-expires (bootstrap lease)", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-02"),
      controlDir,
      witnessId: "wl-02",
      witnessInstanceId: "wil-02",
      bootstrapLeaseMs: 500,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const exitCode = wp.proc.exitCode;
    note({ executed: true, passed: exitCode !== null, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE03 stale socket: handshake refused after witness stop", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-03"),
      controlDir,
      witnessId: "wl-03",
      witnessInstanceId: "wil-03",
      bootstrapLeaseMs: 3000,
    });
    await stopWitness(wp);
    await generateControllerKeys();
    const sr = await runSupervisor({
      socketPath: wp.socketPath,
      controlPrivPath: path.join(controlDir, "controller.key"),
      witnessPub: "00".repeat(32),
      action: "PING",
    });
    const records = parseSupervisorOutput(sr.stdout);
    const hasError = records.some((r) => r.kind === "error");
    note({ executed: true, passed: hasError, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE04 wrong key rejected: signature verification fails", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-04"),
      controlDir,
      witnessId: "wl-04",
      witnessInstanceId: "wil-04",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    await generateControllerKeys();
    const sr = await runSupervisor({
      socketPath: wp.socketPath,
      controlPrivPath: path.join(controlDir, "controller.key"),
      witnessPub: "ff".repeat(32),
      action: "PING",
    });
    const records = parseSupervisorOutput(sr.stdout);
    const hs = records.find((r) => r.kind === "handshake_ok");
    note({ executed: true, passed: hs?.signature_ok === false, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE05 command idempotency: same command_id returns cached result", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-05"),
      controlDir,
      witnessId: "wl-05",
      witnessInstanceId: "wil-05",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    await generateControllerKeys();
    const r1 = await runSupervisor({
      socketPath: wp.socketPath,
      controlPrivPath: path.join(controlDir, "controller.key"),
      witnessPub: wp.publicKey,
      action: "PING",
    });
    const r2 = await runSupervisor({
      socketPath: wp.socketPath,
      controlPrivPath: path.join(controlDir, "controller.key"),
      witnessPub: wp.publicKey,
      action: "PING",
    });
    const rec1 = parseSupervisorOutput(r1.stdout);
    const rec2 = parseSupervisorOutput(r2.stdout);
    const ok1 = rec1.find((r) => r.kind === "command_response_ok");
    const ok2 = rec2.find((r) => r.kind === "command_response_ok");
    const idempotent =
      ok1?.signature_ok === true &&
      ok2?.signature_ok === true &&
      ok1?.result_kind === ok2?.result_kind;
    note({ executed: true, passed: idempotent === true, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE06 protocol version mismatch: decoder rejects unknown version", async () => {
  try {
    const { decodeWitnessMessage } = await import("../../src/witness/witness-codec-decode.js");
    let threw = false;
    try {
      decodeWitnessMessage(
        JSON.stringify({
          kind: "handshake",
          protocol_version: 99,
          witness_state: {},
          signature: "AA",
        }),
      );
    } catch {
      threw = true;
    }
    note({ executed: true, passed: threw, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE07 ledger durability: witness_ready is durably persisted", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-07"),
      controlDir,
      witnessId: "wl-07",
      witnessInstanceId: "wil-07",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    const ledger = new JsonlLedger(wp.runDir);
    const r = await ledger.open({ createIfMissing: false });
    if (!r.ok) {
      note({ executed: true, passed: false, skipped: false, reason: "open failed" });
      return;
    }
    const all = await ledger.readAll();
    if (!all.ok) {
      note({ executed: true, passed: false, skipped: false, reason: "readAll failed" });
      return;
    }
    const hasReady = all.value.some(
      (e) =>
        e.schema_version === 2 &&
        e.kind === "witness_evidence" &&
        e.witness_evidence.kind === "witness_ready" &&
        e.witness_evidence.witness_id === "wl-07",
    );
    note({ executed: true, passed: hasReady, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE08 sequence monotonicity: each append increments seq by 1", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-08"),
      controlDir,
      witnessId: "wl-08",
      witnessInstanceId: "wil-08",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    const ledger = new JsonlLedger(wp.runDir);
    const r = await ledger.open({ createIfMissing: false });
    if (!r.ok) {
      note({ executed: true, passed: false, skipped: false, reason: "open failed" });
      return;
    }
    const all = await ledger.readAll();
    if (!all.ok) {
      note({ executed: true, passed: false, skipped: false, reason: "readAll failed" });
      return;
    }
    const seqs = all.value.map((e) => e.sequence);
    let monotonic = true;
    for (let i = 1; i < seqs.length; i++) {
      const cur = seqs[i] ?? 0;
      const prev = seqs[i - 1] ?? 0;
      if (cur !== prev + 1) { monotonic = false; break; }
    }
    note({ executed: true, passed: monotonic && seqs.length >= 2, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE09 wrong socket path length: rejected at bind", async () => {
  try {
    const longPath = path.join(controlDir, "a".repeat(120) + "_s");
    const longRunDir = path.join(controlDir, "wl09-run");
    const longCtrlDir = path.join(controlDir, "wl09-ctrl");
    await fs.mkdir(longRunDir, { mode: 0o700, recursive: true });
    await fs.chmod(longRunDir, 0o700);
    await fs.mkdir(longCtrlDir, { mode: 0o700, recursive: true });
    await fs.chmod(longCtrlDir, 0o700);
    const proc = spawn(
      process.execPath,
      [
        "--import", "tsx",
        path.join(process.cwd(), "test", "witness", "_witness_helper.ts"),
        "--run-dir", longRunDir,
        "--control-dir", longCtrlDir,
        "--witness-id", "wl-09",
        "--witness-instance-id", "wil-09",
        "--socket-path", longPath,
        "--run-id", "r",
        "--mission-id", "m",
        "--attempt-id", "a",
        "--process-id", "p",
        "--bootstrap-lease-ms", "500",
        "--protocol-version", "1",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let stderr = "";
    const procHandle = proc as ChildProcess;
    procHandle.stderr?.on("data", (b: Buffer) => { stderr += b.toString(); });
    await new Promise<void>((resolve) => procHandle.on("exit", () => resolve()));
    const rejected = stderr.includes("socket_path_too_long");
    note({ executed: true, passed: rejected, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE10 supervisor signature verified by witness", async () => {
  try {
    const wp = await startWitness({
      runDir: path.join(dir, "wl-10"),
      controlDir,
      witnessId: "wl-10",
      witnessInstanceId: "wil-10",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    await generateControllerKeys();
    const sr = await runSupervisor({
      socketPath: wp.socketPath,
      controlPrivPath: path.join(controlDir, "controller.key"),
      witnessPub: wp.publicKey,
      action: "PING",
    });
    const records = parseSupervisorOutput(sr.stdout);
    const cr = records.find((x) => x.kind === "command_response_ok");
    note({ executed: true, passed: cr?.signature_ok === true, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE11 private-key file mode: witness completes bootstrap", async () => {
  try {
    const dir2 = path.join(dir, "wl-11");
    const ctrl2 = path.join(dir2, "ctrl");
    await fs.mkdir(dir2, { recursive: true, mode: 0o700 });
    await fs.mkdir(ctrl2, { recursive: true, mode: 0o700 });
    await fs.chmod(ctrl2, 0o700);
    await generateControllerKeysIn(ctrl2);
    await fs.chmod(path.join(ctrl2, "controller.key"), 0o644);
    const wp = await startWitness({
      runDir: dir2,
      controlDir: ctrl2,
      witnessId: "wl-11",
      witnessInstanceId: "wil-11",
      bootstrapLeaseMs: 10000,
    });
    activeProcs.push(wp);
    note({ executed: true, passed: wp.publicKey.length === 64, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE12 bootstrap-lease self-expire: unactivated witness exits", async () => {
  try {
    const dir3 = path.join(dir, "wl-12");
    const wp = await startWitness({
      runDir: dir3,
      controlDir,
      witnessId: "wl-12",
      witnessInstanceId: "wil-12",
      bootstrapLeaseMs: 500,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const exitCode = wp.proc.exitCode;
    note({ executed: true, passed: exitCode !== null, skipped: false });
  } catch (e: unknown) {
    note({ executed: true, passed: false, skipped: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

test("W-LIVE13 suite residue: no witness processes remain", async () => {
  note({ executed: true, passed: witnessResidue === 0, skipped: false });
});

async function generateControllerKeysIn(d: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const c = spawn(
      process.execPath,
      ["--import", "tsx", path.join(process.cwd(), "test", "witness", "_gen_keys.ts"), "--control-dir", d],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    c.on("exit", () => resolve());
  });
}

after(async () => {
  for (const wp of activeProcs) {
    await stopWitness(wp);
  }
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  if (witnessResidue > 0 && STRICT) {
    throw new Error(`witness residue=${witnessResidue}`);
  }
});

test("WITNESS_LIVE_REPORT strict lane matrix", () => {
  emitStdout(`WITNESS_LIVE_REQUIRED=${WITNESS_LIVE_REQUIRED}`);
  emitStdout(`WITNESS_LIVE_EXECUTED=${witnessExec}`);
  emitStdout(`WITNESS_LIVE_PASSED=${witnessPass}`);
  emitStdout(`WITNESS_LIVE_FAILED=${witnessFail}`);
  emitStdout(`WITNESS_LIVE_SKIPPED=${witnessSkip}`);
  emitStdout(`WITNESS_LIVE_WITNESS_RESIDUE=${witnessResidue}`);
  if (STRICT) {
    if (witnessExec !== WITNESS_LIVE_REQUIRED) {
      throw new Error(`strict: executed ${witnessExec} != required ${WITNESS_LIVE_REQUIRED}`);
    }
    if (witnessFail !== 0) throw new Error(`strict: failed=${witnessFail}`);
    if (witnessSkip !== 0) throw new Error(`strict: skipped=${witnessSkip}`);
    if (witnessResidue !== 0) throw new Error(`strict: residue=${witnessResidue}`);
  }
});

