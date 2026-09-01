/**
 * _live_registry.ts
 * (B0-QUALIFICATION02)
 *
 * Singleton registry for test-owned LedgerWriter live
 * fixtures. Every spawned writer child, runDir, and
 * socket pathname MUST be registered here at creation
 * time, and ONLY unregistered after proven cleanup
 * (child reaped via ESRCH / poll, path absent via
 * lstat, lease dir absent).
 *
 * This is the residue oracle. fs.rm(...).catch(...) is
 * NOT proof of cleanup — it is a request that may
 * silently fail. The strict lane counts anything
 * registered at suite start that was NOT proven
 * unlinked as residue.
 *
 * No production code is included here. This module is
 * test-only.
 */

import { promises as fs } from "node:fs";

export type LiveFixtureKind = "writer_child" | "helper_child" | "run_dir" | "socket_path" | "lease_dir";

export type LiveFixtureEntry = {
  readonly kind: LiveFixtureKind;
  readonly ref: unknown;
  readonly path?: string | undefined;
  readonly pid?: number | undefined;
  readonly note: string;
};

const registry: LiveFixtureEntry[] = [];

export function registerLiveFixture(entry: LiveFixtureEntry): void {
  registry.push(entry);
}

export function unregisterLiveFixture(entry: LiveFixtureEntry): void {
  const idx = registry.indexOf(entry);
  if (idx >= 0) registry.splice(idx, 1);
}

/**
 * Unregister every entry whose `path` matches the
 * given path exactly. Returns the number of entries
 * removed. Used by the strict lane after a proven
 * cleanup so the registry reflects ground truth.
 *
 * (B0-QUALIFICATION04) Lifecycle separation: this is
 * only safe AFTER `proveUnlink` succeeded; residue
 * classification depends on registry truth matching
 * filesystem truth.
 */
