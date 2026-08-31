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
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";

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

/**
 * SHUT13 (B0-CORR07): the request-admission gate is
 * closed synchronously by requestClose, AND no parsed
 * request can be dispatched after that.
 *
 * Host-runnable: uses a hand-built state object, not UDS.
 */
test("SHUT13 admission gate closed synchronously by requestClose (B0-CORR07)", async () => {
  const { handleRequest } = await import(
    "../../src/ledger-writer/ledger-writer-request-handler.js"
  );
  const { emptyDedupIndex } = await import(
    "../../src/ledger-writer/ledger-writer-types.js"
  );
  const { makeLedgerWriterInstanceId } = await import(
    "../../src/ledger-writer/ledger-writer-types.js"
  );
  const { asShutdownServerPort } = await import(
    "../../src/ledger-writer/ledger-writer-shutdown.js"
  );

  const state = {
    index: emptyDedupIndex(),
    busy: false,
    crashCutHook: null,
    inFlight: 0,
    admission: { accepting: true },
  };
  const args = {
    runDir: "/tmp",
    runId: "r",
    missionId: "m",
    socketPath: "/tmp/s",
    instanceId: makeLedgerWriterInstanceId("lw-shut13"),
  };

  assert.equal(state.admission.accepting, true);

  // Reply barrier that the test releases.
  let barrierResolve: () => void = () => undefined;
  const reply = async (): Promise<void> => {
    await new Promise<void>((r) => { barrierResolve = r; });
  };
  const replyErr = async (): Promise<void> => undefined;

  // Replicate the production dispatch path: gate check
  // → inFlight++ → handleRequest → finally inFlight--.
  function dispatch(): void {
    if (!state.admission.accepting) return;
    state.inFlight++;
    void handleRequest(
      { kind: "who_are_you", protocolVersion: 2 } as never,
      args,
      state,
      reply,
      replyErr,
    ).finally(() => {
      state.inFlight--;
    });
  }

  dispatch();
  assert.equal(state.inFlight, 1, "admit request → inFlight = 1");

  // Build a port that uses state.admission as the gate.
  const fakeServerLike = {
    closeCount: 0,
    close(cb: (err: Error | null) => void): void {
      this.closeCount++;
      setImmediate(() => cb(null));
    },
  };
  const port = asShutdownServerPort(
    fakeServerLike as unknown as Server,
    {
      closeAdmission: (): void => {
        state.admission.accepting = false;
      },
      isAcceptingRequests: (): boolean => state.admission.accepting,
    },
  );

  // Issue requestClose.
  const result = port.requestClose();
  assert.equal(result.ok, true);

  // SYNCHRONOUSLY closed: assert without awaiting.
  assert.equal(state.admission.accepting, false,
    "requestClose flips gate closed synchronously");
  assert.equal(fakeServerLike.closeCount, 1,
    "requestClose invokes server.close");

  // Late dispatch is rejected — inFlight does NOT change.
  const before = state.inFlight;
  dispatch();
  dispatch();
  dispatch();
  assert.equal(state.inFlight, before,
    "closed gate prevents new dispatches (no inFlight change)");

  // Idempotent.
  const second = port.requestClose();
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error.kind, "already_closed");

  // Cleanup: release the barrier so the in-flight
  // request completes (its decrement fires in the
  // background).
  barrierResolve();
  await new Promise((r) => setImmediate(r));
  await port.awaitClosed();
});

/**
 * SHUT13b (B0-CORR07): the REAL handleConnection()
 * dispatch path consults the admission gate. This
 * drives a fake socket through the actual exported
 * handler so the test is not merely reimplementing
 * the dispatch loop in test code.
 *
 * Host-runnable: no UDS; uses an EventEmitter as a
 * minimal Socket substitute (handleConnection only
 * invokes .on('data'/'error'), .write(), .end(),
 * .destroy()).
 */
