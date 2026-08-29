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
import { createHash } from "node:crypto";

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
import { envelopeToCommitted, encodeEnvelope } from "./codec.js";
import type { EventEnvelope } from "./codec.js";
import {
  decodeEnvelopeFromJsonLine,
  fsyncPath,
  internal,
  internalFrom,
  isENOENT,
  quarantineTornTail,
  splitOnTornTail,
  type InternalLedgerError,
} from "./ledger-internals.js";

export const LEDGER_FILENAME = "events.jsonl";
export const TORN_TAIL_PREFIX = "events.jsonl.torn-tail.";

export type LedgerOpenOptions = {
  readonly createIfMissing?: boolean;
};

export type LedgerReopenResult = {
  readonly state: RunState;
  readonly events: ReadonlyArray<CommittedRunEvent>;
  readonly eventsProcessed: number;
  readonly lastSeq: number;
};

export type LedgerError = InvalidEvidence | ReplayError | InternalLedgerError;

export type TornTailRecovery = {
  readonly quarantinedBytes: number;
  readonly quarantinePath: string;
  readonly sha256: string;
};

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

  constructor(directory: string, filename: string = LEDGER_FILENAME) {
    this.dirPath = directory;
    this.filePath = path.join(directory, filename);
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
    try {
      const raw = await fs.readFile(this.filePath);
      const split = splitOnTornTail(raw);
      if (split.tornBytes.length > 0) {
        const sha = createHash("sha256")
          .update(split.tornBytes)
          .digest("hex");
        const quarantinePath = await quarantineTornTail(
          this.dirPath,
          split.tornBytes,
          sha,
        );
        if (
          split.committedBytes.length + split.tornBytes.length !==
          raw.length
        ) {
          return err(internal("torn-tail split arithmetic mismatch"));
        }
        await fs.writeFile(this.filePath, split.committedBytes);
        await fsyncPath(this.filePath);
        recovery = {
          quarantinedBytes: split.tornBytes.length,
          quarantinePath,
          sha256: sha,
        };
      }
    } catch (e: unknown) {
      return err(internalFrom(e));
    }

    const v = await this.readAndValidate();
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

  async readAll(): Promise<Result<ReadonlyArray<EventEnvelope>, LedgerError>> {
    const r = await this.readAndValidate();
    if (r.ok === false) return err(r.error);
    return ok(r.value.envelopes);
  }

  async replay(
    runId: RunId,
    missionId: MissionId,
  ): Promise<Result<LedgerReopenResult, LedgerError>> {
    const r = await this.readAndValidate();
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
      events.push(envelopeToCommitted(env));
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
    const cur = await this.readAndValidate();
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

    const envelope = encodeEnvelope(committed);
    const line = JSON.stringify(envelope) + "\n";

    let fh: import("node:fs/promises").FileHandle | null = null;
    try {
      fh = await fs.open(this.filePath, "a");
      await fh.appendFile(line, "utf8");
      await fh.sync();
      return ok(committed);
    } catch (e: unknown) {
      return err(internalFrom(e));
    } finally {
      if (fh !== null) {
        try {
          await fh.close();
        } catch {
          // close failure is logged via internal on the outer error path
        }
      }
    }
  }

  private async readAndValidate(): Promise<
    Result<
      { readonly envelopes: ReadonlyArray<EventEnvelope>; readonly lastSeq: number },
      LedgerError
    >
  > {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (e: unknown) {
      if (isENOENT(e)) return ok({ envelopes: [], lastSeq: 0 });
      return err(internalFrom(e));
    }
    if (text.length > 0 && !text.endsWith("\n")) {
      return err({
        kind: "invalid_evidence",
        reason:
          "Ledger ends with a non-empty unterminated suffix; open must be called to recover.",
      });
    }
    const envelopes: EventEnvelope[] = [];
    let lastSeq = 0;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined || raw.length === 0) continue;
      const parsed = decodeEnvelopeFromJsonLine(raw);
      if (parsed.ok === false) return err(parsed.error);
      const env = parsed.value;
      if (env.sequence <= lastSeq) {
        return err({
          kind: "invalid_evidence",
          reason: `Duplicate or out-of-order sequence at line ${i + 1}: got ${env.sequence}, expected > ${lastSeq}.`,
        });
      }
      if (env.sequence !== lastSeq + 1) {
        return err({
          kind: "invalid_evidence",
          reason: `Sequence gap at line ${i + 1}: got ${env.sequence}, expected ${lastSeq + 1}.`,
        });
      }
      envelopes.push(env);
      lastSeq = env.sequence;
    }
    return ok({ envelopes, lastSeq });
  }
}
