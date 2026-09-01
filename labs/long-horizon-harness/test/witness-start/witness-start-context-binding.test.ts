/**
 * FOUNDATION04 — PHASE A — CORRECTION07
 *
 *   Strict context-binding-law qualification oracle.
 *
 *   A client using a durable authority MUST submit events
 *   in the exact run/mission context to which that
 *   authority was bootstrapped. Endpoint equality without
 *   context equality is insufficient binding.
 *
 *   This file is a STRICT, SHA-bound, zero-skip
 *   qualification matrix:
 *
 *     - CONTEXT_REQUIRED=3
 *     - CONTEXT_EXECUTED=3
 *     - CONTEXT_PASSED=3
 *     - CONTEXT_FAILED=0
 *     - CONTEXT_SKIPPED=0
 *     - CONTEXT_RESIDUE=0
 *     - WITNESS_START_CONTEXT_DISPOSITION = OK
 *
 *   It runs alongside WSTART-LIVE01..03 but is reported
 *   SEPARATELY (its own env vars, its own disposition, its
 *   own rc). Phase A closure is the CONJUNCTION of both
 *   matrices. Required-but-unexercised is BLOCKED, never
 *   PASS (mirrors the B0 doctrine).
 *
 *   Tests:
 *     CONTEXT01: writer.runId == spec.runId (whoAreYou)
 *     CONTEXT02: writer.missionId == spec.missionId (whoAreYou)
 *     CONTEXT03: wrong-missionId spec against a LIVE writer
 *                is rejected by the writer's content_hash
 *                check (intent_persistence_failed with
 *                cause.writer_rejected — the typed boundary,
 *                not a message substring).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import {
  sweepAndProve,
  type LiveFixtureEntry,
} from "../ledger-writer/_live_registry.js";

// ---------------------------------------------------------------------------
// Strict qualification env (mirrors witness-start-live.test.ts shape)
// ---------------------------------------------------------------------------

const STRICT = process.env.FACTORY_STRICT_WITNESS_START_CONTEXT_LIVE === "1";
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

const REQUIRED = 3;
let exec = 0;
let pass = 0;
let fail = 0;
let skip = 0;
let residue = 0;
let residueDetail: ReadonlyArray<LiveFixtureEntry> = [];

function emit(rec: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

type ContextSkip = { readonly skip: true; readonly reason: string };

async function mkRunWith(
  prefix: string,
  runId: LiveRunHandle["runId"],
  missionId: LiveRunHandle["missionId"],
): Promise<LiveRunHandle | ContextSkip> {
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
  // whoAreYou probe: pin that the writer's binding carries
  // the SAME runId/missionId we supplied. This is the
  // counterpart of the same probe in
  // setupLiveRun(); CONTEXT01/02 use it for assertions
  // rather than assertions-of-assertions.
  const who = await writer.whoAreYou();
  if (!who.ok) {
    await teardownLiveRun({
      runDir,
      controlDir,
      runId,
      missionId,
      writer,
      socketPath,
      writerSocketPath,
    });
    throw new Error(
      "CORRECTION07 invariant probe failed: whoAreYou: " +
        JSON.stringify(who.error),
      );
  }
  if (who.runId !== runId || who.missionId !== missionId) {
    await teardownLiveRun({
      runDir,
      controlDir,
      runId,
      missionId,
      writer,
      socketPath,
      writerSocketPath,
    });
    throw new Error(
      "CORRECTION07 invariant violated: writer bound to " +
        JSON.stringify({ runId: who.runId, missionId: who.missionId }) +
        " but caller supplied " +
        JSON.stringify({ runId, missionId }),
      );
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
// CONTEXT01 — writer runId == spec runId
// ---------------------------------------------------------------------------

test("WSTART-CONTEXT01: writer runId == spec runId (positive)", async (t) => {
  exec += 1;
  const runId = DEFAULT_LIVE_RUN_ID;
  const missionId = DEFAULT_LIVE_MISSION_ID;
  const r = await mkRunWith("ctx1", runId, missionId);
  if ("skip" in r) { skip += 1; t.skip(r.reason); return; }
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
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await teardownLiveRun(r);
  }
});

// ---------------------------------------------------------------------------
// CONTEXT02 — writer missionId == spec missionId
// ---------------------------------------------------------------------------

test("WSTART-CONTEXT02: writer missionId == spec missionId (positive)", async (t) => {
  exec += 1;
  const runId = DEFAULT_LIVE_RUN_ID;
  const missionId = DEFAULT_LIVE_MISSION_ID;
  const r = await mkRunWith("ctx2", runId, missionId);
  if ("skip" in r) { skip += 1; t.skip(r.reason); return; }
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
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await teardownLiveRun(r);
  }
});

// ---------------------------------------------------------------------------
// CONTEXT03 — negative: same endpoint + wrong missionId → writer_rejected
// ---------------------------------------------------------------------------
//
//   The test MUST exercise the frozen B0 invariant:
//     writer canonicalContentHash disagrees with the
//     client's clientContentHash
//     → writer replies `content_hash_mismatch`
//     → witness-ledger surfaces `writer_rejected`
//     → gate wraps as `intent_persistence_failed`
//       with `cause.kind = "writer_rejected"`.
//
//   CORRECTION08 (reviewer feedback): the previous version
//   accepted `intent_persistence_failed` regardless of the
//   inner cause. That allowed a false green such as
//   "writer dies unexpectedly". This version requires the
//   typed boundary.
//
//   We assert the typed cause (the strongest assertion
//   available in the public surface) and explicitly do NOT
//   grep the human-readable reason string — the protocol
//   contract is the discriminator, not the prose.
// ---------------------------------------------------------------------------

test("WSTART-CONTEXT03: wrong-missionId spec is rejected by the writer (no spawn)", async (t) => {
  exec += 1;
  const realRunId = DEFAULT_LIVE_RUN_ID;
  const realMissionId = makeMissionId("ctx3-good-mission");
  const real = await mkRunWith("ctx3real", realRunId, realMissionId);
  if ("skip" in real) { skip += 1; t.skip(real.reason); return; }
  try {
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

    const r = await startWitness(wrongSpec);
    assert.equal(r.ok, false,
      "WSTART-CONTEXT03: wrong-missionId spec must be REJECTED by the gate");
    if (r.ok) {
      fail += 1;
      return;
    }

    assert.equal(r.failure.kind, "intent_persistence_failed",
      "WSTART-CONTEXT03: failure.kind must be intent_persistence_failed");

    const cause = r.failure.cause;
    assert.equal(cause.kind, "writer_rejected",
      "WSTART-CONTEXT03: failure.cause.kind must be writer_rejected " +
        "(proves the live writer's content_hash check rejected " +
        "the cross-context request, NOT a generic persistence " +
        "failure)");

    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    await teardownLiveRun(real);
  }
});

// ---------------------------------------------------------------------------
// Strict qualification after-hook (mirrors witness-start-live.test.ts)
// ---------------------------------------------------------------------------

after(async () => {
  const failed = await sweepAndProve();
  residue = failed.length;
  residueDetail = failed;

  // eslint-disable-next-line no-console
  console.log(
    `WITNESS_START_CONTEXT_SUBJECT_COMMIT_OBSERVED=${OBSERVED_SHA}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `WITNESS_START_CONTEXT_SUBJECT_COMMIT_EXPECTED=${EXPECTED_SHA}`,
  );
  // eslint-disable-next-line no-console
  console.log(`WITNESS_START_CONTEXT_RESIDUE=${residue}`);

  const disposition =
    fail === 0 &&
    skip === 0 &&
    residue === 0 &&
    exec === REQUIRED &&
    pass === REQUIRED
      ? "OK"
      : "FAIL";

  emit({
    kind: "witness_start_context_matrix",
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

  // eslint-disable-next-line no-console
  console.log(`WITNESS_START_CONTEXT_DISPOSITION=${disposition}`);
  if (residue > 0) {
    // eslint-disable-next-line no-console
    console.log(
      "WITNESS_START_CONTEXT_RESIDUE_DETAIL=" +
        JSON.stringify(residueDetail),
    );
  }
  if (EXPECTED_SHA !== "" && EXPECTED_SHA !== OBSERVED_SHA) {
    // eslint-disable-next-line no-console
    console.log(
      `WITNESS_START_CONTEXT_SHA_MISMATCH: expected=${EXPECTED_SHA} observed=${OBSERVED_SHA}`,
    );
  }
  if (STRICT && disposition !== "OK") {
    throw new Error(
      "WITNESS_START_CONTEXT_DISPOSITION=FAIL: " +
        "passed=" + pass + " required=" + REQUIRED +
        "; failed=" + fail + "; skipped=" + skip +
        "; residue=" + residue +
        "; executed=" + exec,
    );
  }
  if (STRICT && EXPECTED_SHA !== "" && EXPECTED_SHA !== OBSERVED_SHA) {
    throw new Error(
      "WITNESS_START_CONTEXT_SHA_MISMATCH: expected=" +
        EXPECTED_SHA + " observed=" + OBSERVED_SHA,
    );
  }
});

void assert;
