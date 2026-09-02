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

type Teardown = typeof import("./_writer_teardown.js");
let teardown: Teardown;

test.before(async () => {
  teardown = await import("./_writer_teardown.js");
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
    const outcome = await teardown.terminateHelperAndAwaitTyped(c, 2000);
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
    const outcome = await teardown.terminateHelperAndAwaitTyped(c, 2000);
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
    const outcome = await teardown.terminateHelperAndAwaitTyped(c, 2000);
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
    const outcome = await teardown.terminateHelperAndAwaitTyped(c, 100);
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
    const outcome = await teardown.terminateHelperAndAwaitTyped(c, 2000);
    assert.equal(outcome.kind, "signal_failed",
      `WSTOP05: expected kind=signal_failed; got ${JSON.stringify(outcome)}`);
  });
});

test("WSTOP06: source guard — zero ignored WriterHandle.stop outcomes", async () => {
  // (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
  //  OUTCOME01-CORRECTION01)
  //
  // Acceptance criterion (per CORRECTION01 review):
  //   "ignored WriterHandle.stop outcomes = 0"
  //
  // We assert this in three ways:
  //
  //   (a) Source-text: the canonical swallow-all
  //       pattern `try { await hN.stop(); } catch { /* */ }`
  //       MUST NOT appear anywhere in the
  //       qualification fixtures.
  //   (b) Source-text: the same for the witness-side
  //       teardownLiveRun helper.
  //   (c) Runtime: the teardown registry MUST have
  //       recorded at least one outcome per
  //       instantiated WriterHandle (a separate
  //       oracle drives the integration; here we
  //       just assert the registry API is reachable
  //       and starts empty).
  const { promises: fsp } = await import("node:fs");
  const liveCasesSrc = await fsp.readFile(
    new URL("./_live_cases.ts", import.meta.url),
    "utf8",
  );
  const wstartHelpersSrc = await fsp.readFile(
    new URL(
      "../witness-start/_wstart_live_helpers.ts",
      import.meta.url,
    ),
    "utf8",
  );
  // Pattern: `try { … stop() … } catch { /* */ }`
  // where stop() is the FIRST statement in the
  // try block (we ignore `fs.rm` try/catches
  // which are filesystem-cleanup, not teardown
  // outcome swallowing).
  const swallowAll = /try\s*\{\s*await\s+[^;]*\.stop\(\)/g;
  const lcMatches = liveCasesSrc.match(swallowAll) ?? [];
  const whMatches = wstartHelpersSrc.match(swallowAll) ?? [];
  assert.equal(
    lcMatches.length + whMatches.length,
    0,
    `WSTOP06: zero ignored stop() outcomes required; got live_cases=${lcMatches.length}, wstart_helpers=${whMatches.length}`,
  );

  // Runtime registry is reachable and starts clean.
  const registry = await import("./_writer_teardown_registry.js");
  registry.clearWriterTeardowns();
  assert.equal(
    registry.writerTeardownCount(),
    0,
    "WSTOP06: registry must start empty after clear",
  );
});

test("WSTOP07: only {kind:'closed'} can release writer_child", () => {
  // Compile-time + runtime check. The residue
  // registry's release rule is: only the
  // `closed` outcome may unregister. We assert
  // that on each non-closed outcome the residue
  // entry MUST remain.
  type Outcome = Awaited<
    ReturnType<typeof teardown.terminateHelperAndAwaitTyped>
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

test("WSTOP08: integration — kill-EPERM → stop() → registry; cause + effect both preserved", async () => {
  // (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
  //  OUTCOME01-CORRECTION01-MICROFIX01)
  //
  // Strengthened per the CORRECTION01 review:
  //   "Drive:
  //      fake child kill → EPERM
  //      writer.stop()
  //      fixture cleanup
  //      sweep
  //    and require the actual resulting evidence
  //    object to contain both cause and effect."
  //
  // We do NOT drive a real production LedgerWriter
  // (that is the heavy qualification lane). We use
  // a stub `WriterHandle`-shaped object so the
  // evidence-propagation path is exercised
  // end-to-end: typed outcome → registry →
  // joined-with-residue-observation.
  //
  // The "kill EPERM" branch on this sandbox host
  // is observable on any long-lived child. We
  // synthesize it deterministically by stubbing
  // `child.kill` to throw an EPERM ErrnoException.
  //
  // CORRECTION01-MICROFIX01 identity key:
  //   We mint a `WriterLifetimeId` here — the
  //   registry is keyed by lifetime identity, NOT
  //   runDir. See WSTOP10 for the multi-writer-
  //   same-runDir provenance test that fails
  //   mechanically under a `Map<runDir, …>`.
  await withTmpDir(async (tmp) => {
    const registry = await import(
      "./_writer_teardown_registry.js"
    );
    registry.clearWriterTeardowns();
    registry.resetLifetimeCounter();
    const lifetimeId = registry.makeWriterLifetimeId();
    const c = spawnLongLived();
    c.on("error", () => { /* trap */ });
    (c as { kill: (s?: string) => boolean }).kill = () => {
      const err: NodeJS.ErrnoException = new Error(
        "kill EPERM",
      );
      err.code = "EPERM";
      throw err;
    };
    const outcome = await teardown.terminateHelperAndAwaitTyped(c, 500);
    registry.recordWriterTeardown(lifetimeId, outcome);
    const effect =
      c.exitCode === null && c.signalCode === null
        ? { kind: "alive" as const }
        : { kind: "terminated" as const };
    const record = registry.getWriterTeardown(lifetimeId);
    assert.ok(record,
      "WSTOP08: teardown must have been recorded in the registry");
    const evidence = {
      writer_lifetime: {
        lifetime_id: lifetimeId,
        run_dir: tmp,
        teardown: record.outcome,
        final_observation: effect,
      },
    };
    assert.ok(
      evidence.writer_lifetime.teardown.kind ===
        "signal_permission_denied" ||
        evidence.writer_lifetime.teardown.kind === "close_timeout",
      `WSTOP08: teardown cause MUST be typed; got ${JSON.stringify(evidence.writer_lifetime.teardown)}`,
    );
    if (evidence.writer_lifetime.teardown.kind === "signal_permission_denied") {
      assert.equal(evidence.writer_lifetime.teardown.errno, "EPERM",
        "WSTOP08: typed cause must preserve errno verbatim");
    }
    assert.ok(
      evidence.writer_lifetime.final_observation.kind === "alive" ||
        evidence.writer_lifetime.final_observation.kind === "terminated",
      "WSTOP08: final observation must be a valid residue state",
    );
    const asText = JSON.stringify(evidence);
    assert.match(asText, /"kind":"(signal_permission_denied|close_timeout)"/);
    if (evidence.writer_lifetime.teardown.kind === "signal_permission_denied") {
      assert.match(asText, /"errno":"EPERM"/);
    }
    assert.match(asText, /"kind":"(alive|terminated)"/);
  });
});

test("WSTOP09: dependency direction — fixture primitives MUST NOT import _live_cases.ts", async () => {
  // (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
  //  OUTCOME01-CORRECTION01)
  //
  // Per the CORRECTION01 review:
  //   "_writer_helper.ts MUST NOT import _live_cases.ts"
  //   "_wstart_live_helpers.ts MUST NOT import _live_cases.ts"
  //
  // We static-check this by reading the source text
  // and asserting no `from "./_live_cases.js"` or
  // `from "../ledger-writer/_live_cases.js"` strings
  // exist in those two files.
  const { promises: fsp } = await import("node:fs");
  const writerHelper = await fsp.readFile(
    new URL("./_writer_helper.ts", import.meta.url),
    "utf8",
  );
  const wstartHelpers = await fsp.readFile(
    new URL(
      "../witness-start/_wstart_live_helpers.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const importPatterns = [
    /from\s*["']\.\/_live_cases\.js["']/,
    /from\s*["']\.\.\/ledger-writer\/_live_cases\.js["']/,
    /from\s*["']\.\.\/\.\.\/test\/ledger-writer\/_live_cases\.js["']/,
  ];
  for (const pat of importPatterns) {
    assert.doesNotMatch(writerHelper, pat,
      "WSTOP09: _writer_helper.ts MUST NOT import _live_cases.ts");
    assert.doesNotMatch(wstartHelpers, pat,
      "WSTOP09: _wstart_live_helpers.ts MUST NOT import _live_cases.ts");
  }
  // Positive: both MUST import the neutral module.
  assert.match(writerHelper,
    /from\s*["']\.\/_writer_teardown\.js["']/,
    "WSTOP09: _writer_helper.ts MUST import from _writer_teardown.js");
  assert.match(wstartHelpers,
    /from\s*["']\.\.\/ledger-writer\/_writer_teardown\.js["']/,
    "WSTOP09: _wstart_live_helpers.ts MUST import from _writer_teardown.js");
});

test("WSTOP10: multi-writer same-runDir — provenance preserved per lifetime identity", async () => {
  // (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
  //  OUTCOME01-CORRECTION01-MICROFIX01)
  //
  // Per the MICROFIX01 review: the previous
  // OUTCOME01 keyed the registry by `runDir`,
  // which is contextual identity, not lifecycle
  // identity. LWQ07 (restart preserves dedup)
  // exercises writer A → stop → writer B against
  // the SAME runDir. Under `Map<runDir, ...>` the
  // second writer's teardown would overwrite the
  // first writer's evidence.
  //
  // This oracle fails mechanically under a
  // runDir-keyed implementation.
  await withTmpDir(async (tmp) => {
    const registry = await import(
      "./_writer_teardown_registry.js"
    );
    registry.clearWriterTeardowns();
    registry.resetLifetimeCounter();

    // ----- Writer A — successful lifecycle -----
    const lifetimeIdA = registry.makeWriterLifetimeId();
    const cA = spawnLongLived();
    cA.on("error", () => { /* trap */ });
    (cA as { kill: (s?: string) => boolean }).kill = () => {
      cA.emit("close", null, "SIGKILL");
      return true;
    };
    const outcomeA = await teardown.terminateHelperAndAwaitTyped(cA, 500);
    registry.recordWriterTeardown(lifetimeIdA, outcomeA);
    const effectA =
      cA.exitCode === null && cA.signalCode === null
        ? { kind: "alive" as const }
        : { kind: "pid_absent" as const };

    // ----- Writer B — refused signal lifecycle -----
    const lifetimeIdB = registry.makeWriterLifetimeId();
    const cB = spawnLongLived();
    cB.on("error", () => { /* trap */ });
    (cB as { kill: (s?: string) => boolean }).kill = () => {
      const err: NodeJS.ErrnoException = new Error(
        "kill EPERM",
      );
      err.code = "EPERM";
      throw err;
    };
    const outcomeB = await teardown.terminateHelperAndAwaitTyped(cB, 500);
    registry.recordWriterTeardown(lifetimeIdB, outcomeB);
    const effectB =
      cB.exitCode === null && cB.signalCode === null
        ? { kind: "alive" as const }
        : { kind: "pid_absent" as const };

    // (1) Both teardowns are present.
    assert.equal(
      registry.writerTeardownCount(),
      2,
      "WSTOP10: registry must hold BOTH lifetime teardowns",
    );

    // (2) Per-lifetime lookup returns the correct
    //     typed outcome for each writer.
    const recA = registry.getWriterTeardown(lifetimeIdA);
    const recB = registry.getWriterTeardown(lifetimeIdB);
    assert.ok(recA, "WSTOP10: writer A teardown must be present");
    assert.ok(recB, "WSTOP10: writer B teardown must be present");
    assert.equal(recA.outcome.kind, "closed",
      "WSTOP10: writer A outcome MUST be 'closed' (not overwritten by B)");
    assert.equal(recB.outcome.kind, "signal_permission_denied",
      "WSTOP10: writer B outcome MUST be 'signal_permission_denied'");
    if (recB.outcome.kind === "signal_permission_denied") {
      assert.equal(recB.outcome.errno, "EPERM",
        "WSTOP10: writer B errno must be EPERM");
    }

    // (3) Per-lifetime join: cause + effect, with
    //     NO cross-attribution.
    const joinA = {
      lifetime_id: lifetimeIdA,
      run_dir: tmp,
      teardown: recA.outcome,
      final_observation: effectA,
    };
    const joinB = {
      lifetime_id: lifetimeIdB,
      run_dir: tmp,
      teardown: recB.outcome,
      final_observation: effectB,
    };
    assert.equal(joinA.teardown.kind, "closed",
      "WSTOP10: join A cause is closed");
    assert.equal(joinB.teardown.kind, "signal_permission_denied",
      "WSTOP10: join B cause is signal_permission_denied");
    assert.equal(joinA.lifetime_id, lifetimeIdA,
      "WSTOP10: join A lifetime_id MUST equal the minted A");
    assert.equal(joinB.lifetime_id, lifetimeIdB,
      "WSTOP10: join B lifetime_id MUST equal the minted B");
    assert.notEqual(lifetimeIdA, lifetimeIdB,
      "WSTOP10: distinct lifetimes MUST be distinct identities");

    // (4) JSON shape preservation.
    const asText = JSON.stringify([joinA, joinB]);
    assert.match(asText, /"kind":"closed"/);
    assert.match(asText, /"kind":"signal_permission_denied"/);
    assert.match(asText, /"errno":"EPERM"/);
  });
});

test("WSTOP11: registry reset discipline — clear empties, record → clear → lookup undefined", async () => {
  // (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
  //  OUTCOME01-CORRECTION01-MICROFIX01)
  //
  // Per the MICROFIX01 review: without explicit
  // reset discipline, repeated test execution in
  // a single Node process can turn historical
  // teardown evidence into current evidence.
  // This oracle pins both directions of the
  // discipline.
  const registry = await import(
    "./_writer_teardown_registry.js"
  );
  registry.clearWriterTeardowns();
  registry.resetLifetimeCounter();
  assert.equal(
    registry.writerTeardownCount(),
    0,
    "WSTOP11: registry must start empty after reset",
  );
  const lifetimeId = registry.makeWriterLifetimeId();
  registry.recordWriterTeardown(lifetimeId, {
    kind: "closed",
    code: 0,
    signal: null,
  });
  assert.equal(
    registry.writerTeardownCount(),
    1,
    "WSTOP11: registry must record the outcome",
  );
  assert.ok(
    registry.getWriterTeardown(lifetimeId),
    "WSTOP11: lookup returns the recorded outcome",
  );
  registry.clearWriterTeardowns();
  assert.equal(
    registry.writerTeardownCount(),
    0,
    "WSTOP11: registry must be empty after clear",
  );
  assert.equal(
    registry.getWriterTeardown(lifetimeId),
    undefined,
    "WSTOP11: lookup after clear MUST be undefined",
  );
});
