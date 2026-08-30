import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { JsonlLedger } from "../../src/evidence/jsonl-ledger.js";
import {
  LedgerBackedProcessEvidenceSink,
  NoopProcessEvidenceSink,
} from "../../src/process/process-evidence-sink.js";
import { makeProcessId } from "../../src/process/process-types.js";
import {
  makeEventId,
  makeRunId,
  makeMissionId,
  makeAttemptId,
} from "../../src/domain/ids.js";

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "labsink-"));
}

test("LedgerBackedProcessEvidenceSink appends process-evidence envelope", async () => {
  const dir = await tmpDir();
  try {
    const ledger = new JsonlLedger(dir);
    const opened = await ledger.open();
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    const sink = new LedgerBackedProcessEvidenceSink(ledger);
    const r = await sink.commitCritical({
      eventId: makeEventId("e-1"),
      runId: makeRunId("r-1"),
      missionId: makeMissionId("m-1"),
      observedAt: 1000,
      payload: {
        kind: "process_spawn_requested",
        attempt_id: makeAttemptId("a-1"),
        process_id: makeProcessId("p-x"),
      },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    const all = await ledger.readAll();
    assert.equal(all.ok, true);
    if (all.ok) {
      const ev = all.value[0];
      assert.ok(ev !== undefined);
      assert.ok(
        "kind" in ev,
        "expected v2 envelope with kind discriminator",
      );
      assert.equal(ev.kind, "process_evidence");
      if ("process_evidence" in ev) {
        assert.equal(
          ev.process_evidence.kind,
          "process_spawn_requested",
        );
        if (ev.process_evidence.kind === "process_spawn_requested") {
          assert.equal(ev.process_evidence.attempt_id, "a-1");
        }
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("NoopProcessEvidenceSink returns ok", async () => {
  const sink = new NoopProcessEvidenceSink();
  const r = await sink.commitCritical({
    eventId: makeEventId("e-1"),
    runId: makeRunId("r-1"),
    missionId: makeMissionId("m-1"),
    observedAt: 1000,
    payload: {
      kind: "process_spawn_requested",
      attempt_id: makeAttemptId("a-1"),
      process_id: makeProcessId("p-x"),
    },
  });
  assert.equal(r.ok, true);
});
