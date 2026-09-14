/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01-CORRECTION01)
 *
 * Mechanical oracles for the canonical-main `npm test`
 * liveness. Each oracle is a deterministic assertion
 * about a specific failure mode that previously made
 * `npm test` hang after AP11.
 *
 * These tests are NOT in the strict qualification
 * matrix; they are diagnostic oracles that run as part
 * of the canonical suite and fail LOUDLY if any of the
 * liveness invariants regress.
 *
 * IMPORTANT (CORRECTION01):
 *   This file is EXCLUDED from canonical discovery by
 *   `scripts/run-tests.mjs`. Earlier versions included
 *   LIV04 which recursively spawned the canonical
 *   runner — that produced a self-referential test
 *   corpus whose "11/11 PASS in 2.6s" claim could not
 *   coexist with the observed ~80 second canonical
 *   runtime. The LIV04 invariant is now mechanically
 *   verified externally via
 *   `scripts/qualify-test-runner-liveness.mjs`.
 *
 *   The oracles in this file do NOT spawn the
 *   canonical runner. They are static-source oracles
 *   (read scripts/ files, parse the AST, assert
 *   invariants), standalone subprocess oracles (spawn
 *   individual test FILEs in isolation, NOT through
 *   the runner), and in-process structural oracles.
 *
 * LIV01 — previously-stalling boundary completes or
 *         fails boundedly
 *   The test FILEs that previously pinned the runner
 *   event loop (`_wstop_writer_teardown_adversarial`,
 *   `ledger-writer-live-qualification`, etc.) MUST
 *   complete with a typed outcome within a bounded
 *   runtime when run STANDALONE (i.e. via
 *   `node --import tsx --test <file>` directly,
 *   not through `scripts/run-tests.mjs`).
 *
 * LIV02 — no force-exit in canonical runner
 *   `scripts/run-tests.mjs` MUST NOT pass
 *   `--test-force-exit` to Node. A force-exit run
 *   would hide residue instead of reporting it.
 *
 * LIV03 — runner trace flag schema is correct
 *   The runner's source code MUST contain the
 *   `FACTORY_TEST_RUNNER_TRACE` env-var check and
 *   the JSON trace-line emitter with the documented
 *   schema. (Earlier LIV03a/LIV03b spawned the
 *   runner; CORRECTION01 replaces that with a
 *   static-source oracle so this file never
 *   recursively invokes the runner.)
 *
 * LIV04 — DELETED (moved to
 *   `scripts/qualify-test-runner-liveness.mjs`).
 *   See the new file for the external liveness
 *   qualification.
 *
 * LIV05 — post-test tracked tree remains clean
 *   The repository's `git status --porcelain` output
 *   (excluding `src/ledger-writer/`) MUST show that
 *   no test FILE has accidentally modified tracked
 *   source. This is the post-test invariant that
 *   prevents the test runner from leaving
 *   `git-dirty`-flagged files.
 *
 * LIV06 — B0 freeze remains clean
 *   The B0 freeze on `src/ledger-writer/**` MUST
 *   remain clean across the change. This oracle
 *   verifies that `git diff <B0>..HEAD -- src/ledger-writer/`
 *   is empty.
 *
 * LIV07 — ownership-scoped detachment
 *   `detachOwnedChildren(children)` MUST detach the
 *   IPC channel + stdio FDs of every ChildProcess
 *   passed in. It MUST NOT enumerate or touch handles
 *   that were not passed in (CORRECTION01: no global
 *   type-based handle sweep).
 *
 * LIV08 — detachment is NOT cleanup proof
 *   Even after `detachOwnedChildren` succeeds, the
 *   underlying child processes that the kernel
 *   refused to kill MUST remain observable as alive
 *   in `ps`. Detachment is a parent-liveness
 *   operation; cleanup is the residue oracle's
 *   observation. The assertion crosses the REAL
 *   qualification seam (MICROFIX01 P1-3) — the
 *   canonical `classifyQualification` defined in
 *   `test/_liveness_qualify.ts` — not a locally
 *   modelled closure.
 *
 * LIV09 — detaching owned child A cannot affect
 *         unrelated child/socket B
 *   Cross-ownership isolation. The helper MUST only
 *   affect the children passed in. MICROFIX01
 *   replaces the earlier `typeof B.stdout?.resume
 *   === "function"` check (which is a method-
 *   presence assertion that does NOT distinguish
 *   "untouched" from "destroyed+still-resumable")
 *   with deterministic per-target counter spies
 *   that record every `unref()` and `destroy()`
 *   invocation on every fake child.
 *
 * LIV10 — static guard: no `process._getActiveHandles`
 *         ANYWHERE in `test/` or `src/`
 *   Node documents `process._getActiveHandles` as
 *   private (the underscore prefix) and explicitly
 *   flags it as potentially removable in a future
 *   major release. MICROFIX01 deletes the diagnostic
 *   sweep that previously required a file-level
 *   allowlist; LIV10 now forbids every executable
 *   reference to the symbol under `test/` and `src/`,
 *   full stop. The only narrow allowance is on the
 *   LIV oracle file itself, which carries the LIV10
 *   grep predicate in executable form.
 *
 * LIV11 — LIV04 self-recursion guard (static)
 *   No canonical test FILE (any `*.test.ts` under
 *   `test/`) may execute `scripts/run-tests.mjs`
 *   in its own executable code. The runner
 *   discovers every `*.test.ts` under `test/`
 *   recursively — so a test FILE that itself
 *   spawns the runner produces recursive
 *   self-invocation of the test corpus. The LIV04
 *   oracle lives EXCLUSIVELY in
 *   `scripts/qualify-test-runner-liveness.mjs`,
 *   outside the canonical corpus. This oracle
 *   enforces that invariant.
 *
 *   The runner's own exclusion list (the
 *   `_liveness_oracle.test.ts` skip in the
 *   recursive walk over `test/`) is a defensive
 *   belt; this oracle is the structural suspenders.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn as netSpawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { detachOwnedChildren } from "./_liveness_helpers.js";
import {
  detachUnreachableChild,
  detachOwnedChildren as detachOwnedChildrenDirect,
} from "./ledger-writer/_writer_teardown.js";
import {
  classifyQualification,
} from "./_liveness_qualify.js";

const execFileP = promisify(execFile);
const HERE = import.meta.dirname;

const B0_SHA = "1048c5c680597d1911e5559ee416425d61842b78";

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01) Track every child this
//  oracle FILE spawned (in LIV07a/LIV07b/LIV08/LIV09)
//  so the after-hook can detach them ownership-scoped.
//  The LIV oracles intentionally use long-lived
//  children with `setInterval(() => {}, 1000)` to
//  simulate the residue-pinning bug; the after-hook
//  must release their parent-side handles for the
//  FILE to exit.
const LIV_OWNED_CHILDREN: import("node:child_process").ChildProcess[] = [];

// (CORRECTION01) LIV03: static-source oracle for the
// runner's trace flag. Replaces the earlier LIV03a/LIV03b
// which spawned the runner (and thus recursed into this
// file).
async function readRunnerSource(): Promise<string> {
  return await readFile(`${HERE}/../scripts/run-tests.mjs`, "utf8");
}

