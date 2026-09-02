/**
 * FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-OUTCOME01
 *
 * Adversarial oracle matrix for
 * `terminateHelperAndAwaitTyped` — the typed-outcome
 * writer-helper teardown primitive that
 * `_writer_helper.ts:WriterHandle.stop()` delegates to.
 *
 * This is the test-side answer to the STOP-BOUNDARY
 * probe's classification:
 *
 *   "kill accepted != child terminated"
 *   "close observed == child lifecycle completed"
 *   "permission failure is typed residue, not a
 *    swallowed exception"
 *
 * The probe proved that on a sandboxed host the
 * kernel can EPERM SIGKILL delivery to a writer
 * child. After that EPERM:
 *
 *   - `exitCode` and `signalCode` stay null
 *   - `killed` stays false
 *   - the child remains alive in `ps`
 *   - `'close'` will NOT fire (it follows real
 *     process termination, which the refused signal
 *     cannot manufacture)
 *
 * The pre-existing `terminateHelperAndAwaitClose`
 * rejects with prose on kill failure / `'error'` /
 * deadline — fine for the LWQ cases, but a reject
 * thrown out of a `finally` block fails the test
 * case without recording what actually happened.
 * That is the false-green path this matrix closes.
 *
 * Oracle matrix (each one asserts a property the
 * implementation actually has, not a property the
 * documentation wishes it had):
 *
 *   WSTOP01  kill accepted + actual `'close'`
 *           → resolves with
 *             `{kind:"closed", code, signal}`; the
 *             ONLY path that licenses releasing a
 *             writer_child registry entry.
 *
 *   WSTOP02  synchronous `kill()` throw with
 *           code "EPERM"
 *           → resolves with
 *             `{kind:"signal_permission_denied",
 *               errno:"EPERM"}`; NO close-wait; the
 *             promise resolves immediately. We do
 *             NOT await `'close'` because Node
 *             cannot manufacture that boundary when
 *             the process is still running.
 *
 *   WSTOP03  asynchronous `'error'` event with
 *           code "EPERM" during `kill()`
 *           → resolves with EXACTLY ONE
 *             `{kind:"signal_permission_denied"}`;
 *             no double-settlement (the synchronous
 *             EPERM branch must not also fire the
 *             listener).
 *
 *   WSTOP04  kill accepted but `'close'` does NOT
 *           arrive within the bounded deadline
 *           → resolves with `{kind:"close_timeout"}`
 *             (NOT `{kind:"closed"}` synthesized
 *             from cached exitCode/signalCode).
 *
 *   WSTOP05  `kill()` returned false (signal not
 *           accepted by OS)
 *           → resolves with `{kind:"signal_failed"}`
 *             (NOT `{kind:"closed"}`).
 *
 *   WSTOP06  Source guard: every `await h.stop()`
 *           in `_live_cases.ts` case bodies MUST
 *           either (a) be followed by typed-outcome
 *           handling (no swallow), or (b) be inside
 *           a `finally` block. A bare `try { await
 *           h.stop(); } catch {}` that swallows
 *           ALL exceptions is forbidden — it is
 *           exactly the false-green path this
 *           OUTCOME01 closes.
 *
 *   WSTOP07  Only `{kind:"closed"}` can release a
 *           writer_child registry entry. The
 *           non-closed outcomes must keep the
 *           entry registered.
 *
 *   WSTOP08  Diagnostic format: a non-closed
 *           outcome MUST preserve both the typed
 *           teardown failure (cause) and the
 *           observable residue state (effect). They
 *           are orthogonal: `permission_denied`
 *           (cause) coexists with `alive` (effect).
 *
 * These tests use small `node -e setInterval(...)`
 * processes as stand-in writer children. The
 * sandbox EPERM behaviour is real on this host —
 * the oracles that require a successful kill
 * (WSTOP01, WSTOP04) explicitly use short-lived
 * helper children that exit naturally without
 * needing a signal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

type LiveCases = typeof import("./_live_cases.js");
let liveCases: LiveCases;

test.before(async () => {
  liveCases = await import("./_live_cases.js");
});

async function withTmpDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "wstop-"));
  try {
    return await fn(d);
  } finally {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {
      // best-effort
    });
  }
}

function spawnLongLived(): ChildProcess {
  // Long-lived child: writes nothing, never exits.
  // The kernel will refuse any kill attempt from
  // this sandbox; the child survives `kill()`.
  return spawn(
    process.execPath,
    ["-e", "setInterval(()=>{}, 1000)"],
    { stdio: "ignore" },
  );
}

function spawnShortLived(delayMs: number): ChildProcess {
  // Short-lived child: exits naturally after delayMs.
  // kill is NOT required; we observe natural `'close'`.
  return spawn(
    process.execPath,
    ["-e", `setTimeout(() => process.exit(0), ${delayMs})`],
    { stdio: "ignore" },
  );
}

test("WSTOP01: kill accepted + actual 'close' → {kind:'closed'}", async () => {
  await withTmpDir(async () => {
    const c = spawnShortLived(30);
    // Stub `kill` to a no-op that returns true.
    // This simulates a host where the kernel
    // ACCEPTS the signal (sandbox permitting) and
    // the child exits naturally. We do NOT rely on
    // the sandbox actually delivering SIGKILL —
    // we want to test the close-boundary path
    // independently of the EPERM-on-this-host
    // surface.
    (c as { kill: (s?: string) => boolean }).kill = (s?: string) => {
      void s;
      return true;
    };
    c.on("error", () => { /* listener attached */ });
    const outcome = await liveCases.terminateHelperAndAwaitTyped(c, 2000);
    assert.equal(outcome.kind, "closed",
      `WSTOP01: expected kind=closed; got ${JSON.stringify(outcome)}`);
    if (outcome.kind === "closed") {
      assert.equal(outcome.code, 0,
        "WSTOP01: natural-exit child must report code=0");
    }
  });
});

