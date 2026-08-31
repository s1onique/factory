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
 * Register a writer child + its socket + its runDir +
 * its lease dir atomically. Returns the entries so the
 * caller can unregister explicitly after proven
 * cleanup.
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
  const runDirEntry: LiveFixtureEntry = {
    kind: "run_dir",
    ref: undefined,
    path: args.runDir,
    note: `run dir ${args.runDir}`,
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
  registerLiveFixture(childEntry);
  registerLiveFixture(runDirEntry);
  registerLiveFixture(sockEntry);
  registerLiveFixture(leaseEntry);
  return [childEntry, runDirEntry, sockEntry, leaseEntry] as const;
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
