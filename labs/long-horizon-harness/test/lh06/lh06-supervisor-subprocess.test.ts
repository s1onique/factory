/**
 * LH-06 supervisor subprocess integration test.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Verifies SUPERVISOR01 oracle:
 *
 *   - launch real soak-supervisor.mjs
 *   - child emits >=1 LH06_HEARTBEAT
 *   - terminal result exists
 *   - epochs_completed >= requested minimum
 *
 * Required because the supervisor previously spawned a
 * worker that did not actually run (worker-runner.ts only
 * exported its entrypoint and did not invoke it). The
 * subprocess test forces the issue: if the supervisor does
 * not produce real soak output, this test fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { verifyWorkerResult } from "../../soak/worker-result-verifier.js";

const REPO_ROOT = process.cwd();
const SUPERVISOR = resolve(REPO_ROOT, "scripts/soak-supervisor.mjs");

/**
 * L06-CORRECTION03 L06-C21: a complete substrate for the
 * CI_SMOKE test seam. Production profiles (QUALIFICATION /
 * EXTENDED) ignore this value entirely; the worker
 * reads `LH06_SUBSTRATE_OVERRIDE` only when the profile
 * is CI_SMOKE.
 */
const CI_SMOKE_COMPLETE_SUBSTRATE = JSON.stringify({
  phase_e_head: "test-phase-e",
  lh02_head: "test-lh02",
  lh03_frozen_commit: "test-lh03",
  lh04_frozen_commit: "test-lh04",
  lh05_corpus_commit: "test-lh05",
  repo_commit: "test-repo",
});

function runSupervisor(args: {
  readonly profile: string;
  readonly injection: string;
  readonly maxEpochs: number;
  readonly heartbeatTimeoutMs?: number;
  readonly tmpDir: string;
}): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(
      process.execPath,
      // L06-CORRECTION05 L06-C27: import the TS verifier via tsx.
      ["--import", "tsx", SUPERVISOR],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          LH06_PROFILE: args.profile,
          LH06_INJECTION: args.injection,
          LH06_MAX_EPOCHS: String(args.maxEpochs),
          LH06_HEARTBEAT_TIMEOUT_MS: args.heartbeatTimeoutMs
            ? String(args.heartbeatTimeoutMs)
            : "60000",
          LH06_RESULT_PATH: join(args.tmpDir, "result.json"),
          LH06_LAB_ROOT: REPO_ROOT,
          // L06-CORRECTION04 L06-C23: keep
          // supervisor-spawned telemetry OUT of the
          // repository. Tests use a per-tmpDir
          // telemetry directory that the test will
          // rmSync in `finally`. Without this, the
          // supervisor's default would be a
          // per-run dir inside qualification/.
          LH06_TELEMETRY_DIR: join(args.tmpDir, "telemetry"),
          // CI_SMOKE-only env seam; ignored by other
          // profiles (L06-CORRECTION03 L06-C21).
          LH06_SUBSTRATE_OVERRIDE: CI_SMOKE_COMPLETE_SUBSTRATE,
          PATH: `/opt/homebrew/bin:${process.env["PATH"] ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let heartbeatSeen = 0;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        try {
          const parsed = JSON.parse(line.trim());
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            "type" in parsed &&
            parsed.type === "LH06_HEARTBEAT"
          ) {
            heartbeatSeen += 1;
          }
        } catch {
          // not JSON; ignore
        }
      }
    });
    child.on("exit", (code, signal) => {
      resolveP({ code, signal });
    });
    child.on("error", rejectP);
  });
}

/**
 * L06-CORRECTION06 L06-C32 defensive control: run the
 * supervisor with a stub worker that stages a forged
 * PASS artifact claiming under-minimum epochs. The
 * verifier (C32) must still reject this case with
 * `INSUFFICIENT_EPOCHS` because the asymmetric gate on
 * the PASS verdict path is preserved.
 */
function runForgedArtifactSupervisor(args: {
  readonly staged: string;
  readonly profile: string;
  readonly tmpDir: string;
}): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  // The stub worker script is a small TS file that
  // reads the staged artifact, optionally rewrites
  // supervisor_run_id, and writes it to
  // $LH06_RESULT_PATH. Created as a sibling of the
  // supervisor-subprocess test on first use.
  const stubPath = join(args.tmpDir, "lh06-forger.mjs");
  writeFileSync(
    stubPath,
    [
      "import fs from \"node:fs\";",
      "const staged = process.env.LH06_STAGED;",
      "const target = process.env.LH06_RESULT_PATH;",
      "const supRun = process.env.LH06_SUPERVISOR_RUN_ID;",
      "if (!staged || !target) { process.exit(2); }",
      "const obj = JSON.parse(fs.readFileSync(staged, \"utf8\"));",
      "if (supRun) obj.supervisor_run_id = supRun;",
      "fs.writeFileSync(target, JSON.stringify(obj, null, 2));",
      "process.exit(0);",
      "",
    ].join("\n"),
  );
  return new Promise((resolveP, rejectP) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", SUPERVISOR],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          LH06_PROFILE: args.profile,
          LH06_INJECTION: "NONE",
          LH06_RESULT_PATH: join(args.tmpDir, "result.json"),
          LH06_LAB_ROOT: REPO_ROOT,
          LH06_TELEMETRY_DIR: join(args.tmpDir, "telemetry"),
          LH06_SUBSTRATE_OVERRIDE: CI_SMOKE_COMPLETE_SUBSTRATE,
          LH06_WORKER_SCRIPT: stubPath,
          LH06_STAGED: args.staged,
          PATH: `/opt/homebrew/bin:${process.env["PATH"] ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.on("exit", (code, signal) => {
      resolveP({ code, signal });
    });
    child.on("error", rejectP);
  });
}