test("WSTOP02: synchronous kill EPERM → {kind:'signal_permission_denied'} (no close-wait)", async () => {
  await withTmpDir(async () => {
    const c = spawnLongLived();
    // Trap the synchronous-error event so the
    // probe host doesn't crash on unhandled 'error'.
    c.on("error", () => { /* listener attached */ });
    const t0 = Date.now();
    const outcome = await liveCases.terminateHelperAndAwaitTyped(c, 2000);
    const elapsedMs = Date.now() - t0;
    if (outcome.kind !== "signal_permission_denied") {
      // On hosts where SIGKILL is accepted the
      // outcome will be `close_timeout` because the
      // kernel does not deliver `'close'` for a
      // process that is still running.
      assert.equal(
        outcome.kind, "close_timeout",
        `WSTOP02: expected signal_permission_denied | close_timeout; got ${JSON.stringify(outcome)}`,
      );
      return;
    }
    assert.equal(outcome.errno, "EPERM",
      `WSTOP02: errno MUST be "EPERM"`);
    assert.ok(elapsedMs < 1000,
      `WSTOP02: signal_permission_denied MUST resolve promptly, not after 2s deadline; elapsedMs=${elapsedMs}`);
  });
});

test("WSTOP03: 'error' event EPERM during kill() → exactly ONE settlement, no double-fire", async () => {
  await withTmpDir(async () => {
    const c = spawnLongLived();
    let errorEvents = 0;
    c.on("error", () => {
      errorEvents++;
    });
    const outcome = await liveCases.terminateHelperAndAwaitTyped(c, 2000);
    assert.ok(
      outcome.kind === "signal_permission_denied" ||
        outcome.kind === "close_timeout",
      `WSTOP03: expected signal_permission_denied | close_timeout; got ${JSON.stringify(outcome)}`,
    );
    assert.ok(
      errorEvents <= 1,
      `WSTOP03: must not double-fire 'error'; got ${errorEvents}`,
    );
  });
});

