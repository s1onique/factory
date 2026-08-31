/**
 * FOUNDATION04 — B0-CORR03 — Lease lifetime / shutdown
 * ordering tests (LS01..LS05).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  acquireLedgerWriterLease,
  isLeaseHeld,
} from "../../src/ledger-writer/ledger-writer-lease.js";
import { makeLedgerWriterInstanceId } from "../../src/ledger-writer/ledger-writer-types.js";

function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(process.cwd(), ".lw-shutdown-"));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

test("LS01 in-flight handler keeps the lease held", async () => {
  const tmp = await mkTmp();
  try {
    const id = makeLedgerWriterInstanceId("lw-ls01");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: id,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const held1 = await isLeaseHeld(tmp);
    assert.equal(held1.held, true);

    // While the lease is held, a second writer cannot
    // acquire.
    const r2 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-ls01-other"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r2.ok, false);

    // After release, a second writer can acquire.
    await r1.handle.release();
    const r3 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-ls01-other"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r3.ok, true);
    if (!r3.ok) return;
    await r3.handle.release();
  } finally {
    await rmTmp(tmp);
  }
});

test("LS02 no dual authority during overlapping holds", async () => {
  const tmp = await mkTmp();
  try {
    const promises: Promise<{ ok: boolean }>[] = [];
    for (let i = 0; i < 100; i++) {
      const id = makeLedgerWriterInstanceId(`lw-ls02-${i}`);
      promises.push(
        acquireLedgerWriterLease({
          runDir: tmp,
          instanceId: id,
          runId: "r",
          missionId: "m",
        }).then((r) => ({ ok: r.ok })),
      );
    }
    const results = await Promise.all(promises);
    const winners = results.filter((r) => r.ok).length;
    assert.equal(winners, 1, "exactly one writer acquires the lease");
  } finally {
    await rmTmp(tmp);
  }
});

test("LS03 capability handle release when directory exists succeeds", async () => {
  const tmp = await mkTmp();
  try {
    const id = makeLedgerWriterInstanceId("lw-ls03");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: id,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    // Wipe the owner.json entirely.
    await fs.rm(`${tmp}/ledger-writer-owner/owner.json`, { force: true });

    // Capability release MUST still succeed.
    const rel = await r1.handle.release();
    assert.equal(rel.ok, true);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, false);
  } finally {
    await rmTmp(tmp);
  }
});

test("LS04 release-then-release is idempotent", async () => {
  const tmp = await mkTmp();
  try {
    const id = makeLedgerWriterInstanceId("lw-ls04");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: id,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    const r1a = await r1.handle.release();
    assert.equal(r1a.ok, true);
    const r1b = await r1.handle.release();
    assert.equal(r1b.ok, false);
    if (r1b.ok) return;
    assert.equal(r1b.error.kind, "lease_not_held");
    const r1c = await r1.handle.release();
    assert.equal(r1c.ok, false);
    if (r1c.ok) return;
    assert.equal(r1c.error.kind, "lease_not_held");
  } finally {
    await rmTmp(tmp);
  }
});

test("LS05 no implicit auto-cleanup of unknown leases", async () => {
  const tmp = await mkTmp();
  try {
    // Simulate a stale lease from a previous writer.
    await fs.mkdir(`${tmp}/ledger-writer-owner`, { mode: 0o700 });
    await fs.writeFile(
      `${tmp}/ledger-writer-owner/owner.json`,
      JSON.stringify({
        instanceId: "stale-1",
        runId: "r",
        missionId: "m",
        pid: 99999,
        startedAt: 0,
      }),
    );
    // A new writer cannot acquire.
    const r = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-ls05-new"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.kind, "lease_held");
    // The lease is STILL held (no implicit cleanup).
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, true);
  } finally {
    await rmTmp(tmp);
  }
});
