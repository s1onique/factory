/**
 * Shared test helpers for the process-supervision suite.
 *
 * CORRECTION05 doctrine (strict, fail-closed):
 *   - Negative-PGID absence classification:
 *       success            -> alive
 *       ESRCH              -> absent
 *       EPERM              -> denied
 *       ENOSYS/EINVAL/
 *       ENOTSUP            -> unsupported
 *       other unknown code -> unknown
 *     Only `absent` releases registry ownership.
 *     `EPERM` is "permission denied / unproven absence",
 *     never "absent". `unsupported` / `denied` / `alive` /
 *     `unknown` all mean: "we cannot prove absence; keep
 *     the entry in the ledger so the after-suite sweep
 *     can see and fail on it."
 *   - The capability probe refuses to report `available`
 *     unless BOTH the signal-zero probe succeeded AND the
 *     probe group is itself proven absent (ESRCH) after
 *     SIGKILL. Unproven cleanup yields
 *     `unavailable(PROBE_CLEANUP_UNPROVEN)`.
 *   - Helpers accept an optional `probeNegPgid` injection
 *     so the difference between ESRCH/EPERM/unsupported
 *     can be tested deterministically without unsafe real
 *     PIDs.
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

export function snapshotLiveFixturePgids(): number[] {
  return Array.from(liveFixturePgids);
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
// Negative-PGID probe classification (CORRECTION05)
// --------------------------------------------------------------------------

/**
 * Negative-PGID probe result kinds.
 *
 * Only `absent` releases registry ownership. Anything else
 * (alive / denied / unsupported / unknown) means we cannot
 * prove the group is gone and must keep the registry entry.
 */
export type NegPgidProbeKind =
  | "absent"
  | "alive"
  | "denied"
  | "unsupported"
  | "unknown";

export type NegPgidProbe = {
  readonly kind: NegPgidProbeKind;
  readonly code?: string | undefined;
};

/**
 * Real POSIX probe via process.kill(-pgid, 0). Implements
 * the CORRECTION05 classification:
 *
 *   success  -> alive
 *   ESRCH    -> absent
 *   EPERM    -> denied
 *   ENOSYS /
 *   EINVAL /
 *   ENOTSUP  -> unsupported
 *   other    -> unknown
 */
export function realProbeNegPgid(pgid: number): NegPgidProbe {
  try {
    process.kill(-pgid, 0);
    return { kind: "alive" };
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? (e as { code: unknown }).code
        : undefined;
    const codeStr = typeof code === "string" ? code : undefined;
    if (codeStr === "ESRCH") return { kind: "absent", code: codeStr };
    if (codeStr === "EPERM") return { kind: "denied", code: codeStr };
    if (
      codeStr === "ENOSYS" ||
      codeStr === "EINVAL" ||
      codeStr === "ENOTSUP"
    ) {
      return { kind: "unsupported", code: codeStr };
    }
    return { kind: "unknown", code: codeStr };
  }
}

// --------------------------------------------------------------------------
// Capability probe (CORRECTION05: async + proven-cleanup)
// --------------------------------------------------------------------------

export type ProcessGroupCapability =
  | { kind: "available" }
  | {
      kind: "unavailable";
      code: string;
      reason: string;
    };

/**
 * After SIGKILL, repeatedly probe the negative PGID for
 * ESRCH within a bound. Only ESRCH proves absence;
 * EPERM, ENOSYS, EINVAL, ENOTSUP, or any other unknown
 * code does NOT prove absence and must return false.
 *
 * CORRECTION05 (C01): EPERM is not absence.
 */
async function probeAbsenceAfterKill(
  pgid: number,
  probeFn: (pgid: number) => NegPgidProbe = realProbeNegPgid,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < 1500) {
    const probe = probeFn(pgid);
    if (probe.kind === "absent") return true;
    // denied / unsupported / unknown / alive all keep the
    // entry; we wait briefly and retry, but we never treat
    // them as absence.
    await new Promise<void>((res) => setTimeout(res, 50));
  }
  return false;
}

/**
 * Probe whether the host allows negative-PGID signalling.
 *
 * The capability is reported `available` ONLY when BOTH
 * hold:
 *   1. The initial signal-zero probe classified the group
 *      as `alive` (the kill call succeeded).
 *   2. After SIGKILL and bounded reap, the negative-PGID
 *      probe returned `absent` (ESRCH) at least once
 *      inside the bound.
 *
 * If either fails the capability is `unavailable` and the
 * probe PGID is left in the registry so the after-suite
 * sweep (strict lane) will see and fail on the residue.
 *
 * CORRECTION05 (C03): no early `return available` —
 * capability result is finalized only after cleanup proof.
 */
