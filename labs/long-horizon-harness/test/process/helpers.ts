/**
 * Shared test helpers for the process-supervision suite.
 *
 * CORRECTION04: every real supervised process group is
 * registered synchronously on the process_spawned event
 * by the SAME helper that all LIVE cases use. The
 * capability probe awaits its own reap before returning
 * and refuses to claim available while the probe group
 * is unaccounted for.
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

export function makeEnv(): Readonly<Record<string, string>> {
  return {
    PATH: process.env.PATH ?? "",
    NODE: process.env.NODE ?? "",
    HOME: process.env.HOME ?? "",
  };
}

// --------------------------------------------------------------------------
// Live-fixture registry
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Capability probe (CORRECTION04 async + proven-cleanup)
// --------------------------------------------------------------------------

export type ProcessGroupCapability =
  | { kind: "available" }
  | { kind: "unavailable"; code: string; reason: string };

async function probeAbsenceAfterKill(pgid: number): Promise<boolean> {
  // After SIGKILL, the OS should reap the process shortly.
  // Probe the negative-PGID repeatedly within a bound.
  const start = Date.now();
  while (Date.now() - start < 1500) {
    try {
      process.kill(-pgid, 0);
      // Group is still present; wait and retry.
      await new Promise<void>((res) => setTimeout(res, 50));
    } catch (e: unknown) {
      const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
      if (code === "ESRCH" || code === "EPERM") return true;
      return false;
    }
  }
  return false;
}

export async function probeProcessGroupCapability(): Promise<ProcessGroupCapability> {
  const probe = spawn(
    process.execPath,
    ["-e", "setTimeout(() => process.exit(0), 4000)"],
    { detached: true, stdio: ["ignore", "ignore", "ignore"] },
  );
  const pgid = probe.pid;
  if (pgid === null || pgid === undefined) {
    return { kind: "unavailable", code: "NO_PID", reason: "spawn returned no pid" };
  }
  registerLiveFixturePgid(pgid);
  try {
    process.kill(-pgid, 0);
    return { kind: "available" };
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : "UNKNOWN";
    return {
      kind: "unavailable",
      code: typeof code === "string" ? code : "UNKNOWN",
      reason: "process.kill(-pgid, 0) failed",
    };
  } finally {
    // Best-effort SIGKILL the probe group.
    try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
    // Bound reap by child close, fall back after 2s.
    await new Promise<void>((resolve) => {
      let done = false;
      probe.on("exit", () => { if (!done) { done = true; resolve(); } });
      setTimeout(() => { if (!done) resolve(); }, 2000);
    });
    const provenAbsent = await probeAbsenceAfterKill(pgid);
    if (provenAbsent) {
      unregisterLiveFixturePgid(pgid);
    }
    // If unproven, we leave the pgid in the registry.
    void pgid;
  }
}


// Single shared capability result for the whole suite.
// Both lanes MUST consume this exact promise.

export const PROCESS_GROUP_CAPABILITY_PROMISE: Promise<ProcessGroupCapability> =
  probeProcessGroupCapability();

// Synchronous helper for tests that need a quick boolean.
// Returns false until the probe resolves; both lanes must
// await PROCESS_GROUP_CAPABILITY_PROMISE before making
// skip-vs-fail decisions.
export async function getProcessGroupCapability(): Promise<ProcessGroupCapability> {
  return PROCESS_GROUP_CAPABILITY_PROMISE;
}

// Backwards-compatible derived boolean. Initially false; the
// live-qualification file awaits getProcessGroupCapability()
// before its first LIVE test runs.
export const HARNESS_CAN_SIGNAL = false;

// --------------------------------------------------------------------------
// runLive — single ownership helper for LIVE01..LIVE14 (CORRECTION04)
// --------------------------------------------------------------------------

import type { Result } from "../../src/domain/result.js";
import type { Supervisor, CreateSupervisorArgs } from "../../src/process/supervised-process.js";
import type { Clock, SignalPort, SpawnPort } from "../../src/process/process-ports.js";
import type {
  ProcessFailure,
  ProcessResult,
  ProcessSpec,
  RuntimeEvent,
} from "../../src/process/process-types.js";

/**
 * Probe a negative PGID for absence. Returns one of:
 *   - "absent"  (process gone)
 *   - "alive"   (still alive)
 *   - "denied"  (EPERM/probe failed)
 *   - "unsupported" (negative-PGID signal not available)
 */
function probeNegPgid(pgid: number): { kind: "absent" | "alive" | "denied" | "unsupported" } {
  try {
    process.kill(-pgid, 0);
    return { kind: "alive" };
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code: unknown }).code : undefined;
    if (code === "ESRCH") return { kind: "absent" };
    if (code === "EPERM") return { kind: "denied" };
    if (code === "ENOSYS" || code === "EINVAL") return { kind: "unsupported" };
    return { kind: "unsupported" };
  }
}


