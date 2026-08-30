/**
 * Append-only JSONL evidence ledger.
 *
 * The ledger is the authoritative source of run history. It supports:
 *  - create/open a run evidence file (with torn-tail recovery)
 *  - append one validated payload; the ledger allocates sequence,
 *    stamps metadata, writes the envelope, and syncs the file
 *  - read all records
 *  - decode all records
 *  - validate ordering/identity
 *  - replay into derived RunState
 *
 * Persisted data is never overwritten on ordinary append. The file is
 * opened exclusively; the lab uses a single-writer-process model in
 * which concurrent asynchronous append calls within the same process
 * are serialized through an internal promise-chain mutex.
 *
 * Crash-durability semantics:
 *  - A successful `append()` is acknowledged only after `fsync()` of
 *    the appended bytes has returned without error.
 *  - A JSONL event record is committed iff its complete line
 *    terminates in `\n`. On open, any non-empty unterminated final
 *    suffix is treated as an uncommitted torn tail: the bytes are
 *    quarantined to `events.jsonl.torn-tail.<sha256>.bin`, the
 *    authoritative ledger is truncated to the committed prefix, and
 *    the prefix is revalidated.
 *  - A malformed newline-terminated record fails closed. It is NOT
 *    auto-truncated as a torn tail.
 *
 * This module is the only place in the lab allowed to perform
 * filesystem IO. Domain code MUST NOT import it.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
  EventId,
  MissionId,
  RunId,
} from "../domain/ids.js";
import type {
  CommittedRunEvent,
  RunEventPayload,
} from "../domain/run-event.js";
import type { RunState } from "../domain/run-state.js";
import { replay, type ReplayError } from "../domain/replay.js";
import { err, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import {
  envelopeToCommitted,
  encodeEnvelope,
  encodeProcessEvidenceEnvelope,
} from "./codec.js";
import type { EventEnvelope } from "./codec.js";
import type { CommittedProcessEvidence } from "./committed-process-evidence.js";
import type { PersistedProcessEvidencePayload } from "./codec-types.js";
import {
  appendCommittedLineToFile,
  internal,
  internalFrom,
  isENOENT,
  type InternalLedgerError,
} from "./ledger-internals.js";
import { readAndValidate } from "./ledger-read-validate.js";
import {
  performTornTailRecovery,
  type RecoveryFaultHook,
  type TornTailRecovery,
} from "./ledger-recovery.js";

export const LEDGER_FILENAME = "events.jsonl";
export const TORN_TAIL_PREFIX = "events.jsonl.torn-tail.";

export type LedgerOpenOptions = {
  readonly createIfMissing?: boolean;
};

/**
 * Optional fault-injection hook used only by tests.
 *
 * When set, the hook is invoked BEFORE the durable commit boundary of
 * the corresponding operation. Returning a non-OK result aborts the
 * operation with that exact typed error and the authoritative ledger
 * is left untouched. Production code MUST NOT set this.
 *
 * Hooks currently supported:
 *  - beforeAppendWrite — fires inside `doAppend` after the in-memory
 *    committed event is constructed but BEFORE the file handle is
 *    opened for append.
 *  - beforeQuarantineWrite — fires inside torn-tail recovery AFTER
 *    torn-tail detection and BEFORE quarantine preservation.
 *  - beforeAuthoritativeTruncate — fires inside torn-tail recovery
 *    AFTER quarantine is durable and AFTER directory fsync, but
 *    BEFORE the authoritative ledger is truncated. If it aborts,
 *    the authoritative ledger is byte-identical to its pre-recovery
 *    snapshot (recovery is monotonic up to the destructive step).
 */
export type LedgerFaultHook =
  | {
      readonly kind: "beforeAppendWrite";
      readonly respond: (
        r: Result<void, LedgerError>,
      ) => Result<void, LedgerError>;
    }
  | {
      readonly kind: "beforeQuarantineWrite";
      readonly tornBytes: Buffer;
      readonly respond: (
        r: Result<void, LedgerError>,
      ) => Result<void, LedgerError>;
    }
  | {
      readonly kind: "beforeAuthoritativeTruncate";
      readonly committedPrefixLength: number;
      readonly respond: (
        r: Result<void, LedgerError>,
      ) => Result<void, LedgerError>;
    };

export type LedgerFaultOptions = {
  /**
   * A single-shot fault hook. The hook fires once and is then
   * cleared. Subsequent appends proceed normally.
   */
  readonly fault?: LedgerFaultHook;
};

export type LedgerReopenResult = {
  readonly state: RunState;
  readonly events: ReadonlyArray<CommittedRunEvent>;
  readonly eventsProcessed: number;
  readonly lastSeq: number;
};

export type LedgerError = InvalidEvidence | ReplayError | InternalLedgerError;

