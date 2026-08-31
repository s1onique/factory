/**
 * FOUNDATION04 — B0-CORR05 — Socket probe + bind policy.
 *
 * Doctrine:
 *   **Endpoint-uncertainty law:** possession of
 *   filesystem authority does not prove death of an
 *   independently live kernel endpoint.
 *
 * The probe is the authority on whether the listener at a
 * UDS path is a live writer. Three outcomes:
 *
 *   - absent → safe to bind.
 *   - live_writer_present → refuse to bind.
 *   - unknown_socket (WHO timeout / malformed) →
 *     `startWriterServer()` returns path_collision and
 *     does NOT unlink. This is the B0-CORR05 §8 contract.
 *
 * Path-classification tests (SOCK01..SOCK04) cover the
 * absent / file / directory / symlink cases that the
 * probe short-circuits before any connect attempt. The
 * WHO-roundtrip cases (SOCK05, SOCK06) require a live
 * UDS listener and are exercised in production via the
 * spawned-writer RPC tests under RPC01..03 (those run
 * under a child process where Node 26.0.0's
 * AsyncHooks-on-uds bug does not fire).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { probeSocketPath } from "../../src/ledger-writer/ledger-writer-socket-probe.js";

function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(process.cwd(), ".lw-sock-"));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

test("SOCK01 absent path → absent (B0-CORR05 §12)", async () => {
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "nope.sock");
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, true);
    if (!probe.ok) return;
    assert.equal(probe.value, "absent");
  } finally {
    await rmTmp(tmp);
  }
});

test("SOCK02 regular file at path → path_collision (B0-CORR05 §8)", async () => {
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "not-a-sock");
    await fs.writeFile(sp, "regular file");
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.error.kind, "path_collision");
  } finally {
    await rmTmp(tmp);
  }
});

test("SOCK03 directory at path → path_collision (B0-CORR05 §8)", async () => {
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "subdir");
    await fs.mkdir(sp);
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.error.kind, "path_collision");
  } finally {
    await rmTmp(tmp);
  }
});

test("SOCK04 symlink at path → path_collision (B0-CORR05 §8)", async () => {
  const tmp = await mkTmp();
  try {
    const target = path.join(tmp, "real-sock");
    const link = path.join(tmp, "link-sock");
    await fs.writeFile(target, "x");
    await fs.symlink(target, link);
    const probe = await probeSocketPath(link);
    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.error.kind, "path_collision");
  } finally {
    await rmTmp(tmp);
  }
});
