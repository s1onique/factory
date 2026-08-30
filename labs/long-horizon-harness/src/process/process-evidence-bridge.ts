/**
 * FOUNDATION03 — process-evidence bridge (header).
 */

import type {
  PersistedProcessEvidencePayload,
} from "../evidence/codec-types.js";
import type {
  ProcessEvidenceCommitResult,
  ProcessEvidenceSink,
} from "./process-evidence-sink.js";
import type {
  ProcessId,
  RuntimeEvent,
} from "./process-types.js";

export type EvidenceCommitObserver = {
  readonly onOwnershipDurableCommitFailed: (
    payload: PersistedProcessEvidencePayload,
    result: Extract<ProcessEvidenceCommitResult, { ok: false }>,
  ) => void;
  readonly onNonCriticalCommitFailed: (
    payload: PersistedProcessEvidencePayload,
    result: Extract<ProcessEvidenceCommitResult, { ok: false }>,
  ) => void;
};

const DEFAULT_OBSERVER: EvidenceCommitObserver = {
  onOwnershipDurableCommitFailed: () => {},
  onNonCriticalCommitFailed: () => {},
};

function brandEventId(s: string): import("../domain/ids.js").EventId {
  return s as unknown as import("../domain/ids.js").EventId;
}
function brandRunId(s: string): import("../domain/ids.js").RunId {
  return s as unknown as import("../domain/ids.js").RunId;
}
function brandMissionId(s: string): import("../domain/ids.js").MissionId {
  return s as unknown as import("../domain/ids.js").MissionId;
}

function isOwnershipBoundary(p: PersistedProcessEvidencePayload): boolean {
  return p.kind === "process_spawned";
}

export class PendingCommitsTracker {
  private readonly commits: Array<Promise<ProcessEvidenceCommitResult>> = [];
  add(p: Promise<ProcessEvidenceCommitResult>): void {
    this.commits.push(p);
  }
  async waitAll(): Promise<ReadonlyArray<ProcessEvidenceCommitResult>> {
    const snap = this.commits.slice();
    const out: ProcessEvidenceCommitResult[] = [];
    for (const p of snap) {
      out.push(await p);
    }
    return out;
  }
}

/**
 * Persist a single payload through the sink and track it. The
 * returned sink is the same one the bridge will keep using.
 */
function persistOne(args: {
  readonly evidenceSink: ProcessEvidenceSink;
  readonly eventIdFactory: () => string;
  readonly runId: string;
  readonly missionId: string;
  readonly tracker: PendingCommitsTracker;
  readonly observer: EvidenceCommitObserver;
  readonly payload: PersistedProcessEvidencePayload;
}): void {
  const p = args.evidenceSink.append({
    eventId: brandEventId(args.eventIdFactory()),
    runId: brandRunId(args.runId),
    missionId: brandMissionId(args.missionId),
    observedAt: Date.now(),
    payload: args.payload,
  });
  args.tracker.add(p);
  p.then(
    (r) => {
      if (r.ok === false) {
        if (isOwnershipBoundary(args.payload)) {
          args.observer.onOwnershipDurableCommitFailed(args.payload, r);
        } else {
          args.observer.onNonCriticalCommitFailed(args.payload, r);
        }
      }
    },
    () => {},
  );
}

/**
 * Translate a RuntimeEvent into the persisted payloads that the
 * supervisor emits in response, then write each through the
 * sink. The function is `void`; durability commits run in the
 * background, but the tracker captures every promise so the
 * supervisor can `await tracker.waitAll()` at the result
 * boundary.
 */
export function emitWithPersistence(args: {
  readonly processId: ProcessId;
  readonly evidenceSink: ProcessEvidenceSink;
  readonly eventIdFactory: () => string;
  readonly runId: string;
  readonly missionId: string;
  readonly tracker: PendingCommitsTracker;
  readonly observer?: EvidenceCommitObserver;
  readonly event: RuntimeEvent | SyntheticRuntimeEvent;
  readonly innerSink: (e: RuntimeEvent) => void;
}): void {
  const obs = args.observer ?? DEFAULT_OBSERVER;
  // Inner sink for runtime events; synthetic events are
  // persistence-only and not part of FOUNDATION02's outer
  // RuntimeEvent contract.
  if (isRuntimeEvent(args.event)) {
    args.innerSink(args.event);
  }
  const payloads = toPersistedPayloads(args.event, args.processId);
  for (const payload of payloads) {
    persistOne({
      evidenceSink: args.evidenceSink,
      eventIdFactory: args.eventIdFactory,
      runId: args.runId,
      missionId: args.missionId,
      tracker: args.tracker,
      observer: obs,
      payload,
    });
  }
}

