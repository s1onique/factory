/**
 * Read-and-validate a JSONL ledger file.
 *
 * Pure function that consumes a file path and returns either a
 * validated list of envelopes with the last observed sequence, or a
 * typed {@link InvalidEvidence} failure.
 *
 * Extracted from {@link JsonlLedger} so the class file stays focused
 * on append / replay lifecycle. Production behavior is unchanged.
 */

import { promises as fs } from "node:fs";

import { err, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type { EventEnvelope } from "./codec.js";
import {
  decodeEnvelopeFromJsonLine,
  internal,
  internalFrom,
  isENOENT,
  type InternalLedgerError,
} from "./ledger-internals.js";

export type LedgerError = InvalidEvidence | InternalLedgerError;

export type ReadAndValidateResult = {
  readonly envelopes: ReadonlyArray<EventEnvelope>;
  readonly lastSeq: number;
};

/**
 * Read every newline-terminated line, decode each, validate
 * sequence contiguity and identity. A non-empty unterminated final
 * suffix produces an `invalid_evidence` error directing the caller
 * to open the ledger with torn-tail recovery.
 */
export async function readAndValidate(
  filePath: string,
): Promise<Result<ReadAndValidateResult, LedgerError>> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
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

export { internal };