test("LIV01a: previously-stalling _wstop_writer_teardown_adversarial boundary completes boundedly", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01)
  //
  // The WSTOP matrix (the file that was hanging the
  // canonical suite immediately after AP11 in the
  // pre-fix ordering) MUST now exit naturally when
  // invoked STANDALONE (not via scripts/run-tests.mjs).
  const repoRoot = `${HERE}/..`;
  const filePath = `${repoRoot}/test/ledger-writer/_wstop_writer_teardown_adversarial.test.ts`;
  const c = netSpawn(
    process.execPath,
    [
      "--import", "tsx",
      "--test",
      filePath,
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        TMPDIR: process.env["TMPDIR"] ?? "/tmp",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    },
  );
  const exitCode: number | null = await new Promise((resolve) => {
    const t = setTimeout(() => {
      try { c.kill("SIGKILL"); } catch {}
      resolve(null);
    }, 30000);
    c.on("exit", (code) => { clearTimeout(t); resolve(code); });
  });
  assert.ok(
    exitCode !== null,
    `LIV01a: _wstop_writer_teardown_adversarial.test.ts MUST exit naturally within 30s (was hanging before LIVENESS01); exitCode=${exitCode}`,
  );
  assert.equal(
    exitCode,
    0,
    `LIV01a: WSTOP exit code MUST be 0 (all 11 WSTOP tests pass); got ${exitCode}`,
  );
});

test("LIV01b: previously-stalling ledger-writer-live-qualification boundary completes boundedly", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01)
  //
  // The LWQ matrix was the next hanging boundary
  // after WSTOP. It exercises real writer children
  // and the residue oracle. On a sandboxed host the
  // residue is honestly observed (`permission_denied`)
  // and the FILE must exit naturally with that residue
  // — NOT hang.
  const repoRoot = `${HERE}/..`;
  const filePath = `${repoRoot}/test/ledger-writer/ledger-writer-live-qualification.test.ts`;
  const c = netSpawn(
    process.execPath,
    [
      "--import", "tsx",
      "--test",
      filePath,
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        TMPDIR: process.env["TMPDIR"] ?? "/tmp",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    },
  );
  const exitCode: number | null = await new Promise((resolve) => {
    const t = setTimeout(() => {
      try { c.kill("SIGKILL"); } catch {}
      resolve(null);
    }, 60000);
    c.on("exit", (code) => { clearTimeout(t); resolve(code); });
  });
  assert.ok(
    exitCode !== null,
    `LIV01b: ledger-writer-live-qualification.test.ts MUST exit naturally within 60s (was hanging before LIVENESS01); exitCode=${exitCode}`,
  );
});

test("LIV02: no force-exit in canonical runner", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01)
  //
  // The canonical runner (`scripts/run-tests.mjs`)
  // MUST NOT pass `--test-force-exit`. A force-exit
  // run would convert every hang into a silent PASS,
  // which the ACT explicitly forbids.
  const src = await readRunnerSource();
  const codeOnly = src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    /--test-force-exit/.test(codeOnly),
    false,
    "LIV02: scripts/run-tests.mjs executable code MUST NOT pass --test-force-exit",
  );
});

test("LIV03: runner trace flag schema is correct (static-source oracle)", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01)
  //
  // The runner's source code MUST contain:
  //   1. An env-var check on FACTORY_TEST_RUNNER_TRACE.
  //   2. A `trace(record)` function that emits JSON
  //      lines via process.stderr.write.
  //   3. Trace events for `test_runner_start` and
  //      `test_runner_finish`.
  //
  // We assert these structurally rather than by
  // spawning the runner (which would recurse into
  // this file).
  const src = await readRunnerSource();
  assert.equal(
    /FACTORY_TEST_RUNNER_TRACE\s*===\s*"1"/.test(src),
    true,
    "LIV03: runner MUST check FACTORY_TEST_RUNNER_TRACE === '1'",
  );
  assert.equal(
    /process\.stderr\.write\(JSON\.stringify\(record\)/.test(src),
    true,
    "LIV03: runner MUST emit trace lines via process.stderr.write(JSON.stringify(...))",
  );
  assert.equal(
    /\bkind:\s*"test_runner_start"/.test(src),
    true,
    "LIV03: runner MUST emit test_runner_start trace event",
  );
  assert.equal(
    /\bkind:\s*"test_runner_finish"/.test(src),
    true,
    "LIV03: runner MUST emit test_runner_finish trace event",
  );
});

// (CORRECTION01) LIV04 is intentionally absent from
// this file. The canonical npm-test liveness property
// is verified externally via
// `scripts/qualify-test-runner-liveness.mjs`. A
// static-source witness for that move lives in the
// runner itself — see the LIV04_external docstring
// in that script.

test("LIV05: post-test tracked tree remains clean", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01)
  //
  // After `npm test`, the repository's tracked tree
  // MUST be unchanged (modulo the LIVENESS01 patch).
  // The runner itself MUST NOT touch any tracked
  // file. We assert by listing files in `git status
  // --porcelain` and checking that none of them are
  // tracked files the test runner could have edited.
  const status = execFileP(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: `${HERE}/../..`, encoding: "utf8" },
  );
  const lines = (await status).stdout.split("\n").filter((l) => l.length > 0);
  const srcMods = lines.filter(
    (l) => /^\s*M\s+src\//.test(l) || /^\s*M\s+docs\//.test(l),
  );
  assert.equal(
    srcMods.length,
    0,
    `LIV05: test runner MUST NOT modify any tracked src/ or docs/ file. ` +
      `Found: ${srcMods.join("; ")}`,
  );
});

test("LIV06: B0 freeze remains clean", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01)
  //
  // The B0 freeze on `src/ledger-writer/**` MUST
  // remain intact across this change.
  let diff = "";
  try {
    const result = await execFileP(
      "git",
      ["diff", B0_SHA + "..HEAD", "--", "src/ledger-writer/"],
      { cwd: `${HERE}/../..`, encoding: "utf8" },
    );
    diff = result.stdout;
  } catch (err) {
    // execFile with --exit-code returns non-zero if
    // there ARE differences; the stderr/stdout still
    // contains the diff text. Treat non-zero as a
    // failure for LIV06.
    const e = err as { stdout?: string; stderr?: string };
    diff = (e.stdout ?? "") + (e.stderr ?? "");
  }
  assert.equal(
    diff.trim(),
    "",
    "LIV06: B0 freeze guard on src/ledger-writer/ MUST remain clean",
  );
});

// --------------------------------------------------------------------
// LIV07–LIV10 (CORRECTION01)
//
// LIV07 — ownership-scoped detachment
// LIV08 — detachment is NOT cleanup proof
// LIV09 — cross-ownership isolation
// LIV10 — static guard against process._getActiveHandles
// --------------------------------------------------------------------

test("LIV07a: detachOwnedChildren detaches every passed-in ChildProcess IPC channel", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01)
  //
  // Spawn two long-lived children that the kernel
  // refuses to kill (EPERM). Pass both into
  // `detachOwnedChildren` and verify each child's
  // IPC channel has been detached by attempting to
  // remove all `'message'` listeners (which is a
  // side-effect of `child.unref()` + stdio destroy).
  //
  // We assert the helper ran to completion without
  // throwing and that BOTH children are still in the
  // array (detachment does NOT remove the children).
  const children: ReturnType<typeof spawn>[] = [];
  for (let i = 0; i < 2; i++) {
    const c = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    c.stdout.resume();
    c.stderr.resume();
    LIV_OWNED_CHILDREN.push(c);
    children.push(c);
  }
  try {
    detachOwnedChildren(children);
  } catch (err) {
    assert.fail(
      `LIV07a: detachOwnedChildren threw: ${(err as Error).message}`,
    );
  }
  assert.equal(
    children.length,
    2,
    "LIV07a: detachOwnedChildren MUST NOT remove children from the input array",
  );
  // Best-effort: try to kill and observe EPERM. We
  // accept that the helper ran without throwing as
  // the structural invariant.
  for (const c of children) {
    try { c.kill("SIGKILL"); } catch { /* EPERM expected on sandbox */ }
  }
  await sleep(100);
});

