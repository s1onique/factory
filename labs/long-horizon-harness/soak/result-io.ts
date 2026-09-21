/**
 * LH-06 deterministic long-duration soak laboratory —
 * result artifact IO + verdict mapping.
 *
 * Split from `result.ts` for source-size discipline.
 *
 * L06-CORRECTION03 L06-C20: `writeResult` performs
 * same-directory temp-write + fsync + atomic rename so
 * the supervisor never observes a half-written artifact.
 *
 * L06-CORRECTION06 L06-C33: `writeResult` returns the
 * enhanced result with `publication_durability` set
 * to the actual durability class of THIS publication.
 * The supervisor MUST publish through the same
 * crash-durable write (not plain `writeFileSync`) so
 * the canonical qualification path carries the
 * durability class end-to-end.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { LH06Result, LH06FailureRecord } from "./result.js";
import type { LH06Verdict } from "./types.js";

/**
 * L06-CORRECTION09 L06-C40: typed error for the case
 * where the bounded reconciliation loop exhausts its
 * retry budget without ever observing agreement between
 * the on-disk JSON and the FINAL publication's durability
 * class. The CORRECTION08 implementation silently
 * rewrote the returned object to the last observation
 * while the on-disk JSON still claimed the previous
 * observation's class — i.e., it fabricated agreement.
 * This typed error makes the failure observable to the
 * supervisor and the test harness.
 */
export class DurabilityReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurabilityReconciliationError";
  }
}

/**
 * Result-publication durability. The full POSIX
 * sequence (fsync file + rename + fsync parent dir)
 * yields CRASH_DURABLE; without the directory fsync
 * (because the filesystem cannot fsync a directory,
 * e.g. on Windows or some network mounts) the result
 * is still ATOMIC_ONLY (readers see old or new bytes
 * but never a torn write) but a power loss between the
 * rename and the directory entry commit can lose the
 * rename.
 */
export type PublicationDurability =
  | "CRASH_DURABLE"
  | "ATOMIC_ONLY";

/**
 * L06-CORRECTION08 L06-C37 TEST-ONLY utility. Resets
 * the per-process sequence state on
 * `publishAtomicDurableBytes`. Tests that drive
 * deterministic durability sequences MUST call this
 * at the end of each test invocation to avoid
 * cross-test contamination of the static call-index
 * counter.
 */
export function __resetTestDurabilitySequence(): void {
  const self = publishAtomicDurableBytes as unknown as {
    __activeSeq?: ReadonlyArray<PublicationDurability>;
    __callIdx?: number;
  };
  delete self.__activeSeq;
  self.__callIdx = 0;
}

/**
 * Internal helper. Performs the temp-write + fsync +
 * rename + fsync-parent-dir sequence on the given JSON
 * bytes and reports the resulting durability class.
 *
 * L06-CORRECTION06 L06-C33: exported as
 * `publishAtomicDurableBytes` so the supervisor can
 * promote a worker artifact (or a synthesized supervisor
 * failure artifact) to the canonical qualification path
 * using the SAME crash-durable write that
 * `writeResult` uses for the worker's private per-run
 * artifact. Promoting through a plain `writeFileSync`
 * (the previous behaviour) destroyed the
 * `CRASH_DURABLE` property and the verifier would
 * (correctly) refuse any PASS verdict that arrived
 * through the canonical path.
 */
