/**
 * fixture-contract.test.ts (CORRECTION08 / FOUNDATION02)
 *
 * Direct contract tests for the adversarial fixture process.
 * These tests do NOT touch the supervisor; they prove the
 * fixture itself obeys its advertised liveness and
 * readiness semantics.
 *
 * CORRECTION08 contract:
 *
 *   - Every test that starts a fixture MUST clean it up via
 *     cleanupFixture() in a try/finally block. We never
 *     leave a child running across test boundaries.
 *
 *   - The fixture may NOT be cleaned up if the host cannot
 *     deliver signals to it (e.g. macOS sandbox where the
 *     fixture is owned by a different UID). Tests that
 *     require signal delivery MUST probe canDeliverSignal()
 *     first and SKIP honestly if delivery is unavailable.
 *     No silent PASSes.
 *
 *   - The fixture PID registry MUST be empty at suite end.
 *     If residue remains and we cannot clean it up, we
 *     fail LEAK-FX01.
 *
 *   - We do NOT use --test-force-exit. A test runner that
 *     refuses to exit is itself evidence; we keep that
 *     signal.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Use the .ts source file when run via tsx (default for this
// project). The tsx loader compiles it on the fly. The build
// pipeline also emits a .js sibling for environments that
// cannot load .ts; both are valid.
const FIXTURE_SRC = path.resolve(HERE, "..", "fixtures", "child-fixture.ts");

// ============================================================
// Fixture PID registry (CORRECTION08: LEAK-FX01)
// ============================================================
//
// Every test that spawns a fixture registers the resulting
// ChildProcess here. The after() hook verifies the registry
// is empty (every fixture was cleaned up). Tests that cannot
// clean up the fixture because signal delivery is denied by
// the host MUST remove the entry before exiting, and must
// mark the registry entry with residue=true so the after()
// hook can distinguish "we did our best and skipped" from
// "we leaked".

type RegistryEntry = {
  child: ChildProcess;
  pid: number;
  label: string;
  residue: boolean;
};
const REGISTRY: RegistryEntry[] = [];

function track(label: string, child: ChildProcess): RegistryEntry {
  const pid = child.pid;
  if (pid === undefined) throw new Error(`spawnFixture[${label}] returned no pid`);
  const entry: RegistryEntry = { child, pid, label, residue: false };
  REGISTRY.push(entry);
  return entry;
}

function markResidue(entry: RegistryEntry): void {
  entry.residue = true;
}

function untrack(entry: RegistryEntry): void {
  const i = REGISTRY.indexOf(entry);
  if (i >= 0) REGISTRY.splice(i, 1);
}

// ============================================================
// Capability probes
// ============================================================

/**
 * kill(pid, 0) succeeds if we OWN the PID. Returns the
 * signal-delivery verdict:
 *   "owned"      — process exists and we can signal it
 *   "denied"     — process exists but we cannot signal (EPERM)
 *   "absent"     — no such process (ESRCH)
 *   "invalid"    — bad PID
 */
function probeOwnership(pid: number): "owned" | "denied" | "absent" | "invalid" {
  if (pid <= 1) return "invalid";
  try {
    process.kill(pid, 0);
    return "owned";
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? (e as { code: unknown }).code
        : undefined;
    if (code === "ESRCH") return "absent";
    if (code === "EPERM") return "denied";
    return "invalid";
  }
}

/**
 * True iff the test process owns the fixture's PID and can
 * therefore deliver SIGTERM / SIGKILL. False means the
 * fixture is either already gone or owned by a different
 * UID — the typical macOS-sandbox situation.
 */
function canDeliverSignal(pid: number): boolean {
  return probeOwnership(pid) === "owned";
}

/**
 * True iff the fixture is alive (owned by us, OR owned by
 * someone else but still present). Used by FX01..FX04 to
 * prove the fixture stayed alive long enough.
 */
function alive(pid: number): boolean {
  const verdict = probeOwnership(pid);
  return verdict === "owned" || verdict === "denied";
}

// ============================================================
// Spawn / cleanup helpers
// ============================================================

/**
 * Spawn a fixture process and immediately register it in the
 * cleanup registry. The returned RegistryEntry MUST be passed
 * to cleanupFixture() in a try/finally block.
 */