export type { TornTailRecovery } from "./ledger-recovery.js";

export type OpenResult = {
  readonly ledger: JsonlLedger;
  readonly recovery: TornTailRecovery | null;
};

export class JsonlLedger {
  private readonly filePath: string;
  private readonly dirPath: string;
  private initialized = false;
  /** Promise-chain mutex; never permanently poisoned. */
  private chain: Promise<unknown> = Promise.resolve();
  /**
   * Test-only single-shot fault hook. Cleared after firing once.
   */
  private faultHook: LedgerFaultHook | null = null;

  constructor(
    directory: string,
    filename: string = LEDGER_FILENAME,
    options: LedgerFaultOptions = {},
  ) {
    this.dirPath = directory;
    this.filePath = path.join(directory, filename);
    if (options.fault !== undefined) {
      this.faultHook = options.fault;
    }
  }

  /**
   * Arm a single-shot fault hook. The next matching operation fires
   * the hook and clears it. Subsequent operations proceed normally.
   * Production code MUST NOT call this.
   */
  armFaultHook(hook: LedgerFaultHook): void {
    this.faultHook = hook;
  }

  path(): string {
    return this.filePath;
  }

  /**
   * Open the ledger with torn-tail recovery.
   *
   * If the file ends with a non-empty unterminated suffix, the suffix
   * is quarantined to `events.jsonl.torn-tail.<sha256>.bin`, the
   * authoritative ledger is truncated to the committed prefix, and the
   * prefix is revalidated. Malformed newline-terminated records fail
   * closed without auto-truncation.
   */
  async open(
    opts: LedgerOpenOptions = {},
  ): Promise<Result<OpenResult, LedgerError>> {
    if (this.initialized) {
      return err(internal("Ledger already open."));
    }
    const create = opts.createIfMissing ?? true;
    try {
      await fs.mkdir(this.dirPath, { recursive: true });
      try {
        await fs.access(this.filePath);
      } catch (e: unknown) {
        if (isENOENT(e)) {
          if (!create) {
            return err({
              kind: "invalid_evidence",
              reason: `Ledger file does not exist: ${this.filePath}`,
            });
          }
          await fs.writeFile(this.filePath, "", "utf8");
        } else {
          throw e;
        }
      }
    } catch (e: unknown) {
      return err(internalFrom(e));
    }


    let recovery: TornTailRecovery | null = null;
    {
      // Probe for torn tail: read raw bytes and attempt recovery
      // only if a non-empty unterminated suffix is present.
      const probe = await fs.readFile(this.filePath).catch(() => null);
      if (
        probe !== null &&
        probe.length > 0 &&
        probe[probe.length - 1] !== 0x0a
      ) {
        const recoveryHook: RecoveryFaultHook | null =
          this.faultHook !== null &&
          (this.faultHook.kind === "beforeQuarantineWrite" ||
            this.faultHook.kind === "beforeAuthoritativeTruncate")
            ? this.faultHook
            : null;
        const rec = await performTornTailRecovery({
          filePath: this.filePath,
          dirPath: this.dirPath,
          faultHook: recoveryHook,
        });
        if (rec.ok === false) return err(rec.error);
        recovery = rec.value;
        if (recoveryHook !== null) {
          this.faultHook = null;
        }
      }
    }

    const v = await readAndValidate(this.filePath);
    if (v.ok === false) return err(v.error);

    this.initialized = true;
    return ok({ ledger: this, recovery });
  }

