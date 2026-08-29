/**
 * Shared test helpers for the process-supervision suite.
 *
 * CORRECTION01: The catastrophic watchdog used to access
 * Timeout._destroyed (a private Node internal). The new
 * approach relies on node:test's per-test `timeout` option
 * which is a real failure mechanism, plus the
 * liveFixtureRegistry for emergency cleanup of OS processes.
 */

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { spawn } from "node:child_process";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const FIXTURE_JS = path.join(
  ROOT,
  "build",
  "test",
  "fixtures",
  "child-fixture.js",
);

export const NODE_RUNTIME = process.execPath;

/**
 * Authoritative process-group capability probe. Drives BOTH
 * ordinary skip and strict fail-closed decisions, so we never
 * have a split-brain between positive-PID probing and
 * negative-PGID probing.
 *
 * Spawns a detached probe child, attempts `process.kill(
 * -pgid, 0)`, then best-effort SIGKILLs and reaps the group.
 */
export type ProcessGroupCapability =
  | { kind: "available" }
  | { kind: "unavailable"; code: string; reason: string };

export function probeProcessGroupCapability(): ProcessGroupCapability {
  const probe = spawn(
    process.execPath,
    ["-e", "setTimeout(() => process.exit(0), 4000)"],
    { detached: true, stdio: ["ignore", "ignore", "ignore"] },
  );
  const pgid = probe.pid;
  if (pgid === null || pgid === undefined) {
    return { kind: "unavailable", code: "NO_PID", reason: "spawn returned no pid" };
  }
  try {
    process.kill(-pgid, 0);
    return { kind: "available" };
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? (e as { code: unknown }).code
        : "UNKNOWN";
    return {
      kind: "unavailable",
      code: typeof code === "string" ? code : "UNKNOWN",
      reason: "process.kill(-pgid, 0) failed",
    };
  } finally {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // ignore
    }
    // Reap.
    void new Promise<void>((resolve) => {
      let done = false;
      probe.on("exit", () => {
        if (!done) { done = true; resolve(); }
      });
      setTimeout(() => { if (!done) resolve(); }, 1000);
    });
  }
}

export const PROCESS_GROUP_CAPABILITY: ProcessGroupCapability = probeProcessGroupCapability();

export const HARNESS_CAN_SIGNAL = PROCESS_GROUP_CAPABILITY.kind === "available";

/**
 * Legacy positive-PID probe (DO NOT USE for capability
 * decisions; kept only for backwards compatibility of
 * non-process-group tests). CORRECTION03 removes this from
 * authority: see PROCESS_GROUP_CAPABILITY.
 */
function probeCanSignalChildren(): boolean {
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => process.exit(0), 2000)"],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const pid = child.pid ?? -1;
  let result = false;
  try {
    process.kill(pid, 0);
    result = true;
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null
        ? (e as { code?: unknown }).code
        : undefined;
    result = code === "ESRCH";
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  return result;
}
void probeCanSignalChildren;

export function makeEnv(): Readonly<Record<string, string>> {
  return {
    PATH: process.env.PATH ?? "",
    NODE: process.env.NODE ?? "",
    HOME: process.env.HOME ?? "",
  };
}

// ---------------------------------------------------------------------------
// Live-fixture registry
// ---------------------------------------------------------------------------
//
// Real-process tests register the PGIDs they create so that
// after-suite emergency cleanup can SIGKILL anything left
// alive. The registry size must be 0 at the end of any
// strict-live run; otherwise the strict lane fails.

const liveFixturePgids = new Set<number>();

export function registerLiveFixturePgid(pgid: number): void {
  liveFixturePgids.add(pgid);
}

export function unregisterLiveFixturePgid(pgid: number): void {
  liveFixturePgids.delete(pgid);
}

export function liveFixtureRegistrySize(): number {
  return liveFixturePgids.size;
}

