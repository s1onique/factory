/**
 * LH-06 L06-CORRECTION05 L06-C31: supervisor-level
 * adversarial promotion tests. The CORRECTION04 C26
 * suite proved that `verifyWorkerResult` rejects each
 * attack in isolation. C31 proves that the SUPERVISOR
 * actually delegates to that verifier in its real
 * production promotion path.
 *
 * Strategy: each test runs the real supervisor with
 * `LH06_WORKER_SCRIPT` pointing at a tiny stub worker
 * that writes a forged artifact to the supervisor's
 * chosen per-run worker result path. The supervisor
 * reads it, calls `verifyWorkerResult`, and (correctly)
 * refuses to promote it. The test asserts:
 *   - supervisor exit code is non-zero;
 *   - canonical `resultPath` either doesn't exist OR
 *     uses the supervisor's distinct schema
 *     (`lh06.supervisor-terminal-result/v1`), NEVER the
 *     worker schema with the forged payload.
 *
 * If the supervisor stops calling the verifier, the
 * forged artifact will reach the canonical path with
 * the worker schema and these tests will fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const REPO_ROOT = process.cwd();
const SUPERVISOR = resolve(REPO_ROOT, "scripts/soak-supervisor.mjs");

interface PromotionOutcome {
  readonly exitCode: number | null;
  readonly canonical: unknown;
  readonly canonicalExists: boolean;
  readonly canonicalSchema: string | undefined;
}

/**
 * Build a minimal-valid worker result. CI_SMOKE so
 * `epochs_completed=20` and `duration_ms=60*60*1000`
 * exceed the contract. Tests that want to forge
 * duration/epochs mutate these before passing to
 * `runSupervisorAgainstForgedArtifact`.
 */
