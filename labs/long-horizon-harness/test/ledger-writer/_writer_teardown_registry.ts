/**
 * (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
 *  OUTCOME01-CORRECTION01)
 *
 * Cross-test teardown-outcome registry. Stores the
 * typed `TerminateOutcome` for each writer child
 * that has been torn down during the live lane,
 * keyed by a stable handle id (the runDir, which
 * is unique per test).
 *
 * Why this exists:
 *   The doctrine of OUTCOME01 is "every lifecycle
 *   owner MUST consume the outcome". Without a
 *   shared registry, each LWQ case would have to
 *   maintain its own outcome-tracking local — and
 *   the end-of-suite sweep would have nothing
 *   cross-cutting to read. This module gives the
 *   sweep a single point to query the typed cause
 *   of each child teardown, joined with the
 *   residue-state observation (alive / terminated).
 *
 * Why this is test-only:
 *   Production code does not own child lifecycles
 *   through a SIGKILL teardown — that is a fixture
 *   concern. This registry lives under
 *   `test/ledger-writer/` and is consumed only by
 *   test code.
 *
 * Concurrency:
 *   Node's single-threaded event loop guarantees
 *   that mutations between `await` points cannot
 *   race. The map access is non-atomic in the JS
 *   sense but is fine for test-fixture semantics.
 */
import type { TerminateOutcome } from "./_writer_teardown.js";

/**
 * Stable identity for a writer child. We use the
 * `runDir` because it is unique per LWQ case body
 * and survives multiple `h.stop()` calls (the
 * handle is consumed, the runDir is not).
 */
export type TeardownKey = string;

export type TeardownRecord = {
  readonly key: TeardownKey;
  readonly outcome: TerminateOutcome;
  readonly recordedAt: number;
};

const teardowns: Map<TeardownKey, TeardownRecord> = new Map();

/**
 * Record the typed teardown outcome for a writer
 * child. This is the SOLE point at which a typed
 * outcome becomes part of the cross-cutting
 * residue evidence.
 */
export function recordWriterTeardown(
  key: TeardownKey,
  outcome: TerminateOutcome,
): void {
  teardowns.set(key, {
    key,
    outcome,
    recordedAt: Date.now(),
  });
}

/**
 * Look up a previously-recorded teardown outcome.
 * Returns `undefined` if no teardown was recorded
 * for the given key (which is itself a violation
 * of the doctrine — every handle MUST have its
 * outcome recorded before the residue sweep).
 */
export function getWriterTeardown(
  key: TeardownKey,
): TeardownRecord | undefined {
  return teardowns.get(key);
}

/**
 * Snapshot all recorded teardowns. The sweep uses
 * this to join cause (typed outcome) with effect
 * (residue observation).
 */
export function getAllWriterTeardowns(): readonly TeardownRecord[] {
  return Array.from(teardowns.values());
}

/**
 * Number of recorded teardowns. WSTOP06 uses this
 * to assert that the discarded-stop-result pattern
 * count is zero — every `await h.stop()` call MUST
 * be followed by a `recordWriterTeardown`.
 */
export function writerTeardownCount(): number {
  return teardowns.size;
}

/**
 * Clear the registry. Used by test setup to ensure
 * each adversarial run starts from a clean slate.
 */
export function clearWriterTeardowns(): void {
  teardowns.clear();
}