  /**
   * Append a payload. The ledger allocates the sequence, stamps
   * metadata, writes the envelope, and `fsync()`s the file before
   * returning success.
   *
   * `seq` MUST NOT be supplied by callers; it is allocated by the
   * ledger. Concurrent asynchronous append calls within the same
   * process are serialized via an internal promise-chain mutex; a
   * failed append does not poison the queue.
   */
  async append(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly event: RunEventPayload;
  }): Promise<Result<CommittedRunEvent, LedgerError>> {
    if (!this.initialized) {
      return err(internal("Ledger is not open."));
    }
    return this.runExclusive(() => this.doAppend(input));
  }

  /**
   * Append a process-evidence payload. Same durability contract as
   * {@link append}: sequence allocated by the ledger, envelope
   * written and `fsync()`ed before the returned promise resolves.
   *
   * Process-evidence records share the same global monotonic
   * sequence space as lifecycle events (FOUNDATION03 §45).
   */
  async appendProcessEvidence(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<Result<CommittedProcessEvidence, LedgerError>> {
    if (!this.initialized) {
      return err(internal("Ledger is not open."));
    }
    return this.runExclusive(() => this.doAppendProcessEvidence(input));
  }

  async readAll(): Promise<Result<ReadonlyArray<EventEnvelope>, LedgerError>> {
    const r = await readAndValidate(this.filePath);
    if (r.ok === false) return err(r.error);
    return ok(r.value.envelopes);
  }

  async replay(
    runId: RunId,
    missionId: MissionId,
  ): Promise<Result<LedgerReopenResult, LedgerError>> {
    const r = await readAndValidate(this.filePath);
    if (r.ok === false) return err(r.error);
    const envelopes = r.value.envelopes;
    const events: CommittedRunEvent[] = [];
    for (const env of envelopes) {
      if (env.run_id !== runId || env.mission_id !== missionId) {
        return err({
          kind: "invalid_evidence",
          reason: `Mixed run identities in ledger; expected run=${runId} mission=${missionId}, got run=${env.run_id} mission=${env.mission_id}.`,
        });
      }
      // Process-evidence envelopes share the run/mission identity
      // but are NOT lifecycle events. The lifecycle replay reducer
      // consumes only the lifecycle subset; recovery code consumes
      // the process-evidence subset separately.
      if (env.schema_version === 1 || env.kind === "lifecycle") {
        events.push(envelopeToCommitted(env));
      }
    }
    const r2 = replay(runId, missionId, events);
    if (r2.ok === false) return err(r2.error);
    return ok({
      state: r2.value.state,
      events,
      eventsProcessed: r2.value.eventsProcessed,
      lastSeq: r2.value.lastSeq,
    });
  }

  /**
   * Critical section guarded by a promise-chain mutex. A previous
   * run's failure does not poison the queue.
   */
  private async runExclusive<T>(
    fn: () => Promise<Result<T, LedgerError>>,
  ): Promise<Result<T, LedgerError>> {
    const prev = this.chain;
    let release: () => void = () => {};
    this.chain = new Promise<void>((res) => {
      release = res;
    });
    try {
      await prev;
    } catch {
      // previous run's failure does not poison the queue.
    }
    try {
      const r = await fn();
      release();
      return r;
    } catch (e: unknown) {
      release();
      return err(internalFrom(e));
    }
  }

  private async doAppend(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly event: RunEventPayload;
  }): Promise<Result<CommittedRunEvent, LedgerError>> {
    const cur = await readAndValidate(this.filePath);
    if (cur.ok === false) return err(cur.error);
    const nextSeq = cur.value.lastSeq + 1;

    const committed: CommittedRunEvent = {
      ...input.event,
      eventId: input.eventId,
      runId: input.runId,
      missionId: input.missionId,
      seq: nextSeq,
      observedAt: input.observedAt,
    };

    // (test seam) fire pre-append fault hook BEFORE the durable
    // commit boundary. If the hook reports failure, the committed
    // event is NOT written and no sequence is consumed because the
    // mutex releases the lock without committing.
    if (
      this.faultHook !== null &&
      this.faultHook.kind === "beforeAppendWrite"
    ) {
      const hook = this.faultHook;
      this.faultHook = null;
      const response = hook.respond(ok(undefined));
      if (response.ok === false) {
        // No sequence allocated; no committed record produced.
        return err(response.error);
      }
    }

    const envelope = encodeEnvelope(committed);
    const line = JSON.stringify(envelope) + "\n";

    const io = await appendCommittedLineToFile(this.filePath, line);
    if (io.ok === false) {
      return err(internalFrom(io.error.message));
    }
    return ok(committed);
  }

  private async doAppendProcessEvidence(input: {
    readonly eventId: EventId;
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly payload: PersistedProcessEvidencePayload;
  }): Promise<Result<CommittedProcessEvidence, LedgerError>> {
    const cur = await readAndValidate(this.filePath);
    if (cur.ok === false) return err(cur.error);
    const nextSeq = cur.value.lastSeq + 1;

    const committed: CommittedProcessEvidence = {
      eventId: input.eventId,
      runId: input.runId,
      missionId: input.missionId,
      seq: nextSeq,
      observedAt: input.observedAt,
      payload: input.payload,
    };

    // Same fault-hook semantics as lifecycle append: if a pre-append
    // hook is armed and reports failure, no sequence is consumed
    // and no committed record is produced.
    if (
      this.faultHook !== null &&
      this.faultHook.kind === "beforeAppendWrite"
    ) {
      const hook = this.faultHook;
      this.faultHook = null;
      const response = hook.respond(ok(undefined));
      if (response.ok === false) {
        return err(response.error);
      }
    }

    const envelope = encodeProcessEvidenceEnvelope(committed);
    const line = JSON.stringify(envelope) + "\n";

    const io = await appendCommittedLineToFile(this.filePath, line);
    if (io.ok === false) {
      return err(internalFrom(io.error.message));
    }
    return ok(committed);
  }
}
