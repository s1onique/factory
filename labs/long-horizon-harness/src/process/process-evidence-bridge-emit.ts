/**
 * FOUNDATION03 process-evidence bridge — emit logic.
 *
 * Translates FOUNDATION02 RuntimeEvents (and synthetic close /
 * output_summary / result_committed events) into
 * PersistedProcessEvidencePayload records and writes them
 * through a {@link ProcessEvidenceSink}. The durable identity
 * (run / mission / attempt / process) is supplied by the caller
 * via {@link ProcessEvidenceIdentity}; no string laundering.
 *
 * Companion to {@link ./process-evidence-bridge.ts} which holds
 * the type definitions and observer interface.
 */

import type { AttemptId } from "../domain/ids.js";
import type {
  PersistedProcessEvidencePayload,
} from "../evidence/codec-types.js";
import type { ProcessEvidenceCommitResult, ProcessEvidenceSink } from "./process-evidence-sink.js";
import type {
  ProcessId,
  RuntimeEvent,
} from "./process-types.js";
import type {
  EvidenceCommitObserver,
  ProcessEvidenceIdentity,
  SyntheticRuntimeEvent,
} from "./process-evidence-bridge.js";
import {
  encodeFailure,
  encodeOutput,
  encodeProbe,
  encodeResult,
  encodeSignalResult,
} from "./process-evidence-bridge-encoders.js";

const DEFAULT_OBSERVER: EvidenceCommitObserver = {
  onOwnershipDurableCommitFailed: () => {},
  onNonCriticalCommitFailed: () => {},
};

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

function persistOne(args: {
  readonly evidenceSink: ProcessEvidenceSink;
  readonly identity: ProcessEvidenceIdentity;
  readonly tracker: PendingCommitsTracker;
  readonly observer: EvidenceCommitObserver;
  readonly payload: PersistedProcessEvidencePayload;
}): Promise<ProcessEvidenceCommitResult> {
  const p = isCriticalBoundary(args.payload)
    ? args.evidenceSink.commitCritical({
        eventId: args.identity.eventIdFactory(),
        runId: args.identity.runId,
        missionId: args.identity.missionId,
        observedAt: Date.now(),
        payload: args.payload,
      })
    : args.evidenceSink.commitObservation({
        eventId: args.identity.eventIdFactory(),
        runId: args.identity.runId,
        missionId: args.identity.missionId,
        observedAt: Date.now(),
        payload: args.payload,
      });
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
    () => {
      // CORRECTION02 OG03: internal sink malfunction. The returned
      // promise already rejects; we suppress the fire-and-forget
      // observer-side unhandled rejection here.
    },
  );
  // CORRECTION03 §1: preserve the raw critical-promise semantics.
  // The Promise returned to callers (notably the supervisor's
  // spawn-resolution gate and the wrappedAwait settlement gate)
  // MUST remain the raw `p` so that:
  //
  //   - fulfilled {ok:true}   propagates as fulfillment
  //   - fulfilled {ok:false}  propagates as fulfillment
  //   - Promise rejection      propagates as rejection
  //
  // `requireCriticalCommit()` inspects the outcome through a
  // try/catch and converts each of these three cases into the
  // typed `CriticalCommitOutcome`. We MUST NOT launder the
  // rejection into a synthetic `{ok:false}` here; doing so would
  // collapse internal_malfunction into commit_failed.
  //
  // The unhandled-rejection crash is already prevented by the
  // observer-side `then(_, _)` handler above (which attaches a
  // no-op rejection observer). The tracker is given a separate
  // SAFE promise that NEVER rejects, because the tracker's
  // `waitAll()` is purely a sequencing barrier and does not need
  // to distinguish rejection from fulfillment.
  const safe: Promise<ProcessEvidenceCommitResult> = p.catch(() => ({
    ok: false,
    error: {
      kind: "ledger_write_failure",
      message: "internal sink malfunction (defensive-laundered for tracker only)",
    },
  }));
  args.tracker.add(safe);
  return p;
}

/**
 * Critical-boundary classification (CORRECTION01 §6/§8, CORRECTION07 §2).
 * Critical commits MUST block sustained execution; observation commits may
 * be observed asynchronously.
 *
 * CORRECTION07: process_spawn_requested is now a critical boundary.
 * The durability ACK for the spawn intent MUST precede the OS spawn().
 * Without this guarantee, an early crash can leave a real OS process
 * with no spawn_requested record (not_started becomes a lie).
 */
function isCriticalBoundary(
  p: PersistedProcessEvidencePayload,
): boolean {
  return (
    p.kind === "process_spawn_requested" ||
    p.kind === "process_spawned" ||
    p.kind === "process_result_committed"
  );
}

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

