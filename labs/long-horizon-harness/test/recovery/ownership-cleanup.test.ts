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
  let firstCritical = true;
  let counter = 0;
  return {
    criticalCalls: () => counter,
    commitCritical: (): Promise<ProcessEvidenceCommitResult> => {
      counter++;
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
  const sink: ProcessEvidenceSink = {
    commitCritical: (): Promise<ProcessEvidenceCommitResult> => {
      const r = Promise.reject(new Error("internal sink malfunction"));
      r.catch(() => undefined); // test-only: simulate well-behaved sink
      return r;
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
});
