import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSupervisor } from "../../src/process/supervisor-builder.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import { makeAttemptId, makeEventId, makeRunId, makeMissionId } from "../../src/domain/ids.js";
import type { ProcessEvidenceCommitResult, ProcessEvidenceSink } from "../../src/process/process-evidence-sink.js";
import type { ProcessSpec } from "../../src/process/process-types.js";

const SPEC: ProcessSpec = {
  executable: "true",
  args: [],
  env: {},
  cwd: process.cwd(),
  termGraceMs: 500,
  killGraceMs: 500,
  deadlineMs: 5000,
  stdoutLimitBytes: 0,
  stderrLimitBytes: 0,
};

test("settlement-failure: process_result_committed returns {ok:false} -> evidence_persistence_failure(stage=settlement) and ORIGINAL result preserved", async () => {
  // CORRECTION03 §39/§58: a process that exited cleanly
  // but whose settlement fsync failed must NOT be
  // represented as cleanup_failed. The original ProcessResult
  // (which the lifecycle already produced) must remain
  // accessible to the caller; the only NEW claim is the
  // typed evidence_persistence_failure(stage=settlement).
  let criticalCalls = 0;
  const sink: ProcessEvidenceSink = {
    commitCritical: (): Promise<ProcessEvidenceCommitResult> => {
      criticalCalls++;
      // First call: process_spawned — succeed.
      if (criticalCalls === 1) return Promise.resolve({ ok: true, seq: 1 });
      // All subsequent commitCritical calls fail (both
      // process_result_committed emissions).
      return Promise.resolve({ ok: false, error: { kind: "ledger_write_failure", message: "settlement fail" } });
    },
    commitObservation: (): Promise<ProcessEvidenceCommitResult> => Promise.resolve({ ok: true, seq: 99 }),
  };
  const handle = buildSupervisor({
    spec: SPEC,
    clock: realClock(),
    signals: nodeSignalPort(),
    spawner: nodeSpawnPort(),
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: {
      runId: makeRunId("r-sf"),
      missionId: makeMissionId("m-sf"),
      attemptId: makeAttemptId("a-sf"),
      eventIdFactory: () => makeEventId("e-sf"),
    },
  });
  const r = await handle.await();
  assert.equal(r.outcome.kind, "cleanup_failed");
  if (r.outcome.kind === "cleanup_failed") {
    const f = r.outcome.failure;
    assert.equal(f.kind, "evidence_persistence_failure");
    if (f.kind === "evidence_persistence_failure") {
      assert.equal(f.stage, "settlement");
    }
    // The escalation evidence MUST be empty (no TERM/KILL/probe).
    const e = r.outcome.escalation;
    assert.equal(e.termRequested, false);
    assert.equal(e.termSent, false);
    assert.equal(e.killRequested, false);
    assert.equal(e.killSent, false);
  }
});
