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
 * Probe whether the test harness can deliver signals to its
 * children. Used by `npm test` to classify live OS tests
 * SKIP vs FAIL. The strict live qualification lane
 * (`npm run qualify:process-live`) refuses to run unless
 * this returns true.
 */
export function probeCanSignalChildren(): boolean {
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
  // Best-effort cleanup. The child self-exits in 2s anyway.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  return result;
}

export const HARNESS_CAN_SIGNAL = probeCanSignalChildren();

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
