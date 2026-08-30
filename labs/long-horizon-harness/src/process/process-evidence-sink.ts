/**
 * FOUNDATION03 — process evidence sink.
 *
 * The {@link ProcessEvidenceSink} is the narrow boundary through which
 * the FOUNDATION02 process supervisor emits candidate-neutral
 * process-runtime evidence to the durable ledger.
 *
 * The default implementation, {@link LedgerBackedProcessEvidenceSink},
 * wraps a {@link JsonlLedger} and reuses its append/sync/torn-tail
 * primitive. A {@link NoopProcessEvidenceSink} is provided for tests
 * that don't care about persistence.
 *
 * IMPORTANT: persistence failures of process-evidence records at the
 * durable ownership boundary (NOTABLY `process_spawned`) are
 * FOUNDATION03 §66 / §67 failures. The current-run supervisor MUST
 * NOT continue a sustained RUNNING process whose durable ownership
 * record could not be committed. Callers MUST observe `result.ok`
 * for every commit call that crosses the durable ownership boundary.
 *
 * The sink MUST NOT itself own a Clock, fs, child_process, timers,
 * or signal methods. It is a typed append/replay boundary only.
 */

/**
 * The {@link ProcessEvidenceSink} is the narrow boundary through which
 * the FOUNDATION02 process supervisor emits candidate-neutral
 * process-runtime evidence to the durable ledger.
 *
 * Two tiers of commit exist (CORRECTION01 §8):
 *
 *   - `commitCritical(...)` blocks the caller until the durability
 *     boundary is acknowledged. Required for the durable ownership
 *     boundary (notably `process_spawned`).
 *   - `commitObservation(...)` returns immediately; durability is
 *     observed asynchronously. Used for non-critical evidence such as
 *     `process_close_observed`, `process_output_summary`, and
 *     `process_result_committed`.
 *
 * The {@link LedgerBackedProcessEvidenceSink} wraps a
 * {@link JsonlLedger} and reuses its append/sync/torn-tail primitive.
 * A {@link NoopProcessEvidenceSink} is provided for tests that don't
 * care about persistence.
 *
 * Critical-commit failures are FOUNDATION03 §66 / §67 failures: the
 * current-run supervisor MUST observe `result.ok === false` for every
 * `commitCritical` and bound-cleanup its live process.
 *
 * The sink MUST NOT itself own a Clock, fs, child_process, timers,
 * or signal methods. It is a typed append/replay boundary only.
 */

import type { Result } from "../domain/result.js";
import type {
  EventId,
  MissionId,
  RunId,
} from "../domain/ids.js";
import type { JsonlLedger } from "../evidence/jsonl-ledger.js";
import type { LedgerError } from "../evidence/jsonl-ledger.js";
import type { CommittedProcessEvidence } from "../evidence/committed-process-evidence.js";
import type { PersistedProcessEvidencePayload } from "../evidence/codec-types.js";

/**
 * Result of a single evidence-commit attempt.
 *
 * `Ok` carries the assigned `seq` so callers (the supervisor, the
 * crash harness, the recovery projector) can correlate durability
 * with their own bookkeeping.
 */
export type ProcessEvidenceCommitResult =
  | { readonly ok: true; readonly seq: number }
  | { readonly ok: false; readonly error: ProcessEvidenceSinkError };

/**
 * Failure modes for evidence persistence. These are deliberately a
 * closed ADT so call-sites can branch mechanically. Mirrors §70.
 */
export type ProcessEvidenceSinkError =
  | { readonly kind: "invalid_evidence"; readonly reason: string }
  | { readonly kind: "ledger_write_failure"; readonly message: string }
  | { readonly kind: "ledger_sync_failure"; readonly message: string };