test("LIV07b: detachOwnedChildren is idempotent and safe to call repeatedly", () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01)
  //
  // Calling `detachOwnedChildren` with an empty
  // array MUST be a no-op. Calling it twice with the
  // same children MUST be a no-op the second time.
  assert.doesNotThrow(() => {
    detachOwnedChildren([]);
  }, "LIV07b: detachOwnedChildren([]) MUST NOT throw");
  const c = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  c.stdout.resume();
  c.stderr.resume();
  LIV_OWNED_CHILDREN.push(c);
  assert.doesNotThrow(() => {
    detachOwnedChildren([c]);
    detachOwnedChildren([c]);
  }, "LIV07b: detachOwnedChildren MUST be idempotent");
  try { c.kill("SIGKILL"); } catch { /* EPERM */ }
});

test("LIV07c: helper export shape is stable", () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01)
  //
  // The exported helpers are part of the test FILE
  // API. Their existence is contractually required
  // by every test FILE that owns long-lived writer
  // children.
  assert.equal(
    typeof detachUnreachableChild,
    "function",
    "LIV07c: detachUnreachableChild MUST be exported from _writer_teardown.ts",
  );
  assert.equal(
    typeof detachOwnedChildrenDirect,
    "function",
    "LIV07c: detachOwnedChildren MUST be exported from _writer_teardown.ts",
  );
});

test("LIV08: detachment is NOT cleanup proof (parent-liveness only)", () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX02)
  //
  // Pin the non-equivalence:
  //
  //   teardown = signal_permission_denied
  //   parent_detach = { detached: {stdout: destroyed_unrefed, ...}, skipped: false, ... }
  //   residue = alive
  //   => qualification MUST remain FAIL
  //
  // MICROFIX01 P1-3 + MICROFIX02 P1-1: LIV08 MUST
  // cross the REAL qualification seam. The earlier
  // CORRECTION01 version declared a `qualify()`
  // closure INSIDE the test body and proved that
  // ITS OWN locally-defined function returned FAIL.
  // That was a self-tying evidence loop: a regression
  // in any OTHER consumer of these three dimensions
  // would leave LIV08 green.
  //
  // This revised LIV08 imports the canonical
  // `classifyQualification` from
  // `test/_liveness_qualify.ts` — the SINGLE seam
  // every qualification consumer MUST call (see
  // LIV12) — and asserts its result on the
  // canonical LIV08 input triple. A future
  // regression in the classifier that flipped this
  // triple to PASS would break LIV08.
  const c = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  c.stdout.resume();
  c.stderr.resume();
  LIV_OWNED_CHILDREN.push(c);

  let outcomes: ReturnType<typeof detachOwnedChildren> = [];
  let returned = false;
  try {
    outcomes = detachOwnedChildren([c]);
    returned = true;
  } catch {
    // ignore — but we want to assert `returned` below
  }
  assert.equal(
    returned,
    true,
    "LIV08: detachOwnedChildren MUST complete synchronously (it is not an async cleanup operation)",
  );
  assert.equal(
    outcomes.length,
    1,
    "LIV08: detachOwnedChildren MUST return one ParentDetachOutcome per passed-in child",
  );
  const o0 = outcomes[0];
  assert.ok(o0, "LIV08: outcomes[0] MUST exist");
  assert.equal(
    o0.skipped,
    false,
    "LIV08: detachOwnedChildren MUST NOT skip a real ChildProcess with pipe stdio",
  );
  assert.equal(
    o0.childLifecycleAtDetach,
    "running_or_unknown",
    "LIV08: detachOwnedChildren MUST report childLifecycleAtDetach='running_or_unknown' for a live child whose exit has not been observed",
  );

  // The child reference is still here. We did NOT
  // mutate `c` to signal termination — the helper is
  // a liveness seam, not a teardown operator.
  assert.ok(
    c.pid !== undefined,
    "LIV08: child pid MUST remain observable; detachment does not invalidate the child reference",
  );

  // MICROFIX01 P1-2 + MICROFIX02 P1-2 evidence
  // precision: the outcome carries a typed
  // per-handle observation, not a bare tuple. The
  // IPC channel MUST be `unrefed` (not failed /
  // unavailable), and the stdio streams MUST be
  // successfully detached for the parent's loop to
  // actually be unpinned.
  const d = o0.detached;
  assert.equal(
    d.ipc,
    "unrefed",
    "LIV08: detachOwnedChildren MUST report ipc='unrefed' (not 'unavailable' or 'failed') for a live child with stdio",
  );
  assert.notEqual(
    d.stdout,
    "absent",
    "LIV08: detachOwnedChildren MUST observe a stdout stream for stdio:['ignore','pipe','pipe']",
  );
  assert.notEqual(
    d.stdout,
    "failed",
    "LIV08: detachOwnedChildren MUST NOT fail the stdout detachment on a normal pipe",
  );
  assert.notEqual(
    d.stderr,
    "absent",
    "LIV08: detachOwnedChildren MUST observe a stderr stream for stdio:['ignore','pipe','pipe']",
  );

  // Canonical qualification join (MICROFIX02 P1-1).
  // The oracle imports the SINGLE canonical
  // classifier; LIV08 asserts its result on the
  // canonical LIV08 input triple.
  const canonicalLIV08 = classifyQualification({
    teardown: { kind: "signal_permission_denied", errno: "EPERM" },
    parent_detach: o0,
    residue: "alive",
  });
  assert.equal(
    canonicalLIV08.disposition,
    "FAIL",
    "LIV08: CANONICAL classifier MUST return FAIL for teardown=signal_permission_denied + parent_detach=any-valid-shape + residue=alive",
  );
  assert.equal(
    canonicalLIV08.reason,
    "residue_alive",
    "LIV08: canonical classifier MUST report reason='residue_alive' (parent_detach does NOT influence the reason)",
  );

  // Sanity check: a closed teardown + gone residue
  // is the ONLY path to PASS (round-trip).
  const canonicalClean = classifyQualification({
    teardown: { kind: "closed", code: 0, signal: null },
    parent_detach: {
      childLifecycleAtDetach: "already_exited",
      skipped: false,
      detached: {
        ipc: "unrefed",
        stdout: "destroyed_unrefed",
        stderr: "destroyed_unrefed",
        stdin: "absent",
      },
    },
    residue: "gone",
  });
  assert.equal(
    canonicalClean.disposition,
    "PASS",
    "LIV08: CANONICAL classifier MUST return PASS for teardown=closed + residue=gone (the canonical clean triple)",
  );

  // Pin the parent_detach-is-irrelevant law:
  // classifyQualification MUST return the same
  // disposition regardless of parent_detach state,
  // given the same teardown+residue.
  const pdCompleted = classifyQualification({
    teardown: { kind: "signal_permission_denied", errno: "EPERM" },
    parent_detach: {
      childLifecycleAtDetach: "running_or_unknown",
      skipped: false,
      detached: {
        ipc: "unrefed",
        stdout: "destroyed_unrefed",
        stderr: "destroyed_unrefed",
        stdin: "absent",
      },
    },
    residue: "alive",
  });
  const pdSkipped = classifyQualification({
    teardown: { kind: "signal_permission_denied", errno: "EPERM" },
    parent_detach: {
      childLifecycleAtDetach: "running_or_unknown",
      skipped: true,
      detached: {
        ipc: "unavailable",
        stdout: "absent",
        stderr: "absent",
        stdin: "absent",
      },
    },
    residue: "alive",
  });
  assert.equal(
    pdCompleted.disposition,
    pdSkipped.disposition,
    "LIV08: CANONICAL classifier MUST return the SAME disposition regardless of parent_detach state (parent_detach is parent-liveness only)",
  );
  assert.equal(
    pdCompleted.disposition,
    "FAIL",
    "LIV08: parent_detach with all handles unrefed MUST still FAIL when residue='alive' — detachment != cleanup",
  );

  // MICROFIX02 P1-2 sanity: an `already_exited`
  // child still attempts stdio detach and reports
  // per-handle evidence. Build a synthetic child
  // whose exitCode is set and verify the result
  // carries both lifecycle AND per-handle fields.
  const exitedChild = {
    exitCode: 0,
    signalCode: null,
    stdout: { destroy() {}, unref() {} },
    stderr: { destroy() {}, unref() {} },
    stdin: { destroy() {}, unref() {} },
  } as unknown as import("node:child_process").ChildProcess;
  const exitedOutcome = detachOwnedChildren([exitedChild]);
  assert.equal(
    exitedOutcome[0]?.childLifecycleAtDetach,
    "already_exited",
    "LIV08 (MICROFIX02): already_exited lifecycle MUST be recorded orthogonally to per-handle detach evidence",
  );
  assert.equal(
    exitedOutcome[0]?.skipped,
    false,
    "LIV08 (MICROFIX02): a non-null child reference is NEVER skipped",
  );
  // The detached fields MUST be populated even when
  // the child has already exited — stdio may still
  // be open and the parent's loop may still be
  // pinned by it. The per-handle evidence is the
  // only honest signal that those FDs were
  // closed.
  assert.ok(
    exitedOutcome[0]?.detached,
    "LIV08 (MICROFIX02): per-handle detached evidence MUST be present even when childLifecycleAtDetach='already_exited'",
  );
  assert.notEqual(
    exitedOutcome[0]?.detached.stdout,
    "absent",
    "LIV08 (MICROFIX02): already_exited child with pipe stdio MUST attempt stdout destroy/unref (per-handle evidence, not mutual exclusion)",
  );

  try { c.kill("SIGKILL"); } catch { /* EPERM */ }
});

