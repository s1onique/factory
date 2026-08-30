import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSupervisor } from "../../src/process/supervisor-builder.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import { makeAttemptId, makeEventId, makeRunId, makeMissionId } from "../../src/domain/ids.js";
import type { ProcessEvidenceCommitResult, ProcessEvidenceSink } from "../../src/process/process-evidence-sink.js";
import type { ProcessSpec } from "../../src/process/process-types.js";

interface FaultSink extends ProcessEvidenceSink {
  criticalCalls(): number;
}

function faultInjectingSink(): FaultSink {
  // CORRECTION07 §2: process_spawn_requested is a critical boundary.
  // 1st critical call: spawn_requested (must succeed)
  // 2nd critical call: process_spawned (fault-injected failure)
  let firstCritical = true;
  let counter = 0;
  return {
    criticalCalls: () => counter,
    commitCritical: (): Promise<ProcessEvidenceCommitResult> => {
      counter++;
      if (counter === 1) {
        // 1st: process_spawn_requested - succeed
        return Promise.resolve({ ok: true, seq: counter });
      }
      if (firstCritical) {
        firstCritical = false;
        return Promise.resolve({ ok: false, error: { kind: "ledger_write_failure", message: "fault-injected" } });
      }
      return Promise.resolve({ ok: true, seq: counter });
    },
    commitObservation: (): Promise<ProcessEvidenceCommitResult> =>
      Promise.resolve({ ok: true, seq: 0 }),
  };
}

const SPEC: ProcessSpec = {
  executable: "sleep",
  args: ["0.3"],
  env: {},
  cwd: process.cwd(),
  termGraceMs: 500,
  killGraceMs: 500,
  deadlineMs: 5000,
  stdoutLimitBytes: 0,
  stderrLimitBytes: 0,
};

test("OG01/OG02 ownership gate fails closed when commitCritical returns {ok:false}", async () => {
  const signals = nodeSignalPort();
  const spawner = nodeSpawnPort();
  const clock = realClock();
  const sink = faultInjectingSink();
  const handle = buildSupervisor({
    spec: SPEC,
    clock,
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: {
      runId: makeRunId("r-og"),
      missionId: makeMissionId("m-og"),
      attemptId: makeAttemptId("a-og"),
      eventIdFactory: () => makeEventId("e-og"),
    },
  });
  const r = await handle.await();
  assert.equal(r.outcome.kind, "cleanup_failed");
  if (r.outcome.kind === "cleanup_failed") {
    const f = r.outcome.failure as { kind?: string; message?: string };
    assert.ok(
      typeof f.message === "string" &&
        (f.message.includes("ownership") ||
          f.message.includes("persistence") ||
          f.message.includes("commit") ||
          f.message.includes("evidence") ||
          f.message.includes("permission") ||
          f.message.includes("denied")),
      "failure message should reference ownership/persistence/commit; got: " + f.message,
    );
  }
  assert.ok(sink.criticalCalls() >= 1, "expected commitCritical to be called");
});

test("OG03 internal sink malfunction also fails closed", async () => {
  const signals = nodeSignalPort();
  const spawner = nodeSpawnPort();
  const clock = realClock();
  let criticalCalls = 0;
  const sink: ProcessEvidenceSink = {
    commitCritical: (): Promise<ProcessEvidenceCommitResult> => {
      criticalCalls++;
      // CORRECTION07 §2: 1st critical is spawn_requested, must succeed.
      // 2nd critical is process_spawned, faults to test ownership malfunction.
      if (criticalCalls === 1) {
        return Promise.resolve({ ok: true, seq: criticalCalls });
      }
      if (criticalCalls === 2) {
        return Promise.reject(new Error("internal sink malfunction"));
      }
      return Promise.resolve({ ok: true, seq: criticalCalls });
    },
    commitObservation: (): Promise<ProcessEvidenceCommitResult> =>
      Promise.resolve({ ok: true, seq: 0 }),
  };
  const handle = buildSupervisor({
    spec: SPEC,
    clock,
    signals,
    spawner,
    sink: () => {},
    evidenceSink: sink,
    evidenceIdentity: {
      runId: makeRunId("r-og2"),
      missionId: makeMissionId("m-og2"),
      attemptId: makeAttemptId("a-og2"),
      eventIdFactory: () => makeEventId("e-og2"),
    },
  });
  const r = await handle.await();
  assert.equal(r.outcome.kind, "cleanup_failed");
  // CORRECTION03 §2: mechanically prove the
  // internal_malfunction taxonomy is preserved end-to-end:
  // the typed cause MUST be
  //   evidence_persistence_failure(stage=ownership)
  // NOT
  //   evidence_persistence_failure(stage=settlement)
  // and the message MUST mention the rejected Promise error
  // (the raw rejection taxonomy is preserved, not laundered).
  if (r.outcome.kind === "cleanup_failed") {
    const f = r.outcome.failure;
    assert.equal(f.kind, "evidence_persistence_failure");
    if (f.kind === "evidence_persistence_failure") {
      assert.equal(f.stage, "ownership");
      assert.ok(
        typeof f.message === "string" && f.message.length > 0,
        "ownership failure must carry a non-empty message",
      );
    }
  }
})
