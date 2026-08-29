/**
 * Shared test helpers for the process-supervision suite.
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
 * children. Some sandbox profiles (notably the Cline IDE shell
 * on macOS) deny process.kill(2). When denied, tests that
 * depend on real signal delivery are classified SKIP rather
 * than FAIL.
 */
export function probeCanSignalChildren(): boolean {
  // Spawn a short-lived child and verify we can signal it.
  // The child self-exits after 2s so the test runner doesn't
  // hang if we cannot kill it.
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => process.exit(0), 2000)"],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const pid = child.pid ?? -1;
  let probeOk = false;
  try {
    process.kill(pid, 0);
    probeOk = true;
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null
        ? (e as { code?: unknown }).code
        : undefined;
    // ESRCH means the syscall works (kernel reachable); EPERM
    // means sandbox denied cross-process signaling.
    probeOk = code === "ESRCH";
  }
  // Best-effort cleanup; the child will self-exit anyway.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // ignore
  }
  return probeOk;
}

export const HARNESS_CAN_SIGNAL = probeCanSignalChildren();

export function makeEnv(): Readonly<Record<string, string>> {
  return {
    PATH: process.env.PATH ?? "",
    NODE: process.env.NODE ?? "",
    HOME: process.env.HOME ?? "",
  };
}

export type Watchdog = {
  readonly cancel: () => void;
  readonly fired: () => boolean;
};

/**
 * Outer catastrophic watchdog: if the test's runtime doesn't
 * settle within budgetMs, signal TEST FAIL and force cleanup of
 * any registered process group.
 */
export function catastrophicWatchdog(
  budgetMs: number,
  onFire: () => void,
): Watchdog {
  let fired = false;
  const t = setTimeout(() => {
    fired = true;
    onFire();
  }, budgetMs);
  const original = t as unknown as { _destroyed?: boolean };
  t.unref?.();
  return {
    cancel: () => clearTimeout(t),
    fired: () => fired || original._destroyed === true,
  };
}

/**
 * Standard small config for fast tests: 250 ms deadline, 100 ms
 * each grace. Outer watchdog budget is 5 s.
 */
export const FAST_BUDGET = {
  deadlineMs: 250,
  termGraceMs: 100,
  killGraceMs: 100,
  outerWatchdogMs: 5000,
} as const;

/**
 * Skip the current test if the harness cannot deliver signals.
 * Returns true if the test should proceed, false if it should
 * be skipped.
 */
export function requireSignalCapability(
  t: { skip: (msg: string) => void },
): boolean {
  if (HARNESS_CAN_SIGNAL) return true;
  t.skip(
    "harness denies process.kill(2); cannot supervise real OS processes in this environment",
  );
  return false;
}

export const SKIP_REASON_HARNESS = "harness denies process.kill(2)";