export function unregisterLiveFixtureByPath(p: string): number {
  let removed = 0;
  for (let i = registry.length - 1; i >= 0; i--) {
    const e = registry[i];
    if (e !== undefined && e.path === p) {
      registry.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

/**
 * (B0-QUALIFICATION04) Register a runDir as a
 * NON-OWNED fixture. The strict lane tracks runDirs
 * for residue accounting but the per-case lifecycle
 * explicitly distinguishes writer-stop from
 * evidence-preservation from runDir-cleanup.
 *
 * `destroyRunDir()` is the ONLY operation permitted
 * to remove this entry; child termination MUST NOT
 * touch it.
 */
export function registerRunDirForTracking(args: {
  readonly runDir: string;
  readonly note: string;
}): LiveFixtureEntry {
  const entry: LiveFixtureEntry = {
    kind: "run_dir",
    ref: undefined,
    path: args.runDir,
    note: args.note,
  };
  registerLiveFixture(entry);
  return entry;
}

/**
 * (B0-QUALIFICATION04) Destroy a runDir and prove
 * its absence; on success, unregister the registry
 * entry. Returns true iff the path was proven absent
 * after the operation.
 *
 * Failure semantics:
 *   - Throws if the path STILL exists after `fs.rm`,
 *     OR if the registry has no matching entry.
 *   - Swallowed fs.rm errors are NOT acceptable:
 *     they leave ground truth < registry truth,
 *     which the strict lane counts as residue.
 */
export async function destroyRunDir(p: string): Promise<boolean> {
  await fs.rm(p, { recursive: true, force: true });
  // Prove absence: lstat must raise ENOENT.
  let absent = false;
  try {
    await fs.lstat(p);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") absent = true;
  }
  if (!absent) {
    throw new Error(`destroyRunDir: path still present after rm: ${p}`);
  }
  const removed = unregisterLiveFixtureByPath(p);
  if (removed === 0) {
    throw new Error(`destroyRunDir: no registered run_dir entry for ${p}`);
  }
  return true;
}

export function liveFixtureRegistrySize(): number {
  return registry.length;
}

export function snapshotLiveFixtures(): ReadonlyArray<LiveFixtureEntry> {
  return registry.slice();
}

/**
 * Probe whether a path is absent. Returns true only if
 * lstat raises ENOENT.
 */
export async function probePathAbsent(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return false;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return true;
    return false;
  }
}

/**
 * Best-effort unlink of a path with no throw.
 * Returns true iff the path was absent at exit time
 * (proved by ENOENT on lstat after the operation).
 *
 * Use this for sockets / lease dirs where missing
 * is acceptable. For runDir evidence lifecycle, use
 * `destroyRunDir` instead — it THROWS on failure so
 * residue accounting cannot be silently bypassed.
 */
export async function proveUnlink(p: string): Promise<boolean> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  return await probePathAbsent(p);
}

/**
 * Prove a ChildProcess is absent. SIGKILL after
 * already-exited is a no-op. We require exitCode /
 * signalCode !== null within a bounded wait.
 */
export async function proveChildAbsent(
  child: import("node:child_process").ChildProcess,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // best-effort
  }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/**
 * Sweep all registered fixtures. Returns the residue
 * list (entries that could NOT be proven cleaned).
 */
export async function sweepAndProve(): Promise<ReadonlyArray<LiveFixtureEntry>> {
  const failed: LiveFixtureEntry[] = [];
  for (let i = registry.length - 1; i >= 0; i--) {
    const e = registry[i];
    if (e === undefined) continue;
    let proved = false;
    if (e.kind === "writer_child" || e.kind === "helper_child") {
      const child = e.ref as import("node:child_process").ChildProcess;
      proved = await proveChildAbsent(child);
    } else if (e.path !== undefined) {
      proved = await proveUnlink(e.path);
    }
    if (proved) {
      unregisterLiveFixture(e);
    } else {
      failed.push(e);
    }
  }
  return failed;
}

/**
 * Register a writer child + its socket + its lease
 * dir + its runDir atomically.
 *
 * (B0-QUALIFICATION04) The runDir IS registered
 * here for residue accounting, but it is NOT touched
 * by writer termination. The qualification wrapper
 * no longer calls `fs.rm(runDir)` inside
 * `WriterHandle.stop()`. The runDir is destroyed
 * ONLY by `destroyRunDir(runDir)`, which the case
 * body invokes explicitly after evidence reads.
 *
 * Evidence-preservation invariant enforced:
 *
 *   stopping the writer MUST NOT delete the ledger
 *   before the case finishes reading it.
 *
 * Returns the registered entries so the caller can
 * unregister them explicitly if needed.
 */
export function registerWriterSpawn(args: {
  readonly child: import("node:child_process").ChildProcess;
  readonly runDir: string;
  readonly socketPath: string;
}): readonly [
  LiveFixtureEntry,
  LiveFixtureEntry,
  LiveFixtureEntry,
  LiveFixtureEntry,
] {
  const leaseDir = `${args.runDir}/ledger-writer-owner`;
  const childEntry: LiveFixtureEntry = {
    kind: "writer_child",
    ref: args.child,
    pid: args.child.pid,
    path: args.socketPath,
    note: `writer child pid=${args.child.pid ?? "?"}`,
  };
  const sockEntry: LiveFixtureEntry = {
    kind: "socket_path",
    ref: undefined,
    path: args.socketPath,
    note: `socket ${args.socketPath}`,
  };
  const leaseEntry: LiveFixtureEntry = {
    kind: "lease_dir",
    ref: undefined,
    path: leaseDir,
    note: `lease dir ${leaseDir}`,
  };
  const runDirEntry: LiveFixtureEntry = {
    kind: "run_dir",
    ref: undefined,
    path: args.runDir,
    note: `run dir ${args.runDir}`,
  };
  registerLiveFixture(childEntry);
  registerLiveFixture(sockEntry);
  registerLiveFixture(leaseEntry);
  registerLiveFixture(runDirEntry);
  return [childEntry, sockEntry, leaseEntry, runDirEntry] as const;
}

export function registerHelperSpawn(args: {
  readonly child: import("node:child_process").ChildProcess;
  readonly note: string;
}): LiveFixtureEntry {
  const entry: LiveFixtureEntry = {
    kind: "helper_child",
    ref: args.child,
    pid: args.child.pid,
    note: args.note,
  };
  registerLiveFixture(entry);
  return entry;
}

/**
 * Narrow port for any "owned child" the live lane can
 * terminate and prove absent.
 *
 *   pid:    observed child PID (set by Node's spawn())
 *   kill:   send a signal (best-effort; does NOT prove exit)
 *
 * The residue oracle does NOT require anything else from
 * the child. In particular, it does NOT need the full
 * ChildProcess interface — that would force the test
 * harness to widen `r.value.child` (a narrower
 * WitnessSpawnHandle) to a wider type, which is a
 * coupling tax (CORRECTION03 P2).
 */
export type OwnedChildPort = {
  readonly pid: number | null;
  kill(signal?: NodeJS.Signals): boolean;
};

/**
 * (FOUNDATION04 CORRECTION02/CORRECTION03) Register a
 * witness child produced by Phase A's `startWitness`
 * gate. The entry MUST be unregistered ONLY after
 * `proveChildAbsent` succeeded. Without this
 * registration, the strict lane could certify
 * WITNESS_START_LIVE_RESIDUE=0 without proving the
 * witness actually disappeared (Q15: signal-sent is not
 * proof-of-cleanup).
 *
 * `witnessInstanceId` is recorded as the note so the
 * residue sweep can identify which witness (if any)
 * failed to clean up.
 */
export function registerWitnessSpawn(args: {
  readonly child: OwnedChildPort;
  readonly witnessInstanceId: string;
  readonly runDir: string;
}): LiveFixtureEntry {
  const entry: LiveFixtureEntry = {
    kind: "helper_child",
    ref: args.child,
    pid: args.child.pid ?? undefined,
    note:
      `witness instance=${args.witnessInstanceId} ` +
      `runDir=${args.runDir}`,
  };
  registerLiveFixture(entry);
  return entry;
}