/**
 * Narrow contract for emitting one process-evidence payload.
 *
 * Implementations are responsible for stamping the supplied
 * (eventId, runId, missionId, observedAt) onto the payload,
 * allocating sequence, and durability-fsync'ing before returning.
 *
 * Persistence failures at the `process_spawned` boundary are
 * treated as critical by the supervisor (FOUNDATION03 §66 / §67):
 * the current-run supervisor will bound-cleanup its live process
 * and report an internal failure.
 */
export interface ProcessEvidenceSink {
  /**
   * Critical append — the caller MUST await the returned promise
   * and observe `result.ok`. The fsync boundary is honoured before
     * the returned promise resolves. Failure at this boundary
   * (NOTABLY for `process_spawned`) is a FOUNDATION03 §67
   * ownership-persistence failure.
   */
  commitCritical(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult>;

  /**
   * Non-critical observation append — durability is recorded
   * asynchronously; the returned promise resolves after the
   * ledger commit fsyncs but the caller does NOT need to await it
   * for sustained execution to proceed.
   */
  commitObservation(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult>;
}

/**
 * A sink that discards every payload. Useful for unit tests that
 * exercise supervisor logic without caring about persistence.
 */
export class NoopProcessEvidenceSink implements ProcessEvidenceSink {
  private next = 1;
  async commitCritical(
    _input: {
      readonly eventId: EventId;
      readonly runId: RunId;
      readonly missionId: MissionId;
      readonly observedAt: number;
      readonly payload: PersistedProcessEvidencePayload;
    },
  ): Promise<ProcessEvidenceCommitResult> {
    return { ok: true, seq: this.next++ };
  }
  async commitObservation(
    _input: {
      readonly eventId: EventId;
      readonly runId: RunId;
      readonly missionId: MissionId;
      readonly observedAt: number;
      readonly payload: PersistedProcessEvidencePayload;
    },
  ): Promise<ProcessEvidenceCommitResult> {
    return { ok: true, seq: this.next++ };
  }
}

/**
 * A sink that wraps a {@link JsonlLedger}. Each `append` calls into
 * the ledger's `appendProcessEvidence`, which acquires the same
 * promise-chain mutex and uses the same `fsync`-then-acknowledge
 * contract as lifecycle events.
 *
 * Sequence numbers are allocated by the ledger, so this sink
 * returns them from the CommittedProcessEvidence.
 */
export class LedgerBackedProcessEvidenceSink implements ProcessEvidenceSink {
  constructor(private readonly ledger: JsonlLedger) {}
  async commitCritical(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult> {
    return this.commitNow(input);
  }
  async commitObservation(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult> {
    // For non-critical evidence the caller may not await, but the
    // underlying ledger already serialises through the same mutex
    // and fsync semantics. We still return the awaited promise so
    // tests that DO await observe the durability boundary.
    return this.commitNow(input);
  }
  private async commitNow(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<ProcessEvidenceCommitResult> {
    const r: Result<CommittedProcessEvidence, LedgerError> =
      await this.ledger.appendProcessEvidence(input);
    if (r.ok === false) {
      return { ok: false, error: mapLedgerError(r.error) };
    }
    return { ok: true, seq: r.value.seq };
  }
}

function mapLedgerError(e: LedgerError): ProcessEvidenceSinkError {
  // LedgerError is `InvalidEvidence | ReplayError | InternalLedgerError`.
  // We treat invalid_evidence as a payload-shape error; replay_error
  // (invalid_transition) as ledger_write_failure; and internal_failure
  // as ledger_sync_failure (filesystem fsync / IO errors).
  if (e.kind === "invalid_evidence") {
    return { kind: "invalid_evidence", reason: e.reason };
  }
  if (e.kind === "internal_failure") {
    return { kind: "ledger_sync_failure", message: e.message };
  }
  // ReplayError covers invalid_transition + (Failure & invalid_evidence).
  // We surface both kinds as ledger_write_failure so the supervisor can
  // distinguish from infrastructure (fsync) failures.
  return {
    kind: "ledger_write_failure",
    message: `ledger reported replay_error during append: ${JSON.stringify(e)}`,
  };
}