function makeForgedArtifact(
  mutator: (r: Record<string, unknown>) => void,
): Record<string, unknown> {
  const dir = join(
    tmpdir(),
    `lh06-c31-stub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  );
  mkdirSync(dir, { recursive: true });
  const tp = join(dir, "lh06-stub.telemetry.jsonl");
  const lines = [
    '{"type":"LH06_HEARTBEAT","epoch":0}',
    '{"type":"LH06_HEARTBEAT","epoch":1}',
  ];
  writeFileSync(tp, lines.join("\n") + "\n");
  const realBytes = readFileSync(tp);
  const realSha = createHash("sha256").update(realBytes).digest("hex");
  const runId = `c31-${Date.now()}`;
  const r: Record<string, unknown> = {
    schema: "lh06.deterministic.soak.result.v1",
    contract_version: "lh06.soak.contract.v1",
    profile: "CI_SMOKE",
    supervisor_run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 60 * 60 * 1000,
    environment_identity: {
      soak_run_id: runId,
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
      cases_observed: 20,
      drift_count: 0,
      cases_with_multiple_semantic_results: 0,
      lifecycle_drift_by_scenario: {},
      predecessor_dependency_count: 0,
      fault_count: 0,
      fault_escape_count: 0,
    },
    resources: {
      heap_slope_bytes_per_epoch: 0,
      owned_after_release: 0,
      owned_leaked_after_epoch: 0,
    },
    latency: {
      p50_ms: 1,
      p95_ms: 1,
      p99_ms: 1,
      max_ms: 1,
      window_size: 32,
      threshold_p99_ms: 1000,
      observed_drift_ms: 0,
    },
    repeatability: { semantic_repeatability: true },
    telemetry_path: tp,
    telemetry_sha256: realSha,
    telemetry_bytes: realBytes.length,
    telemetry_line_count: lines.length,
    // L06-CORRECTION06 L06-C33: helper claims
    // CRASH_DURABLE so the verifier's PASS-durability
    // gate does not falsely reject the legitimate
    // clean-artifact control. Tests that want to forge
    // this field mutate it explicitly.
    publication_durability: "CRASH_DURABLE",
    verdict: "PASS_DETERMINISTIC_SOAK",
    failure: null,
  };
  mutator(r);
  return r;
}

/**
 * Stub worker: read staged artifact, optionally mutate
 * `supervisor_run_id` to match the supervisor's actual
 * run-id (read from `LH06_SUPERVISOR_RUN_ID`), write
 * to `$LH06_RESULT_PATH`, exit 0. The supervisor sees
 * the artifact via its per-run worker path.
 *
 * `LH06_STUB_REWRITE_RUN_ID` controls whether the stub
 * rewrites the artifact's supervisor_run_id. Forged
 * attacks (C31) leave it `false` so the mismatch is
 * exposed; the legitimate-clean test sets it to `true`
 * so the artifact passes the verifier.
 *
 * `LH06_STUB_WRITE_WITNESS` controls whether the stub
 * also writes a valid commit witness for the artifact
 * at `<LH06_RESULT_PATH>.commit.json`. The legitimate
 * end-to-end promotion path requires the witness; the
 * forged / supervisor-failure tests either do not write
 * one (so the verifier refuses) or write one with the
 * wrong SHA / run-id (so the verifier still refuses).
 *
 * L06-CORRECTION07 L06-C35.
 */
const STUB_WORKER = `
import fs from "node:fs";
import crypto from "node:crypto";
const target = process.env.LH06_RESULT_PATH;
const staged = process.env.LH06_STAGED_ARTIFACT;
const rewrite = process.env.LH06_STUB_REWRITE_RUN_ID === "1";
const writeWitness = process.env.LH06_STUB_WRITE_WITNESS === "1";
const badWitness = process.env.LH06_STUB_BAD_WITNESS === "1";
const supRunId = process.env.LH06_SUPERVISOR_RUN_ID;
if (!target || !staged) {
  process.stderr.write("stub-worker missing LH06_RESULT_PATH or LH06_STAGED_ARTIFACT\\n");
  process.exit(2);
}
let text = fs.readFileSync(staged, "utf8");
let obj = JSON.parse(text);
if (rewrite && supRunId) {
  obj.supervisor_run_id = supRunId;
  text = JSON.stringify(obj, null, 2);
}
fs.writeFileSync(target, text);
if (writeWitness) {
  const sha = crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
  const witness = {
    schema: "lh06.commit-witness/v1",
    result_path: target,
    result_sha256: badWitness ? "00".repeat(32) : sha,
    supervisor_run_id: obj.supervisor_run_id,
    run_id: (obj.environment_identity && obj.environment_identity.soak_run_id) || "",
    profile: obj.profile,
    verdict: obj.verdict,
    durability: "CRASH_DURABLE",
    captured_at_ms: Date.now(),
  };
  fs.writeFileSync(target + ".commit.json", JSON.stringify(witness, null, 2));
}
process.exit(0);
`;

async function runSupervisorAgainstForgedArtifact(args: {
  readonly forged: Record<string, unknown>;
  readonly rewriteRunId?: boolean;
  readonly writeWitness?: boolean;
  readonly badWitness?: boolean;
}): Promise<PromotionOutcome> {
  const tmpDir = `/tmp/factory-lh06-c31-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  const telemetryDir = join(tmpDir, "telemetry");
  const stubPath = join(tmpDir, "stub-worker.mjs");
  writeFileSync(stubPath, STUB_WORKER);
  const stagedArtifactPath = join(tmpDir, "forged-artifact.json");
  writeFileSync(
    stagedArtifactPath,
    JSON.stringify(args.forged, null, 2),
  );
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
            LH06_PROFILE: "CI_SMOKE",
            LH06_INJECTION: "NONE",
            LH06_RESULT_PATH: resultPath,
            LH06_LAB_ROOT: REPO_ROOT,
            LH06_TELEMETRY_DIR: telemetryDir,
            LH06_WORKER_SCRIPT: stubPath,
            LH06_STAGED_ARTIFACT: stagedArtifactPath,
            LH06_STUB_REWRITE_RUN_ID: args.rewriteRunId ? "1" : "0",
            LH06_STUB_WRITE_WITNESS: args.writeWitness ? "1" : "0",
            LH06_STUB_BAD_WITNESS: args.badWitness ? "1" : "0",
            PATH: `/opt/homebrew/bin:${process.env["PATH"] ?? ""}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.on("exit", (code, signal) => resolveP({ code, signal }));
      child.on("error", rejectP);
    });
    const canonicalExists = existsSync(resultPath);
    const canonical = canonicalExists
      ? JSON.parse(readFileSync(resultPath, "utf8"))
      : null;
    const canonicalSchema =
      canonical !== null &&
      typeof canonical === "object" &&
      canonical !== null &&
      "schema" in (canonical as Record<string, unknown>)
        ? String((canonical as Record<string, unknown>)["schema"])
        : undefined;
    return {
      exitCode: exitInfo.code,
      canonical,
      canonicalExists,
      canonicalSchema,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function assertForgedArtifactRefused(o: PromotionOutcome): void {
  assert.notEqual(
    o.exitCode,
    0,
    "supervisor must exit non-zero when the verifier rejects the worker artifact",
  );
  if (o.canonicalExists) {
    assert.notEqual(
      o.canonicalSchema,
      "lh06.deterministic.soak.result.v1",
      "canonical path must NOT carry the worker schema; the verifier rejected the artifact",
    );
    assert.equal(
      o.canonicalSchema,
      "lh06.supervisor-terminal-result/v1",
      "canonical file must use the supervisor failure schema when the verifier rejects the worker artifact",
    );
    assert.equal(
      (o.canonical as Record<string, unknown>)["verdict"],
      "FAIL_WORKER",
      "supervisor-owned rejection must report verdict=FAIL_WORKER",
    );
    assert.match(
      String(
        ((o.canonical as Record<string, unknown>)[
          "supervisor_termination"
        ] as Record<string, unknown> | undefined)?.[
          "supervisor_reason"
        ] ?? "",
      ),
      /^verifier_rejected:/,
      "supervisor_termination.supervisor_reason must record the verifier rejection",
    );
  }
}

// L06-C31: each forge-attack runs end-to-end through
// the real supervisor. The supervisor must invoke
// `verifyWorkerResult` and refuse to promote the forged
// artifact.

test(
  "L06-C31: supervisor refuses forged wrong-telemetry-hash artifact",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      r["telemetry_sha256"] =
        "0000000000000000000000000000000000000000000000000000000000000000";
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged wrong-supervisor-run-id artifact",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      r["supervisor_run_id"] = "not-the-real-run-id";
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged bad-profile artifact",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      r["profile"] = "PROD";
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged incomplete-substrate artifact",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      const sub = r["substrate"] as Record<string, unknown>;
      sub["phase_e_head"] = null;
      r["substrate_complete"] = false;
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged bad-frozen-tree artifact",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      const ft = r["frozen_tree"] as Record<string, unknown>;
      const status = ft["status"] as Record<string, unknown>;
      status["ok"] = false;
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged insufficient-epochs artifact (CI_SMOKE 9)",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      r["epochs_completed"] = 9;
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged PASS QUALIFICATION with 1ms duration",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      r["profile"] = "QUALIFICATION";
      r["duration_ms"] = 1;
      r["epochs_completed"] = 500;
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor refuses forged inflated-telemetry-bytes artifact",
  { concurrency: false },
  async () => {
    const forged = makeForgedArtifact((r) => {
      r["telemetry_bytes"] = 999_999_999;
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assertForgedArtifactRefused(o);
  },
);

test(
  "L06-C31: supervisor promotes a clean (non-forged) artifact to the canonical path",
  { concurrency: false },
  async () => {
    const clean = makeForgedArtifact(() => {
      /* no mutation */
    });
    const o = await runSupervisorAgainstForgedArtifact({
      forged: clean,
      rewriteRunId: true,
      writeWitness: true,
    });
    assert.equal(o.canonicalExists, true);
    assert.equal(o.canonicalSchema, "lh06.deterministic.soak.result.v1");
    assert.equal(o.exitCode, 0);
  },
);

/**
 * L06-CORRECTION06 L06-C33 supervisor-promotion path:
 * the canonical qualification path must carry a
 * `publication_durability` field with the actual
 * durability class of the supervisor's publish call,
 * not the `null` sentinel the worker-side
 * `buildResult` sets before `writeResult` upgrades
 * it. The verifier reads this field; if the
 * supervisor promotes via `writeFileSync`, the field
 * would be inconsistent with the bytes.
 */
test(
  "L06-C33: supervisor-promoted worker artifact carries CRASH_DURABLE publication_durability",
  { concurrency: false },
  async () => {
    const clean = makeForgedArtifact(() => {
      /* no mutation */
    });
    const o = await runSupervisorAgainstForgedArtifact({
      forged: clean,
      rewriteRunId: true,
    });
    assert.equal(o.canonicalExists, true);
    assert.equal(
      (o.canonical as Record<string, unknown>)["publication_durability"],
      "CRASH_DURABLE",
      "supervisor must publish through crash-durable writer; " +
        "verifier requires CRASH_DURABLE for any PASS_DETERMINISTIC_SOAK " +
        "qualification closure (L06-C33)",
    );
  },
);

test(
  "L06-C33: supervisor-owned failure artifact carries CRASH_DURABLE publication_durability",
  { concurrency: false },
  async () => {
    // PASS @ CI_SMOKE 9 epochs is verifier-rejected
    // with INSUFFICIENT_EPOCHS. The supervisor writes
    // its distinct failure schema, also through the
    // crash-durable publisher.
    const forged = makeForgedArtifact((r) => {
      r["epochs_completed"] = 9;
    });
    const o = await runSupervisorAgainstForgedArtifact({ forged });
    assert.equal(o.canonicalExists, true);
    assert.equal(
      o.canonicalSchema,
      "lh06.supervisor-terminal-result/v1",
    );
    assert.equal(
      (o.canonical as Record<string, unknown>)["publication_durability"],
      "CRASH_DURABLE",
      "supervisor failure artifact must also be published " +
        "through the crash-durable writer (L06-C33)",
    );
  },
);
