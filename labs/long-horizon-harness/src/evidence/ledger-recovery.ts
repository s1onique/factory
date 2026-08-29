/**
 * Torn-tail recovery orchestration.
 *
 * Pure function (no class state). Caller passes the file path,
 * directory path, and a fault hook. Returns either a TornTailRecovery
 * descriptor on success or a typed `internal_failure` error WITHOUT
 * modifying the authoritative file on failure.
 *
 * Recovery ordering (CRITICAL):
 *   1. (test seam) pre-quarantine fault hook.
 *   2. durably preserve the torn bytes (sync included).
 *   3. attempt to fsync the parent directory entry where supported.
 *      If fsyncDir returns "error" we FAIL CLOSED — we do NOT
 *      truncate the authoritative ledger.
 *   4. only NOW truncate authoritative ledger to committed prefix.
 */

import { promises as fs } from "node:fs";
import { err, ok, type Result } from "../domain/result.js";

import type { DirSyncCapability, InternalLedgerError } from "./ledger-internals.js";
import {
  fsyncDir,
  internal,
  quarantineTornTail,
  sha256OfBytes,
  splitOnTornTail,
  writeAuthoritativeAndSync,
} from "./ledger-internals.js";

export type TornTailRecovery = {
  readonly quarantinedBytes: number;
  readonly quarantinePath: string;
  readonly sha256: string;
  readonly quarantineAlreadyExisted: boolean;
  readonly directorySync: DirSyncCapability;
};

/**
 * Test-only fault hook types. Production code MUST NOT pass these.
 *
 * The recovery phase emits only `InternalLedgerError`; other ledger
 * errors (`invalid_evidence`, `invalid_transition`) cannot arise here
 * because torn-tail recovery does not decode persisted envelope
 * contents. The hook callback accepts the wider {@link LedgerError}
 * union for compatibility with the {@link LedgerFaultHook} in
 * {@link jsonl-ledger.ts}, but the recovery phase only feeds it
 * `InternalLedgerError` results.
 */
import type { LedgerError } from "./jsonl-ledger.js";

export type RecoveryFaultHook = {
  readonly kind: "beforeQuarantineWrite";
  readonly tornBytes: Buffer;
  readonly respond: (r: Result<void, LedgerError>) => Result<void, LedgerError>;
};

export type RecoveryResult = Result<TornTailRecovery, InternalLedgerError>;

export async function performTornTailRecovery(args: {
  readonly filePath: string;
  readonly dirPath: string;
  readonly faultHook: RecoveryFaultHook | null;
}): Promise<RecoveryResult> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(args.filePath);
  } catch (e: unknown) {
    return err(e instanceof Error ? { kind: "internal_failure", message: e.message } : { kind: "internal_failure", message: String(e) });
  }
  const split = splitOnTornTail(raw);
  if (split.tornBytes.length === 0) {
    return err({ kind: "internal_failure", message: "no torn tail" });
  }

  const sha = sha256OfBytes(split.tornBytes);

  // 1. (test seam) fire pre-quarantine fault hook.
  if (args.faultHook !== null) {
    const hook = args.faultHook;
    const response = hook.respond(ok(undefined));
    if (response.ok === false) {
      return err({
        kind: "internal_failure",
        message: `Quarantine pre-write hook aborted recovery: ${response.error.kind === "internal_failure" ? response.error.message : response.error.kind}`,
      });
    }
  }

  // 2. durably preserve the torn bytes (sync included).
  const qResult = await quarantineTornTail(args.dirPath, split.tornBytes, sha);
  if (qResult.ok === false) {
    return err({
      kind: "internal_failure",
      message: `Quarantine preservation failed: ${qResult.error.message}`,
    });
  }
  const quarantinePath = qResult.value.path;
  const quarantineAlreadyExisted = !qResult.value.created;

  // 3. attempt to fsync the parent directory entry where supported.
  const directorySync = await fsyncDir(args.dirPath);
  if (directorySync === "error") {
    return err({
      kind: "internal_failure",
      message:
        "Quarantine directory entry fsync returned an error; refusing to truncate authoritative ledger.",
    });
  }

  // 4. only NOW truncate authoritative ledger to committed prefix.
  if (
    split.committedBytes.length + split.tornBytes.length !== raw.length
  ) {
    return err(internal("torn-tail split arithmetic mismatch"));
  }
  const writeResult = await writeAuthoritativeAndSync(
    args.filePath,
    split.committedBytes,
  );
  if (writeResult.ok === false) {
    return err({
      kind: "internal_failure",
      message: `Authoritative ledger repair failed: ${writeResult.error.message}`,
    });
  }

  return ok({
    quarantinedBytes: split.tornBytes.length,
    quarantinePath,
    sha256: sha,
    quarantineAlreadyExisted,
    directorySync,
  });
}
