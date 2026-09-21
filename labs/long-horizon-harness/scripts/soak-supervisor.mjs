#!/usr/bin/env node
/**
 * LH-06 deterministic soak - supervisor entrypoint.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Launches the LH-06 soak worker as a separate child
 * process. Reads heartbeats from stdout, persists the
 * terminal result on every exit path, and writes a
 * failure packet on hard failures.
 *
 * Termination invariant:
 *   EVERY_STARTED_SOAK_HAS_TERMINAL_RESULT = TRUE.
 *
 * The supervisor OWNS the terminal-result synthesis for
 * crash / hang / worker-exit-before-result / malformed-
 * result paths. A signal-terminated child MUST NOT be
 * turned into exit-0; the supervisor propagates a non-zero
 * status to the caller for every failing verdict.
 *
 * Generation-bound result ownership (L06-CORRECTION02 C02-02):
 *   - Each supervisor invocation generates a fresh run-id
 *     and writes to a per-run result path
 *     `LH06_RESULT_PATH.<runId>.json` AND a canonical
 *     `LH06_RESULT_PATH` that is pre-emptively cleared at
 *     supervisor start.
 *   - Stale PASS files from a prior run CANNOT survive a
 *     new failed run: the canonical file is unlinked before
 *     the worker is spawned, and the canonical file is only
 *     written by this supervisor at the end of the run.
 *   - Supervisor-owned failure artifacts use the distinct
 *     schema `lh06.supervisor-terminal-result/v1` so a
 *     watchdog result cannot be mistaken for a worker-result.
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// L06-CORRECTION06 L06-C33: the canonical qualification
// path is promoted through the same crash-durable write
// that the worker uses (`publishAtomicDurableBytes`,
// re-exported from `./soak/result-io.js`). Promoting
// through `writeFileSync` would destroy the durability
// property and the verifier would correctly refuse a
// PASS verdict arriving via the canonical path.
// `publishFn` is filled by the `await import(...)`
// below (next to the verifier load). Until then we
// refuse to do any promotion work — fail closed.
let publishFn = null;

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = process.env["LH06_LAB_ROOT"]
  ? resolve(process.env["LH06_LAB_ROOT"])
  : resolve(here, "..");

const profile = process.env["LH06_PROFILE"] ?? "CI_SMOKE";
const injection = process.env["LH06_INJECTION"] ?? "NONE";

/**
 * L06-CORRECTION11 L06-C46: supervisor owns its own start
 * timestamp. QUALIFICATION01 ran for an hour but the
 * supervisor-generated terminal result claimed
 * `started_at == finished_at` and `duration_ms == 0`.
 * That is false evidence.
 *
 * We capture the supervisor start wall-clock AND the
 * monotonic counterpart at module init. The terminal
 * synthesis uses the monotonic counter for `duration_ms`
 * (so it is not subject to wall-clock skew) and a fresh
 * wall-clock read for `finished_at`. The two are recorded
 * as the supervisor's authoritative timing record.
 */
const supervisorStartedWallClockMs = Date.now();
const supervisorStartedAtIso = new Date(
  supervisorStartedWallClockMs,
).toISOString();
// L06-CORRECTION12 L06-C51 cleanup: `performance.now()`
// returns a millisecond-fractional number directly; the
// previous `performance.now().ofMs ? .ofMs() : performance.now()`
// branch was nonsensical (`.ofMs` does not exist on the
// returned number). Keep the monotonic read simple and
// authoritative.
const supervisorStartedMonotonic = performance.now();

/**
 * Canonical result path. The supervisor clears this BEFORE
 * spawning the worker and is the only writer. The worker
 * receives the per-run path `LH06_RESULT_PATH.<runId>.json`
 * to write into.
 */
const resultPath =
  process.env["LH06_RESULT_PATH"] ??
  resolve(labRoot, "qualification/lh06-deterministic-soak.json");

mkdirSync(dirname(resultPath), { recursive: true });

/**
 * Generation-bound run id. Distinct for each supervisor
 * invocation so two consecutive runs cannot collide on the
 * same artifact path. Used as the suffix for the worker
 * output path and as an env var the worker records.
 */