export function emitWithPersistence(args: {
  readonly processId: ProcessId;
  readonly evidenceSink: ProcessEvidenceSink;
  readonly identity: ProcessEvidenceIdentity;
  readonly tracker: PendingCommitsTracker;
  readonly observer?: EvidenceCommitObserver;
  readonly event: RuntimeEvent | SyntheticRuntimeEvent;
  readonly innerSink: (e: RuntimeEvent) => void;
}): Promise<ProcessEvidenceCommitResult> | null {
  const obs = args.observer ?? DEFAULT_OBSERVER;
  if (isRuntimeEvent(args.event)) {
    args.innerSink(args.event);
  }
  const payloads = toPersistedPayloads(
    args.event,
    args.processId,
    args.identity.attemptId,
  );
  let critical: Promise<ProcessEvidenceCommitResult> | null = null;
  for (const payload of payloads) {
    const p = persistOne({
      evidenceSink: args.evidenceSink,
      identity: args.identity,
      tracker: args.tracker,
      observer: obs,
      payload,
    });
    if (isCriticalBoundary(payload)) {
      critical = p;
    }
  }
  return critical;
}

function toPersistedPayloads(
  e: RuntimeEvent | SyntheticRuntimeEvent,
  pid: ProcessId,
  aid: AttemptId,
): ReadonlyArray<PersistedProcessEvidencePayload> {
  switch (e.kind) {
    case "process_spawn_started":
      return [{ kind: "process_spawn_requested", attempt_id: aid, process_id: pid }];
    case "process_spawned":
      return [
        {
          kind: "process_spawned",
          attempt_id: aid,
          process_id: pid,
          pid: e.pid,
          pgid: e.processGroupId,
        },
      ];
    case "process_spawn_failed":
      return [
        {
          kind: "process_spawn_failed",
          attempt_id: aid,
          process_id: pid,
          failure: encodeFailure(e.failure),
        },
      ];
    case "deadline_reached":
      return [{ kind: "process_deadline_reached", attempt_id: aid, process_id: pid }];
    case "cancellation_requested":
      return [{ kind: "process_cancel_requested", attempt_id: aid, process_id: pid }];
    case "signal_sent":
      return [
        {
          kind: "process_signal_attempted",
          attempt_id: aid,
          process_id: pid,
          signal: e.signal === 0 ? "SIGTERM" : e.signal,
        },
        {
          kind: "process_signal_result",
          attempt_id: aid,
          process_id: pid,
          signal: e.signal === 0 ? "SIGTERM" : e.signal,
          result: encodeSignalResult(e.result),
        },
      ];
    case "cleanup_probe":
      return [
        {
          kind: "process_group_probe",
          attempt_id: aid,
          process_id: pid,
          probe: encodeProbe(e.probe),
        },
      ];
    case "process_close_observed":
      return [
        {
          kind: "process_close_observed",
          attempt_id: aid,
          process_id: pid,
          exit_code: e.exitCode,
          signal: e.signal,
        },
      ];
    case "process_output_summary":
      return [
        {
          kind: "process_output_summary",
          attempt_id: aid,
          process_id: pid,
          stdout: encodeOutput(e.stdout),
          stderr: encodeOutput(e.stderr),
        },
      ];
    case "process_result_committed":
      return [
        {
          kind: "process_result_committed",
          attempt_id: aid,
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
    case "process_spawn_identity_unavailable":
      // CORRECTION11: identity was lost AFTER Node "spawn"
      // fired. We MUST NOT append any synthetic
      // process_close_observed or process_result_committed
      // (we did not observe close; we cannot claim absence).
      // Recovery projector sees the gap and treats the
      // attempt as `spawn_outcome_unknown`.
      return [];
  }
}

export function syntheticEventToPersistedPayload(
  e: SyntheticRuntimeEvent,
  aid: AttemptId,
): ReadonlyArray<PersistedProcessEvidencePayload> {
  switch (e.kind) {
    case "process_close_observed":
      return [
        {
          kind: "process_close_observed",
          attempt_id: aid,
          process_id: e.processId,
          exit_code: e.exitCode,
          signal: e.signal,
        },
      ];
    case "process_output_summary":
      return [
        {
          kind: "process_output_summary",
          attempt_id: aid,
          process_id: e.processId,
          stdout: encodeOutput(e.stdout),
          stderr: encodeOutput(e.stderr),
        },
      ];
    case "process_result_committed":
      return [
        {
          kind: "process_result_committed",
          attempt_id: aid,
          process_id: e.processId,
          result: encodeResult(e.result),
        },
      ];
  }
}

export function appendSyntheticEvidence(args: {
  readonly evidenceSink: ProcessEvidenceSink;
  readonly identity: ProcessEvidenceIdentity;
  readonly event: SyntheticRuntimeEvent;
  readonly pendingCommits: PendingCommitsTracker;
  readonly observer?: EvidenceCommitObserver;
}): void {
  const obs = args.observer ?? DEFAULT_OBSERVER;
  const payloads = syntheticEventToPersistedPayload(
    args.event,
    args.identity.attemptId,
  );
  for (const payload of payloads) {
    const commitPromise = args.evidenceSink.commitObservation({
      eventId: args.identity.eventIdFactory(),
      runId: args.identity.runId,
      missionId: args.identity.missionId,
      observedAt: Date.now(),
      payload,
    });
    args.pendingCommits.add(commitPromise);
    commitPromise.then(
      (r: ProcessEvidenceCommitResult) => {
        if (r.ok === false) {
          obs.onOwnershipDurableCommitFailed(payload, r);
        }
      },
      () => {
        // CORRECTION02 OG03: swallow unhandled rejection; the
        // returned promise already surfaces the failure.
      },
    );
  }
}
