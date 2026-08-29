/**
 * Append-only JSONL evidence ledger.
 *
 * Doctrine D05: historical run events are immutable; recovery is performed
 * by replaying the ledger. There is no "current truth" mutable cache.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { RunId, MissionId } from "../domain/ids.js";
import type { RunEvent } from "../domain/run-event.js";
import type { RunState } from "../domain/run-state.js";
import { replay, type ReplayError } from "../domain/replay.js";
import { err, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import { decodeEnvelope, envelopeToRunEvent, encodeEnvelope } from "./codec.js";
import type { EventEnvelope } from "./codec.js";

export const LEDGER_FILENAME = "events.jsonl";

export type LedgerOpenOptions = {
  readonly createIfMissing?: boolean;
};

export type LedgerReopenResult = {
  readonly state: RunState;
  readonly events: ReadonlyArray<RunEvent>;
  readonly eventsProcessed: number;
  readonly lastSeq: number;
};

export type LedgerError = InvalidEvidence | ReplayError | InternalLedgerError;

export type InternalLedgerError = {
  readonly kind: "internal_failure";
  readonly message: string;
};

export class JsonlLedger {
  private readonly filePath: string;
  private initialized = false;

  constructor(directory: string, filename: string = LEDGER_FILENAME) {
    this.filePath = path.join(directory, filename);
  }

  path(): string {
    return this.filePath;
  }

  async open(opts: LedgerOpenOptions = {}): Promise<Result<void, LedgerError>> {
    if (this.initialized) {
      return ok(undefined);
    }
    const create = opts.createIfMissing ?? true;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await fs.access(this.filePath);
        const r = await this.readAndValidate();
        if (r.ok === false) {
          return err(r.error);
        }
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
      this.initialized = true;
      return ok(undefined);
    } catch (e: unknown) {
      return err({
        kind: "internal_failure",
        message: `Failed to open ledger: ${errorMessage(e)}`,
      });
    }
  }

  async append(
    event: Omit<RunEvent, "seq" | "observedAt" | "eventId" | "runId" | "missionId"> & {
      readonly eventId: string;
      readonly runId: string;
      readonly missionId: string;
      readonly observedAt: number;
    },
  ): Promise<Result<{ readonly seq: number }, LedgerError>> {
    if (!this.initialized) {
      return err({
        kind: "internal_failure",
        message: "Ledger is not open.",
      });
    }
    const current = await this.readAndValidate();
    if (current.ok === false) {
      return err(current.error);
    }
    const nextSeq = current.value.lastSeq + 1;
    const envelope = encodeEnvelope({
      eventId: event.eventId,
      runId: event.runId,
      missionId: event.missionId,
      sequence: nextSeq,
      observedAt: event.observedAt,
      event: event as RunEvent,
    });
    const line = JSON.stringify(envelope) + "\n";
    try {
      await fs.appendFile(this.filePath, line, "utf8");
    } catch (e: unknown) {
      return err({
        kind: "internal_failure",
        message: `Failed to append to ledger: ${errorMessage(e)}`,
      });
    }
    return ok({ seq: nextSeq });
  }

  async readAll(): Promise<Result<ReadonlyArray<EventEnvelope>, LedgerError>> {
    const r = await this.readAndValidate();
    if (r.ok === false) {
      return err(r.error);
    }
    return ok(r.value.envelopes);
  }

  async replay(
    runId: RunId,
    missionId: MissionId,
  ): Promise<Result<LedgerReopenResult, LedgerError>> {
    const r = await this.readAndValidate();
    if (r.ok === false) {
      return err(r.error);
    }
    const envelopes = r.value.envelopes;
    const events: RunEvent[] = [];
    for (const env of envelopes) {
      if (env.run_id !== runId || env.mission_id !== missionId) {
        return err({
          kind: "invalid_evidence",
          reason: `Mixed run identities in ledger; expected run=${runId} mission=${missionId}, got run=${env.run_id} mission=${env.mission_id}.`,
        });
      }
      events.push(envelopeToRunEvent(env));
    }
    const r2 = replay(runId, missionId, events);
    if (r2.ok === false) {
      return err(r2.error);
    }
    return ok({
      state: r2.value.state,
      events,
      eventsProcessed: r2.value.eventsProcessed,
      lastSeq: r2.value.lastSeq,
    });
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
      if (isENOENT(e)) {
        return ok({ envelopes: [], lastSeq: 0 });
      }
      return err({
        kind: "internal_failure",
        message: `Failed to read ledger: ${errorMessage(e)}`,
      });
    }
    const envelopes: EventEnvelope[] = [];
    let lastSeq = 0;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined || raw.length === 0) {
        continue;
      }
      const parsed = decodeEnvelopeFromJsonLine(raw);
      if (parsed.ok === false) {
        return err(parsed.error);
      }
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

function decodeEnvelopeFromJsonLine(
  text: string,
): Result<EventEnvelope, InvalidEvidence> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ kind: "invalid_evidence", reason: `Malformed JSON: ${msg}` });
  }
  return decodeEnvelope(raw);
}

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Helper: open a ledger in a fresh temporary directory under `baseDir`.
 */
export async function openTempLedger(
  baseDir: string,
): Promise<Result<{ ledger: JsonlLedger; dir: string }, LedgerError>> {
  const dir = await fs.mkdtemp(path.join(baseDir, "lh-ledger-"));
  const ledger = new JsonlLedger(dir);
  const r = await ledger.open();
  if (r.ok === false) {
    return err(r.error);
  }
  return ok({ ledger, dir });
}