const runId = createHash("sha256")
  .update(`${process.pid}|${Date.now()}|${Math.random()}`)
  .digest("hex")
  .slice(0, 16);
const workerResultPath = `${resultPath}.${runId}.json`;

const heartbeatTimeoutMs = Number(
  process.env["LH06_HEARTBEAT_TIMEOUT_MS"] ?? 60_000,
);

/**
 * C02-02: pre-emptively clear the canonical result path
 * BEFORE spawning the worker. Stale PASS files from a
 * prior run CANNOT survive a new failed run: the only
 * writer of `resultPath` is THIS supervisor invocation.
 *
 * `unlinkSync` is used (not `rmSync -r`) because we only
 * need to remove a single file. A missing file is fine.
 */
try {
  unlinkSync(resultPath);
} catch (err) {
  // ENOENT (file already absent) is the expected case.
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code !== "ENOENT"
  ) {
    throw err;
  }
}

/**
 * Write a supervisor-owned terminal result. Used when the
 * child died without writing one (crash, hang, malformed
 * JSON) so EVERY_STARTED_SOAK_HAS_TERMINAL_RESULT holds.
 *
 * C02-03: Supervisor failure artifacts use a distinct
 * schema (`lh06.supervisor-terminal-result/v1`) so they
 * cannot be confused with the canonical worker result
 * (`lh06.deterministic.soak.result.v1`). A watchdog
 * result does NOT pretend to be a worker-result.
 *
 * L06-CORRECTION10 L06-C41: the underlying durability
 * bookkeeping is delegated to `writeSupervisorResult`
 * in `soak/result-io.js`, the SAME primitive the
 * worker writer uses. There is no longer a divergent
 * supervisor-only durability loop. On budget exhaustion
 * the shared primitive throws `DurabilityReconciliationError`
 * and the supervisor refuses to claim a terminal result.
 *
 * @returns the supervisor's view of the published
 *   artifact (sha256 + durability). Callers that need
 *   fail-closed behaviour MUST surface a non-zero exit
 *   code if this throws.
 */
function writeSupervisorResult(args) {
  if (writeSupervisorResultIo === null) {
    throw new Error(
      "LH-06 supervisor: writeSupervisorResultIo not loaded; " +
        "refusing to publish supervisor failure artifact (fail closed)",
    );
  }
  // L06-CORRECTION11 L06-C46: capture BOTH the wall clock
  // and the monotonic elapsed at the moment of terminal
  // synthesis. `started_at` is the supervisor's own start
  // (recorded at module init), NOT a value reconstructed
  // from the worker artifact. `duration_ms` is the
  // monotonic elapsed so it is not subject to wall-clock
  // adjustments during the run.
  const finishedAtMs = Date.now();
  const finishedAtIso = new Date(finishedAtMs).toISOString();
  const finishedMonotonic = performance.now();
  const monotonicElapsed = Math.max(
    0,
    finishedMonotonic - supervisorStartedMonotonic,
  );
  // Wall-clock elapsed must agree (or be larger) with the
  // monotonic elapsed. We use the monotonic value as the
  // canonical duration and report the wall-clock pair as
  // the supervisor's truthful start/finish.
  const durationMs = Math.max(
    monotonicElapsed,
    finishedAtMs - supervisorStartedWallClockMs,
  );
  void finishedAtIso;
  void supervisorStartedAtIso;
  return writeSupervisorResultIo({
    path: resultPath,
    profile,
    supervisor_run_id: runId,
    worker_result_path: workerResultPath,
    verdict: args.verdict,
    failure: args.failure,
    child_exit_code: args.child_exit_code ?? null,
    child_exit_signal: args.child_exit_signal ?? null,
    supervisor_reason: args.supervisor_reason,
    started_at_ms: supervisorStartedWallClockMs,
    finished_at_ms: finishedAtMs,
    duration_ms: durationMs,
  });
}

const workerScript = process.env["LH06_WORKER_SCRIPT"]
  ? resolve(process.env["LH06_WORKER_SCRIPT"])
  : resolve(labRoot, "soak/worker-runner.ts");