/**
 * A type guard distinguishing RuntimeEvent from the synthetic
 * close / output_summary / result_committed events.
 */
export function isRuntimeEvent(
  e: RuntimeEvent | SyntheticRuntimeEvent,
): e is RuntimeEvent {
  return (
    e.kind === "process_spawn_started" ||
    e.kind === "process_spawned" ||
    e.kind === "process_spawn_failed" ||
    e.kind === "stdout_progress" ||
    e.kind === "stderr_progress" ||
    e.kind === "stdout_closed" ||
    e.kind === "stderr_closed" ||
    e.kind === "deadline_reached" ||
    e.kind === "cancellation_requested" ||
    e.kind === "signal_sent" ||
    e.kind === "process_exit_observed" ||
    e.kind === "cleanup_probe" ||
    e.kind === "cleanup_verified" ||
    e.kind === "cleanup_failed" ||
    e.kind === "stdio_failure"
  );
}

/**
 * Synthetic RuntimeEvent variants emitted by the supervisor at
 * close, output summary, and result commit boundaries. They are
 * NOT part of the FOUNDATION02 RuntimeEvent union so they do
 * not leak into existing tests, but they share the same
 * persisted-payload translation pipeline.
 */
export type SyntheticRuntimeEvent =
  | {
      readonly kind: "process_close_observed";
      readonly processId: ProcessId;
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {
      readonly kind: "process_output_summary";
      readonly processId: ProcessId;
      readonly stdout: import("./process-types.js").CapturedOutput;
      readonly stderr: import("./process-types.js").CapturedOutput;
    }
  | {
      readonly kind: "process_result_committed";
      readonly processId: ProcessId;
      readonly result: import("./process-types.js").ProcessResult;
    };

import type {
  CapturedOutput,
  EscalationEvidence as RuntimeEscalationEvidence,
  GroupProbe as RuntimeGroupProbe,
  ProcessFailure as RuntimeProcessFailure,
  ProcessResult,
  SignalAttemptResult,
} from "./process-types.js";
import type {
  PersistedEscalationEvidence,
  PersistedGroupProbe,
  PersistedOutputSummary,
  PersistedProcessFailure,
  PersistedProcessResult,
  PersistedSignalAttemptResult,
} from "../evidence/codec-types.js";

function toPersistedPayloads(
  e: RuntimeEvent | SyntheticRuntimeEvent,
  pid: ProcessId,
): ReadonlyArray<PersistedProcessEvidencePayload> {
  switch (e.kind) {
    case "process_spawn_started":
      return [{ kind: "process_spawn_requested", process_id: pid }];
    case "process_spawned":
      return [
        {
          kind: "process_spawned",
          process_id: pid,
          pid: e.pid,
          pgid: e.processGroupId,
        },
      ];
    case "process_spawn_failed":
      return [
        {
          kind: "process_spawn_failed",
          process_id: pid,
          failure: encodeFailure(e.failure),
        },
      ];
    case "deadline_reached":
      return [{ kind: "process_deadline_reached", process_id: pid }];
    case "cancellation_requested":
      return [{ kind: "process_cancel_requested", process_id: pid }];
    case "signal_sent":
      return [
        {
          kind: "process_signal_attempted",
          process_id: pid,
          signal: e.signal === 0 ? "SIGTERM" : e.signal,
        },
        {
          kind: "process_signal_result",
          process_id: pid,
          signal: e.signal === 0 ? "SIGTERM" : e.signal,
          result: encodeSignalResult(e.result),
        },
      ];
    case "cleanup_probe":
      return [
        {
          kind: "process_group_probe",
          process_id: pid,
          probe: encodeProbe(e.probe),
        },
      ];
    case "process_close_observed":
      return [
        {
          kind: "process_close_observed",
          process_id: pid,
          exit_code: e.exitCode,
          signal: e.signal,
        },
      ];
    case "process_output_summary":
      return [
        {
          kind: "process_output_summary",
          process_id: pid,
          stdout: encodeOutput(e.stdout),
          stderr: encodeOutput(e.stderr),
        },
      ];
    case "process_result_committed":
      return [
        {
          kind: "process_result_committed",
          process_id: pid,
          result: encodeResult(e.result),
        },
      ];
    case "process_exit_observed":
    case "cleanup_verified":
    case "cleanup_failed":
    case "stdout_progress":
    case "stderr_progress":
    case "stdout_closed":
    case "stderr_closed":
    case "stdio_failure":
      return [];
  }
}

function encodeFailure(f: RuntimeProcessFailure): PersistedProcessFailure {
  switch (f.kind) {
    case "invalid_process_spec":
      return { kind: f.kind, message: f.message };
    case "spawn_failure":
      return {
        kind: "spawn_failure",
        message: f.message,
        ...(f.code !== undefined ? { code: f.code } : {}),
        ...(f.syscall !== undefined ? { syscall: f.syscall } : {}),
        ...(f.path !== undefined ? { path: f.path } : {}),
      };
    case "signal_failure":
      return {
        kind: "signal_failure",
        signal: f.signal,
        message: f.message,
        ...(f.code !== undefined ? { code: f.code } : {}),
      };
    case "cleanup_timeout":
      return { kind: "cleanup_timeout", phase: f.phase, message: f.message };
    case "stdio_failure":
      return {
        kind: "stdio_failure",
        stream: f.stream,
        message: f.message,
        ...(f.code !== undefined ? { code: f.code } : {}),
      };
    case "internal_process_failure":
      return { kind: f.kind, message: f.message };
    case "capability_unavailable":
      return { kind: f.kind, message: f.message };
  }
}

function encodeSignalResult(
  r: SignalAttemptResult,
): PersistedSignalAttemptResult {
  switch (r.kind) {
    case "sent":
      return { result_kind: "sent", signal: r.signal };
    case "group_absent":
      return { result_kind: "group_absent" };
    case "permission_denied":
      return {
        result_kind: "permission_denied",
        ...(r.code !== undefined ? { code: r.code } : {}),
      };
    case "error":
      return {
        result_kind: "error",
        message: r.message,
        ...(r.code !== undefined ? { code: r.code } : {}),
      };
  }
}

function encodeProbe(p: RuntimeGroupProbe): PersistedGroupProbe {
  switch (p.kind) {
    case "alive":
      return { probe_kind: "alive" };
    case "absent":
      return { probe_kind: "absent" };
    case "permission_denied":
      return {
        probe_kind: "permission_denied",
        ...(p.code !== undefined ? { code: p.code } : {}),
      };
    case "probe_error":
      return {
        probe_kind: "probe_error",
        message: p.message,
        ...(p.code !== undefined ? { code: p.code } : {}),
      };
  }
}

function encodeEscalation(
  e: RuntimeEscalationEvidence,
): PersistedEscalationEvidence {
  return {
    term_requested: e.termRequested,
    term_sent: e.termSent,
    term_result:
      e.termResult === null ? null : encodeSignalResult(e.termResult),
    kill_requested: e.killRequested,
    kill_sent: e.killSent,
    kill_result:
      e.killResult === null ? null : encodeSignalResult(e.killResult),
    final_group_probe: encodeProbe(e.finalGroupProbe),
  };
}

function encodeOutput(o: CapturedOutput): PersistedOutputSummary {
  return {
    bytes_seen: o.bytesSeen,
    bytes_retained: o.bytesRetained,
    truncated: o.truncated,
  };
}

function encodeResult(r: ProcessResult): PersistedProcessResult {
  const o = r.outcome;
  switch (o.kind) {
    case "exited":
      return { outcome_kind: "exited", exit_code: o.exitCode };
    case "signaled":
      return {
        outcome_kind: "signaled",
        signal: o.signal,
        exit_code: o.exitCode,
      };
    case "deadline":
      return {
        outcome_kind: "deadline",
        escalation: encodeEscalation(o.escalation),
      };
    case "cancelled":
      return {
        outcome_kind: "cancelled",
        escalation: encodeEscalation(o.escalation),
      };
    case "spawn_failed":
      return {
        outcome_kind: "spawn_failed",
        failure: encodeFailure(o.failure),
      };
    case "cleanup_failed":
      return {
        outcome_kind: "cleanup_failed",
        failure: encodeFailure(o.failure),
        escalation: encodeEscalation(o.escalation),
      };
  }
}
