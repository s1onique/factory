/**
 * Centralized POSIX process-group signal + liveness probe.
 *
 * Doctrine:
 *   - pgid must be a positive integer > 0.
 *   - pgid === 1 is rejected (init/scheduler, never owned by us).
 *   - signalGroup(0, sig) is a probe, never reaches kill(-pgid, sig)
 *     with arbitrary bytes; it returns the typed classification.
 *   - Invalid inputs are rejected BEFORE process.kill() is reached.
 *   - On EPERM the caller must NOT silently fall back to the
 *     immediate child PID. Doing so would degrade process-group
 *     cleanup to single-process cleanup and is a CORRECTION04
 *     forbid. The caller classifies permission_denied and
 *     fails closed.
 */

import { kill } from "node:process";
import type {
  GroupProbe,
  SignalAttemptResult,
} from "./process-types.js";
import type { SignalPort } from "./process-ports.js";

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
    signalGroup: (pgid, signal) => signalGroupImpl(pgid, signal),
    probeGroup: (pgid) => probeGroupImpl(pgid),
  };
}

function signalGroupImpl(
  pgid: number,
  signal: "SIGTERM" | "SIGKILL" | 0,
): SignalAttemptResult {
  const guard = validatePgid(pgid);
  if (guard !== null) {
    return { kind: "error", code: "EINVAL", message: guard };
  }
  try {
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
