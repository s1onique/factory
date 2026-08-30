/**
 * CORRECTION08 — supervisor evidence runtime.
 *
 * Wraps {@link ./process-evidence-bridge-emit.ts} with the
 * per-supervisor wiring: tracker ownership, ownership-commit
 * ref, sealed flag, and the `safeEmit` thunk. Pulled out of
 * supervisor-builder.ts to keep that file under the 400 LOC
 * discipline.
 *
 * The runtime does NOT make policy decisions. It is a thin
 * wrapper that:
 *   - routes a RuntimeEvent through the bridge,
 *   - captures the critical-boundary commit promise for the
 *     spawn handler (ownership gate),
 *   - tracks all pending observations so wrappedAwait can
 *     sequence them deterministically.
 *
 * CORRECTION08 (process_spawn_requested):
 *   - `safeEmit({kind:"process_spawn_started", ...})` returns
 *     the critical-boundary commit Promise for
 *     `process_spawn_requested`. The caller MUST await it
 *     BEFORE performing the OS spawn. `await` is the only
 *     ordering primitive that survives a crash between
 *     intent emission and OS reality creation.
 */

import {
  emitWithPersistence,
  PendingCommitsTracker,
} from "./process-evidence-bridge-emit.js";
import type { ProcessEvidenceCommitResult } from "./process-evidence-sink.js";
import type { ProcessId, RuntimeEvent } from "./process-types.js";
import type {
  EvidenceCommitObserver,
  ProcessEvidenceIdentity,
  SyntheticRuntimeEvent,
} from "./process-evidence-bridge.js";
import type { ProcessEvidenceSink } from "./process-evidence-sink.js";

export type EvidenceRuntime = {
  readonly sink: ProcessEvidenceSink;
  readonly identity: ProcessEvidenceIdentity;
  readonly observer: EvidenceCommitObserver | undefined;
  readonly tracker: PendingCommitsTracker;
  /**
   * safeEmit routes the event to the bridge. Returns the
   * critical-boundary commit Promise when applicable, or
   * null for non-critical observations. After
   * `seal()` it becomes a no-op.
   */
  readonly safeEmit: (
    e: RuntimeEvent | SyntheticRuntimeEvent,
  ) => Promise<ProcessEvidenceCommitResult> | null;
  readonly seal: () => void;
  readonly isSealed: () => boolean;
};

export function createEvidenceRuntime(args: {
  readonly processId: ProcessId;
  readonly evidenceSink: ProcessEvidenceSink;
  readonly evidenceIdentity: ProcessEvidenceIdentity;
  readonly evidenceObserver?: EvidenceCommitObserver;
}): EvidenceRuntime {
  const tracker = new PendingCommitsTracker();
  let sealed = false;
  const safeEmit = (
    e: RuntimeEvent | SyntheticRuntimeEvent,
  ): Promise<ProcessEvidenceCommitResult> | null => {
    if (sealed) return null;
    return emitWithPersistence({
      processId: args.processId,
      evidenceSink: args.evidenceSink,
      identity: args.evidenceIdentity,
      tracker,
      ...(args.evidenceObserver !== undefined
        ? { observer: args.evidenceObserver }
        : {}),
      event: e,
      innerSink: () => {},
    });
  };
  return {
    sink: args.evidenceSink,
    identity: args.evidenceIdentity,
    observer: args.evidenceObserver,
    tracker,
    safeEmit,
    seal: () => {
      sealed = true;
    },
    isSealed: () => sealed,
  };
}