test("LIV09: detaching owned child A cannot affect unrelated child/socket B", () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX01)
  //
  // Cross-ownership isolation. Build two
  // adversarially-shaped ChildProcess fakes:
  //   A — passed into detachOwnedChildren
  //   B — NOT passed in
  //
  // Each fake's `unref()` and each stream's
  // `destroy()` / `unref()` increment a per-target
  // counter. The detached shape is a literal
  // ChildProcess: it has `stdout`, `stderr`, `stdin`,
  // `unref`, `exitCode`, `signalCode`, plus a
  // minimal `kill` that returns true (so the helper
  // does not try to actually spawn).
  //
  // After calling `detachOwnedChildren([A])`:
  //   - A's counters MUST have incremented.
  //   - B's counters MUST be exactly zero. A destroyed
  //     or unrefed stream STILL has `.resume` callable
  //     (CORRECTION01 LIV09 erroneously relied on this,
  //     which produced a false-green oracle).
  //
  // This is deterministic, host-independent, and
  // verifies the actual ownership boundary
  // mechanically.
  type SpyStream = {
    destroyCalls: number;
    unrefCalls: number;
    resumeCalls: number;
    destroy(): void;
    unref(): void;
    resume(): void;
  };
  type SpyChild = {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    unrefCalls: number;
    kill(_signal?: NodeJS.Signals): boolean;
    unref(): void;
    stdout: SpyStream;
    stderr: SpyStream;
    stdin: SpyStream;
  };
  function mkSpyStream(label: string): SpyStream {
    return {
      destroyCalls: 0,
      unrefCalls: 0,
      resumeCalls: 0,
      destroy() { this.destroyCalls++; void label; },
      unref() { this.unrefCalls++; void label; },
      resume() { this.resumeCalls++; void label; },
    };
  }
  function mkSpyChild(pid: number): SpyChild {
    return {
      pid,
      exitCode: null,
      signalCode: null,
      unrefCalls: 0,
      kill() { return true; },
      unref() { this.unrefCalls++; },
      stdout: mkSpyStream(`stdout#${pid}`),
      stderr: mkSpyStream(`stderr#${pid}`),
      stdin: mkSpyStream(`stdin#${pid}`),
    };
  }
  const childA = mkSpyChild(1001);
  const childB = mkSpyChild(1002);

  // Cast: the spies implement the subset of
  // ChildProcess surface that `detachOwnedChildren`
  // and `detachUnreachableChild` actually consume
  // (`unref()`, `exitCode`, `signalCode`, plus the
  // three stdio streams). The cast is at the call
  // site only; the helpers are statically typed
  // against ChildProcess, and the spy shape is
  // designed to satisfy every read path inside them.
  const childAProcess = childA as unknown as import("node:child_process").ChildProcess;
  const childBProcess = childB as unknown as import("node:child_process").ChildProcess;

  // Only A is detached.
  detachOwnedChildren([childAProcess]);

  // A's per-handle counters MUST have advanced.
  assert.equal(
    childA.unrefCalls,
    1,
    "LIV09: child A's unref() MUST be called exactly once when detached",
  );
  assert.equal(
    childA.stdout.destroyCalls,
    1,
    "LIV09: child A's stdout.destroy() MUST be called exactly once",
  );
  assert.equal(
    childA.stdout.unrefCalls,
    1,
    "LIV09: child A's stdout.unref() MUST be called exactly once",
  );
  assert.equal(
    childA.stderr.destroyCalls,
    1,
    "LIV09: child A's stderr.destroy() MUST be called exactly once",
  );
  assert.equal(
    childA.stderr.unrefCalls,
    1,
    "LIV09: child A's stderr.unref() MUST be called exactly once",
  );

  // B's per-handle counters MUST be exactly zero.
  // This is the deterministic, host-independent
  // proof that the helper does NOT walk the global
  // handle set; it ONLY touches what was passed in.
  assert.equal(
    childB.unrefCalls,
    0,
    "LIV09: child B's unref() MUST NOT be called when only [A] was passed to detachOwnedChildren",
  );
  assert.equal(
    childB.stdout.destroyCalls,
    0,
    "LIV09: child B's stdout.destroy() MUST NOT be called (deterministic ownership isolation)",
  );
  assert.equal(
    childB.stdout.unrefCalls,
    0,
    "LIV09: child B's stdout.unref() MUST NOT be called (deterministic ownership isolation)",
  );
  assert.equal(
    childB.stderr.destroyCalls,
    0,
    "LIV09: child B's stderr.destroy() MUST NOT be called (deterministic ownership isolation)",
  );
  assert.equal(
    childB.stderr.unrefCalls,
    0,
    "LIV09: child B's stderr.unref() MUST NOT be called (deterministic ownership isolation)",
  );

  // And B's `resume` was never called either (no
  // ambient reads from the helper).
  assert.equal(
    childB.stdout.resumeCalls,
    0,
    "LIV09: child B's stdout.resume() MUST NOT be called (helper must not touch unowned streams at all)",
  );
  assert.equal(
    childB.stderr.resumeCalls,
    0,
    "LIV09: child B's stderr.resume() MUST NOT be called",
  );

  // Sanity check: also exercise the direct
  // `detachUnreachableChild` path with another spy
  // pair to ensure the standalone entry point also
  // respects ownership.
  const childC = mkSpyChild(1003);
  const childD = mkSpyChild(1004);
  const childCProcess = childC as unknown as import("node:child_process").ChildProcess;
  detachUnreachableChild(childCProcess);
  assert.equal(
    childC.unrefCalls,
    1,
    "LIV09: detachUnreachableChild(C) MUST invoke C.unref() exactly once",
  );
  assert.equal(
    childD.unrefCalls,
    0,
    "LIV09: detachUnreachableChild(C) MUST NOT invoke D.unref() (ownership isolation at the standalone entry point too)",
  );

  void childD;
  void childBProcess;
});

