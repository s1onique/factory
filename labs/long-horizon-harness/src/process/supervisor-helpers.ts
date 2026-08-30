/**
 * CORRECTION08 — supervisor helpers.
 *
 * Pulled out of supervisor-builder.ts to keep that file
 * under the 400 LOC discipline. Holds the small pure
 * utilities used by both the sync and async supervisor
 * builders:
 *
 *   - defaultIdFactory                 — ProcessId minting
 *   - buildSpawnFailure                — convert an unknown
 *                                        into a typed
 *                                        spawn_failure ProcessFailure
 *   - emptyCaptured                    — empty CapturedOutput
 *   - emptyEscalation                  — empty EscalationEvidence
 *   - invalidSpecSupervisorHandle      — supervisor handle for
 *                                        invalid specs (sync, no
 *                                        side effects)
 *
 * No policy. No I/O. No Node imports beyond the
 * process-types brand.
 */

import { makeProcessId } from "./process-types.js";
import type {
  EscalationEvidence,
  ProcessFailure,
  ProcessHandle,
  ProcessId,
  ProcessResult,
  ProcessSpec,
} from "./process-types.js";
import type { OuterSupervisorResult } from "./outer-supervisor-result.js";

export function defaultIdFactory(): ProcessId {
  const u = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (u !== undefined && typeof u.randomUUID === "function") {
    return makeProcessId(`p-${u.randomUUID()}`);
  }
  return makeProcessId(
    `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
}

export function buildSpawnFailure(e: unknown): ProcessFailure {
  if (typeof e === "object" && e !== null) {
    const o = e as {
      code?: unknown;
      syscall?: unknown;
      path?: unknown;
      message?: unknown;
    };
    const base: { kind: "spawn_failure"; message: string } = {
      kind: "spawn_failure",
      message: typeof o.message === "string" ? o.message : String(e),
    };
    return {
      ...base,
      ...(typeof o.code === "string" ? { code: o.code } : {}),
      ...(typeof o.syscall === "string" ? { syscall: o.syscall } : {}),
      ...(typeof o.path === "string" ? { path: o.path } : {}),
    };
  }
  return { kind: "spawn_failure", message: String(e) };
}

export function emptyCaptured(): ProcessResult["stdout"] {
  return {
    bytesSeen: 0,
    bytesRetained: 0,
    truncated: false,
    buffer: Buffer.alloc(0),
  };
}

export function emptyEscalation(): EscalationEvidence {
  return {
    termRequested: false,
    termSent: false,
    termResult: null,
    killRequested: false,
    killSent: false,
    killResult: null,
    finalGroupProbe: { kind: "absent" },
  };
}

/**
 * The structural Supervisor type — defined here as a
 * structural interface so helpers can return it without
 * pulling in supervisor-builder.ts (which would create an
 * import cycle).
 */
export type SupervisorHandleShape = {
  readonly handle: () => ProcessHandle;
  readonly cancel: () => void;
  readonly await: () => Promise<ProcessResult>;
  readonly awaitOuter: () => Promise<OuterSupervisorResult>;
};

export function invalidSpecSupervisorResult(
  spec: ProcessSpec,
  failure: ProcessFailure,
  idFactory: () => ProcessId,
): SupervisorHandleShape {
  const id = idFactory();
  const now = Date.now();
  const result: ProcessResult = {
    processId: id,
    spec,
    outcome: { kind: "spawn_failed", failure },
    stdout: emptyCaptured(),
    stderr: emptyCaptured(),
    startedAtMs: now,
    finishedAtMs: now,
    escalation: emptyEscalation(),
  };
  return {
    handle: () => ({ processId: id, pid: null, processGroupId: null }),
    cancel: () => {},
    await: () => Promise.resolve(result),
    awaitOuter: () =>
      Promise.resolve({
        kind: "durably_settled",
        process: result,
        observedPgid: null,
        observedPid: null,
      }),
  };
}
