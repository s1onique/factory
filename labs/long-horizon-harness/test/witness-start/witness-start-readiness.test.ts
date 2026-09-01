/**
 * FOUNDATION04 — PHASE A FINAL CLOSURE — READY01..10.
 *
 *   Readiness-evidence law: a witness is ready only
 *   when its identity-bound readiness fact is durably
 *   committed in the authoritative ledger.
 *
 *   These tests are live (require a real writer and
 *   witness process) and SKIP honestly on long-path
 *   hosts. They are NOT in the strict qualification
 *   matrix; they are regression guards for the host
 *   burn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_LIVE_MISSION_ID,
  DEFAULT_LIVE_RUN_ID,
  mkLiveSpec,
  mkTmp,
  startLiveWriter,
  teardownLiveRun,
  udsPathTooLong,
  type LiveRunHandle,
} from "./_wstart_live_helpers.js";
import { startWitness } from "../../src/witness-start/witness-start-gate.js";
import { nodeSpawnWitnessPort } from "../../src/witness-start/witness-start-spawn.js";
import { ledgerWriterSocketPath } from "../../src/ledger-writer/ledger-writer-process.js";
import { awaitWitnessReady } from "./witness-start-readiness.js";

async function setupLive(prefix: string): Promise<
  LiveRunHandle | { skip: true; reason: string }
> {
  const runDir = await mkTmp(prefix);
  const controlDir = await fs.mkdtemp(
    path.join(runDir, "..", ".c-rd-" + prefix + "-"),
  );
  const writerSocketPath = ledgerWriterSocketPath(runDir);
  const socketPath = path.join(runDir, "witness.sock");
  if (udsPathTooLong(writerSocketPath) || udsPathTooLong(socketPath)) {
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
    return { skip: true, reason: "uds path > 100 bytes budget on this host" };
  }
  const writer = await startLiveWriter({
    runDir,
    runId: DEFAULT_LIVE_RUN_ID,
    missionId: DEFAULT_LIVE_MISSION_ID,
  });
  if (writer.socketPath !== writerSocketPath) {
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
    throw new Error("CORRECTION04 socket invariant violated");
  }
  return {
    runDir,
    controlDir,
    runId: DEFAULT_LIVE_RUN_ID,
    missionId: DEFAULT_LIVE_MISSION_ID,
    writer,
    socketPath,
    writerSocketPath,
  };
}

test("READY01..08, READY10: live witness reaches witness_ready and the ledger proves the identity", async (t) => {
  const r = await setupLive("ready");
  if ("skip" in r) { t.skip(r.reason); return; }
  const run: LiveRunHandle = r;
  try {
    const spec = mkLiveSpec(run);
    const start = await startWitness(spec, { spawn: nodeSpawnWitnessPort() });
    assert.equal(start.ok, true, "READY01: startWitness must succeed on a live run");
    if (!start.ok) return;
    const witnessInstanceId = start.value.identity.witnessInstanceId;
    const ready = await awaitWitnessReady({
      runDir: run.runDir,
      witnessInstanceId,
      deadlineMs: 5000,
      pollIntervalMs: 25,
    });
    assert.equal(ready.kind, "ready",
      "READY01: witness_ready must be durably committed within the deadline");

    const events = await fs.readFile(path.join(run.runDir, "events.jsonl"), "utf8");
    const lines = events.split("\n").filter((l) => l.length > 0);
    const readyRec = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => (r["witness_evidence"] as { kind?: string } | undefined)?.kind === "witness_ready");
    assert.ok(readyRec !== undefined,
      "READY02: ledger must contain a witness_ready record");
    const we = readyRec!["witness_evidence"] as Record<string, unknown>;
    assert.equal(we["witness_id"], spec.suggestedWitnessId,
      "READY03: ready.witness_id must equal spec.witnessId");
    assert.equal(we["witness_instance_id"], witnessInstanceId,
      "READY04: ready.witness_instance_id must equal start identity");
    assert.equal(we["socket_path"], spec.socketPath,
      "READY05: ready.socket_path must equal spec.socketPath");
    assert.equal(typeof we["controller_public_key_fingerprint"], "string",
      "READY06: ready.controller_public_key_fingerprint must be a string");
    assert.notEqual(we["controller_public_key_fingerprint"], "",
      "READY06: ready.controller_public_key_fingerprint must be non-empty");
    assert.equal(typeof we["witness_public_key_fingerprint"], "string",
      "READY07: ready.witness_public_key_fingerprint must be a string");
    assert.notEqual(we["witness_public_key_fingerprint"], "",
      "READY07: ready.witness_public_key_fingerprint must be non-empty");

    const intentRec = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => (r["witness_evidence"] as { kind?: string } | undefined)?.kind === "witness_start_requested");
    assert.ok(intentRec !== undefined, "READY08: a witness_start_requested must exist");
    const intentSeq = intentRec!["sequence"] as number;
    const readySeq = readyRec!["sequence"] as number;
    assert.ok(readySeq > intentSeq,
      "READY08: ready.sequence (" + readySeq + ") must be > intent.sequence (" + intentSeq + ")");

    const intents = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => (r["witness_evidence"] as { kind?: string } | undefined)?.kind === "witness_start_requested");
    assert.equal(intents.length, 1,
      "READY10: exactly one witness_start_requested (sole-producer)");

    start.value.child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    await teardownLiveRun(run);
  }
});

test("READY09: spawn ENOENT (bad nodePath) produces no witness_ready", async (t) => {
  const r = await setupLive("ready9");
  if ("skip" in r) { t.skip(r.reason); return; }
  const run: LiveRunHandle = r;
  try {
    const spec = mkLiveSpec(run);
    const start = await startWitness({
      ...spec,
      nodePath: "/no/such/node/executable",
    }, { spawn: nodeSpawnWitnessPort() });
    assert.equal(start.ok, false, "READY09: start with bad nodePath must fail");
    if (start.ok) return;
    assert.equal(start.failure.kind, "spawn_failed",
      "READY09: failure.kind must be spawn_failed");
    await new Promise((r) => setTimeout(r, 200));
    const events = await fs.readFile(path.join(run.runDir, "events.jsonl"), "utf8")
      .catch(() => "");
    const hasReady = events.split("\n").filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .some((r) => (r["witness_evidence"] as { kind?: string } | undefined)?.kind === "witness_ready");
    assert.equal(hasReady, false,
      "READY09: no witness_ready must be written when spawn fails");
  } finally {
    await teardownLiveRun(run);
  }
});