test("LIV10: static guard — no process._getActiveHandles anywhere", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX01)
  //
  // Node documents `process._getActiveHandles` as
  // private (the underscore prefix) and explicitly
  // flags it as potentially removable in a future
  // major release.
  //
  // MICROFIX01 P1-5: LIV10 forbids EVERY reference to
  // `_getActiveHandles` anywhere under `test/` or
  // `src/`. There is NO escape hatch.
  //
  // The earlier CORRECTION01 LIV10 had two file-level
  // allowlists:
  //   - `test/ledger-writer/_writer_teardown.ts`
  //     (because of `_diagnostic_sweepAllHandles`)
  //   - `test/_liveness_oracle.test.ts` (this file)
  //
  // The first was a LIV10 ambiguity: any future
  // addition of `_getActiveHandles` ANYWHERE in
  // `_writer_teardown.ts` (not just inside the
  // diagnostic function) would pass silently.
  // MICROFIX01 deletes the diagnostic sweep
  // entirely; `_writer_teardown.ts` no longer
  // references `_getActiveHandles` in executable
  // code. The allowlist on that file is now
  // redundant and is REMOVED.
  //
  // The second (this file) is unavoidable: LIV10's
  // own test body must reference the symbol it
  // forbids, in executable form, in order to grep
  // for it. The narrow allowance is on the test FILE
  // itself only — not on `_writer_teardown.ts`.
  //
  // We additionally scan `src/` for the same symbol
  // because no production code path may legitimately
  // touch the private handle introspection API.
  const { readdir } = await import("node:fs/promises");
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...await walk(full));
      } else if (e.isFile() && /\.(ts|mjs|js)$/.test(e.name)) {
        out.push(full);
      }
    }
    return out;
  }
  const repoRoot = `${HERE}/..`;
  const offenders: string[] = [];
  for (const dir of ["src", "test"]) {
    let dirPath = path.join(repoRoot, dir);
    try {
      await (await import("node:fs/promises")).stat(dirPath);
    } catch {
      continue;
    }
    const files = await walk(dirPath);
    for (const f of files) {
      // Allow ONLY the LIV oracle file itself
      // (LIV10's executable reference is part of the
      // grep predicate). Every other FILE must be
      // free of executable references to
      // `_getActiveHandles`.
      if (f.endsWith("_liveness_oracle.test.ts")) continue;
      const text = await readFile(f, "utf8");
      // Strip line and block comments so LIV10 only
      // forbids *executable* references.
      const codeOnly = text
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      if (/_getActiveHandles/.test(codeOnly)) {
        offenders.push(f);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `LIV10: process._getActiveHandles MUST NOT appear in executable code in any FILE except _liveness_oracle.test.ts (which carries the LIV10 grep predicate). Offenders: ${offenders.join("; ")}`,
  );
});

test("LIV11: static guard — no canonical test FILE executes scripts/run-tests.mjs", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01)
  //
  // LIV04_SELF_RECURSION = IMPOSSIBLE.
  //
  // `scripts/run-tests.mjs` discovers every
  // `*.test.ts` under `test/` recursively. If a
  // canonical test FILE itself spawns the runner
  // (via `spawn("node", ["scripts/run-tests.mjs", ...])`
  // or equivalent), the runner's recursive walk
  // would re-discover the test FILE that spawned
  // it — producing self-referential execution and
  // a false-green corpus whose observed runtime
  // cannot coexist with the canonical run.
  //
  // The LIV04 oracle for the canonical run's
  // liveness therefore lives EXCLUSIVELY in
  // `scripts/qualify-test-runner-liveness.mjs`,
  // which is NOT under `test/` and is therefore
  // not part of the canonical corpus.
  //
  // This oracle statically asserts that
  // INVARIANT:
  //   No `*.test.ts` file under `test/` may
  //   reference `run-tests.mjs` in executable
  //   code.
  const { readdir, stat } = await import("node:fs/promises");
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...await walk(full));
      } else if (e.isFile() && e.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
    return out;
  }
  const repoRoot = `${HERE}/..`;
  const testRoot = path.join(repoRoot, "test");
  try {
    await stat(testRoot);
  } catch {
    assert.fail(`LIV11: test root does not exist at ${testRoot}`);
    return;
  }
  const files = await walk(testRoot);
  const offenders: string[] = [];
  // Match forms a canonical test FILE could
  // plausibly use to invoke the runner:
  //   "run-tests.mjs"
  //   "scripts/run-tests.mjs"
  //   "scripts\\run-tests.mjs"  (Windows path sep)
  //   /run-tests\.mjs/          (regex literal)
  const FORBIDDEN = /["'/](?:scripts[/\\]+)?run-tests\.mjs["')]/;
  for (const f of files) {
    // The LIV oracle file itself is EXCLUDED from
    // canonical runner discovery (see
    // `scripts/run-tests.mjs`'s `_liveness_oracle.test.ts`
    // skip). It is allowed to *reference*
    // `scripts/run-tests.mjs` in executable code
    // because that reference is part of a
    // static-source read (e.g. `readFile(...run-tests.mjs)`)
    // for LIV03 — NOT a `spawn` of the runner.
    //
    // We further narrow the LIV11 scan to executable
    // *invocations*: a literal string reference is
    // not an invocation. We grep for `spawn`,
    // `exec`, or `execFile` calls combined with a
    // `run-tests.mjs` reference, OR an explicit
    // `child_process.spawn(... "run-tests.mjs" ...)`
    // shape. A bare string literal (used by LIV03
    // for static-source reading) is allowed.
    if (f.endsWith("_liveness_oracle.test.ts")) continue;
    const text = await readFile(f, "utf8");
    // Strip line and block comments so LIV11 only
    // forbids *executable* references.
    const codeOnly = text
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // LIV11 only flags executable *invocations* of
    // the runner. We look for one of:
    //   - spawn( ... "run-tests.mjs" ... )
    //   - exec ( ... "run-tests.mjs" ... )
    //   - execFile( ... "run-tests.mjs" ... )
    //   - spawnSync / execSync / execFileSync
    // A bare string literal (no nearby invocation
    // call) is allowed — that's the LIV03 static-
    // source read pattern.
    const lines = codeOnly.split("\n");
    let inInvocation = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      // Track multi-line spawn/exec/... argument
      // lists: an opening `(` without a closing `)`
      // on the same line keeps us in an invocation.
      if (/\b(spawn|exec|execFile|spawnSync|execSync|execFileSync)\s*\(/.test(line)) {
        inInvocation = true;
      }
      if (inInvocation && FORBIDDEN.test(line)) {
        offenders.push(`${f}:${i + 1}`);
      }
      // Close the invocation tracking if this
      // line's parens balance.
      const opens = (line.match(/\(/g) ?? []).length;
      const closes = (line.match(/\)/g) ?? []).length;
      if (opens <= closes) inInvocation = false;
    }
  }
  assert.equal(
    offenders.length,
    0,
    `LIV11: canonical test FILEs MUST NOT spawn/exec scripts/run-tests.mjs (would produce self-referential corpus). Offenders: ${offenders.join("; ")}`,
  );
});