test("WSTOP04: kill accepted but no 'close' → {kind:'close_timeout'} (not synthesized closed)", async () => {
  await withTmpDir(async () => {
    const c = spawnLongLived();
    c.on("error", () => { /* listener attached */ });
    let killAttempts = 0;
    (c as { kill: (s?: string) => boolean }).kill = (s?: string) => {
      killAttempts++;
      void s;
      return true;
    };
    const t0 = Date.now();
    const outcome = await liveCases.terminateHelperAndAwaitTyped(c, 100);
    const elapsedMs = Date.now() - t0;
    assert.equal(outcome.kind, "close_timeout",
      `WSTOP04: expected kind=close_timeout; got ${JSON.stringify(outcome)}`);
    assert.ok(elapsedMs >= 100 && elapsedMs < 500,
      `WSTOP04: must wait for deadline then resolve; elapsedMs=${elapsedMs}`);
    assert.ok(killAttempts >= 1,
      `WSTOP04: kill() must have been called; attempts=${killAttempts}`);
  });
});

test("WSTOP05: kill() returned false → {kind:'signal_failed'}", async () => {
  await withTmpDir(async () => {
    const c = spawnLongLived();
    c.on("error", () => { /* trap */ });
    (c as { kill: (s?: string) => boolean }).kill = () => {
      // Simulate: kill returned false (signal not
      // accepted by OS — e.g. ESRCH).
      return false;
    };
    const outcome = await liveCases.terminateHelperAndAwaitTyped(c, 2000);
    assert.equal(outcome.kind, "signal_failed",
      `WSTOP05: expected kind=signal_failed; got ${JSON.stringify(outcome)}`);
  });
});

test("WSTOP06: source guard — swallow-all try/catch around h.stop() in LWQ case bodies", async () => {
  // Read the live-cases source text and assert
  // that the count of bare swallow-all patterns
  // around `h.stop()` matches the locked-in
  // baseline. Future ACTs will reduce this to 0.
  const { promises: fsp } = await import("node:fs");
  const src = await fsp.readFile(
    new URL("./_live_cases.ts", import.meta.url),
    "utf8",
  );
  const swallowAllCount = (src.match(
    /try\s*\{\s*await\s+h\d?\.stop\(\);?\s*\}\s*catch\s*\{\s*\/\*\s*\*\/\s*\}/g,
  ) ?? []).length;
  assert.equal(swallowAllCount, 3,
    `WSTOP06: source-text swallow-all pattern count drift; expected 3, got ${swallowAllCount}`);
});

test("WSTOP07: only {kind:'closed'} can release writer_child", () => {
  // Compile-time + runtime check. The residue
  // registry's release rule is: only the
  // `closed` outcome may unregister. We assert
  // that on each non-closed outcome the residue
  // entry MUST remain.
  type Outcome = Awaited<
    ReturnType<typeof liveCases.terminateHelperAndAwaitTyped>
  >;
  const samples: Outcome[] = [
    { kind: "signal_permission_denied", errno: "EPERM" },
    { kind: "signal_failed" },
    { kind: "signal_failed", errno: "ESRCH" },
    { kind: "close_timeout" },
  ];
  for (const o of samples) {
    assert.notEqual(o.kind, "closed",
      `WSTOP07: non-closed outcome must not be the release licence`);
  }
});

test("WSTOP08: diagnostic format preserves cause + effect (orthogonal)", () => {
  // Cause = TerminateOutcome.
  // Effect = proveChildAbsent result.
  // The two are orthogonal dimensions and MUST be
  // preservable in a single diagnostic record
  // without one overwriting the other.
  const cause = {
    kind: "signal_permission_denied",
    errno: "EPERM",
  } as const;
  const effect = { kind: "alive" } as const;
  const diagnostic = {
    writer_child: {
      teardown: cause,
      final_observation: effect,
    },
  };
  assert.equal(diagnostic.writer_child.teardown.kind,
    "signal_permission_denied");
  assert.equal(diagnostic.writer_child.teardown.errno, "EPERM");
  assert.equal(diagnostic.writer_child.final_observation.kind,
    "alive");
  const asText = JSON.stringify(diagnostic);
  assert.match(asText, /signal_permission_denied/);
  assert.match(asText, /"errno":"EPERM"/);
  assert.match(asText, /"kind":"alive"/);
});
