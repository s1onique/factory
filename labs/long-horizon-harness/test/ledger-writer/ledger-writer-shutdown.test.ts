/**
 * FOUNDATION04 — B0-CORR04 + B0-CORR05 — Real shutdown
 * state-machine tests (SHUT01..SHUT10).
 *
 * These tests exercise the production
 * shutdownLedgerWriter() operation against real
 * ShutdownServerPort / ShutdownClockPort adapters. They
 * do NOT depend on signal handlers or process-level
 * effects.
 *
 * Doctrine (B0-CORR04):
 *   **Qualification-oracle fidelity law:** a test named
 *   for a lifecycle property must exercise the production
 *   lifecycle that owns that property.
 *
 * Doctrine (B0-CORR05):
 *   **Admission-closure law:** graceful shutdown begins
 *   by preventing new work from entering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  acquireLedgerWriterLease,
  isLeaseHeld,
} from "../../src/ledger-writer/ledger-writer-lease.js";
import {
  shutdownLedgerWriter,
  asShutdownServerPort,
  realShutdownClockPort,
  type ShutdownServerPort,
  type ShutdownClockPort,
} from "../../src/ledger-writer/ledger-writer-shutdown.js";
import { makeLedgerWriterInstanceId } from "../../src/ledger-writer/ledger-writer-types.js";
import type { Server } from "node:net";

function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(process.cwd(), ".lw-shut-"));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Test clock that lets us advance virtual time. Each
 * tick advances by tickMs.
 */
function testClock(tickMs = 50): ShutdownClockPort {
  return {
    sleep: (ms: number): Promise<void> => {
      const ticks = Math.max(1, Math.ceil(ms / tickMs));
      let i = 0;
      return new Promise((r) => {
        const advance = (): void => {
          i++;
          if (i >= ticks) r();
          else setImmediate(advance);
        };
        advance();
      });
    },
  };
}

async function acquireLeaseAndHandle(
  runDir: string,
): Promise<{
  releaseCalls: { count: number };
  release: () => Promise<{ readonly ok: boolean }>;
}> {
  const r = await acquireLedgerWriterLease({
    runDir,
    instanceId: makeLedgerWriterInstanceId(`lw-shut-${Date.now()}`),
    runId: "r",
    missionId: "m",
  });
  if (!r.ok) {
    throw new Error(`could not acquire lease: ${JSON.stringify(r.error)}`);
  }
  const releaseCalls = { count: 0 };
  const release = async (): Promise<{ readonly ok: boolean }> => {
    releaseCalls.count++;
    const rel = await r.handle.release();
    return { ok: rel.ok };
  };
  return { releaseCalls, release };
}

function fakeServer(
  behavior: "instant" | "hang" | "throw",
): ShutdownServerPort & {
  readonly calls: { readonly closeCount: number };
  readonly admission: { isOpen: boolean };
} {
  const calls = { closeCount: 0 };
  const admission = { isOpen: true };
  let closeResolve: ((v?: unknown) => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    closeResolve = resolve as (v?: unknown) => void;
  });
  return {
    calls,
    admission,
    requestClose: (): { readonly ok: true } | { readonly ok: false; readonly error: { readonly kind: "already_closed" } | { readonly kind: "io_error"; readonly message: string } } => {
      calls.closeCount++;
      if (!admission.isOpen) {
        return { ok: false, error: { kind: "already_closed" } };
      }
      admission.isOpen = false;
      if (behavior === "throw") {
        return {
          ok: false,
          error: { kind: "io_error", message: "simulated close failure" },
        };
      }
      // Schedule close-boundary settlement.
      if (behavior === "instant") {
        queueMicrotask(() => {
          if (closeResolve !== null) closeResolve();
        });
      }
      return { ok: true };
    },
    awaitClosed: async (): Promise<void> => {
      if (behavior === "throw") {
        throw new Error("simulated close failure");
      }
      if (behavior === "hang") {
        await new Promise<never>(() => undefined);
      }
      await closed;
    },
  };
}

