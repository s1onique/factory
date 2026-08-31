/**
 * FOUNDATION04 — B0-CORR03 — Lease capability + LS01..LS04
 * (lifetime).
 *
 * LS01 in-flight append prevents lease release: a hook that
 * blocks the append handler keeps the lease held until the
 * handler completes.
 *
 * LS02 no dual authority during shutdown: while W1 is
 * mid-shutdown, a W2 acquisition fails. After W1 close +
 * lease release, W2 succeeds.
 *
 * LS03 close timeout preserves lease: if server.close()
 * stalls, the bounded shutdown expires and the lease is
 * RETAINED.
 *
 * LS04 repeated signals are idempotent: SIGTERM/SIGINT
 * flood produces a single shutdown sequence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  acquireLedgerWriterLease,
  isLeaseHeld,
  releaseLedgerWriterLease,
} from "../../src/ledger-writer/ledger-writer-lease.js";
import { makeLedgerWriterInstanceId } from "../../src/ledger-writer/ledger-writer-types.js";

function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(process.cwd(), ".lw-lease-cap-"));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

test("LEASE_CAP01 capability handle release is idempotent", async () => {
  const tmp = await mkTmp();
  try {
    const id = makeLedgerWriterInstanceId("lw-cap-1");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: id,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    const rel1 = await r1.handle.release();
    assert.equal(rel1.ok, true);

    // Second release is a no-op (returns lease_not_held) —
    // the capability is exhausted.
    const rel2 = await r1.handle.release();
    assert.equal(rel2.ok, false);
    if (rel2.ok) return;
    assert.equal(rel2.error.kind, "lease_not_held");
  } finally {
    await rmTmp(tmp);
  }
});

test("LEASE_CAP02 corrupted owner.json while lease held → second writer still rejected", async () => {
  const tmp = await mkTmp();
  try {
    const id = makeLedgerWriterInstanceId("lw-corrupt-2");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: id,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;

    // Corrupt the owner.json. The directory still exists
    // (mkdir is atomic; only owner.json is descriptive).
    await fs.writeFile(
      `${tmp}/ledger-writer-owner/owner.json`,
      "{garbage",
    );

    // A second acquisition MUST fail because the directory
    // exists.
    const r2 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-other-2"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r2.ok, false);
    if (r2.ok) return;
    assert.equal(
      r2.error.kind,
      "lease_held",
      `expected lease_held, got ${JSON.stringify(r2.error)}`,
    );

    // The capability release works regardless of corrupted
    // owner.json.
    const rel = await r1.handle.release();
    assert.equal(rel.ok, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("LEASE_CAP03 hold/release pattern releases between two fresh acquisitions", async () => {
  const tmp = await mkTmp();
  try {
    const idA = makeLedgerWriterInstanceId("lw-cycle-3a");
    const idB = makeLedgerWriterInstanceId("lw-cycle-3b");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: idA,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    await r1.handle.release();

    const r2 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: idB,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    await r2.handle.release();

    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, false);
  } finally {
    await rmTmp(tmp);
  }
});

test("LEASE_CAP04 releaseLedgerWriterLease still works (backwards compat)", async () => {
  const tmp = await mkTmp();
  try {
    const id = makeLedgerWriterInstanceId("lw-compat-4");
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: id,
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const rel = await releaseLedgerWriterLease({
      runDir: tmp,
      expectedInstanceId: id,
    });
    assert.equal(rel.ok, true);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, false);
  } finally {
    await rmTmp(tmp);
  }
});