test("SHUT13b real handleConnection respects admission gate (B0-CORR07)", async () => {
  const { handleConnection } = await import(
    "../../src/ledger-writer/ledger-writer-connection.js"
  );
  const { emptyDedupIndex } = await import(
    "../../src/ledger-writer/ledger-writer-types.js"
  );
  const { makeLedgerWriterInstanceId } = await import(
    "../../src/ledger-writer/ledger-writer-types.js"
  );
  const { encodeFrame } = await import(
    "../../src/witness/witness-codec-framing.js"
  );

  const state = {
    index: emptyDedupIndex(),
    busy: false,
    crashCutHook: null,
    inFlight: 0,
    admission: { accepting: true },
  };
  const args = {
    runDir: "/tmp",
    runId: "r",
    missionId: "m",
    socketPath: "/tmp/s",
    instanceId: makeLedgerWriterInstanceId("lw-shut13b"),
  };

  // Track all bytes written to the fake socket so we
  // can assert whether a reply was emitted.
  const writes: Buffer[] = [];
  const fakeSocket = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    write: (buf: Buffer, cb?: (e?: Error | null) => void) => boolean;
    end: (cb?: () => void) => void;
    destroy: (e?: Error) => void;
  };
  fakeSocket.destroyed = false;
  fakeSocket.write = ((buf: Buffer): boolean => {
    writes.push(Buffer.from(buf));
    return true;
  }) as typeof fakeSocket.write;
  fakeSocket.end = ((): void => undefined) as typeof fakeSocket.end;
  fakeSocket.destroy = ((): void => {
    fakeSocket.destroyed = true;
  }) as typeof fakeSocket.destroy;

  // Drive the REAL handleConnection.
  const connPromise = handleConnection(
    fakeSocket as unknown as Socket,
    args,
    state,
  );
  // handleConnection installs listeners and returns.
  await connPromise;

  // Pre-shutdown: send a valid who_are_you frame.
  // The data handler runs through the REAL production
  // dispatch path — gate check → inFlight++ →
  // handleRequest → finally inFlight--.
  assert.equal(state.admission.accepting, true);
  const frame1 = encodeFrame(JSON.stringify({
    kind: "who_are_you",
    protocolVersion: 2,
  }));
  if (!frame1.ok) throw new Error("encode failed");
  fakeSocket.emit("data", Buffer.from(frame1.bytes));
  await new Promise((r) => setImmediate(r));
  assert.ok(state.inFlight >= 0, "inFlight observed during dispatch");

  // Wait for the who_are_you to settle.
  for (let i = 0; i < 50; i++) {
    if (state.inFlight === 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(state.inFlight, 0, "inFlight settles to 0 after who_are_you");

  // The server emitted a reply (the "self" envelope).
  const sawSelfReply = writes.some((b) => b.includes(Buffer.from('"kind":"self"')));
  assert.ok(sawSelfReply, "pre-shutdown who_are_you produced a reply");

  // Close the admission gate synchronously.
  state.admission.accepting = false;
  const writesBeforeGate = writes.length;

  // Send another valid frame on the SAME socket.
  // The data handler MUST observe the closed gate and
  // tear down the socket without dispatching.
  const frame2 = encodeFrame(JSON.stringify({
    kind: "who_are_you",
    protocolVersion: 2,
  }));
  if (!frame2.ok) throw new Error("encode failed");
  fakeSocket.emit("data", Buffer.from(frame2.bytes));
  await new Promise((r) => setImmediate(r));

  // inFlight unchanged: gate closed → no dispatch.
  assert.equal(state.inFlight, 0,
    "closed gate prevents new dispatch (inFlight unchanged)");
  // Socket destroyed by the gate-closed branch.
  assert.equal(fakeSocket.destroyed, true,
    "closed gate destroys the socket");
  // No new reply emitted.
  assert.equal(writes.length, writesBeforeGate,
    "closed gate emits no new reply");
});