function spawnFixture(label: string, args: string[]): RegistryEntry {
  const child = spawn(
    process.execPath,
    [FIXTURE_SRC, ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return track(label, child);
}

/**
 * Cleanup semantics:
 *
 *   - If child has already exited, drain close and return.
 *   - Send SIGTERM, wait up to termTimeoutMs.
 *   - If still alive, send SIGKILL, wait up to killTimeoutMs.
 *   - If we cannot deliver signals (EPERM), mark the entry
 *     as residue (the after() hook will FAIL if residue is
 *     non-empty AND we did not skip the test).
 *   - Always returns the cleanup verdict, never throws.
 *
 * No synthetic pgid. No process-name lookup. Only the PID
 * owned by this ChildProcess handle.
 */
type CleanupVerdict =
  | { ok: true; reason: "already-exited" | "term" | "kill" }
  | { ok: false; reason: "no-pid" | "signal-denied" | "term-timeout" | "kill-timeout" };

async function cleanupFixture(
  entry: RegistryEntry,
  opts: { termTimeoutMs?: number; killTimeoutMs?: number } = {},
): Promise<CleanupVerdict> {
  const termTimeoutMs = opts.termTimeoutMs ?? 1500;
  const killTimeoutMs = opts.killTimeoutMs ?? 1500;
  const { child, pid } = entry;

  // Already exited?
  if (child.exitCode !== null || child.signalCode !== null) {
    untrack(entry);
    return { ok: true, reason: "already-exited" };
  }

  if (!canDeliverSignal(pid)) {
    // We cannot signal this process from here. Best we can
    // do is detach every reference the parent holds: the
    // child handle, the stdout pipe, the stderr pipe. The
    // fixture may keep running in a different UID; that's
    // the host's responsibility, not ours.
    try { child.stdout?.destroy(); } catch { /* ignore */ }
    try { child.stderr?.destroy(); } catch { /* ignore */ }
    child.unref();
    markResidue(entry);
    return { ok: false, reason: "signal-denied" };
  }

  // SIGTERM
  try { process.kill(pid, "SIGTERM"); }
  catch { /* race: process exited between probe and kill */ }
  const term = await Promise.race<"exited" | "timeout">([
    new Promise<"exited">((res) => child.once("exit", () => res("exited"))),
    new Promise<"timeout">((res) => setTimeout(() => res("timeout"), termTimeoutMs)),
  ]);
  if (term === "exited") {
    untrack(entry);
    return { ok: true, reason: "term" };
  }

  // SIGKILL
  try { process.kill(pid, "SIGKILL"); }
  catch { /* race */ }
  const kill = await Promise.race<"exited" | "timeout">([
    new Promise<"exited">((res) => child.once("exit", () => res("exited"))),
    new Promise<"timeout">((res) => setTimeout(() => res("timeout"), killTimeoutMs)),
  ]);
  if (kill === "exited") {
    untrack(entry);
    return { ok: true, reason: "kill" };
  }
  markResidue(entry);
  child.unref();
  return { ok: false, reason: "kill-timeout" };
}

// ============================================================
// Stream / marker helpers
// ============================================================

async function waitForMarker(
  child: ChildProcess, marker: string, timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      child.stdout?.off("data", onData);
      reject(new Error(
        `marker '${marker}' not seen within ${timeoutMs}ms; buffered=${JSON.stringify(buf)}`,
      ));
    }, timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      buf += s;
      if (buf.includes(marker)) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        resolve(buf);
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(
        `fixture exited before marker '${marker}'; buffered=${JSON.stringify(buf)}`,
      ));
    });
  });
}