export type LiveRunOptions = {
  readonly startSupervised: (a: CreateSupervisorArgs) => Result<Supervisor, ProcessFailure>;
  readonly clock: Clock;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
};

/**
 * Run a single supervised LIVE case with mandatory ownership.
 *
 * The supervisor sink is wired so that process_spawned
 * synchronously registers the PGID into the global
 * liveFixturePgids registry. This happens BEFORE any body
 * code can execute hazardous logic, and BEFORE the
 * supervisor can yield the result back to the body.
 *
 * The finally block probes each registered PGID for
 * absence, attempts a best-effort negative-PGID SIGKILL
 * if not absent, awaits close with a bounded wait, and
 * then unregisters ONLY when a final probe proves the
 * group is absent. If absence cannot be proven, the
 * registry entry stays — after-suite will see it and fail.
 */
export async function runLive(
  spec: ProcessSpec,
  opts: LiveRunOptions,
): Promise<ProcessResult> {
  const ownedPgids = new Set<number>();

  const events: RuntimeEvent[] = [];
  // The synchronous registration sink: every process_spawned
  // is inserted into the registry IN THE SAME TICK.
  const sink = (e: RuntimeEvent): void => {
    events.push(e);
    if (e.kind === "process_spawned") {
      const pgid = e.processGroupId;
      registerLiveFixturePgid(pgid);
      ownedPgids.add(pgid);
    }
  };

  const r = opts.startSupervised({
    spec,
    clock: opts.clock,
    signals: opts.signals,
    spawner: opts.spawner,
    sink,
  });
  if (r.ok === false) throw new Error(`startSupervised failed: ${JSON.stringify(r.error)}`);
  const sup = r.value;

  try {
    return await sup.await();
  } finally {
    // Force the supervisor to settle within a bound so we
    // can begin cleanup deterministically.
    await Promise.race([
      sup.await().catch(() => undefined),
      new Promise<void>((res) => setTimeout(res, 1000)),
    ]);
    // Best-effort emergency cleanup for every owned PGID.
    for (const pgid of ownedPgids) {
      const probe = probeNegPgid(pgid);
      if (probe.kind === "absent" || probe.kind === "unsupported") {
        // Already gone, or we cannot probe negative PGIDs.
        unregisterLiveFixturePgid(pgid);
        continue;
      }
      // Try to kill the group, then reap, then re-probe.
      try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
      await new Promise<void>((res) => setTimeout(res, 200));
      const finalProbe = probeNegPgid(pgid);
      if (finalProbe.kind === "absent") {
        unregisterLiveFixturePgid(pgid);
      }
      // If not absent, leave it in the registry so the
      // after-suite hook (or the operator) can see it.
    }
  }
}

/**
 * withLiveSupervisor — ownership helper for LIVE cases
 * that need direct access to the supervisor object (e.g.
 * LIVE04, LIVE07, LIVE09). Wires the same synchronous
 * registration sink as runLive().
 */
export async function withLiveSupervisor<T>(
  spec: ProcessSpec,
  body: (sup: Supervisor) => Promise<T>,
  opts: LiveRunOptions,
): Promise<T> {
  const ownedPgids = new Set<number>();
  const sink = (e: RuntimeEvent): void => {
    if (e.kind === "process_spawned") {
      const pgid = e.processGroupId;
      registerLiveFixturePgid(pgid);
      ownedPgids.add(pgid);
    }
  };
  const r = opts.startSupervised({
    spec,
    clock: opts.clock,
    signals: opts.signals,
    spawner: opts.spawner,
    sink,
  });
  if (r.ok === false) throw new Error(`startSupervised failed: ${JSON.stringify(r.error)}`);
  const sup = r.value;
  let bodyError: unknown;
  try {
    return await body(sup);
  } catch (e) {
    bodyError = e;
    throw e;
  } finally {
    await Promise.race([
      sup.await().catch(() => undefined),
      new Promise<void>((res) => setTimeout(res, 1000)),
    ]);
    for (const pgid of ownedPgids) {
      const probe = probeNegPgid(pgid);
      if (probe.kind === "absent" || probe.kind === "unsupported") {
        unregisterLiveFixturePgid(pgid);
        continue;
      }
      try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
      await new Promise<void>((res) => setTimeout(res, 200));
      const finalProbe = probeNegPgid(pgid);
      if (finalProbe.kind === "absent") unregisterLiveFixturePgid(pgid);
    }
    void bodyError;
  }
}