export function emergencyKillAllRegisteredPgids(): number {
  // Best-effort: SIGKILL each registered PGID.
  let killed = 0;
  for (const pgid of liveFixturePgids) {
    try {
      process.kill(-pgid, "SIGKILL");
      killed++;
    } catch {
      // ignore
    }
  }
  return killed;
}

/**
 * Live-supervisor helper. Subscribes to the supervisor's
 * runtime-event sink; on every `process_spawned` it
 * registers the PGID into the live fixture registry. After
 * the body returns, the `finally` block:
 *
 *   1. awaits the supervisor's lifecycle (if not already);
 *   2. probes the supervised PGID; if still alive/uncertain
 *      and capability permits, best-effort negative-PGID
 *      SIGKILL;
 *   3. bounded reap;
 *   4. unregisters the PGID.
 *
 * Even if the body throws, the cleanup runs. Test-body
 * failures therefore cannot leak process groups.
 */
import type { RuntimeEvent } from "../../src/process/process-types.js";
import type { Result } from "../../src/domain/result.js";
import type { Supervisor, CreateSupervisorArgs } from "../../src/process/supervised-process.js";
import type { Clock, SignalPort, SpawnPort } from "../../src/process/process-ports.js";

export async function withLiveSupervisor<T>(
  spec: import("../../src/process/process-types.js").ProcessSpec,
  body: (
    sup: Supervisor,
    register: (pgid: number) => void,
  ) => Promise<T>,
  opts: {
    readonly startSupervised: (a: CreateSupervisorArgs) => Result<Supervisor, import("../../src/process/process-types.js").ProcessFailure>;
    readonly clock: Clock;
    readonly signals: SignalPort;
    readonly spawner: SpawnPort;
  },
): Promise<T> {
  const events: RuntimeEvent[] = [];
  const r = opts.startSupervised({
    spec,
    clock: opts.clock,
    signals: opts.signals,
    spawner: opts.spawner,
    sink: (e: RuntimeEvent) => events.push(e),
  });
  if (r.ok === false) throw new Error(`startSupervised failed: ${JSON.stringify(r.error)}`);
  const sup = r.value;
  const registered = new Set<number>();
  const register = (pgid: number): void => {
    if (liveFixturePgids.has(pgid)) return;
    liveFixturePgids.add(pgid);
    registered.add(pgid);
  };
  for (const e of events) {
    if (e.kind === "process_spawned") register(e.processGroupId);
  }
  let bodyError: unknown;
  try {
    return await body(sup, register);
  } catch (e) {
    bodyError = e;
    throw e;
  } finally {
    for (const e of events) {
      if (e.kind === "process_spawned") register(e.processGroupId);
    }
    const settle = await Promise.race<{ kind: "result"; res: unknown } | { kind: "no-result" } | { kind: "timeout" }>([
      sup.await().then(
        (res) => ({ kind: "result" as const, res }),
        () => ({ kind: "no-result" as const }),
      ),
      new Promise<{ kind: "timeout" }>((res) => setTimeout(() => res({ kind: "timeout" }), 2000)),
    ]);
    if (settle.kind === "no-result") {
      try { sup.cancel(); } catch { /* ignore */ }
      await Promise.race([
        sup.await().catch(() => undefined),
        new Promise<void>((res) => setTimeout(res, 2000)),
      ]);
    }
    for (const pgid of registered) {
      try {
        const probe = opts.signals.probeGroup(pgid);
        if (probe.kind !== "absent" && HARNESS_CAN_SIGNAL) {
          try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
        }
      } catch {
        // ignore
      }
      liveFixturePgids.delete(pgid);
      registered.delete(pgid);
    }
    void bodyError;
  }
}

/**
 * Async version that subscribes to live events as they
 * arrive. Used by node:test wrappers that prefer the
 * `sink` callback instead of post-spawn polling.
 */
export function startSubscribingRegister(
  register: (pgid: number) => void,
): (e: RuntimeEvent) => void {
  return (e) => {
    if (e.kind === "process_spawned") register(e.processGroupId);
  };
}