test("SHUT01 in-flight append blocks release; release succeeds after drain", async () => {
  const tmp = await mkTmp();
  try {
    const { releaseCalls, release } = await acquireLeaseAndHandle(tmp);
    const server = fakeServer("instant");
    let drainResolve: ((v: void | undefined) => void) | null = null;
    let drainCalled = false;
    const waitForInFlight = (): Promise<void> => {
      drainCalled = true;
      return new Promise<void>((resolve) => {
        drainResolve = resolve as unknown as (v: void | undefined) => void;
      });
    };
    const shutdownPromise = shutdownLedgerWriter({
      server,
      waitForInFlight,
      leaseHandle: { release },
      drainDeadlineMs: 5000,
      closeDeadlineMs: 5000,
      leaseReleaseDeadlineMs: 5000,
      clock: realShutdownClockPort,
    });
    while (!drainCalled) {
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(
      releaseCalls.count,
      0,
      "lease must not be released during drain",
    );
    if (drainResolve === null) {
      throw new Error("drainResolve never set");
    }
    (drainResolve as () => void)();
    const result = await shutdownPromise;
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.phase, "shutdown_verified");
    }
    assert.equal(releaseCalls.count, 1);
    assert.equal(server.calls.closeCount, 1);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, false);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT02 drain timeout retains lease; release count = 0", async () => {
  const tmp = await mkTmp();
  try {
    const { releaseCalls, release } = await acquireLeaseAndHandle(tmp);
    const server = fakeServer("instant");
    const waitForInFlight = (): Promise<void> =>
      new Promise<void>(() => undefined);
    const result = await shutdownLedgerWriter({
      server,
      waitForInFlight,
      leaseHandle: { release },
      drainDeadlineMs: 100,
      closeDeadlineMs: 100,
      leaseReleaseDeadlineMs: 100,
      clock: testClock(10),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.phase, "drain_timeout");
    }
    assert.equal(releaseCalls.count, 0);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT03 close timeout retains lease; release count = 0", async () => {
  const tmp = await mkTmp();
  try {
    const { releaseCalls, release } = await acquireLeaseAndHandle(tmp);
    const server = fakeServer("hang");
    const result = await shutdownLedgerWriter({
      server,
      waitForInFlight: async (): Promise<void> => undefined,
      leaseHandle: { release },
      drainDeadlineMs: 100,
      closeDeadlineMs: 100,
      leaseReleaseDeadlineMs: 100,
      clock: testClock(10),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.phase, "close_timeout");
    }
    assert.equal(releaseCalls.count, 0);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT04 close failure retains lease; release count = 0", async () => {
  const tmp = await mkTmp();
  try {
    const { releaseCalls, release } = await acquireLeaseAndHandle(tmp);
    // A server whose awaitClosed rejects simulates a close
    // failure at the boundary.
    let admission = true;
    const server = {
      requestClose: (): { readonly ok: true } => {
        admission = false;
        return { ok: true };
      },
      awaitClosed: async (): Promise<void> => {
        throw new Error("simulated close failure");
      },
      admission: { get isOpen(): boolean { return admission; } },
    };
    const result = await shutdownLedgerWriter({
      server: server as unknown as ShutdownServerPort,
      waitForInFlight: async (): Promise<void> => undefined,
      leaseHandle: { release },
      drainDeadlineMs: 5000,
      closeDeadlineMs: 5000,
      leaseReleaseDeadlineMs: 5000,
      clock: realShutdownClockPort,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.phase, "close_failed");
    }
    assert.equal(releaseCalls.count, 0);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT05 shutdown verifies through LeaseHandle (single runtime release authority)", async () => {
  const tmp = await mkTmp();
  try {
    const r = await acquireLedgerWriterLease({
      runDir: tmp,
      instanceId: makeLedgerWriterInstanceId("lw-shut05"),
      runId: "r",
      missionId: "m",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    let releaseCalls = 0;
    const release = async (): Promise<{ readonly ok: boolean }> => {
      releaseCalls++;
      const rel = await r.handle.release();
      return { ok: rel.ok };
    };
    const server = fakeServer("instant");
    const result = await shutdownLedgerWriter({
      server,
      waitForInFlight: async (): Promise<void> => undefined,
      leaseHandle: { release },
      drainDeadlineMs: 5000,
      closeDeadlineMs: 5000,
      leaseReleaseDeadlineMs: 5000,
      clock: realShutdownClockPort,
    });
    assert.equal(result.ok, true);
    assert.equal(releaseCalls, 1);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, false);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT06 asShutdownServerPort wraps net.Server.close callback", async () => {
  const tmp = await mkTmp();
  try {
    const { releaseCalls, release } = await acquireLeaseAndHandle(tmp);
    const fakeServerLike = {
      closeCount: 0,
      close(cb: (err: Error | null) => void): void {
        this.closeCount++;
        setImmediate(() => cb(null));
      },
    };
    const port = asShutdownServerPort(fakeServerLike as unknown as Server);
    const result = await shutdownLedgerWriter({
      server: port,
      waitForInFlight: async (): Promise<void> => undefined,
      leaseHandle: { release },
      drainDeadlineMs: 200,
      closeDeadlineMs: 200,
      leaseReleaseDeadlineMs: 200,
      clock: realShutdownClockPort,
    });
    assert.equal(result.ok, true);
    assert.equal(fakeServerLike.closeCount, 1);
    assert.equal(releaseCalls.count, 1);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT08 requestClose stops admission synchronously (B0-CORR05 §2)", async () => {
  const tmp = await mkTmp();
  try {
    const { release } = await acquireLeaseAndHandle(tmp);
    // Construct a custom server so we can observe the
    // synchronous requestClose BEFORE the full shutdown.
    let closeResolve: ((v?: unknown) => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      closeResolve = resolve as (v?: unknown) => void;
    });
    const admission = { isOpen: true };
    const port = {
      admission,
      requestClose: (): { readonly ok: true } => {
        admission.isOpen = false;
        queueMicrotask(() => {
          if (closeResolve !== null) closeResolve();
        });
        return { ok: true };
      },
      awaitClosed: async (): Promise<void> => {
        await closed;
      },
    };
    assert.equal(admission.isOpen, true, "admission open before shutdown");
    // Race the synchronous requestClose against a probe
    // that asserts admission is closed immediately after.
    const result = await shutdownLedgerWriter({
      server: port,
      waitForInFlight: async (): Promise<void> => undefined,
      leaseHandle: { release },
      drainDeadlineMs: 5000,
      closeDeadlineMs: 5000,
      leaseReleaseDeadlineMs: 5000,
      clock: realShutdownClockPort,
    });
    assert.equal(result.ok, true);
    assert.equal(admission.isOpen, false);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT09 second requestClose returns already_closed (B0-CORR05 §3)", async () => {
  const tmp = await mkTmp();
  try {
    await acquireLeaseAndHandle(tmp);
    const server = fakeServer("instant");
    const first = server.requestClose();
    assert.equal(first.ok, true);
    const second = server.requestClose();
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.error.kind, "already_closed");
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT10 admission_not_closable retains lease (B0-CORR05 §2)", async () => {
  const tmp = await mkTmp();
  try {
    const { releaseCalls, release } = await acquireLeaseAndHandle(tmp);
    const server = fakeServer("throw");
    const result = await shutdownLedgerWriter({
      server,
      waitForInFlight: async (): Promise<void> => undefined,
      leaseHandle: { release },
      drainDeadlineMs: 200,
      closeDeadlineMs: 200,
      leaseReleaseDeadlineMs: 200,
      clock: realShutdownClockPort,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.phase, "admission_not_closable");
    assert.equal(releaseCalls.count, 0);
    const held = await isLeaseHeld(tmp);
    assert.equal(held.held, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("SHUT11 asShutdownServerPort rejects double requestClose", async () => {
  const tmp = await mkTmp();
  try {
    const fakeServerLike = {
      closeCount: 0,
      close(cb: (err: Error | null) => void): void {
        this.closeCount++;
        setImmediate(() => cb(null));
      },
    };
    const port = asShutdownServerPort(fakeServerLike as unknown as Server);
    const first = port.requestClose();
    assert.equal(first.ok, true);
    const second = port.requestClose();
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.error.kind, "already_closed");
    // Only the first requestClose called server.close.
    assert.equal(fakeServerLike.closeCount, 1);
    await port.awaitClosed();
  } finally {
    await rmTmp(tmp);
  }
});