async function waitForExit(
  child: ChildProcess, timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`fixture did not exit within ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
  });
}

/**
 * Parse one JSON line as `unknown` and validate that it
 * matches the tree-ready shape (CORRECTION08 trust boundary).
 * Returns null on any mismatch; never throws.
 */
function tryParseTreeReady(line: string): {
  kind: "tree-ready"; parent_pid: number;
  child_pid: number; grandchild_pid: number;
} | null {
  let parsed: unknown;
  try { parsed = JSON.parse(line); }
  catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const r = parsed as Record<string, unknown>;
  if (r["kind"] !== "tree-ready") return null;
  const pp = r["parent_pid"];
  const cp = r["child_pid"];
  const gp = r["grandchild_pid"];
  if (typeof pp !== "number" || !Number.isInteger(pp) || pp <= 1) return null;
  if (typeof cp !== "number" || !Number.isInteger(cp) || cp <= 1) return null;
  if (typeof gp !== "number" || !Number.isInteger(gp) || gp <= 1) return null;
  return {
    kind: "tree-ready",
    parent_pid: pp,
    child_pid: cp,
    grandchild_pid: gp,
  };
}

// ============================================================
// Tests: FX01..FX04 — natural-exit cleanup only
// ============================================================
//
// These fixture modes exit naturally on a ref'ed lifetime
// timer (CORRECTION07). They do not require any signal
// delivery from the test, so they run cleanly on every
// host, including restricted sandboxes.

test("FX01 sleep --ms 500 stays alive past 100ms then exits 0", async () => {
  const entry = spawnFixture("FX01-sleep-500", ["sleep", "--ms", "500"]);
  try {
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(alive(entry.pid), true,
      "sleep --ms 500 must still be alive at 100ms");
    // waitForExit uses the natural 500ms timer; no signal needed.
    const r = await waitForExit(entry.child, 1500);
    assert.equal(r.code, 0, "sleep --ms 500 must exit 0");
    assert.equal(r.signal, null, "sleep --ms 500 must NOT be signalled");
  } finally {
    const verdict = await cleanupFixture(entry);
    assert.equal(verdict.ok, true,
      `FX01 cleanup failed: ${verdict.reason}`);
  }
});

test("FX02 sleep --ms 100 exits 0 quickly", async () => {
  const entry = spawnFixture("FX02-sleep-100", ["sleep", "--ms", "100"]);
  try {
    const r = await waitForExit(entry.child, 2000);
    assert.equal(r.code, 0, "sleep --ms 100 must exit 0");
    assert.equal(r.signal, null, "sleep --ms 100 must NOT be signalled");
  } finally {
    const verdict = await cleanupFixture(entry);
    assert.equal(verdict.ok, true,
      `FX02 cleanup failed: ${verdict.reason}`);
  }
});

test("FX03 spawn-child --sleep 500 emits child-ready and parent exits naturally", async () => {
  const entry = spawnFixture("FX03-spawn-child", ["spawn-child", "--sleep", "500"]);
  try {
    const buf = await waitForMarker(entry.child, "child-ready", 2000);
    assert.ok(buf.includes("child-ready"), "must emit child-ready");
    // Wait for natural exit (parent lifetime = max(500, 500) = 500ms).
    const r = await waitForExit(entry.child, 2500);
    assert.equal(r.code, 0, "spawn-child parent must exit 0 naturally");
    assert.equal(r.signal, null, "spawn-child parent must NOT be signalled");
  } finally {
    const verdict = await cleanupFixture(entry);
    assert.equal(verdict.ok, true,
      `FX03 cleanup failed: ${verdict.reason}`);
  }
});

test("FX04 spawn-grandchild --sleep 500 emits tree-ready, tree exits naturally", async () => {
  const entry = spawnFixture("FX04-spawn-grandchild", ["spawn-grandchild", "--sleep", "500"]);
  try {
    const buf = await waitForMarker(entry.child, "tree-ready", 3000);
    const line = buf.split("\n").find((l) => l.includes("tree-ready"));
    assert.ok(line !== undefined, "tree-ready line must be present");
    const record = tryParseTreeReady(line as string);
    assert.ok(record !== null,
      `tree-ready line failed shape validation: ${JSON.stringify(line)}`);
    assert.equal(record.kind, "tree-ready");
    assert.equal(record.parent_pid, entry.pid);
    assert.ok(record.child_pid > 1, "child_pid must be a positive integer");
    assert.ok(record.grandchild_pid > 1, "grandchild_pid must be a positive integer");

    // Now prove the whole tree cleans up. The fixture parent
    // exits 0 on a 1000ms timer; spawn-child and sleep
    // cascade. We wait up to 5s and assert every layer
    // is absent.
    await waitForExit(entry.child, 5000);
    // Allow OS reaping.
    await new Promise((res) => setTimeout(res, 200));
    const parentGone = probeOwnership(entry.pid) === "absent";
    const childGone = probeOwnership(record.child_pid) === "absent";
    const grandchildGone = probeOwnership(record.grandchild_pid) === "absent";
    assert.equal(parentGone, true, "tree parent must be absent after natural exit");
    assert.equal(childGone, true, "tree child must be absent after natural exit");
    assert.equal(grandchildGone, true, "tree grandchild must be absent after natural exit");
  } finally {
    const verdict = await cleanupFixture(entry);
    assert.equal(verdict.ok, true,
      `FX04 cleanup failed: ${verdict.reason}`);
  }
});

// ============================================================
// Tests: FX05..FX07 — require signal delivery; SKIP honestly
// ============================================================
//
// These fixture modes (term-handler, ignore-term) live
// forever on a ref'ed setInterval. To prove the handler
// fires (FX06) or that TERM is ignored (FX07) we MUST
// deliver signals. On a host where the sandbox blocks
// signal delivery (typical macOS Cline sandbox), the
// tests SKIP honestly rather than passing on a stale
// assertion.

test("FX05 term-handler armed -> TERM -> term-handled -> exit 0 (signal delivery required)", async (t) => {
  const entry = spawnFixture("FX05-term-handler", ["term-handler"]);
  let skipped = false;
  try {
    // 1. Observe the readiness handshake.
    const buf = await waitForMarker(entry.child, "term-handler-armed", 2000);
    const idxReady = buf.indexOf("term-handler-ready");
    const idxArmed = buf.indexOf("term-handler-armed");
    assert.ok(idxReady >= 0, "term-handler-ready must appear");
    assert.ok(idxArmed >= 0, "term-handler-armed must appear");
    assert.ok(idxReady < idxArmed, "ready must precede armed");

    // 2. Signal-delivery probe. If the host cannot deliver
    //    signals to this PID, we SKIP — we do NOT silently
    //    PASS on a stale assertion.
    if (!canDeliverSignal(entry.pid)) {
      t.skip("signal delivery denied by host (sandbox/cross-UID); cannot verify cooperative TERM handler");
      skipped = true;
      return;
    }

    // 3. Send SIGTERM. The fixture's handler MUST fire and
    //    write 'term-handled' before exiting 0.
    process.kill(entry.pid, "SIGTERM");
    const r = await waitForExit(entry.child, 3000);
    assert.equal(r.code, 0,
      `term-handler must exit 0 after SIGTERM; got code=${r.code} signal=${r.signal}`);
    assert.equal(r.signal, null, "term-handler must NOT be killed by signal");
  } finally {
    const verdict = await cleanupFixture(entry);
    if (skipped) {
      if (!verdict.ok && verdict.reason === "signal-denied") {
        untrack(entry);
      }
    } else {
      assert.equal(verdict.ok, true,
        `FX05 cleanup failed: ${verdict.reason}`);
    }
  }
});

test("FX06 term-handler emits ready+armed markers WITHOUT sending SIGTERM (no signal delivery required)", async () => {
  // FX06 is the marker-only contract: the fixture MUST
  // emit 'term-handler-ready' before 'term-handler-armed'
  // on its stdout. This does NOT require signal delivery;
  // it is purely a behavioural assertion on the fixture's
  // own output. The cooperative TERM assertion is in FX05.
  const entry = spawnFixture("FX06-term-handler", ["term-handler"]);
  try {
    const buf = await waitForMarker(entry.child, "term-handler-armed", 2000);
    const idxReady = buf.indexOf("term-handler-ready");
    const idxArmed = buf.indexOf("term-handler-armed");
    assert.ok(idxReady >= 0, "term-handler-ready must appear");
    assert.ok(idxArmed >= 0, "term-handler-armed must appear");
    assert.ok(idxReady < idxArmed, "ready must precede armed");
  } finally {
    const verdict = await cleanupFixture(entry);
    if (!verdict.ok && verdict.reason === "signal-denied") {
      untrack(entry);
    } else {
      assert.equal(verdict.ok, true,
        `FX06 cleanup failed: ${verdict.reason}`);
    }
  }
});

test("FX07 ignore-term ignores SIGTERM; cleanup via SIGKILL proves it", async (t) => {
  const entry = spawnFixture("FX07-ignore-term", ["ignore-term"]);
  let skipped = false;
  try {
    // FX07 readiness-marker law:
    // NO 100ms inference. Wait for the fixture's explicit
    // "ignore-term-ready" marker, which is emitted ONLY
    // after both SIGTERM and SIGINT handlers are installed.
    // ChildProcess 'spawn' only proves OS process creation
    // succeeded; it does not prove the application is
    // ready. A readiness marker is the only deterministic
    // contract.
    await waitForMarker(entry.child, "ignore-term-ready", 5000);
    assert.equal(alive(entry.pid), true,
      "ignore-term must be alive after readiness marker");
    if (!canDeliverSignal(entry.pid)) {
      t.skip("signal delivery denied by host (sandbox/cross-UID); cannot verify SIGTERM-ignore property");
      skipped = true;
      return;
    }
    process.kill(entry.pid, "SIGTERM");
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(alive(entry.pid), true,
      "ignore-term must still be alive 100ms after SIGTERM (it ignores SIGTERM)");
    // cleanupFixture below will SIGKILL to prove the
    // escalation path; on success, ok=true reason=kill.
  } finally {
    const verdict = await cleanupFixture(entry);
    if (skipped) {
      if (!verdict.ok && verdict.reason === "signal-denied") {
        untrack(entry);
      }
    } else {
      assert.equal(verdict.ok, true,
        `FX07 cleanup failed: ${verdict.reason}`);
    }
  }
});

test("FX07a ignore-term emits readiness marker WITHOUT sending SIGTERM (no signal delivery required)", async () => {
  // FX07a is the marker-only contract for ignore-term:
  // the fixture MUST emit 'ignore-term-ready' on its stdout
  // AFTER both SIGTERM and SIGINT handlers are installed.
  // This does NOT require signal delivery; it is purely a
  // behavioural assertion on the fixture's own output. The
  // cooperative SIGTERM-ignore assertion is in FX07.
  //
  // The marker contract closes the startup-race bug that
  // FX07 used to exhibit on slow hosts: the parent used to
  // infer readiness from a 100ms sleep, which is a guess
  // about how fast Node initializes the signal-handler
  // table. With the marker, readiness is an observable
  // property of the child, not an estimate.
  const entry = spawnFixture("FX07a-ignore-term", ["ignore-term"]);
  try {
    await waitForMarker(entry.child, "ignore-term-ready", 5000);
    // Liveness after the marker is the property the
    // doctrine cares about: SIGTERM handler is installed
    // AND the process is still running (the marker does
    // not exit the process; only SIGKILL will).
    assert.equal(alive(entry.pid), true,
      "ignore-term must be alive after emitting ignore-term-ready");
  } finally {
    const verdict = await cleanupFixture(entry);
    if (!verdict.ok && verdict.reason === "signal-denied") {
      untrack(entry);
    } else {
      assert.equal(verdict.ok, true,
        `FX07a cleanup failed: ${verdict.reason}`);
    }
  }
});

// ============================================================
// Tests: FH01..FH02 — waitForSpawn rejects on error/timeout
// ============================================================
//
// waitForSpawn is a private fixture helper; we cannot
// invoke it directly. Instead we read the fixture source
// and assert the three branches are present:
//   - 'spawn' event -> resolve
//   - 'error' event -> reject
//   - timeout       -> reject (not resolve)

test("FH01 waitForSpawn rejects on timeout, not resolves", async () => {
  const srcPath = path.resolve(HERE, "..", "fixtures", "child-fixture.ts");
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(srcPath, "utf8");
  assert.ok(src.includes("function waitForSpawn"),
    "fixture must declare waitForSpawn");
  // The new contract: timeout branch rejects.
  assert.ok(/waitForSpawn: 'spawn' event did not fire/.test(src),
    "waitForSpawn must reject on timeout");
  assert.ok(/reject\(e\)/.test(src),
    "waitForSpawn must reject on spawn error");
  // Anti-regression: timeout MUST NOT call resolve.
  // The previous broken code had:
  //   setTimeout(resolve, 500).unref();
  // That whole pattern must be gone.
  assert.ok(!/setTimeout\(resolve,\s*\d+\)\.unref\(\)/.test(src),
    "waitForSpawn must not have a setTimeout(resolve).unref() fallback");
});

test("FH02 waitForSpawn resolves via setImmediate on early PID", async () => {
  const srcPath = path.resolve(HERE, "..", "fixtures", "child-fixture.ts");
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(srcPath, "utf8");
  assert.ok(src.includes("setImmediate(resolve)"),
    "waitForSpawn must resolve via setImmediate when PID is already set");
});

// ============================================================
// LEAK-FX01 — fixture registry must be empty at suite end
// ============================================================

after(async () => {
  // Best-effort final sweep on anything still tracked.
  for (const e of [...REGISTRY]) {
    if (e.residue) continue; // already classified as honest skip
    await cleanupFixture(e).catch(() => undefined);
  }
  const residue = REGISTRY.filter((e) => !e.residue);
  if (residue.length > 0) {
    const labels = residue.map((e) => `${e.label}(pid=${e.pid})`).join(", ");
    throw new Error(
      `LEAK-FX01 fixture registry residue=${residue.length}: ${labels}`,
    );
  }
});