/**
 * L06-CORRECTION06 L06-C32 control helper. Produces
 * a minimal-valid worker result (CI_SMOKE 60min / 20
 * epochs / PASS / CRASH_DURABLE) that the verifier
 * accepts as-is. Tests that want a forged shape
 * mutate fields on top of this baseline.
 */
function makeFakeCleanWorkerResult(): Record<string, unknown> {
  const dir = `/tmp/factory-lh06-clean-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  mkdirSync(dir, { recursive: true });
  const tp = join(dir, "t.jsonl");
  const lines = [
    '{"type":"LH06_HEARTBEAT","epoch":0}',
    '{"type":"LH06_HEARTBEAT","epoch":1}',
  ];
  writeFileSync(tp, lines.join("\n") + "\n");
  const realBytes = readFileSync(tp);
  const realSha = createHash("sha256")
    .update(realBytes)
    .digest("hex");
  const runId = `clean-${Date.now()}`;
  return {
    schema: "lh06.deterministic.soak.result.v1",
    contract_version: "lh06.soak.contract.v1",
    profile: "CI_SMOKE",
    supervisor_run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 60 * 60 * 1000,
    environment_identity: {
      run_id: runId,
      profile: "CI_SMOKE",
      contract_version: "lh06.soak.contract.v1",
      repo_commit: "x",
    },
    substrate: {
      phase_e_head: "x",
      lh02_head: "x",
      lh03_frozen_commit: "x",
      lh04_frozen_commit: "x",
      lh05_corpus_commit: "x",
      repo_commit: "x",
    },
    substrate_complete: true,
    frozen_tree: {
      before_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      after_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      changed: false,
      status: { ok: true, kind: "VALID" },
    },
    epochs_completed: 20,
    cases_completed: 20,
    semantic: {
      drift_count: 0,
      fault_escape_count: 0,
      lifecycle_drift_count: 0,
      predecessor_dependency_count: 0,
      canary_before_equals_canary_after: true,
      cases_with_multiple_semantic_results: 0,
    },
    resources: {
      post_gc_heap_first_window: 50 * 1024 * 1024,
      post_gc_heap_last_window: 51 * 1024 * 1024,
      heap_slope_bytes_per_epoch: 0,
    },
    latency: { first_window_median_ms: 100, last_window_median_ms: 110 },
    repeatability: { semantic_repeatability: true },
    telemetry_path: tp,
    telemetry_sha256: realSha,
    telemetry_bytes: realBytes.length,
    telemetry_line_count: lines.length,
    publication_durability: "CRASH_DURABLE",
    verdict: "FAIL_RESOURCE_STABILITY",
    failure: {
      kind: "RESOURCE_LEAK",
      epoch: 0,
      last_completed_case: "x",
      minimal_diff: {},
      message: "fake",
    },
  };
}

test("SUPERVISOR01: real supervisor launches worker, emits heartbeats, writes result", { concurrency: false }, async () => {
  const tmpDir = `/tmp/factory-lh06-supervisor-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const result = { code: null as number | null, signal: null as NodeJS.Signals | null };
    let heartbeatSeen = 0;
    const child = spawn(
      process.execPath,
      // L06-CORRECTION05 L06-C27: import the TS verifier via tsx.
      ["--import", "tsx", SUPERVISOR],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          LH06_PROFILE: "CI_SMOKE",
          LH06_INJECTION: "NONE",
          LH06_MAX_EPOCHS: "10",
          LH06_RESULT_PATH: join(tmpDir, "result.json"),
          LH06_LAB_ROOT: REPO_ROOT,
          // L06-CORRECTION04 L06-C23: keep
          // supervisor-spawned telemetry OUT of the
          // repository. Tests use a per-tmpDir
          // telemetry directory that the test will
          // rmSync in `finally`.
          LH06_TELEMETRY_DIR: join(tmpDir, "telemetry"),
          // L06-CORRECTION05 L06-C27: provide a complete
          // substrate so the verifier accepts the
          // worker artifact (was missing before; the
          // supervisor's verifier now correctly rejects
          // an incomplete substrate with
          // `INCOMPLETE_SUBSTRATE`).
          LH06_SUBSTRATE_OVERRIDE: CI_SMOKE_COMPLETE_SUBSTRATE,
          PATH: `/opt/homebrew/bin:${process.env["PATH"] ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        try {
          const parsed = JSON.parse(line.trim());
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            "type" in parsed &&
            parsed.type === "LH06_HEARTBEAT"
          ) {
            heartbeatSeen += 1;
          }
        } catch {
          // ignore
        }
      }
    });
    const exitInfo: typeof result = await new Promise((resolveP) => {
      child.on("exit", (code, signal) => resolveP({ code, signal }));
    });
    const resultPath = join(tmpDir, "result.json");
    assert.equal(existsSync(resultPath), true, "terminal result must exist");
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(written.schema, "lh06.deterministic.soak.result.v1");
    assert.ok(
      heartbeatSeen >= 1,
      `supervisor must emit >=1 LH06_HEARTBEAT (got ${heartbeatSeen})`,
    );
    assert.equal(
      written.epochs_completed >= 10,
      true,
      `epochs_completed (${written.epochs_completed}) must satisfy max_epochs ceiling`,
    );
    assert.equal(written.profile, "CI_SMOKE");
    // Exit code: PASS verdict -> 0; otherwise non-zero.
    if (written.verdict === "PASS_DETERMINISTIC_SOAK") {
      assert.equal(exitInfo.code, 0);
    } else {
      assert.notEqual(exitInfo.code, 0);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SUPERVISOR02: a 10-epoch CI_SMOKE run via real supervisor returns PASS", { concurrency: false }, async () => {
  const tmpDir = `/tmp/factory-lh06-supervisor-pass-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const resultPath = join(tmpDir, "result.json");
    const exitInfo = await runSupervisor({
      profile: "CI_SMOKE",
      injection: "NONE",
      maxEpochs: 10,
      tmpDir,
    });
    assert.equal(existsSync(resultPath), true);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    if (written.verdict !== "PASS_DETERMINISTIC_SOAK") {
      // Surface diagnostics if the assertion is going to fail.
      console.log(
        "SUPERVISOR02 result:",
        JSON.stringify(written, null, 2).slice(0, 1500),
      );
    }
    assert.equal(written.verdict, "PASS_DETERMINISTIC_SOAK");
    assert.equal(exitInfo.code, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SUPERVISOR03: under-length run via supervisor is PROMOTED honestly (QUALIFICATION_INCOMPLETE)", { concurrency: false }, async () => {
  // L06-CORRECTION06 L06-C32: a run that does not
  // satisfy both profile minima but is honestly
  // labelled QUALIFICATION_INCOMPLETE is a valid
  // terminal record; the verifier accepts it, the
  // supervisor promotes it. The previous C28 test
  // (which asserted that under-minimum → FAIL_WORKER)
  // was a semantic-information-loss bug; it asserted
  // that the supervisor would synthesize a watchdog
  // failure even though the worker honestly reported
  // an incomplete run. The verifier now preserves the
  // truthful negative record.
  const tmpDir = `/tmp/factory-lh06-supervisor-short-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const resultPath = join(tmpDir, "result.json");
    const exitInfo = await runSupervisor({
      profile: "CI_SMOKE",
      injection: "NONE",
      maxEpochs: 2, // < 10 CI_SMOKE minimum
      tmpDir,
    });
    assert.equal(existsSync(resultPath), true);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(
      written.schema,
      "lh06.deterministic.soak.result.v1",
      "under-minimum CI run with honest QUALIFICATION_INCOMPLETE is a valid terminal record",
    );
    assert.equal(written.verdict, "QUALIFICATION_INCOMPLETE");
    assert.equal(written.profile, "CI_SMOKE");
    assert.ok(written.epochs_completed <= 2);
    assert.notEqual(exitInfo.code, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SUPERVISOR03b: under-length run with PASS verdict is verifier-rejected (INSUFFICIENT_EPOCHS)", { concurrency: false }, async () => {
  // Defensive control — the original C28 test, kept
  // verbatim, asserts that the verifier preserves its
  // asymmetric gate against a CLAIMED PASS verdict at
  // under-minimum counters. C32 only relaxed the
  // minima check for honestly-incomplete claims; a
  // forged PASS under the minima is still rejected.
  //
  // This test runs the same supervisor with a stub
  // worker (`LH06_WORKER_SCRIPT`) that forges a PASS
  // artifact with epochs_completed = 2.
  const tmpDir = `/tmp/factory-lh06-supervisor-forged-pass-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const resultPath = join(tmpDir, "result.json");
    const staged = join(tmpDir, "staged-pass.json");
    // Build a minimal-valid worker result with PASS
    // but epochs=2 (CI_SMOKE minimum is 10).
    const r = makeFakeCleanWorkerResult();
    r.profile = "CI_SMOKE";
    r.epochs_completed = 2;
    r.verdict = "PASS_DETERMINISTIC_SOAK";
    r.failure = null;
    writeFileSync(staged, JSON.stringify(r));
    const exitInfo = await runForgedArtifactSupervisor({
      staged,
      profile: "CI_SMOKE",
      tmpDir,
    });
    assert.equal(existsSync(resultPath), true);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(
      written.schema,
      "lh06.supervisor-terminal-result/v1",
      "forged PASS at under-minimum epochs MUST be a supervisor failure artifact",
    );
    assert.equal(written.verdict, "FAIL_WORKER");
    assert.match(
      String(
        (written.supervisor_termination ?? {}).supervisor_reason ?? "",
      ),
      /^verifier_rejected:INSUFFICIENT_EPOCHS$/,
    );
    assert.notEqual(exitInfo.code, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SUPERVISOR04: LEAK07 (heartbeat stop) triggers supervisor hang watchdog", { concurrency: false }, async () => {
  const tmpDir = `/tmp/factory-lh06-supervisor-leak07-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });
  try {
    const resultPath = join(tmpDir, "result.json");
    // LEAK07 stops heartbeats after epoch 1. With a tight
    // 500ms heartbeat timeout, the supervisor MUST kill the
    // worker, write a terminal result, and exit non-zero.
    const exitInfo = await runSupervisor({
      profile: "CI_SMOKE",
      injection: "LEAK07",
      maxEpochs: 5,
      heartbeatTimeoutMs: 500,
      tmpDir,
    });
    assert.equal(existsSync(resultPath), true);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    // Either the worker reported a hang itself, or the
    // supervisor synthesized a terminal result on signal.
    // Both are valid terminal dispositions.
    assert.notEqual(written.verdict, "PASS_DETERMINISTIC_SOAK");
    assert.notEqual(exitInfo.code, 0, "hang kill must exit non-zero");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * SUPERVISOR05 (L06-CORRECTION02 C02-02 + L06-CORRECTION06
 * L06-C32): a stale PASS file planted at the canonical
 * result path CANNOT survive a new failed run.
 *
 * Under CORRECTION05 the supervisor delegated to the
 * verifier, which rejected under-minimum runs. Under
 * CORRECTION06 the verifier preserves honest
 * QUALIFICATION_INCOMPLETE as a valid terminal record.
 * The stale-PASS survival invariant is still preserved:
 * the new run produces a worker artifact bound to the
 * CURRENT supervisor's run-id; the OLD stale artifact
 * (with `supervisor_run_id: "stale-prior-generation"`)
 * is overwritten by the new run's bytes.
 *
 * The crucial invariant is: the canonical file at the
 * end MUST NOT carry `verdict=PASS_DETERMINISTIC_SOAK`.
 * That's what this test asserts. The exact schema
 * under C32 is the worker schema with
 * `verdict=QUALIFICATION_INCOMPLETE` (a valid terminal
 * record); under the old C28 it would have been the
 * supervisor failure schema with FAIL_WORKER.
 *
 * Without this test, the supervisor would happily
 * read a prior PASS verdict from a previous run and
 * exit 0 — a stale-state contamination defect
 * specifically called out by the L06-CORRECTION01
 * review.
 */
test("SUPERVISOR05: stale PASS from a previous run CANNOT survive a new failed run", { concurrency: false }, async () => {
  const tmpDir = `/tmp/factory-lh06-supervisor-stale-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  // Plant a stale PASS from a previous run. The schema
  // is the canonical worker-result schema; the verdict
  // is PASS_DETERMINISTIC_SOAK; supervisor_run_id is
  // from some other generation.
  writeFileSync(
    resultPath,
    JSON.stringify({
      schema: "lh06.deterministic.soak.result.v1",
      verdict: "PASS_DETERMINISTIC_SOAK",
      epochs_completed: 500,
      duration_ms: 86_400_000,
      supervisor_run_id: "stale-prior-generation",
      substrate: {
        phase_e_head: null,
        lh02_head: null,
        lh03_frozen_commit: null,
        lh04_frozen_commit: null,
        lh05_corpus_commit: null,
        repo_commit: null,
      },
    }),
  );
  try {
    // Run a 3-epoch CI_SMOKE run. Under C32 the
    // verifier preserves the honest
    // QUALIFICATION_INCOMPLETE verdict; the worker
    // artifact IS promoted, overwriting the stale
    // PASS. The invariant that matters is that the
    // PASS-DETERMINISTIC_SOAK is no longer present.
    const exitInfo = await runSupervisor({
      profile: "CI_SMOKE",
      injection: "NONE",
      maxEpochs: 3,
      tmpDir,
    });
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    // The stale PASS verdict MUST have been replaced.
    assert.notEqual(
      written.verdict,
      "PASS_DETERMINISTIC_SOAK",
      "stale PASS verdict from previous run leaked into a new failed run",
    );
    // The canonical file MUST be either:
    //   (a) the worker result schema with an honest
    //       incomplete verdict (under C32 semantics),
    //   (b) a supervisor failure artifact (under C28
    //       semantics, when the verifier rejects).
    // Both are valid stale-PASS-replacement outcomes.
    // What is NOT valid: canonical file = the stale
    // PASS bytes we planted above.
    assert.equal(
      written.supervisor_run_id === "stale-prior-generation",
      false,
      "stale supervisor_run_id from previous run leaked into canonical file",
    );
    // The supervisor ALWAYS opens with `unlinkSync` of
    // the canonical path; either the supervisor or the
    // worker re-published through the crash-durable
    // publisher (L06-C33). The canonical file MUST
    // carry a valid schema.
    const validSchemas = new Set([
      "lh06.deterministic.soak.result.v1",
      "lh06.supervisor-terminal-result/v1",
    ]);
    assert.ok(
      validSchemas.has(written.schema),
      `canonical file has unexpected schema: ${written.schema}`,
    );
    // runId from the worker must be a fresh generation,
    // not the stale one.
    assert.notEqual(written.verdict, "PASS_DETERMINISTIC_SOAK");
    assert.notEqual(exitInfo.code, 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * SUPERVISOR06 (L06-CORRECTION02 C02-03): supervisor-owned
 * failure artifacts MUST use a distinct schema
 * (`lh06.supervisor-terminal-result/v1`) — they MUST NOT
 * masquerade as a worker result (`lh06.deterministic.soak.result.v1`)
 * with null-filled object fields claiming a worker-result
 * shape.
 *
 * We force the supervisor into failure mode by passing an
 * invalid `LH06_PROFILE` value (`BAD_PROFILE`). The worker
 * crashes (it cannot look up the profile), the supervisor
 * writes a supervisor-terminal-result artifact, and exits
 * non-zero. The canonical result MUST use the supervisor
 * schema, not the worker schema.
 */
test("SUPERVISOR06: supervisor failure artifact uses distinct schema (lh06.supervisor-terminal-result/v1)", { concurrency: false }, async () => {
  const tmpDir = `/tmp/factory-lh06-supervisor-schema-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  try {
    const exitInfo = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolveP, rejectP) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", SUPERVISOR],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            LH06_PROFILE: "BAD_PROFILE",
            LH06_INJECTION: "NONE",
            LH06_RESULT_PATH: resultPath,
            LH06_LAB_ROOT: REPO_ROOT,
            // L06-CORRECTION04 L06-C23: telemetry
            // out of the repository.
            LH06_TELEMETRY_DIR: join(tmpDir, "telemetry"),
            PATH: `/opt/homebrew/bin:${process.env["PATH"] ?? ""}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.on("exit", (code, signal) => resolveP({ code, signal }));
      child.on("error", rejectP);
    });
    assert.equal(existsSync(resultPath), true);
    assert.notEqual(exitInfo.code, 0);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    // The supervisor-owned failure artifact MUST use the
    // distinct supervisor schema, NOT the worker-result
    // schema with null-filled fields.
    assert.equal(
      written.schema,
      "lh06.supervisor-terminal-result/v1",
      "supervisor failure artifact must use distinct schema",
    );
    assert.equal(written.verdict, "FAIL_WORKER");
    assert.ok(written.failure !== null);
    assert.equal(typeof written.supervisor_run_id, "string");
    // It MUST NOT contain the worker-only fields.
    assert.equal(written.environment_identity, undefined);
    assert.equal(written.substrate, undefined);
    assert.equal(written.resources, undefined);
    assert.equal(written.latency, undefined);
    assert.equal(written.frozen_tree, undefined);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * L06-CORRECTION07 L06-C35: end-to-end supervisor
 * subprocess test. A successful CI_SMOKE pass via the
 * REAL supervisor MUST publish a `*.commit.json`
 * witness alongside the canonical result. The witness
 * is the closure authority; without it the
 * qualification is invalid even though the canonical
 * result.json is present.
 */
test(
  "SUPERVISOR07: a successful CI_SMOKE PASS writes a *.commit.json witness",
  { concurrency: false },
  async () => {
    const tmpDir = `/tmp/factory-lh06-supervisor-witness-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    try {
      const resultPath = join(tmpDir, "result.json");
      const witnessPath = `${resultPath}.commit.json`;
      const exitInfo = await runSupervisor({
        profile: "CI_SMOKE",
        injection: "NONE",
        maxEpochs: 10,
        tmpDir,
      });
      assert.equal(existsSync(resultPath), true);
      const written = JSON.parse(readFileSync(resultPath, "utf8"));
      if (written.verdict === "PASS_DETERMINISTIC_SOAK") {
        // Successful PASS closure. The supervisor MUST
        // have written a witness file alongside the
        // canonical result.
        assert.equal(
          existsSync(witnessPath),
          true,
          "PASS closure requires a *.commit.json witness alongside the canonical result (L06-CORRECTION07 L06-C35)",
        );
        const witness = JSON.parse(readFileSync(witnessPath, "utf8"));
        assert.equal(witness.schema, "lh06.commit-witness/v1");
        assert.equal(witness.supervisor_run_id, written.supervisor_run_id);
        assert.equal(
          witness.run_id,
          written.environment_identity.soak_run_id,
        );
        assert.equal(witness.durability, "CRASH_DURABLE");
        assert.equal(witness.profile, "CI_SMOKE");
        assert.equal(witness.verdict, "PASS_DETERMINISTIC_SOAK");
        assert.equal(witness.result_path, resultPath);
        assert.equal(
          witness.result_sha256,
          createHash("sha256")
            .update(readFileSync(resultPath))
            .digest("hex"),
        );
        // Re-running the verifier with the witness must
        // yield ok=true (closure authority accepts).
        const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: resultPath,
          raw: written,
          expected_supervisor_run_id: written.supervisor_run_id,
          result_bytes: new TextEncoder().encode(
            readFileSync(resultPath, "utf8"),
          ),
          commit_witness_raw: witness,
        });
        assert.equal(v.ok, true);
        assert.equal(exitInfo.code, 0);
      } else {
        // Non-PASS path: witness may not be written
        // (negative evidence doesn't need closure).
        // The canonical result uses the supervisor
        // schema in this case.
        assert.equal(
          written.schema,
          "lh06.supervisor-terminal-result/v1",
        );
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
);