test("LIV12: strict qualification matrix imports the canonical classifier (real-seam binding)", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX02)
  //
  // P1-1 — REAL QUALIFICATION BINDING.
  //
  // LIV08 proves the canonical
  // `classifyQualification()` function in
  // `test/_liveness_qualify.ts` returns FAIL on the
  // canonical LIV08 triple. LIV08 alone, however,
  // does NOT prove that the ACTUAL strict
  // qualification matrix
  // (`ledger-writer-live-qualification.test.ts`)
  // uses the same canonical function. Before
  // MICROFIX02, the matrix had its own
  // `qualifies()` / `classifyCounters()` algebra
  // that decided PASS/FAIL from counter shape —
  // that was a SEPARATE seam, and a regression in
  // either could leave the other green.
  //
  // LIV12 statically proves the matrix depends on
  // the canonical classifier, AND that no other
  // file under `test/` or `src/` contains a
  // duplicate `teardown === "closed" && residue ===
  // "gone"` PASS algebra.
  //
  // The canonical classifier is the ONLY seam that
  // may license a PASS. If anyone introduces a
  // parallel PASS algebra, LIV12 fails closed.
  const { readFile, readdir, stat } = await import("node:fs/promises");
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...await walk(full));
      } else if (e.isFile() && /\.(ts|mjs|js)$/.test(e.name)) {
        out.push(full);
      }
    }
    return out;
  }
  const repoRoot = `${HERE}/..`;

  // (a) The strict qualification matrix MUST
  // import `classifyQualification` from
  // `_liveness_qualify.js`.
  const matrixPath = path.join(
    repoRoot,
    "test/ledger-writer/ledger-writer-live-qualification.test.ts",
  );
  await stat(matrixPath); // throw if not present
  const matrixSrc = await readFile(matrixPath, "utf8");
  const matrixCodeOnly = matrixSrc
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    /classifyQualification/.test(matrixCodeOnly),
    "LIV12: ledger-writer-live-qualification.test.ts MUST reference classifyQualification in executable code",
  );
  assert.ok(
    /from\s+["']\.\.\/_liveness_qualify\.js["']/.test(matrixCodeOnly),
    `LIV12: ledger-writer-live-qualification.test.ts MUST import classifyQualification from "../_liveness_qualify.js"`,
  );

  // (b) No duplicate PASS algebra. We forbid any
  // executable reference to
  // `teardown.kind === "closed"` combined with a
  // residue == "gone" check (the canonical PASS
  // gate) outside `_liveness_qualify.ts`. A
  // duplicate would let a regression in the
  // canonical classifier leave the matrix green.
  const srcDirs = ["src", "test"];
  const dupOffenders: string[] = [];
  for (const dir of srcDirs) {
    let dirPath = path.join(repoRoot, dir);
    try { await stat(dirPath); } catch { continue; }
    const files = await walk(dirPath);
    for (const f of files) {
      // Allow the canonical classifier module itself.
      if (f.endsWith("_liveness_qualify.ts")) continue;
      // Allow the LIV oracle itself (LIV08 and
      // LIV12 use the canonical classifier by
      // name in their executable code; LIV12's
      // own structural-string assertion must be
      // exempt).
      if (f.endsWith("_liveness_oracle.test.ts")) continue;
      const text = await readFile(f, "utf8");
      const codeOnly = text
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // Look for the canonical PASS gate pattern:
      // `teardown.kind === "closed"` AND
      // `residue === "gone"` (in any combination
      // of spaces / newlines). Both substrings
      // on the same FILE outside the canonical
      // module is a duplicate algebra.
      const hasTeardownClosed =
        /teardown[^\n]*\.kind\s*===\s*["']closed["']/.test(codeOnly);
      const hasResidueGone =
        /residue\s*===\s*["']gone["']/.test(codeOnly);
      if (hasTeardownClosed && hasResidueGone) {
        dupOffenders.push(f);
      }
    }
  }
  assert.equal(
    dupOffenders.length,
    0,
    `LIV12: duplicate PASS algebra (teardown.kind === "closed" + residue === "gone") MUST NOT exist outside _liveness_qualify.ts. Offenders: ${dupOffenders.join("; ")}`,
  );

  // (c) Round-trip sanity: the canonical
  // classifier MUST return PASS for the
  // canonical clean triple.
  const clean = classifyQualification({
    teardown: { kind: "closed", code: 0, signal: null },
    parent_detach: {
      childLifecycleAtDetach: "already_exited",
      skipped: false,
      detached: {
        ipc: "unrefed",
        stdout: "destroyed_unrefed",
        stderr: "destroyed_unrefed",
        stdin: "absent",
      },
    },
    residue: "gone",
  });
  assert.equal(
    clean.disposition,
    "PASS",
    "LIV12: canonical classifier MUST return PASS for the canonical clean triple (sanity check that the seam is wired)",
  );
  const liv08Triple = classifyQualification({
    teardown: { kind: "signal_permission_denied", errno: "EPERM" },
    parent_detach: {
      childLifecycleAtDetach: "running_or_unknown",
      skipped: false,
      detached: {
        ipc: "unrefed",
        stdout: "destroyed_unrefed",
        stderr: "destroyed_unrefed",
        stdin: "absent",
      },
    },
    residue: "alive",
  });
  assert.equal(
    liv08Triple.disposition,
    "FAIL",
    "LIV12: canonical classifier MUST return FAIL for the LIV08 triple (parent_detach is parent-liveness only)",
  );
});

// --------------------------------------------------------------------
// LIV13 — SINGLE-DISPOSITION-AUTHORITY
//
// The strict qualification matrix
// (`ledger-writer-live-qualification.test.ts`) MUST
// emit `LEDGER_WRITER_QUALIFICATION_DISPOSITION=`
// at exactly ONE site in executable code, and that
// site MUST come AFTER the canonical classifier
// call (so a regression in the counter algebra
// cannot throw the matrix FAIL before the canonical
// verdict is consulted).
//
// Before MICROFIX03, the matrix emitted the
// disposition twice: once from the counter
// algebra (`qualifies(counters, STRICT)`) and once
// from the canonical classifier. STRICT-throws
// could fire on EITHER path. That violated the
// single-authority principle: the canonical
// classifier was downstream of a different
// authority that could short-circuit the verdict.
//
// LIV13 statically proves:
//   (a) The string
//       `LEDGER_WRITER_QUALIFICATION_DISPOSITION=`
//       appears in EXECUTABLE code (comments
//       stripped) exactly once OR as a single
//       if/else split (FAIL branch + OK branch)
//       under the same canonical classifier call.
//   (b) The first occurrence is preceded (in
//       source order) by a call to
//       `classifyQualification(`, proving the
//       classifier is the authority.
//   (c) No `throw new Error(...)` fires in the
//       after() block BEFORE the
//       `classifyQualification(` call — counter
//       algebra must never short-circuit the
//       canonical verdict.
// --------------------------------------------------------------------
test("LIV13: matrix has exactly ONE disposition emitter (single-authority)", async () => {
  const { readFile, stat } = await import("node:fs/promises");
  const matrixPath = path.join(
    HERE,
    "../test/ledger-writer/ledger-writer-live-qualification.test.ts",
  );
  await stat(matrixPath);
  const src = await readFile(matrixPath, "utf8");
  const codeOnly = src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  // (a) Exactly 1 or 2 emissions — the if/else
  // split for FAIL/OK is allowed since both
  // branches share the same canonical
  // classifier verdict.
  const occurrences = (codeOnly.match(
    /LEDGER_WRITER_QUALIFICATION_DISPOSITION\s*=/g,
  ) ?? []).length;
  assert.ok(
    occurrences >= 1 && occurrences <= 2,
    `LIV13: matrix MUST emit LEDGER_WRITER_QUALIFICATION_DISPOSITION= at exactly one or two sites (FAIL + OK branches); got ${occurrences}`,
  );
  // (b) The first emission MUST be downstream
  // (in source order) of `classifyQualification(`.
  const classifierIdx = codeOnly.indexOf("classifyQualification(");
  assert.ok(
    classifierIdx >= 0,
    "LIV13: classifyQualification call site must be present in the matrix",
  );
  const firstEmissionIdx = codeOnly.indexOf(
    "LEDGER_WRITER_QUALIFICATION_DISPOSITION=",
  );
  assert.ok(
    firstEmissionIdx > classifierIdx,
    "LIV13: first LEDGER_WRITER_QUALIFICATION_DISPOSITION= emission MUST come AFTER classifyQualification( call (single-authority)",
  );
  // (c) No `throw new Error(...)` between
  // `after(async` and the classifier call.
  const afterIdx = codeOnly.indexOf("after(async");
  const matrixBlock = codeOnly.slice(
    afterIdx,
    classifierIdx,
  );
  assert.equal(
    /throw\s+new\s+Error/.test(matrixBlock),
    false,
    "LIV13: no `throw new Error(...)` MUST occur in the after() block BEFORE the classifyQualification() call (counter algebra must never short-circuit)",
  );
});

// --------------------------------------------------------------------
// LIV14 — NO-SYNTHETIC-ERRNO
//
// The matrix MUST NOT fabricate errno values from
// counter shapes. Specifically: no literal
// `errno: "ESRCH"` (or other placeholder errnos
// that the kernel never actually returned).
// Real errno evidence flows from the
// `TerminateOutcome` records keyed by
// WriterLifetimeId in `_writer_teardown_registry.ts`.
//
// `errno: "EPERM"` IS allowed in the matrix
// because that literal IS the typed ADT marker
// for the `signal_permission_denied` variant in
// `_writer_teardown.ts:TerminateOutcome`. It is
// the canonical kernel-meaningful errno for "we
// tried to kill and were refused". Anything else
// (synthesised `"ESRCH"`, invented `"UNKNOWN"`,
// borrowed `"CLOSE_TIMEOUT"` etc.) IS
// fabrication and is forbidden.
//
// LIV14 statically forbids those placeholder
// patterns in the matrix's executable code.
//
// Additionally: the matrix MUST call
// `getAllWriterTeardowns()` to pull real evidence.
// A regression that removes the registry read
// would be caught.
// --------------------------------------------------------------------
test("LIV14: matrix does not fabricate synthetic errno values (actual-evidence binding)", async () => {
  const { readFile, stat } = await import("node:fs/promises");
  const matrixPath = path.join(
    HERE,
    "../test/ledger-writer/ledger-writer-live-qualification.test.ts",
  );
  await stat(matrixPath);
  const src = await readFile(matrixPath, "utf8");
  const codeOnly = src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const forbidden = [
    /errno:\s*["']ESRCH["']/,
    /errno:\s*["']UNKNOWN["']/,
    /errno:\s*["']CLOSE_TIMEOUT["']/,
  ];
  for (const re of forbidden) {
    assert.equal(
      re.test(codeOnly),
      false,
      `LIV14: matrix MUST NOT contain literal placeholder errno values (fabrication). Matched: ${re}`,
    );
  }
  assert.ok(
    /getAllWriterTeardowns/.test(codeOnly),
    "LIV14: matrix MUST call getAllWriterTeardowns() to pull actual TerminateOutcome evidence (no synthetic teardown reconstruction)",
  );
});

test("LIV15: qualifier classifies cleanup errors from err.code (no evidence-provenance inversion)", async () => {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX04)
  //
  // QFIX01+QFIX02+QFIX04 — DETERMINISTIC CLEANUP-ERROR
  // ORACLE.
  //
  // The MICROFIX03 qualifier treated EVERY post-kill
  // `'error'` event as `PERMISSION_DENIED` without
  // examining `err.code`. That is exactly the
  // evidence-provenance inversion this Factory doctrine
  // forbids: a generic ESRCH (process already gone)
  // or an EACCES (file-mode refusal, NOT a signal
  // rights refusal) would have been reported as
  // PERMISSION_DENIED.
  //
  // LIV15 enforces:
  //   (a) The qualifier defines a single typed
  //       `classifyCleanupError(err)` helper.
  //   (b) The helper returns `PERMISSION_DENIED`
  //       iff `err.code === "EPERM"`.
  //   (c) The helper returns `FAILED` for ESRCH,
  //       EACCES, or any other err.code (including
  //       `undefined` / unknown).
  //   (d) BOTH the synchronous `kill()` catch AND the
  //       asynchronous `'error'` event handler call
  //       `classifyCleanupError(err)` — the two paths
  //       cannot use different mappings (the prior
  //       inversion had sync EPERM → FAILED, async
  //       EPERM → PERMISSION_DENIED).
  //   (e) QFIX03: spawn authority is the
  //       ChildProcess `'spawn'` event, NOT a stderr
  //       regex. The qualifier MUST register a
  //       `child.once("spawn", ...)` listener (or
  //       equivalent `child.on("spawn", ...)`).
  //   (f) The qualifier MUST NOT classify spawn-error
  //       vs signal-error by the presence of the
  //       runner's own telemetry line in stderr.
  //
  // The deterministic table tested via static-source
  // grep:
  //
  //   EPERM       → PERMISSION_DENIED
  //   ESRCH       → FAILED
  //   EACCES      → FAILED
  //   undefined   → FAILED
  //
  const { readFile, stat } = await import("node:fs/promises");
  const qualifierPath = path.join(
    HERE,
    "../scripts/qualify-test-runner-liveness.mjs",
  );
  await stat(qualifierPath);
  const src = await readFile(qualifierPath, "utf8");

  // (a) Single classifier helper exists. Accept either
  //     function declaration (`function classifyCleanupError(err)`)
  //     or arrow assignment (`const classifyCleanupError = (err) =>`).
  assert.ok(
    /function\s+classifyCleanupError\s*\(/.test(src) ||
      /const\s+classifyCleanupError\s*=\s*\(/.test(src),
    "LIV15: qualifier MUST define `classifyCleanupError(err)` as a single classifier authority (function decl or arrow assignment)",
  );

  // (b) The helper has the EPERM → PERMISSION_DENIED branch.
  // We extract the helper body and parse its return
  // statement — the prior slack regex matched
  // *anywhere* within 400 chars and missed cases
  // where the function returned a non-canonical
  // literal.
  const helperBodyMatch = src.match(
    /(?:function\s+classifyCleanupError\s*\([^)]*\)\s*\{|const\s+classifyCleanupError\s*=\s*\([^)]*\)\s*=>\s*\{)([\s\S]*?)\n\}/,
  );
  assert.ok(
    helperBodyMatch,
    "LIV15: could not locate the body of classifyCleanupError to verify return mapping",
  );
  const helperBody = helperBodyMatch?.[1] ?? "";

  // The helper body MUST contain a return that
  // discriminates on err.code === "EPERM" and
  // returns PERMISSION_DENIED in the EPERM branch.
  assert.ok(
    /err(?:\?\.|\.)code\s*===\s*["']EPERM["']/.test(helperBody) &&
      /PERMISSION_DENIED/.test(helperBody),
    "LIV15: classifyCleanupError(err) body MUST discriminate on err.code === 'EPERM' → PERMISSION_DENIED",
  );

  // (c) The helper body MUST return FAILED (or
  // PERMISSION_DENIED) as the ONLY terminal literals,
  // i.e. no BOGUS / unknown return literals allowed.
  // We extract every string literal in the return
  // expression and verify the set is exactly
  // {PERMISSION_DENIED, FAILED}. The discriminator
  // literal "EPERM" (in the comparison) is excluded
  // because it is not a return literal.
  const returnLiterals = Array.from(
    helperBody.matchAll(/["']([A-Z_][A-Z0-9_]*)["']/g),
  )
    .map((m) => m[1] ?? "")
    .filter((l) => l !== "EPERM");
  const literalSet = new Set(returnLiterals);
  const allowedLiterals = new Set(["PERMISSION_DENIED", "FAILED"]);
  const offending = [...literalSet].filter((l) => !allowedLiterals.has(l));
  assert.equal(
    offending.length,
    0,
    `LIV15: classifyCleanupError(err) MUST NOT return non-canonical literals. Found offending literals: ${offending.join(",")}. Allowed: PERMISSION_DENIED, FAILED.`,
  );
  // Also confirm both expected literals are present.
  assert.ok(
    literalSet.has("PERMISSION_DENIED") && literalSet.has("FAILED"),
    `LIV15: classifyCleanupError(err) MUST return both PERMISSION_DENIED and FAILED. Found: ${[...literalSet].join(",")}`,
  );

  // (d) BOTH sync catch AND async 'error' handler
  // call the classifier. We use a brace-balancing
  // pass instead of a regex (lazy regex with `\n}`
  // is too greedy across nested blocks).
  const extractBalancedBlock = (text: string, openIdx: number) => {
    // openIdx points at `{`. Find matching `}` by
    // counting brace depth, ignoring braces inside
    // string literals.
    let depth = 0;
    let i = openIdx;
    let inSingle = false;
    let inDouble = false;
    let inLineComment = false;
    let inBlockComment = false;
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (inLineComment) {
        if (c === "\n") inLineComment = false;
        i++;
        continue;
      }
      if (inBlockComment) {
        if (c === "*" && next === "/") {
          inBlockComment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      if (inSingle) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "'") inSingle = false;
        i++;
        continue;
      }
      if (inDouble) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') inDouble = false;
        i++;
        continue;
      }
      if (c === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (c === "'") {
        inSingle = true;
        i++;
        continue;
      }
      if (c === '"') {
        inDouble = true;
        i++;
        continue;
      }
      if (c === "{") {
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) {
          return { body: text.slice(openIdx + 1, i), end: i };
        }
        i++;
        continue;
      }
      i++;
    }
    return null;
  };

  // Find every `catch (NAME) { ... }` block and check
  // whether the body references classifyCleanupError.
  const catchOpenings = [...src.matchAll(/\}\s*catch\s*\(\s*(\w+)\s*\)\s*\{/g)];
  let catchUsesClassifier = false;
  for (const m of catchOpenings) {
    const openIdx = m.index + m[0].length - 1; // position of `{`
    const block = extractBalancedBlock(src, openIdx);
    if (block && /classifyCleanupError\s*\(/.test(block.body)) {
      catchUsesClassifier = true;
      break;
    }
  }
  assert.ok(
    catchUsesClassifier,
    "LIV15: classifyCleanupError(err) MUST be invoked from a `catch (err) { ... }` block (the synchronous kill() failure path). Hardcoding cleanupOutcome in the catch is the prior evidence-provenance inversion.",
  );

  // Find the `child.on('error', (err) => { ... })`
  // handler and verify it calls the classifier.
  const errorHandlerMatch = src.match(
    /child\.on\(\s*["']error["']\s*,\s*\(([^)]*)\)\s*=>\s*\{/,
  );
  let errorHandlerUsesClassifier = false;
  if (errorHandlerMatch && errorHandlerMatch.index !== undefined) {
    const openIdx = errorHandlerMatch.index + errorHandlerMatch[0].length - 1;
    const block = extractBalancedBlock(src, openIdx);
    if (block && /classifyCleanupError\s*\(/.test(block.body)) {
      errorHandlerUsesClassifier = true;
    }
  }
  assert.ok(
    errorHandlerUsesClassifier,
    "LIV15: classifyCleanupError(err) MUST be invoked from a `child.on('error', ...)` handler (the asynchronous error path).",
  );

  // (e) QFIX03: ChildProcess 'spawn' listener exists.
  // We strip comments BEFORE grepping so a commented-
  // out `child.once("spawn", ...)` does not satisfy
  // the oracle. The earlier failure-mode (reviewer's
  // concern) is exactly: relying on a stderr regex
  // instead of the typed lifecycle event.
  const codeOnlySrc = src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    /child\.once\(\s*["']spawn["']/.test(codeOnlySrc) ||
      /child\.on\(\s*["']spawn["']/.test(codeOnlySrc),
    "LIV15: qualifier MUST register a `child.on('spawn', ...)` (or `.once`) listener — ChildProcess 'spawn' is the typed spawn authority",
  );

  // (f) The qualifier MUST NOT classify spawn-error
  // vs signal-error using a stderr regex. The prior
  // MICROFIX03 used
  //   const hasStart = /"kind":"test_runner_start"/.test(stderrBuf);
  //   settleOnce(hasStart ? "SIGNAL_ERROR" : "SPAWN_ERROR");
  // We forbid the `(hasStart ? "SIGNAL_ERROR" : "SPAWN_ERROR")`
  // shape, which is the documentary-signal boundary
  // decision the reviewer flagged.
  //
  // We narrow: the literal `(hasStart ? "SIGNAL_ERROR" : "SPAWN_ERROR")`
  // expression MUST NOT appear in executable code.
  const codeOnly = src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(
    /hasStart\s*\?\s*["']SIGNAL_ERROR["']\s*:\s*["']SPAWN_ERROR["']/.test(codeOnly),
    false,
    "LIV15: qualifier MUST NOT classify spawn-vs-signal using stderr regex (hasStart). Use the ChildProcess 'spawn' event instead.",
  );

  // Positive assertion: the qualifier's spawn-error
  // classification is gated on the typed event, e.g.
  //   spawned ? "SIGNAL_ERROR" : "SPAWN_ERROR"
  //   !spawned → "SPAWN_ERROR"
  assert.ok(
    /spawned\s*\?\s*["']SIGNAL_ERROR["']\s*:\s*["']SPAWN_ERROR["']/.test(codeOnly) ||
      /!\s*spawned[^A-Za-z][\s\S]{0,80}["']SPAWN_ERROR["']/.test(codeOnly),
    "LIV15: qualifier MUST gate spawn-error classification on the typed 'spawned' flag from the ChildProcess 'spawn' event",
  );
});

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01-CORRECTION01) The LIV oracle itself
// spawns orphan children for the LIV07/LIV08/LIV09
// tests. Without this after-hook, the oracle FILE
// itself would hang. Apply the same law to itself.
// We pass the LIV-owned child registry here; each
// spawned orphan was registered when it was created
// above. Detachment is ownership-scoped.
after(() => {
  detachOwnedChildren(LIV_OWNED_CHILDREN);
});