export async function probeProcessGroupCapability(
  probeFn: (pgid: number) => NegPgidProbe = realProbeNegPgid,
): Promise<ProcessGroupCapability> {
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

  // Step 1: classify the initial signal-zero attempt
  // WITHOUT committing a return value.
  let candidate: ProcessGroupCapability;
  let signalZeroSucceeded = false;
  try {
    const initial = probeFn(pgid);
    if (initial.kind === "alive") {
      candidate = { kind: "available" };
      signalZeroSucceeded = true;
    } else if (initial.kind === "denied") {
      candidate = {
        kind: "unavailable",
        code: "PROBE_DENIED",
        reason: "process.kill(-pgid, 0) returned EPERM",
      };
    } else if (initial.kind === "unsupported") {
      candidate = {
        kind: "unavailable",
        code: "PROBE_UNSUPPORTED",
        reason: "negative-PGID signal not available on this host",
      };
    } else if (initial.kind === "unknown") {
      candidate = {
        kind: "unavailable",
        code: initial.code ?? "PROBE_UNKNOWN",
        reason: "process.kill(-pgid, 0) returned an unclassified error",
      };
    } else {
      // initial.kind === "absent" — already gone.
      candidate = {
        kind: "unavailable",
        code: "PROBE_ABSENT",
        reason: "probe group already absent at first probe",
      };
    }
  } catch (e: unknown) {
    candidate = {
      kind: "unavailable",
      code: "PROBE_EXCEPTION",
      reason: `probe threw: ${String(e)}`,
    };
  }

  // Step 2: best-effort SIGKILL the probe group, bounded
  // reap, then prove absence via the negative-PGID probe.
  try {
    try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      let done = false;
      probe.on("exit", () => {
        if (!done) {
          done = true;
          resolve();
        }
      });
      setTimeout(() => {
        if (!done) resolve();
      }, 2000);
    });
    const provenAbsent = await probeAbsenceAfterKill(pgid, probeFn);

    // Step 3: capability finalization.
    if (signalZeroSucceeded && !provenAbsent) {
      // Cleanup could not prove absence — the registry
      // must keep the entry, and the capability must be
      // downgraded to unavailable.
      return {
        kind: "unavailable",
        code: "PROBE_CLEANUP_UNPROVEN",
        reason:
          "signal-zero succeeded but cleanup absence could not be proven (denied/unsupported/unknown/timeout)",
      };
    }

    if (provenAbsent) {
      unregisterLiveFixturePgid(pgid);
    }
    // If not provenAbsent and signalZeroSucceeded is false,
    // the candidate already reflects the initial failure
    // (PROBE_DENIED / PROBE_UNSUPPORTED / PROBE_UNKNOWN /
    // PROBE_ABSENT / PROBE_EXCEPTION) and the registry
    // entry stays.

    return candidate;
  } catch (e: unknown) {
    return {
      kind: "unavailable",
      code: "PROBE_CLEANUP_EXCEPTION",
      reason: `cleanup raised: ${String(e)}`,
    };
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
// runLive — single ownership helper for LIVE01..LIVE14 (CORRECTION05)
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
 * Live-run options. See `realProbeNegPgid` for the real
 * classification (CORRECTION05):
 *   - "absent"      (ESRCH)
 *   - "alive"       (signal-zero succeeded)
 *   - "denied"      (EPERM)
 *   - "unsupported" (ENOSYS/EINVAL/ENOTSUP)
 *   - "unknown"     (any other classification)
 */


export type LiveRunOptions = {
  readonly startSupervised: (a: CreateSupervisorArgs) => Result<Supervisor, ProcessFailure>;
  readonly clock: Clock;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
  /**
   * Optional injected probe. Defaults to `realProbeNegPgid`.
   * Used by ABS/OWN/CAP tests to deterministically exercise
   * ESRCH / EPERM / unsupported / unknown classifications
   * without unsafe real PIDs.
   */
  readonly probeNegPgid?: (pgid: number) => NegPgidProbe;
};

function resolveProbeFn(opts: LiveRunOptions): (pgid: number) => NegPgidProbe {
  return opts.probeNegPgid ?? realProbeNegPgid;
}

/**
 * Best-effort cleanup for one owned PGID.
 *   - if first probe says absent -> unregister
 *   - else SIGKILL -> bounded wait -> final probe
 *     -> only unregister on final probe.kind === "absent"
 *   - anything else (alive / denied / unsupported / unknown)
 *     keeps the registry entry.
 */
async function cleanupOnePgid(
  pgid: number,
  probeFn: (pgid: number) => NegPgidProbe,
): Promise<void> {
  const probe = probeFn(pgid);
  if (probe.kind === "absent") {
    unregisterLiveFixturePgid(pgid);
    return;
  }
  // For alive / denied / unsupported / unknown we still
  // try a best-effort SIGKILL, then re-probe. ONLY the
  // final probe.kind === "absent" releases the registry.
  try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
  await new Promise<void>((res) => setTimeout(res, 200));
  const finalProbe = probeFn(pgid);
  if (finalProbe.kind === "absent") {
    unregisterLiveFixturePgid(pgid);
  }
  // If denied/unsupported/unknown/alive: keep registry.
}

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
  const probeFn = resolveProbeFn(opts);

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
    // ONLY probe.kind === "absent" releases the registry.
    for (const pgid of ownedPgids) {
      await cleanupOnePgid(pgid, probeFn);
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
  const probeFn = resolveProbeFn(opts);
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
    // ONLY probe.kind === "absent" releases the registry.
    for (const pgid of ownedPgids) {
      await cleanupOnePgid(pgid, probeFn);
    }
    void bodyError;
  }
}
