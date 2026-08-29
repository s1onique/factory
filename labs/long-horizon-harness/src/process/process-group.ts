/**
 * Centralized POSIX process-group signal + liveness probe.
 *
 * PGID safety doctrine:
 *   - pgid must be a positive integer > 0
 *   - pgid === 1 is treated as a programmer error (init/scheduler)
 *   - signalGroup(0, sig) must NEVER reach process.kill — that
 *     targets the entire process group of the caller.
 *   - NaN / negative / non-integer / undefined are rejected before
 *     the OS call.
 *
 * Production implementation delegates to Node's process.kill with
 * the POSIX negative-pgid convention. Tests can construct a fake
 * `SignalPort` to simulate ESRCH, EPERM, etc., without ever
 * exercising the real OS.
 */

import { kill } from "node:process";
import type { SignalPort } from "./process-ports.js";
import type { GroupProbe, SignalAttemptResult } from "./process-types.js";

/**
 * Validate a pgid is safe to send to process.kill().
 *
 * Returns null when valid, or a reason string when invalid.
 *
 * Rejected inputs:
 *   - non-integers
 *   - NaN, ±Infinity
 *   - <= 0
 *   - pgid === 1 (init/scheduler — never owned by us)
 */
export function validatePgid(pgid: number): string | null {
  if (!Number.isInteger(pgid)) {
    return `pgid must be an integer; got ${pgid}`;
  }
  if (!Number.isFinite(pgid)) {
    return `pgid must be finite; got ${pgid}`;
  }
  if (pgid <= 0) {
    return `pgid must be positive; got ${pgid}`;
  }
  if (pgid === 1) {
    return `pgid === 1 (init) is never a valid supervised pgid`;
  }
  return null;
}

export function nodeSignalPort(): SignalPort {
  return {
    signalGroup: (pgid, signal, immediateChildPid) =>
      immediateChildPid === undefined
        ? signalGroupImpl(pgid, signal)
        : signalGroupOrChild(pgid, immediateChildPid, signal as "SIGTERM" | "SIGKILL"),
    probeGroup: (pgid) => probeGroupImpl(pgid),
  };
}

function signalGroupImpl(
  pgid: number,
  signal: "SIGTERM" | "SIGKILL" | 0,
): SignalAttemptResult {
  const guard = validatePgid(pgid);
  if (guard !== null) {
    return {
      kind: "error",
      code: "EINVAL",
      message: guard,
    };
  }
  try {
    // process.kill with negative pgid targets the process group.
    kill(-pgid, signal);
    return { kind: "sent", signal };
  } catch (e: unknown) {
    return classifyKillError(e, signal);
  }
}

function probeGroupImpl(pgid: number): GroupProbe {
  const guard = validatePgid(pgid);
  if (guard !== null) {
    return {
      kind: "probe_error",
      code: "EINVAL",
      message: guard,
    };
  }
  try {
    kill(-pgid, 0);
    return { kind: "alive" };
  } catch (e: unknown) {
    return classifyProbeError(e);
  }
}

/**
 * Variant used during supervisor-driven cleanup. Some platforms
 * (notably macOS) return EPERM on `kill(-pgid, ...)` when the
 * caller is not in the same session as the target group, even
 * when the caller owns the process. The supervisor holds
 * authoritative ownership via the immediate child PID, so we
 * attempt the negative-PID signal first and, on EPERM, fall
 * back to signalling the immediate child PID.
 *
 * The fallback target MUST be the immediate child of the
 * supervisor; descendants are still addressed via the group
 * (which the supervisor cannot reach on EPERM — this is the
 * documented platform limitation in §66 of the ACT).
 */
export function signalGroupOrChild(
  pgid: number,
  immediateChildPid: number,
  signal: "SIGTERM" | "SIGKILL",
): SignalAttemptResult {
  const guard = validatePgid(pgid);
  if (guard !== null) {
    return { kind: "error", code: "EINVAL", message: guard };
  }
  if (!Number.isInteger(immediateChildPid) || immediateChildPid <= 0) {
    return {
      kind: "error",
      code: "EINVAL",
      message: `immediateChildPid must be a positive integer; got ${immediateChildPid}`,
    };
  }
  try {
    kill(-pgid, signal);
    return { kind: "sent", signal };
  } catch (e: unknown) {
    const code = errorCode(e);
    if (code === "EPERM") {
      // Fall back: signal the immediate child. This works
      // because the supervisor created the process and remains
      // its parent.
      try {
        kill(immediateChildPid, signal);
        return { kind: "sent", signal };
      } catch (e2: unknown) {
        return classifyKillError(e2, signal);
      }
    }
    return classifyKillError(e, signal);
  }
}

function classifyKillError(
  e: unknown,
  signal: "SIGTERM" | "SIGKILL" | 0,
): SignalAttemptResult {
  const code = errorCode(e);
  const message = errorMessage(e);
  if (code === "ESRCH") {
    return { kind: "group_absent" };
  }
  if (code === "EPERM") {
    return code !== undefined
      ? { kind: "permission_denied", code }
      : { kind: "permission_denied" };
  }
  return code !== undefined
    ? { kind: "error", code, message: `${message} (signal=${signal})` }
    : { kind: "error", message: `${message} (signal=${signal})` };
}

function classifyProbeError(e: unknown): GroupProbe {
  const code = errorCode(e);
  const message = errorMessage(e);
  if (code === "ESRCH") {
    return { kind: "absent" };
  }
  if (code === "EPERM") {
    return code !== undefined
      ? { kind: "permission_denied", code }
      : { kind: "permission_denied" };
  }
  return code !== undefined
    ? { kind: "probe_error", code, message }
    : { kind: "probe_error", message };
}

function errorCode(e: unknown): string | undefined {
  if (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string"
  ) {
    return (e as { code: string }).code;
  }
  return undefined;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
