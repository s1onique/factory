/**
 * FOUNDATION04 — B0-CORR04 — Lease ABA safety (LEASE_CAP05..07).
 *
 * A stale LeaseHandle MUST NOT delete a replacement lease.
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
  return fs.mkdtemp(path.join(process.cwd(), ".lw-aba-"));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

test("LEASE_CAP05 stale handle A cannot delete replacement lease B", async () => {
  const tmp = await mkTmp();
  try {
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-aba-w1"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    // Operator removes the lease.
    await fs.rm(`${tmp}/ledger-writer-owner`, { recursive: true, force: true });
    const r2 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-aba-w2"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    // Stale W1 capability tries to release — MUST NOT
    // delete W2's lease.
    const relA = await r1.handle.release();
    assert.equal(relA.ok, false);
    if (relA.ok) return;
    assert.equal(relA.error.kind, "lease_replaced");
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, true);
    const relB = await r2.handle.release();
    assert.equal(relB.ok, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("LEASE_CAP06 corrupt token while W1 owns lease → release fails closed", async () => {
  const tmp = await mkTmp();
  try {
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-corrupt-tok"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    await fs.writeFile(`${tmp}/ledger-writer-owner/token`, "{not the token}");
    const rel = await r1.handle.release();
    assert.equal(rel.ok, false);
    if (rel.ok) return;
    assert.equal(rel.error.kind, "lease_replaced");
  } finally {
    await rmTmp(tmp);
  }
});

test("LEASE_CAP07 token file missing while W1 owns lease → release fails closed", async () => {
  const tmp = await mkTmp();
  try {
    const r1 = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-missing-tok"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    await fs.rm(`${tmp}/ledger-writer-owner/token`, { force: true });
    const rel = await r1.handle.release();
    assert.equal(rel.ok, false);
    if (rel.ok) return;
    assert.equal(rel.error.kind, "lease_replaced");
  } finally {
    await rmTmp(tmp);
  }
});
