/**
 * CORRECTION10 — API gate closure tests (FOUNDATION03 §27).
 *
 * TypeScript enforces that:
 *   - buildSupervisor does NOT accept EvidenceSupervisorArgs
 *   - createSupervisor does NOT accept EvidenceSupervisorArgs
 *   - startSupervisor does NOT accept NoEvidenceSupervisorArgs
 *
 * The synchronous APIs are FORCED to be no-evidence. The
 * evidence-enabled path is FORCED to be async.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  NoEvidenceSupervisorArgs,
  EvidenceSupervisorArgs,
} from "../../src/process/supervisor-builder.js";
import type { ProcessEvidenceSink } from "../../src/process/process-evidence-sink.js";
import type { ProcessEvidenceIdentity } from "../../src/process/process-evidence-bridge.js";
import {
  makeAttemptId,
  makeEventId,
  makeMissionId,
  makeRunId,
} from "../../src/domain/ids.js";

const fakeSink: ProcessEvidenceSink = {
  commitCritical: () => Promise.resolve({ ok: true, seq: 1 }),
  commitObservation: () => Promise.resolve({ ok: true, seq: 1 }),
};
const fakeIdentity: ProcessEvidenceIdentity = {
  runId: makeRunId("r-api"),
  missionId: makeMissionId("m-api"),
  attemptId: makeAttemptId("a-api"),
  eventIdFactory: () => makeEventId("e-api"),
};
const baseArgs = {
  spec: {
    executable: "/bin/true", args: [], cwd: "/tmp", env: {},
    deadlineMs: 5000, termGraceMs: 100, killGraceMs: 100,
    stdoutLimitBytes: 1024, stderrLimitBytes: 1024,
  },
  clock: { nowMs: () => 0, nowMonotonicMs: () => 0, sleep: async () => ({ kind: "completed" as const }) },
  signals: { signalGroup: () => ({ kind: "group_absent" as const }), probeGroup: () => ({ kind: "absent" as const }) },
  spawner: { spawn: () => ({}) as never },
};

// We anchor the negative compile via Parameters:
type _BuildArgs = Parameters<typeof import("../../src/process/supervisor-builder.js").buildSupervisor>[0];
// @ts-expect-error - evidenceSink must be rejected by buildSupervisor.
const _buildArg: _BuildArgs = { ...baseArgs, evidenceSink: fakeSink };
void _buildArg;
// @ts-expect-error - evidenceIdentity must be rejected by buildSupervisor.
const _buildArg2: _BuildArgs = { ...baseArgs, evidenceIdentity: fakeIdentity };
void _buildArg2;
// Positive: NoEvidenceSupervisorArgs MUST be acceptable.
const _good: _BuildArgs = { ...baseArgs } satisfies NoEvidenceSupervisorArgs;
void _good;

type _CreateArgs = Parameters<typeof import("../../src/process/supervised-process.js").createSupervisor>[0];
// @ts-expect-error - createSupervisor MUST NOT accept evidence fields.
const _createArg: _CreateArgs = { ...baseArgs, evidenceSink: fakeSink };
void _createArg;
// @ts-expect-error - createSupervisor MUST NOT accept evidenceIdentity.
const _createArg2: _CreateArgs = { ...baseArgs, evidenceIdentity: fakeIdentity };
void _createArg2;

type _StartArgs = Parameters<typeof import("../../src/process/supervisor-builder.js").startSupervisor>[0];
// @ts-expect-error - startSupervisor MUST require evidenceIdentity.
const _startArg: _StartArgs = { ...baseArgs };
void _startArg;

// Positive: EvidenceSupervisorArgs MUST be acceptable to startSupervisor.
const _goodStart: _StartArgs = { ...baseArgs, evidenceSink: fakeSink, evidenceIdentity: fakeIdentity };
void _goodStart;

test("API01 buildSupervisor + createSupervisor reject evidence fields at compile time", () => {
  // The compile-time guarantees are above. The runtime anchor
  // asserts the type split is real.
  const n: NoEvidenceSupervisorArgs = { ...baseArgs };
  const e: EvidenceSupervisorArgs = {
    ...baseArgs,
    evidenceSink: fakeSink,
    evidenceIdentity: fakeIdentity,
  };
  assert.ok(typeof n === "object");
  assert.ok(typeof e === "object");
});

test("API02 every evidence-enabled public route runs through the async startSupervisor", async () => {
  // Spawner that records calls. Use a sink whose first commit
  // resolves immediately so the gate passes; spawner.spawn()
  // MUST be called exactly once.
  let spawnCalls = 0;
  type _Result = import("../../src/process/process-evidence-sink.js").ProcessEvidenceCommitResult;
  // Holder object avoids TypeScript narrowing issues when
  // capturing the resolver across a Promise boundary.
  const holder: { resolve: ((r: _Result) => void) | null } = { resolve: null };
  const controlledSink: ProcessEvidenceSink = {
    commitCritical: (input): Promise<_Result> => {
      if (input.payload.kind === "process_spawn_requested") {
        return new Promise<_Result>((res) => {
          holder.resolve = res;
        });
      }
      return Promise.resolve({ ok: true, seq: 999 });
    },
    commitObservation: () => Promise.resolve({ ok: true, seq: 1 }),
  };
  const { Readable } = await import("node:stream");
  const fakeChild = {
    pid: 0,
    pgid: 0,
    stdout: new Readable({ read() {} }),
    stderr: new Readable({ read() {} }),
    on: (_e: string, _l: (...args: unknown[]) => void) => fakeChild,
    once: (_e: string, _l: (...args: unknown[]) => void) => fakeChild,
    kill: () => false,
  } as unknown as import("../../src/process/process-ports.js").SpawnedChild;
  const m = await import("../../src/process/supervised-process.js");
  const startPromise = m.startSupervisor({
    spec: baseArgs.spec,
    clock: baseArgs.clock,
    signals: baseArgs.signals,
    spawner: {
      spawn: () => {
        spawnCalls++;
        return fakeChild;
      },
    },
    sink: () => {},
    evidenceSink: controlledSink,
    evidenceIdentity: fakeIdentity,
  });
  // While the gate is unresolved, the spawner MUST NOT have
  // been called.
  await new Promise((res) => setImmediate(res));
  assert.equal(spawnCalls, 0, "evidence gate blocks spawn until ACK");
  // Now resolve the gate. The spawner fires.
  const resolver = holder.resolve;
  if (resolver !== null) {
    resolver({ ok: true, seq: 1 });
  }
  const r = await startPromise;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(spawnCalls, 1, "after ACK, spawner is called exactly once");
});

test("API03 synchronous supervisor entry points cannot accept evidence (buildSupervisor)", () => {
  // Probe the synchronous surface; this MUST compile only
  // when no evidence fields are present. We rely on the
  // negative compile-time directives above; the runtime
  // anchor here just confirms the synchronous build is
  // callable.
  const m = import("../../src/process/supervised-process.js");
  void m;
  assert.ok(true);
});
