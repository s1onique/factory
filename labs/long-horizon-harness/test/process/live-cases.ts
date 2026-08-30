/**
 * live-cases.ts
 *
 * Single maintained implementation of the Factory
 * subprocess-supervisor LIVE01..LIVE15 matrix.
 */
import type {
  ProcessFailure,
  ProcessResult,
  ProcessSpec,
} from "../../src/process/process-types.js";
import type { SignalPort, SpawnPort, Clock } from "../../src/process/process-ports.js";
import type { Supervisor, CreateSupervisorArgs } from "../../src/process/supervised-process.js";
import type { Result } from "../../src/domain/result.js";
import {
  FIXTURE_JS,
  NODE_RUNTIME,
  makeEnv,
  withLiveSupervisor,
  registerLiveFixturePgid,
  unregisterLiveFixturePgid,
  tapStdoutUntil,
} from "./helpers.js";

import assert from "node:assert/strict";

/**
 * Wrapped assert API. Direct `assert.equal` triggers TS2775
 * because the inferred type of `assert` is the namespace
 * itself; we expose typed function references explicitly.
 */
const aEqual: (actual: unknown, expected: unknown, msg?: string) => void = assert.equal;
const aOk: (value: unknown, msg?: string) => void = assert.ok;

/**
 * Parse one JSON line as `unknown` and validate that it
 * matches the tree-ready shape (CORRECTION08 trust
 * boundary). Returns null on any mismatch; never throws.
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

export type LiveCaseRunner = (a: {
  readonly run: (spec: ProcessSpec) => Promise<ProcessResult>;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
  readonly clock: Clock;
  readonly startSupervised: (args: CreateSupervisorArgs) => Result<Supervisor, ProcessFailure>;
  readonly eq: typeof aEqual;
  readonly ok: typeof aOk;
}) => Promise<void>;

export type LiveCase = { readonly id: string; readonly title: string; readonly run: LiveCaseRunner };

export function liveBasicSpec(args: string[], overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  return {
    executable: NODE_RUNTIME,
    args: [FIXTURE_JS, ...args],
    cwd: "/tmp",
    env: makeEnv(),
    deadlineMs: 60000,
    termGraceMs: 200,
    killGraceMs: 200,
    stdoutLimitBytes: 1024 * 1024,
    stderrLimitBytes: 1024 * 1024,
    ...overrides,
  };
}

export const LIVE_CASES: readonly LiveCase[] = [
  {
    id: "LIVE01",
    title: "exit 0",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["exit", "--code", "0"]));
      eq(r.outcome.kind, "exited");
      if (r.outcome.kind === "exited") eq(r.outcome.exitCode, 0);
    },
  },
  {
    id: "LIVE02",
    title: "exit nonzero",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["exit", "--code", "42"]));
      eq(r.outcome.kind, "exited");
      if (r.outcome.kind === "exited") eq(r.outcome.exitCode, 42);
    },
  },
  {
    id: "LIVE03",
    title: "spawn ENOENT",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec([], { executable: "/this/path/does/not/exist" }));
      eq(r.outcome.kind, "spawn_failed");
    },
  },
  {
    id: "LIVE04",
    title: "cooperative TERM via cancel",
    run: async ({ startSupervised, signals, spawner, clock, eq, ok: _ok }) => {
      // CORRECTION08: actually observe the fixture's
      // readiness handshake BEFORE cancel(). We tap the
      // spawner's stdout so we see the 'term-handler-armed'
      // marker as soon as the fixture installs its SIGTERM
      // handler. Only then do we cancel(). No fixed sleep.
      //
      // Mechanically:
      //   spawn
      //   -> stdout: term-handler-ready
      //   -> stdout: term-handler-armed   <-- we await this
      //   cancel()
      //   -> TERM sent
      //   -> stdout: term-handled
      //   -> close
      //   outcome: cancelled
      const spec = liveBasicSpec(["term-handler"], { stdoutLimitBytes: 4096 });
      const tap = tapStdoutUntil(spawner, "term-handler-armed", 5000);
      await withLiveSupervisor(spec, async (sup) => {
        // Bounded readiness handshake.
        await tap.arrived;
        sup.cancel();
        const result = await sup.await();
        eq(result.outcome.kind, "cancelled");
        eq(result.escalation.termSent, true);
        eq(result.escalation.killSent, false);
        // term-handler exits 0 with 'term-handled' on stdout;
        // prove the cooperative marker was captured.
        const stdout = result.stdout.buffer.toString("utf8");
        if (!stdout.includes("term-handler-ready")) {
          throw new Error(
            `LIVE04: stdout missing term-handler-ready marker; got=${JSON.stringify(stdout)}`,
          );
        }
        if (!stdout.includes("term-handler-armed")) {
          throw new Error(
            `LIVE04: stdout missing term-handler-armed marker; got=${JSON.stringify(stdout)}`,
          );
        }
        if (!stdout.includes("term-handled")) {
          throw new Error(
            `LIVE04: stdout missing term-handled marker; got=${JSON.stringify(stdout)}`,
          );
        }
        // Ordering proof: ready < armed < handled.
        const idxReady = stdout.indexOf("term-handler-ready");
        const idxArmed = stdout.indexOf("term-handler-armed");
        const idxHandled = stdout.indexOf("term-handled");
        if (!(idxReady < idxArmed && idxArmed < idxHandled)) {
          throw new Error(
            `LIVE04: marker ordering broken; ready=${idxReady} armed=${idxArmed} handled=${idxHandled}`,
          );
        }
      }, { startSupervised, clock, signals, spawner: tap.spawner });
    },
  },
  {
    id: "LIVE05",
    title: "ignore TERM -> real KILL",
    run: async ({ run, eq, ok: _ok }) => {
      // CORRECTION09: a real POSIX host may exhibit a
      // zombie/reap race on the SIGKILL path. After SIGKILL
      // is sent, the direct child becomes a zombie until
      // Node reaps it; during that window a signal-zero
      // group probe can still appear "alive". The
      // supervisor's KILL grace must NOT report
      // cleanup_failed on this transient visibility. It
      // MUST await the direct-child close (which removes
      // the zombie) and re-probe the group only after that.
      //
      // If this assertion fails, dump the full evidence
      // shape so we can see exactly where the race lives.
      const r = await run(liveBasicSpec(["ignore-term"], { deadlineMs: 250 }));
      if (r.outcome.kind !== "deadline") {
        // Diagnostic dump on failure only; never on success.
        throw new Error(
          `LIVE05 expected outcome=deadline, got=${JSON.stringify({
            kind: r.outcome.kind,
            failure: r.outcome.kind === "cleanup_failed"
              ? r.outcome.failure
              : undefined,
            escalation: r.escalation,
          })}`,
        );
      }
      eq(r.escalation.termSent, true);
      eq(r.escalation.killSent, true);
      // Final group probe MUST be absent. The supervisor's
      // combined close + group-absent proof is what makes
      // this a real cleanup, not a paper one.
      eq(r.escalation.finalGroupProbe.kind, "absent");
    },
  },
  {
    id: "LIVE06",
    title: "deadline fires",
    run: async ({ run, eq, ok: _ok }) => {
      // CORRECTION07: sleep fixture now uses a ref'ed
      // lifetime timer. deadlineMs is set generously to
      // 500ms to give the supervisor room to spawn and
      // register, while still being well below the fixture's
      // 30s natural exit. The previous 200ms deadline raced
      // with fixture startup on some hosts.
      const r = await run(liveBasicSpec(["sleep", "--ms", "30000"], { deadlineMs: 500 }));
      eq(r.outcome.kind, "deadline");
      if (r.outcome.kind === "deadline") {
        // The supervisor must have escalated. TERM at minimum;
        // KILL is sent after the grace period.
        eq(r.escalation.termSent, true);
      }
    },
  },
  {
    id: "LIVE07",
    title: "explicit cancel",
    run: async ({ startSupervised, signals, spawner, clock, eq, ok: _ok }) => {
      const spec = liveBasicSpec(["sleep", "--ms", "5000"]);
      await withLiveSupervisor(spec, async (sup) => {
        await new Promise((res) => setTimeout(res, 50));
        sup.cancel();
        const result = await sup.await();
        eq(result.outcome.kind, "cancelled");
      }, { startSupervised, clock, signals, spawner });
    },
  },
  {
    id: "LIVE08",
    title: "descendant tree cleanup (trigger=explicit_cancel_after_tree_ready)",
    run: async ({ startSupervised, signals, spawner, clock, eq, ok: _ok }) => {
      // CORRECTION08: LIVE08 no longer races tree construction
      // against a tight deadline. It:
      //   1. Spawns spawn-grandchild with a generous deadline
      //      (30s, well above fixture startup but well below
      //      what would actually expire during the test).
      //   2. Waits for the explicit 'tree-ready' handshake on
      //      stdout, proving parent/child/grandchild exist.
      //   3. Then issues an explicit cancel().
      //   4. Asserts outcome=cancelled, finalGroupProbe=absent.
      //
      // This separates the questions:
      //   - "Did the tree exist?"  -> handled by FX04 + the
      //      tree-ready handshake.
      //   - "Can the supervisor clean up a confirmed owned
      //      3-process tree?"  -> LIVE08.
      //
      // LIVE06 remains the authoritative deadline path.
      const spec = liveBasicSpec(
        ["spawn-grandchild", "--sleep", "30000"],
        {
          deadlineMs: 30000,
          termGraceMs: 200,
          killGraceMs: 500,
          stdoutLimitBytes: 8192,
        },
      );
      const tap = tapStdoutUntil(spawner, "tree-ready", 10000);
      await withLiveSupervisor(spec, async (sup) => {
        // Bounded tree readiness handshake.
        await tap.arrived;
        sup.cancel();
        const result = await sup.await();
        eq(result.outcome.kind, "cancelled");
        eq(result.escalation.finalGroupProbe.kind, "absent");
        eq(result.escalation.termSent, true);
        // Stdout must contain a tree-ready JSON record with
        // positive pids for parent/child/grandchild. We use
        // the explicit trust-boundary parser (unknown -> shape
        // check) rather than a structural cast.
        const stdout = result.stdout.buffer.toString("utf8");
        const treeLine = stdout
          .split("\n")
          .find((l) => l.includes("tree-ready"));
        if (treeLine === undefined) {
          throw new Error(
            `LIVE08: stdout missing tree-ready marker; got=${JSON.stringify(stdout)}`,
          );
        }
        const tree = tryParseTreeReady(treeLine);
        if (tree === null) {
          throw new Error(
            `LIVE08: tree-ready failed shape validation: ${JSON.stringify(treeLine)}`,
          );
        }
        if (
          tree.parent_pid <= 1 ||
          tree.child_pid <= 1 ||
          tree.grandchild_pid <= 1
        ) {
          throw new Error(
            `LIVE08: invalid tree pids: ${JSON.stringify(tree)}`,
          );
        }
      }, { startSupervised, clock, signals, spawner: tap.spawner });
    },
  },
  {
    id: "LIVE09",
    title: "group probe after cleanup = absent",
    run: async ({ startSupervised, signals, spawner, clock, eq, ok: _ok }) => {
      const spec = liveBasicSpec(["sleep", "--ms", "5000"]);
      await withLiveSupervisor(spec, async (sup) => {
        await new Promise((res) => setTimeout(res, 50));
        sup.cancel();
        await sup.await();
        const handle = sup.handle();
        const pgid = handle.processGroupId;
        if (pgid !== null) {
          const probe = signals.probeGroup(pgid);
          eq(probe.kind, "absent");
        }
      }, { startSupervised, clock, signals, spawner });
    },
  },
  {
    id: "LIVE10",
    title: "stdout flood",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["flood-stdout", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
      eq(r.stdout.bytesRetained, 1024);
      eq(r.stdout.truncated, true);
    },
  },
  {
    id: "LIVE11",
    title: "stderr flood",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["flood-stderr", "--bytes", "20000", "--chunk", "1024"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
      eq(r.stderr.bytesRetained, 1024);
      eq(r.stderr.truncated, true);
    },
  },
  {
    id: "LIVE12",
    title: "mixed flood",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["mixed-output", "--bytes", "20000"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
      eq(r.stdout.bytesRetained, 1024);
      eq(r.stderr.bytesRetained, 1024);
    },
  },
  {
    id: "LIVE13",
    title: "invalid UTF-8",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["invalid-utf8"], { stdoutLimitBytes: 1024, stderrLimitBytes: 1024 }));
      eq(r.stdout.bytesSeen, 4);
    },
  },
  {
    id: "LIVE14",
    title: "self-signal",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["crash"]));
      eq(r.outcome.kind, "signaled");
    },
  },
  {
    id: "LIVE15",
    title: "negative-PGID signal-zero probe",
    run: async ({ ok }) => {
      const { spawn } = await import("node:child_process");
      const c = spawn(NODE_RUNTIME, [FIXTURE_JS, "sleep", "--ms", "5000"], { detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ...makeEnv() } });
      const pgid = c.pid;
      if (pgid === null || pgid === undefined) throw new Error("no pid");
      // Synchronous registration: register BEFORE any further
      // hazardous logic (signal-zero, SIGKILL, reap).
      registerLiveFixturePgid(pgid);
      try {
        await new Promise((res) => setTimeout(res, 50));
        process.kill(-pgid, 0);
        process.kill(-pgid, "SIGKILL");
        await new Promise<void>((resolve) => {
          let done = false;
          c.on("exit", () => { if (!done) { done = true; resolve(); } });
          setTimeout(() => { if (!done) resolve(); }, 1000);
        });
        // Probe absence before unregistering.
        let absent = false;
        try {
          process.kill(-pgid, 0);
        } catch (e: unknown) {
          const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
          if (code === "ESRCH") absent = true;
        }
        if (absent) unregisterLiveFixturePgid(pgid);
      } catch (e) {
        // Leave the registry entry intact so after-suite sweep
        // can see it.
        throw e;
      }
      ok(true, "negative-PGID signal-zero probe succeeded");
    },
  },
];
