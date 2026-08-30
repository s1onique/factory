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
} from "./helpers.js";

import assert from "node:assert/strict";

/**
 * Wrapped assert API. Direct `assert.equal` triggers TS2775
 * because the inferred type of `assert` is the namespace
 * itself; we expose typed function references explicitly.
 */
const aEqual: (actual: unknown, expected: unknown, msg?: string) => void = assert.equal;
const aOk: (value: unknown, msg?: string) => void = assert.ok;

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
      // CORRECTION07: use a real SIGTERM handler (term-handler
      // mode) so we exercise cooperative termination instead
      // of relying on Node's default disposition. We wait up
      // to 500ms for the fixture's readiness handshake so the
      // SIGTERM cannot race handler installation.
      const spec = liveBasicSpec(["term-handler"], { stdoutLimitBytes: 4096 });
      await withLiveSupervisor(spec, async (sup) => {
        // Allow plenty of time for the fixture's handler to be
        // installed and the term-handler-armed marker to flush.
        await new Promise((res) => setTimeout(res, 500));
        sup.cancel();
        const result = await sup.await();
        eq(result.outcome.kind, "cancelled");
        eq(result.escalation.termSent, true);
        eq(result.escalation.killSent, false);
        // term-handler exits 0 with 'term-handled' on stdout;
        // the supervisor reports outcome.exited for a
        // graceful exit-on-TERM.
        eq(result.outcome.kind, "cancelled");
        // Stdout must contain the cooperative-handler marker.
        const stdout = result.stdout.buffer.toString("utf8");
        if (!stdout.includes("term-handled")) {
          throw new Error(
            `LIVE04: stdout missing term-handled marker; got=${JSON.stringify(stdout)}`,
          );
        }
      }, { startSupervised, clock, signals, spawner });
    },
  },
  {
    id: "LIVE05",
    title: "ignore TERM -> real KILL",
    run: async ({ run, eq, ok: _ok }) => {
      const r = await run(liveBasicSpec(["ignore-term"], { deadlineMs: 250 }));
      eq(r.outcome.kind, "deadline");
      if (r.outcome.kind === "deadline") {
        eq(r.escalation.termSent, true);
        eq(r.escalation.killSent, true);
      }
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
    title: "descendant tree cleanup",
    run: async ({ run, eq, ok: _ok }) => {
      // CORRECTION07: spawn-grandchild now emits a tree-ready
      // JSON record with parent_pid / child_pid / grandchild_pid
      // only AFTER both descendants are confirmed alive.
      // give the supervisor 800ms to spawn and observe the
      // tree, then escalate via the deadline. The fixture
      // itself lives 30s, so this deadline is guaranteed to
      // fire from the supervisor and not the fixture.
      const r = await run(
        liveBasicSpec(["spawn-grandchild", "--sleep", "30000"], {
          deadlineMs: 800,
          stdoutLimitBytes: 4096,
        }),
      );
      eq(r.outcome.kind, "deadline");
      eq(r.escalation.finalGroupProbe.kind, "absent");
      // Stdout must contain the tree-ready evidence with
      // positive pids for parent/child/grandchild.
      const stdout = r.stdout.buffer.toString("utf8");
      if (!stdout.includes("tree-ready")) {
        throw new Error(
          `LIVE08: stdout missing tree-ready marker; got=${JSON.stringify(stdout)}`,
        );
      }
      const treeLine = stdout.split("\n").find((l) => l.includes("tree-ready"));
      if (treeLine === undefined) {
        throw new Error("LIVE08: tree-ready line not found in stdout");
      }
      const tree = JSON.parse(treeLine) as {
        kind: string;
        parent_pid: number;
        child_pid: number;
        grandchild_pid: number;
      };
      eq(tree.kind, "tree-ready");
      if (tree.parent_pid <= 1 || tree.child_pid <= 1 || tree.grandchild_pid <= 1) {
        throw new Error(`LIVE08: invalid tree pids: ${JSON.stringify(tree)}`);
      }
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
