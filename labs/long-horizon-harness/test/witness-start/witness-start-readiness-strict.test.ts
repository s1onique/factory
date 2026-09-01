/**
 * FOUNDATION04 — PHASE A FINAL CLOSURE — strict readiness
 * qualification matrix.
 *
 *   Readiness-evidence law: a witness is ready only
 *   when its identity-bound readiness fact is durably
 *   committed in the authoritative ledger.
 *
 *   This is the third strict matrix (alongside
 *   WSTART-LIVE and WSTART-CONTEXT) that participates
 *   in the conjunctive PHASE_A disposition.
 *
 *   The tests are deterministic (no real witness
 *   process, no real ledger-writer) and zero-skip.
 *   They exercise the `awaitWitnessReady` function
 *   directly with a fake `WitnessSpawnHandle` and a
 *   synthetic events.jsonl.
 *
 *   STRICT=true
 *   (FACTORY_STRICT_WITNESS_START_READINESS_LIVE=1)
 *   fails the suite on any SKIP.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  awaitWitnessReady,
  type AwaitWitnessReadyResult,
  type ExpectedBinding,
} from "./witness-start-readiness.js";
import type {
  WitnessBootstrapOutput,
  WitnessExitInfo,
  WitnessSpawnHandle,
} from "../../src/witness-start/witness-start-types.js";

const STRICT = process.env.FACTORY_STRICT_WITNESS_START_READINESS_LIVE === "1";
const EXPECTED_SHA =
  process.env.FACTORY_QUALIFICATION_SUBJECT_COMMIT ?? "";
const OBSERVED_SHA = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "<unable-to-resolve>";
  }
})();

const REQUIRED = 6;
let exec = 0;
let pass = 0;
let fail = 0;
let skip = 0;
let residue = 0;

function emit(rec: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

function mkHandle(overrides?: {
  exited?: boolean;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}): WitnessSpawnHandle {
  const exit: WitnessExitInfo = {
    pid: 99999,
    code: overrides?.code ?? null,
    signal: overrides?.signal ?? null,
    exited: overrides?.exited ?? false,
  };
  const out: WitnessBootstrapOutput = {
    stdout: new TextEncoder().encode(overrides?.stdout ?? ""),
    stderr: new TextEncoder().encode(overrides?.stderr ?? ""),
    stdoutBytesSeen: (overrides?.stdout ?? "").length,
    stderrBytesSeen: (overrides?.stderr ?? "").length,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
  return {
    pid: 99999,
    kill: () => true,
    on: () => ({}),
    bootstrapOutput: () => out,
    exitInfo: () => exit,
  };
}

async function mkRunDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), ".rdy-strict-"));
}

function mkReadyLine(args: {
  runId: string;
  missionId: string;
  witnessId: string;
  witnessInstanceId: string;
  socketPath: string;
  controllerFingerprint: string;
  witnessFingerprint: string;
  sequence: number;
}): string {
  const obj = {
    schema_version: 2,
    event_id: "e-" + args.sequence,
    run_id: args.runId,
    mission_id: args.missionId,
    sequence: args.sequence,
    observed_at: Date.now(),
    kind: "witness_evidence",
    witness_evidence: {
      kind: "witness_ready",
      witness_id: args.witnessId,
      witness_instance_id: args.witnessInstanceId,
      historical_witness_pid: 12345,
      socket_path: args.socketPath,
      witness_public_key: "a".repeat(64),
      witness_public_key_fingerprint: args.witnessFingerprint,
      controller_public_key_fingerprint: args.controllerFingerprint,
      protocol_version: 1,
    },
    commit_id: "w-ready-" + args.witnessInstanceId,
    content_hash: "h-" + args.sequence,
  };
  return JSON.stringify(obj);
}

const EXPECTED_BINDING: ExpectedBinding = {
  runId: "r-strict",
  missionId: "m-strict",
  witnessId: "w-strict",
  witnessInstanceId: "wi-strict",
  socketPath: "/tmp/rdy-strict.sock",
};

test("READY-STRICT01: full identity match returns ready", async () => {
  exec += 1;
  const runDir = await mkRunDir();
  try {
    const line = mkReadyLine({
      runId: EXPECTED_BINDING.runId,
      missionId: EXPECTED_BINDING.missionId,
      witnessId: EXPECTED_BINDING.witnessId,
      witnessInstanceId: EXPECTED_BINDING.witnessInstanceId,
      socketPath: EXPECTED_BINDING.socketPath,
      controllerFingerprint: "f".repeat(64),
      witnessFingerprint: "e".repeat(64),
      sequence: 1,
    });
    await fs.writeFile(path.join(runDir, "events.jsonl"), line + "\n");
    const handle = mkHandle();
    const r: AwaitWitnessReadyResult = await awaitWitnessReady({
      runDir,
      child: handle,
      expected: EXPECTED_BINDING,
      deadlineMs: 1000,
      pollIntervalMs: 10,
    });
    assert.equal(r.kind, "ready",
      "READY-STRICT01: full identity match must return ready");
    if (r.kind === "ready") {
      assert.equal(r.sequence, 1,
        "READY-STRICT01: sequence must round-trip");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("READY-STRICT02: wrong witnessInstanceId returns evidence_invalid", async () => {
  exec += 1;
  const runDir = await mkRunDir();
  try {
    const line = mkReadyLine({
      runId: EXPECTED_BINDING.runId,
      missionId: EXPECTED_BINDING.missionId,
      witnessId: EXPECTED_BINDING.witnessId,
      witnessInstanceId: "wi-OTHER",
      socketPath: EXPECTED_BINDING.socketPath,
      controllerFingerprint: "f".repeat(64),
      witnessFingerprint: "e".repeat(64),
      sequence: 1,
    });
    await fs.writeFile(path.join(runDir, "events.jsonl"), line + "\n");
    const handle = mkHandle();
    const r = await awaitWitnessReady({
      runDir,
      child: handle,
      expected: EXPECTED_BINDING,
      deadlineMs: 200,
      pollIntervalMs: 10,
    });
    assert.equal(r.kind, "evidence_invalid",
      "READY-STRICT02: wrong witness_instance_id must yield evidence_invalid " +
      "(got: " + r.kind + ")");
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("READY-STRICT03: malformed JSON line before any ready returns evidence_invalid (fail closed)", async () => {
  exec += 1;
  const runDir = await mkRunDir();
  try {
    // The first line is malformed JSON. The helper must
    // fail closed (not skip silently, not time out).
    const malformed = "{ this is not valid json";
    const good = mkReadyLine({
      runId: EXPECTED_BINDING.runId,
      missionId: EXPECTED_BINDING.missionId,
      witnessId: EXPECTED_BINDING.witnessId,
      witnessInstanceId: EXPECTED_BINDING.witnessInstanceId,
      socketPath: EXPECTED_BINDING.socketPath,
      controllerFingerprint: "f".repeat(64),
      witnessFingerprint: "e".repeat(64),
      sequence: 1,
    });
    await fs.writeFile(
      path.join(runDir, "events.jsonl"),
      malformed + "\n" + good + "\n",
    );
    const handle = mkHandle();
    const r = await awaitWitnessReady({
      runDir,
      child: handle,
      expected: EXPECTED_BINDING,
      deadlineMs: 200,
      pollIntervalMs: 10,
    });
    assert.equal(r.kind, "evidence_invalid",
      "READY-STRICT03: malformed JSON must yield evidence_invalid " +
      "(got: " + r.kind + ")");
    if (r.kind === "evidence_invalid") {
      assert.ok(r.reason.length > 0,
        "READY-STRICT03: evidence_invalid must carry a reason");
      assert.equal(r.lineNumber, 0,
        "READY-STRICT03: must identify the offending line number");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("READY-STRICT04: ready_but_child_exited when durable ready exists but child has died", async () => {
  exec += 1;
  const runDir = await mkRunDir();
  try {
    // A well-formed witness_ready for the expected identity
    // is durably committed. The child has ALREADY exited
    // before we observe. The CORRECTION02 ledger-first
    // ordering returns ready_but_child_exited, NOT the
    // old misnamed child_exited_before_ready.
    const line = mkReadyLine({
      runId: EXPECTED_BINDING.runId,
      missionId: EXPECTED_BINDING.missionId,
      witnessId: EXPECTED_BINDING.witnessId,
      witnessInstanceId: EXPECTED_BINDING.witnessInstanceId,
      socketPath: EXPECTED_BINDING.socketPath,
      controllerFingerprint: "f".repeat(64),
      witnessFingerprint: "e".repeat(64),
      sequence: 1,
    });
    await fs.writeFile(path.join(runDir, "events.jsonl"), line + "\n");
    const handle = mkHandle({
      exited: true,
      code: 0,
      signal: null,
    });
    const r = await awaitWitnessReady({
      runDir,
      child: handle,
      expected: EXPECTED_BINDING,
      deadlineMs: 200,
      pollIntervalMs: 10,
    });
    assert.equal(r.kind, "ready_but_child_exited",
      "READY-STRICT04: durable ready + dead child must yield " +
      "ready_but_child_exited (the authority is gone even though " +
      "the durability fact exists). got: " + r.kind);
    if (r.kind === "ready_but_child_exited") {
      assert.equal(r.exit.code, 0,
        "READY-STRICT04: exit code must round-trip");
      assert.equal(r.sequence, 1,
        "READY-STRICT04: sequence must round-trip");
      assert.ok(typeof r.observedAt === "number",
        "READY-STRICT04: observedAt must round-trip");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("READY-STRICT05: malformed envelope with valid witness payload returns evidence_invalid", async () => {
  exec += 1;
  const runDir = await mkRunDir();
  try {
    // CORRECTION03: durable bytes crossing back from storage
    // MUST pass the AUTHORITATIVE envelope decoder. This line
    // carries a perfectly valid witness_ready payload for the
    // expected identity, but the envelope is invalid: the
    // run_id violates the identifier grammar and event_id is
    // absent. The readiness oracle MUST fail closed rather
    // than trust a writer that supposedly validated it.
    const bad = JSON.stringify({
      schema_version: 2,
      run_id: "not a legal id!!",
      mission_id: EXPECTED_BINDING.missionId,
      sequence: 1,
      observed_at: Date.now(),
      kind: "witness_evidence",
      witness_evidence: {
        kind: "witness_ready",
        witness_id: EXPECTED_BINDING.witnessId,
        witness_instance_id: EXPECTED_BINDING.witnessInstanceId,
        historical_witness_pid: 12345,
        socket_path: EXPECTED_BINDING.socketPath,
        witness_public_key: "a".repeat(64),
        witness_public_key_fingerprint: "e".repeat(64),
        controller_public_key_fingerprint: "f".repeat(64),
        protocol_version: 1,
      },
    });
    await fs.writeFile(path.join(runDir, "events.jsonl"), bad + "\n");
    const r = await awaitWitnessReady({
      runDir,
      child: mkHandle(),
      expected: EXPECTED_BINDING,
      deadlineMs: 200,
      pollIntervalMs: 10,
    });
    assert.equal(r.kind, "evidence_invalid",
      "READY-STRICT05: malformed envelope MUST yield evidence_invalid " +
      "even when the witness payload is valid (got: " + r.kind + ")");
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

test("READY-STRICT06: non-integer sequence / null observed_at returns evidence_invalid", async () => {
  exec += 1;
  const runDir = await mkRunDir();
  try {
    // CORRECTION03: the old handwritten decoder cast
    // `observed_at`/`sequence` with `as number`, so these
    // values could reach the readiness result unvalidated.
    // The authoritative envelope decoder rejects them.
    const bad = JSON.stringify({
      schema_version: 2,
      event_id: "e-1",
      run_id: EXPECTED_BINDING.runId,
      mission_id: EXPECTED_BINDING.missionId,
      sequence: "lol-not-an-int",
      observed_at: null,
      kind: "witness_evidence",
      witness_evidence: {
        kind: "witness_ready",
        witness_id: EXPECTED_BINDING.witnessId,
        witness_instance_id: EXPECTED_BINDING.witnessInstanceId,
        historical_witness_pid: 12345,
        socket_path: EXPECTED_BINDING.socketPath,
        witness_public_key: "a".repeat(64),
        witness_public_key_fingerprint: "e".repeat(64),
        controller_public_key_fingerprint: "f".repeat(64),
        protocol_version: 1,
      },
    });
    await fs.writeFile(path.join(runDir, "events.jsonl"), bad + "\n");
    const r = await awaitWitnessReady({
      runDir,
      child: mkHandle(),
      expected: EXPECTED_BINDING,
      deadlineMs: 200,
      pollIntervalMs: 10,
    });
    assert.equal(r.kind, "evidence_invalid",
      "READY-STRICT06: invalid sequence/observed_at MUST yield " +
      "evidence_invalid (got: " + r.kind + ")");
    if (r.kind === "evidence_invalid") {
      assert.ok(/sequence|observed_at/.test(r.reason),
        "READY-STRICT06: reason must name the offending envelope field " +
        "(got: " + r.reason + ")");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});

after(async () => {
  process.stdout.write(
    `WITNESS_START_READINESS_SUBJECT_COMMIT_OBSERVED=${OBSERVED_SHA}\n`,
  );
  process.stdout.write(
    `WITNESS_START_READINESS_SUBJECT_COMMIT_EXPECTED=${EXPECTED_SHA}\n`,
  );
  const disposition =
    fail === 0 &&
    skip === 0 &&
    residue === 0 &&
    exec === REQUIRED &&
    pass === REQUIRED
      ? "OK"
      : "FAIL";
  emit({
    kind: "witness_start_readiness_matrix",
    strict: STRICT,
    expected_sha: EXPECTED_SHA,
    observed_sha: OBSERVED_SHA,
    required: REQUIRED,
    executed: exec,
    passed: pass,
    failed: fail,
    skipped: skip,
    residue,
    disposition,
  });
  process.stdout.write(`WITNESS_START_READINESS_DISPOSITION=${disposition}\n`);
  if (EXPECTED_SHA !== "" && EXPECTED_SHA !== OBSERVED_SHA) {
    process.stdout.write(
      `WITNESS_START_READINESS_SHA_MISMATCH: expected=${EXPECTED_SHA} observed=${OBSERVED_SHA}\n`,
    );
  }
  if (STRICT && disposition !== "OK") {
    throw new Error(
      "WITNESS_START_READINESS_DISPOSITION=FAIL: " +
      "passed=" + pass + " required=" + REQUIRED +
      "; failed=" + fail + "; skipped=" + skip +
      "; residue=" + residue + "; executed=" + exec,
    );
  }
  if (STRICT && EXPECTED_SHA !== "" && EXPECTED_SHA !== OBSERVED_SHA) {
    throw new Error(
      "WITNESS_START_READINESS_SHA_MISMATCH: expected=" +
      EXPECTED_SHA + " observed=" + OBSERVED_SHA,
    );
  }
});

void assert;