export function publishAtomicDurableBytes(
  path: string,
  json: string,
  /**
   * TEST-ONLY durability sequence. If supplied, the
   * publisher returns each entry in order on
   * successive calls; once exhausted it returns the
   * last entry. Production callers never supply this;
   * the function performs the real POSIX publish when
   * the sequence is omitted.
   */
  durabilitySequence?: ReadonlyArray<PublicationDurability>,
): PublicationDurability {
  // TEST-ONLY short-circuit. The injection only fires
  // when a sequence is supplied; production callers
  // always go through the real POSIX publish below.
  if (durabilitySequence !== undefined && durabilitySequence.length > 0) {
    // Use a per-process counter that resets whenever a
    // NEW sequence (different identity) is supplied.
    // This guarantees successive calls in the same
    // `writeResult` / `publishCommitWitness` invocation
    // advance through the injected sequence, and that
    // an unrelated subsequent test invocation starts
    // from index 0 of its own sequence.
    const seq = durabilitySequence;
    const self = publishAtomicDurableBytes as unknown as {
      __activeSeq?: ReadonlyArray<PublicationDurability>;
      __callIdx?: number;
    };
    if (self.__activeSeq !== seq) {
      self.__activeSeq = seq;
      self.__callIdx = 0;
    }
    const idx = Math.min(self.__callIdx ?? 0, seq.length - 1);
    self.__callIdx = idx + 1;
    return seq[idx] ?? seq[seq.length - 1] ?? "ATOMIC_ONLY";
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  // `openSync(path, "w")` is portable: write + create +
  // truncate. The run-loop is single-writer so we do not
  // need O_EXCL.
  const fd = openSync(tmp, "w", 0o644);
  try {
    writeFileSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Atomic rename onto the canonical path. On POSIX
  // this is a single rename(2) syscall; the canonical
  // path either points at the previous file or the new
  // file — never a partial write.
  renameSync(tmp, path);
  // L06-CORRECTION04 L06-C25: fsync the parent
  // directory so the rename's directory entry is
  // durable across power loss. POSIX `fsync(file)`
  // persists the file's data and metadata but NOT the
  // directory entry.
  let durability: PublicationDurability = "ATOMIC_ONLY";
  try {
    const dirFd = openSync(dirname(path), "r", 0o644);
    try {
      fsyncSync(dirFd);
      durability = "CRASH_DURABLE";
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Some filesystems cannot fsync a directory; the
    // file-level fsync above is still authoritative
    // for visibility (ATOMIC_ONLY).
  }
  return durability;
}

/**
 * Max corrective re-publishes inside the bounded
 * reconciliation loop. After `MAX_RECONCILE_ATTEMPTS`
 * unsuccessful corrections, the publisher fails-closed
 * with `DurabilityReconciliationError`. See
 * `publishReconciledJson` for the invariants.
 */
const MAX_RECONCILE_ATTEMPTS = 4;

/**
 * L06-CORRECTION10 L06-C41: the bounded reconciliation
 * primitive extracted so BOTH `writeResult` (worker
 * path) and `writeSupervisorResult` (supervisor
 * failure-artifact path) share the same fail-closed
 * invariants. The CORRECTION09 fix only landed in the
 * worker path; the supervisor kept a divergent
 * one-corrective-write implementation. This helper
 * closes that gap.
 *
 * @returns the durability class of the FINAL
 *   publication (the one whose on-disk JSON claims
 *   the same class) and the SHA-256 of those final
 *   bytes.
 */
export function publishReconciledJson(args: {
  readonly path: string;
  readonly json: string;
  /** TEST-ONLY: see `publishAtomicDurableBytes`. */
  readonly durabilitySequence?: ReadonlyArray<PublicationDurability>;
}): {
  readonly durability: PublicationDurability;
  readonly sha256: string;
} {
  // Sentinel pass: publish bytes with
  // publication_durability=null so the canonical path
  // exists before we know THIS publication's class.
  const sentinelJson = args.json.replace(
    /"publication_durability"\s*:\s*"[A-Z_]+"/,
    '"publication_durability": null',
  );
  publishAtomicDurableBytes(args.path, sentinelJson, args.durabilitySequence);
  // Provisional pass: claim CRASH_DURABLE; observe the
  // class of THIS publication to seed the loop.
  const provisionalJson = args.json.replace(
    /"publication_durability"\s*:\s*"[A-Z_]+"/,
    '"publication_durability": "CRASH_DURABLE"',
  );
  let observed: PublicationDurability = publishAtomicDurableBytes(
    args.path,
    provisionalJson,
    args.durabilitySequence,
  );
  // The "recorded" class that the on-disk JSON
  // CURRENTLY claims. Sentinel pass wrote `null`;
  // provisional pass wrote CRASH_DURABLE.
  let last_written_class: PublicationDurability = "CRASH_DURABLE";
  let finalJson: string = provisionalJson;
  let attempts = 0;
  while (
    last_written_class !== observed &&
    attempts < MAX_RECONCILE_ATTEMPTS
  ) {
    finalJson = args.json.replace(
      /"publication_durability"\s*:\s*"[A-Z_]+"/,
      `"publication_durability": "${observed}"`,
    );
    last_written_class = observed;
    observed = publishAtomicDurableBytes(
      args.path,
      finalJson,
      args.durabilitySequence,
    );
    attempts++;
  }
  if (last_written_class !== observed) {
    throw new DurabilityReconciliationError(
      `publishReconciledJson: durability reconciliation failed after ${String(attempts)} attempts; ` +
        `last_written_class=${last_written_class} observed=${observed}; ` +
        `refusing to fabricate agreement`,
    );
  }
  const sha256 = createHash("sha256").update(finalJson).digest("hex");
  return { durability: observed, sha256 };
}

/**
 * C02-03: Supervisor failure artifacts use a distinct
 * schema (`lh06.supervisor-terminal-result/v1`) so
 * they cannot be confused with the canonical worker
 * result (`lh06.deterministic.soak.result.v1`). A
 * watchdog result does NOT pretend to be a worker-result.
 *
 * L06-CORRECTION10 L06-C41: durability reconciliation
 * delegated to `publishReconciledJson`, the SAME
 * primitive the worker writer uses. There is no
 * divergent supervisor-only durability path.
 */
export function writeSupervisorResult(args: {
  readonly path: string;
  readonly profile: string;
  readonly supervisor_run_id: string;
  readonly worker_result_path: string | null;
  readonly verdict: LH06Verdict;
  readonly failure: LH06FailureRecord;
  readonly child_exit_code: number | null;
  readonly child_exit_signal: NodeJS.Signals | null;
  readonly supervisor_reason: string;
  readonly started_at_ms: number;
  readonly finished_at_ms: number;
  readonly duration_ms: number;
  /** TEST-ONLY: see `publishAtomicDurableBytes`. */
  readonly durabilitySequence?: ReadonlyArray<PublicationDurability>;
}): {
  readonly path: string;
  readonly sha256: string;
  readonly publication_durability: PublicationDurability;
} {
  const result = {
    schema: "lh06.supervisor-terminal-result/v1",
    contract_version: "lh06.soak.contract.v1",
    profile: args.profile,
    supervisor_run_id: args.supervisor_run_id,
    worker_result_path: args.worker_result_path,
    started_at: new Date(args.started_at_ms).toISOString(),
    finished_at: new Date(args.finished_at_ms).toISOString(),
    duration_ms: args.duration_ms,
    failure: args.failure,
    verdict: args.verdict,
    supervisor_termination: {
      child_exit_code: args.child_exit_code,
      child_exit_signal: args.child_exit_signal,
      supervisor_reason: args.supervisor_reason,
      captured_at_ms: args.finished_at_ms,
    },
    publication_durability: "ATOMIC_ONLY",
  };
  const json = JSON.stringify(result, null, 2) + "\n";
  const { durability, sha256 } = publishReconciledJson({
    path: args.path,
    json,
    ...(args.durabilitySequence !== undefined
      ? { durabilitySequence: args.durabilitySequence }
      : {}),
  });
  return {
    path: args.path,
    sha256,
    publication_durability: durability,
  };
}

export function writeResult(args: {
  readonly path: string;
  readonly result: LH06Result;
  /** TEST-ONLY: inject a deterministic durability sequence. */
  readonly durabilitySequence?: ReadonlyArray<PublicationDurability>;
}): {
  readonly path: string;
  readonly sha256: string;
  readonly publication_durability: PublicationDurability;
  readonly result: LH06Result;
} {
  // L06-CORRECTION10 L06-C41: durability bookkeeping is
  // delegated to `publishReconciledJson`, the SAME
  // primitive `writeSupervisorResult` uses. There is no
  // longer a divergent worker-only durability loop.
  // The contract remains:
  //   - on-disk JSON's `publication_durability` agrees
  //     with the FINAL publication's observed class
  //   - on budget exhaustion we throw
  //     `DurabilityReconciliationError` rather than
  //     fabricating agreement
  const provisional: LH06Result = {
    ...args.result,
    publication_durability: "CRASH_DURABLE",
  };
  const provisionalJson = JSON.stringify(provisional, null, 2) + "\n";
  const { durability, sha256 } = publishReconciledJson({
    path: args.path,
    json: provisionalJson,
    ...(args.durabilitySequence !== undefined
      ? { durabilitySequence: args.durabilitySequence }
      : {}),
  });
  const finalResult: LH06Result = {
    ...args.result,
    publication_durability: durability,
  };
  return {
    path: args.path,
    sha256,
    publication_durability: durability,
    result: finalResult,
  };
}

/** Map a failure kind to a verdict. */
export function verdictForFailure(
  kind: LH06FailureRecord["kind"],
): LH06Verdict {
  switch (kind) {
    case "MEMORY_GROWTH": case "RESOURCE_LEAK": case "WORKSPACE_LEAK":
      return "FAIL_RESOURCE_STABILITY";
    case "LATENCY_DRIFT": return "FAIL_LATENCY_STABILITY";
    case "FROZEN_MUTATION": return "FAIL_FROZEN_INTEGRITY";
    case "SEMANTIC_DRIFT": case "FAULT_ESCAPE": case "LIFECYCLE_DRIFT":
      return "FAIL_SEMANTIC_DRIFT";
    case "WORKER_CRASH": case "WORKER_HANG":
    case "BASELINE_REGRESSION": case "INVALID_TELEMETRY":
      return "FAIL_WORKER";
    case "QUALIFICATION_INCOMPLETE": return "QUALIFICATION_INCOMPLETE";
    case "INCONCLUSIVE_ENVIRONMENT": return "INCONCLUSIVE_ENVIRONMENT";
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return "FAIL_WORKER";
    }
  }
}
