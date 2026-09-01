/**
 * FOUNDATION04 — PHASE A — CORRECTION07
 *
 *   Context-binding-law enforcement.
 *
 *   A client using a durable authority MUST submit events
 *   in the exact run/mission context to which that
 *   authority was bootstrapped. Endpoint equality without
 *   context equality is insufficient binding.
 *
 *   These three tests pin that contract against the
 *   frozen LedgerWriter. They run in the live lane
 *   alongside the WSTART-LIVE01..03 strict matrix but
 *   are reported SEPARATELY so the strict-lane
 *   REQUIRED=3 contract is not inflated.
 *
 *   SKIP behaviour mirrors the strict lane: if the host
 *   tmpdir cannot construct a writer socket path within
 *   the 100-byte budget, these tests SKIP honestly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  ledgerWriterSocketPath,
} from "../../src/ledger-writer/ledger-writer-process.js";
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
import { makeMissionId } from "../../src/domain/ids.js";

// ---------------------------------------------------------------------------
// Helpers (kept tiny; we do NOT reuse setupLiveRun() here because the
// context tests want finer control over the {runId, missionId} tuple).
// ---------------------------------------------------------------------------

type LiveRun = LiveRunHandle;

async function mkRunWith(
  prefix: string,
  runId: LiveRun["runId"],
  missionId: LiveRun["missionId"],
): Promise<LiveRun | { skip: true; reason: string }> {
  const runDir = await mkTmp(prefix);
  const controlDir = await fs.mkdtemp(
    path.join(runDir, "..", ".c-" + prefix + "-"),
  );
  const writerSocketPath = ledgerWriterSocketPath(runDir);
  const socketPath = path.join(runDir, "witness.sock");
  if (udsPathTooLong(writerSocketPath) || udsPathTooLong(socketPath)) {
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
    return { skip: true, reason: "uds path > 100 bytes budget on this host" };
  }
  const writer = await startLiveWriter({ runDir, runId, missionId });
  if (writer.socketPath !== writerSocketPath) {
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
    throw new Error("CORRECTION04 socket invariant violated");
  }
  return {
    runDir,
    controlDir,
    runId,
    missionId,
    writer,
    socketPath,
    writerSocketPath,
  };
}

// ---------------------------------------------------------------------------
// WSTART-CONTEXT01 — writer runId == spec runId
// ---------------------------------------------------------------------------

test("WSTART-CONTEXT01: writer runId == spec runId (positive)", async (t) => {
  const runId = DEFAULT_LIVE_RUN_ID;
  const missionId = DEFAULT_LIVE_MISSION_ID;
  const r = await mkRunWith("ctx1", runId, missionId);
  if ("skip" in r) { t.skip(r.reason); return; }
  try {
    const who = await r.writer.whoAreYou();
    assert.equal(who.ok, true,
      "WSTART-CONTEXT01: writer whoAreYou must succeed");
    if (!who.ok) return;
    assert.equal(who.runId, runId,
      "WSTART-CONTEXT01: writer.runId == caller-supplied runId");

    const spec = mkLiveSpec(r);
    assert.equal(spec.runId, runId,
      "WSTART-CONTEXT01: spec.runId == caller-supplied runId");
    assert.equal(spec.runId, who.runId,
      "WSTART-CONTEXT01: spec.runId == writer.runId");
  } finally {
    await teardownLiveRun(r);
  }
});

// ---------------------------------------------------------------------------
// WSTART-CONTEXT02 — writer missionId == spec missionId
// ---------------------------------------------------------------------------

test("WSTART-CONTEXT02: writer missionId == spec missionId (positive)", async (t) => {
  const runId = DEFAULT_LIVE_RUN_ID;
  const missionId = DEFAULT_LIVE_MISSION_ID;
  const r = await mkRunWith("ctx2", runId, missionId);
  if ("skip" in r) { t.skip(r.reason); return; }
  try {
    const who = await r.writer.whoAreYou();
    assert.equal(who.ok, true,
      "WSTART-CONTEXT02: writer whoAreYou must succeed");
    if (!who.ok) return;
    assert.equal(who.missionId, missionId,
      "WSTART-CONTEXT02: writer.missionId == caller-supplied missionId");

    const spec = mkLiveSpec(r);
    assert.equal(spec.missionId, missionId,
      "WSTART-CONTEXT02: spec.missionId == caller-supplied missionId");
    assert.equal(spec.missionId, who.missionId,
      "WSTART-CONTEXT02: spec.missionId == writer.missionId");
  } finally {
    await teardownLiveRun(r);
  }
});

// ---------------------------------------------------------------------------
// WSTART-CONTEXT03 — negative: same endpoint + wrong missionId → rejection
// ---------------------------------------------------------------------------

test("WSTART-CONTEXT03: wrong-missionId spec against live writer is rejected (no spawn)", async (t) => {
  const realRunId = DEFAULT_LIVE_RUN_ID;
  const realMissionId = makeMissionId("ctx3-good-mission");
  const real = await mkRunWith("ctx3real", realRunId, realMissionId);
  if ("skip" in real) { t.skip(real.reason); return; }

  const wrongMissionId = makeMissionId("ctx3-wrong-mission");
  const spec = mkLiveSpec(real, {
    ledgerWriterSocketPath: real.writerSocketPath,
  });
  const wrongSpec = {
    ...spec,
    missionId: wrongMissionId,
  };

  assert.notEqual(wrongSpec.missionId, real.missionId,
    "WSTART-CONTEXT03: spec.missionId must differ from writer.missionId");

  let r;
  try {
    r = await startWitness(wrongSpec);
  } finally {
    await teardownLiveRun(real);
  }
  assert.equal(r.ok, false,
    "WSTART-CONTEXT03: wrong-missionId spec must be REJECTED by the gate");
  if (r.ok) return;
  assert.equal(r.failure.kind, "intent_persistence_failed",
    "WSTART-CONTEXT03: failure must be intent_persistence_failed");
});