// L06-CORRECTION04 L06-C23: the worker's default
// telemetry directory is os.tmpdir(). The supervisor
// passes an explicit LH06_TELEMETRY_DIR only when the
// operator opts in (e.g. for a real qualification
// run that wants the closed file retained as durable
// evidence). Without an explicit env override, the
// default lives under os.tmpdir() so the supervisor
// never writes telemetry into the repository.
const telemetryDir = process.env["LH06_TELEMETRY_DIR"]
  ? resolve(process.env["LH06_TELEMETRY_DIR"])
  : resolve(tmpdir(), `factory-lh06-supervisor-${runId}`);
mkdirSync(telemetryDir, { recursive: true });

// L06-CORRECTION05 L06-C27: load the verifier module
// BEFORE spawning the worker so the synchronous exit
// handler can call `verifyWorkerResult` directly. The
// verifier is the single authority for promotion; the
// supervisor delegates to it instead of re-implementing
// the checks itself. We fail closed: if the verifier
// cannot be loaded, the supervisor refuses to promote.
let verifier = null;
let resultIo = null;
let writeSupervisorResultIo = null;
let commitWitness = null;
try {
  const verifierMod = await import(
    resolve(labRoot, "soak/worker-result-verifier.js")
  );
  verifier = verifierMod.verifyWorkerResult;
  resultIo = await import(resolve(labRoot, "soak/result-io.js"));
  publishFn = resultIo.publishAtomicDurableBytes;
  writeSupervisorResultIo = resultIo.writeSupervisorResult;
  // L06-CORRECTION07 L06-C35: load the commit-witness
  // publisher. The supervisor publishes the witness
  // for every promoted PASS verdict. Without the
  // witness, the verifier refuses any PASS closure.
  const cwMod = await import(
    resolve(labRoot, "soak/commit-witness.js")
  );
  commitWitness = cwMod.publishCommitWitness;
} catch (e) {
  console.error(
    "LH-06 SUPERVISOR_VERIFIER_LOAD_FAILED:",
    e instanceof Error ? e.message : String(e),
  );
  // Set up a watchdog that exits if the verifier is not
  // loadable. We intentionally do NOT spawn a worker
  // whose artifact we cannot verify.
  writeFileSync(
    `${dirname(resultPath)}/lh06-supervisor-init-failure.json`,
    JSON.stringify(
      {
        schema: "lh06.failure-packet/v1",
        captured_at_ms: Date.now(),
        supervisor_run_id: runId,
        failure: {
          kind: "WORKER_CRASH",
          epoch: null,
          last_completed_case: null,
          minimal_diff: {
            reason: "verifier_module_load_failed",
            detail:
              e instanceof Error ? e.message : String(e),
          },
          message:
            "supervisor could not load worker-result-verifier.js; aborting",
        },
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(1);
}
if (typeof publishFn !== "function") {
  // L06-CORRECTION06 L06-C33: without the crash-durable
  // publisher the canonical qualification path cannot
  // carry a `CRASH_DURABLE` class. Failing closed is the
  // safer default — promotion through `writeFileSync`
  // would silently destroy the durability property.
  console.error("LH-06 SUPERVISOR_PUBLISH_FN_MISSING");
  writeFileSync(
    `${dirname(resultPath)}/lh06-supervisor-init-failure.json`,
    JSON.stringify(
      {
        schema: "lh06.failure-packet/v1",
        captured_at_ms: Date.now(),
        supervisor_run_id: runId,
        failure: {
          kind: "WORKER_CRASH",
          epoch: null,
          last_completed_case: null,
          minimal_diff: {
            reason: "publish_function_missing",
            detail:
              "soak/result-io.js did not export publishAtomicDurableBytes",
          },
          message:
            "supervisor could not load crash-durable publisher; aborting",
        },
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--expose-gc", workerScript],
  {
    cwd: labRoot,
    env: {
      ...process.env,
      LH06_PROFILE: profile,
      LH06_INJECTION: injection,
      LH06_LAB_ROOT: labRoot,
      LH06_RESULT_PATH: workerResultPath,
      LH06_SUPERVISOR_RUN_ID: runId,
      LH06_TELEMETRY_DIR: telemetryDir,
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);

let lastHeartbeatMs = Date.now();
const recentHeartbeats = [];
let hung = false;
let lastEpochSeen = -1;

child.stdout.setEncoding("utf8");
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        parsed.type === "LH06_HEARTBEAT"
      ) {
        lastHeartbeatMs = Date.now();
        recentHeartbeats.push(lastHeartbeatMs);
        if (recentHeartbeats.length > 20) recentHeartbeats.shift();
        if (typeof parsed.epoch === "number") {
          lastEpochSeen = Math.max(lastEpochSeen, parsed.epoch);
        }
        process.stdout.write(JSON.stringify(parsed) + "\n");
      } else if (
        parsed !== null &&
        typeof parsed === "object" &&
        "type" in parsed &&
        parsed.type === "LH06_WORKER_FATAL"
      ) {
        process.stderr.write(JSON.stringify(parsed) + "\n");
      }
    } catch {
      // not a heartbeat line; ignore
    }
  }
});

/**
 * Hang watchdog poll cadence. We poll at heartbeatTimeout / 4
 * (with a 100ms floor) so a sub-second heartbeat timeout
 * actually catches short hangs. The previous fixed 5000ms
 * poll meant a `heartbeat_timeout_ms=500` was effectively
 * ignored — the watchdog would only fire 10x later than
 * the worker expected.
 */
const watchdogPollMs = Math.max(100, Math.floor(heartbeatTimeoutMs / 4));
const watchdog = setInterval(() => {
  if (hung) return;
  const sinceLast = Date.now() - lastHeartbeatMs;
  if (sinceLast > heartbeatTimeoutMs) {
    hung = true;
    console.error(
      `LH-06 SOAK_HANG: no heartbeat for ${sinceLast}ms; killing worker PID ${child.pid}`,
    );
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    writeFileSync(
      `${dirname(resultPath)}/lh06-failure-${Date.now()}.json`,
      JSON.stringify(
        {
          schema: "lh06.failure-packet/v1",
          captured_at_ms: Date.now(),
          supervisor_run_id: runId,
          failure: {
            kind: "WORKER_HANG",
            epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
            last_completed_case: null,
            minimal_diff: {
              heartbeat_timeout_ms: heartbeatTimeoutMs,
              since_last_ms: sinceLast,
            },
            message: `supervisor killed worker after ${sinceLast}ms without heartbeat`,
          },
          worker_pid: child.pid,
          recent_heartbeats: recentHeartbeats,
        },
        null,
        2,
      ) + "\n",
    );
  }
}, watchdogPollMs);

child.on("exit", (code, signal) => {
  clearInterval(watchdog);

  // L06-CORRECTION05 L06-C27: the supervisor delegates
  // to the SAME verifier the test harness uses. The
  // verifier is the single authority for promotion; the
  // supervisor does NOT inspect the result fields
  // individually. Promotion is gated on `{ok:true}`.
  // `verifier` was loaded at module top (fails closed if
  // it cannot be loaded) so this handler remains
  // synchronous.
  if (existsSync(workerResultPath)) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(workerResultPath, "utf8"));
    } catch (e) {
      raw = null;
    }
    if (raw !== null && typeof verifier === "function") {
      const artifactBytes = readFileSync(workerResultPath, "utf8");
      // L06-CORRECTION07 L06-C35: phase 1 — verify the
      // worker's per-run artifact WITHOUT a witness.
      // The witness doesn't exist yet; the supervisor
      // publishes it after canonical promotion. We do
      // NOT pass `result_bytes` here because that
      // would signal phase 2 (closure) and the verifier
      // would (correctly) reject PASS without a witness.
      const artifactU8 = new TextEncoder().encode(artifactBytes);
      const v = verifier({
        raw,
        expected_supervisor_run_id: runId,
        mode: "PROMOTION",
        result_path: resultPath,
      });
      if (v.ok) {
        // L06-CORRECTION06 L06-C33: promote the worker
        // artifact to the canonical qualification path
        // through the SAME crash-durable write that
        // produced it. A plain `writeFileSync` would
        // destroy the durability class and the verifier
        // would (correctly) refuse a PASS verdict arriving
        // through the canonical path.
        //
        // The worker-side `writeResult` set
        // `publication_durability` on the JSON bytes
        // already. We re-publish those exact bytes; the
        // durability class travels with them.
        const dur = publishFn(resultPath, artifactBytes);
        if (
          v.result.verdict === "PASS_DETERMINISTIC_SOAK" &&
          dur !== "CRASH_DURABLE"
        ) {
          // The publisher could not commit the parent
          // directory entry. The artifact is on disk but
          // a power loss between the rename and any
          // later read could lose the rename. Refuse
          // PASS closure — emit a supervisor failure
          // artifact instead.
          writeSupervisorResult({
            failure: {
              kind: "WORKER_CRASH",
              epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
              last_completed_case: null,
              minimal_diff: {
                child_exit_code: code ?? null,
                child_exit_signal: signal ?? null,
                publication_durability: dur,
              },
              message: `PASS verdict arrived at canonical path but ` +
                `publication_durability=${dur} (not CRASH_DURABLE); ` +
                `verifier would reject. Cannot serve as LH-06 closure ` +
                `evidence.`,
            },
            verdict: "FAIL_WORKER",
            child_exit_code: code,
            child_exit_signal: signal,
            supervisor_reason:
              `pass_but_publication_not_crash_durable:${dur}`,
          });
          process.exit(1);
        }
        // L06-CORRECTION07 L06-C35: publish the commit
        // witness BEFORE claiming PASS closure. The
        // witness is the closure authority — a dangling
        // PASS JSON with no witness is not closure.
        let witness = null;
        if (
          v.result.verdict === "PASS_DETERMINISTIC_SOAK"
        ) {
          if (typeof commitWitness !== "function") {
            // The supervisor cannot publish a witness
            // (e.g. the witness module failed to load).
            // Refuse PASS closure.
            writeSupervisorResult({
              failure: {
                kind: "WORKER_CRASH",
                epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
                last_completed_case: null,
                minimal_diff: {
                  child_exit_code: code ?? null,
                  child_exit_signal: signal ?? null,
                },
                message:
                  "PASS verdict arrived but supervisor could not " +
                  "load the commit-witness publisher; refusing " +
                  "PASS closure (L06-CORRECTION07 L06-C35).",
              },
              verdict: "FAIL_WORKER",
              child_exit_code: code,
              child_exit_signal: signal,
              supervisor_reason:
                "pass_but_commit_witness_publisher_missing",
            });
            process.exit(1);
          }
          const runIdOfArtifact =
            v.result.environment_identity?.soak_run_id ?? null;
          const pub = commitWitness({
            result_path: resultPath,
            result_bytes: artifactU8,
            supervisor_run_id: runId,
            run_id: runIdOfArtifact ?? "",
            profile: v.result.profile,
            verdict: v.result.verdict,
          });
          witness = pub.witness;
          if (pub.durability !== "CRASH_DURABLE") {
            // The witness publish itself could not
            // commit the parent directory entry.
            // Refuse PASS closure.
            writeSupervisorResult({
              failure: {
                kind: "WORKER_CRASH",
                epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
                last_completed_case: null,
                minimal_diff: {
                  child_exit_code: code ?? null,
                  child_exit_signal: signal ?? null,
                  witness_durability: pub.durability,
                },
                message:
                  `PASS verdict arrived but the commit witness ` +
                  `published with durability=${pub.durability} (not ` +
                  `CRASH_DURABLE); refusing PASS closure ` +
                  `(L06-CORRECTION07 L06-C35).`,
              },
              verdict: "FAIL_WORKER",
              child_exit_code: code,
              child_exit_signal: signal,
              supervisor_reason:
                `pass_but_commit_witness_not_crash_durable:${pub.durability}`,
            });
            process.exit(1);
          }
        }
        // L06-CORRECTION07 L06-C35: re-verify the
        // canonical artifact with the witness included.
        // This is the final closure gate: the verifier
        // recomputes SHA(canonical bytes) and checks
        // the witness binds correctly.
        if (
          v.result.verdict === "PASS_DETERMINISTIC_SOAK" &&
          witness !== null
        ) {
          let canonicalRaw;
          try {
            canonicalRaw = JSON.parse(
              readFileSync(resultPath, "utf8"),
            );
          } catch (e) {
            canonicalRaw = null;
          }
          const v2 = verifier({
            raw: canonicalRaw,
            expected_supervisor_run_id: runId,
            mode: "CLOSURE",
            result_path: resultPath,
            result_bytes: new TextEncoder().encode(
              readFileSync(resultPath, "utf8"),
            ),
            commit_witness_raw: witness,
          });
          if (!v2.ok) {
            writeSupervisorResult({
              failure: {
                kind: "WORKER_CRASH",
                epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
                last_completed_case: null,
                minimal_diff: {
                  verifier_reason: v2.reason,
                  verifier_detail: v2.detail,
                },
                message:
                  `commit-witness re-verification failed: ${v2.reason} (${v2.detail})`,
              },
              verdict: "FAIL_WORKER",
              child_exit_code: code,
              child_exit_signal: signal,
              supervisor_reason: `commit_witness_reverify_failed:${v2.reason}`,
            });
            process.exit(1);
          }
        }
        // A signal-terminated child ALWAYS exits non-zero,
        // even if the verifier approved the result; the
        // worker's process was killed, which itself is a
        // failure of normal termination.
        if (signal !== null && signal !== undefined) {
          process.exit(1);
        }
        process.exit(
          v.result.verdict === "PASS_DETERMINISTIC_SOAK" ? 0 : 1,
        );
      }
      // The verifier rejected the artifact. Synthesize a
      // supervisor failure so EVERY_STARTED_SOAK_HAS_TERMINAL_RESULT
      // holds. The canonical result uses the SUPERVISOR
      // schema so it cannot be confused with a worker
      // artifact the verifier refused to promote.
      writeSupervisorResult({
        failure: {
          kind: "WORKER_CRASH",
          epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
          last_completed_case: null,
          minimal_diff: {
            verifier_reason: v.reason,
            verifier_detail: v.detail,
            child_exit_code: code ?? null,
            child_exit_signal: signal ?? null,
          },
          message: `worker-result verifier rejected artifact: ${v.reason} (${v.detail})`,
        },
        verdict: "FAIL_WORKER",
        child_exit_code: code,
        child_exit_signal: signal,
        supervisor_reason: `verifier_rejected:${v.reason}`,
      });
      process.exit(1);
    }
  }

  // Worker exited without producing a terminal result. The
  // supervisor synthesizes one so the artifact is always
  // durable, using the supervisor-owned schema.
  const failureKind = signal ? "WORKER_HANG" : "WORKER_CRASH";
  writeSupervisorResult({
    failure: {
      kind: failureKind,
      epoch: lastEpochSeen >= 0 ? lastEpochSeen : null,
      last_completed_case: null,
      minimal_diff: {
        child_exit_code: code ?? null,
        child_exit_signal: signal ?? null,
      },
      message: `worker exited without terminal result (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    },
    verdict: "FAIL_WORKER",
    child_exit_code: code,
    child_exit_signal: signal,
    supervisor_reason: signal
      ? "child terminated by signal"
      : "child exited without producing terminal result",
  });
  // Exit non-zero: a missing terminal result is itself a
  // failure, never a successful operation.
  process.exit(1);
});

// Belt-and-braces: if anything throws in the supervisor
// itself, write a minimal failure artifact and exit 1.
process.on("uncaughtException", (err) => {
  console.error("LH-06 SUPERVISOR_UNCAUGHT:", err);
  writeSupervisorResult({
    failure: {
      kind: "WORKER_CRASH",
      epoch: null,
      last_completed_case: null,
      minimal_diff: { message: err?.message ?? String(err) },
      message: "supervisor caught uncaughtException",
    },
    verdict: "FAIL_WORKER",
    supervisor_reason: "supervisor_uncaught_exception",
  });
  process.exit(1);
});
