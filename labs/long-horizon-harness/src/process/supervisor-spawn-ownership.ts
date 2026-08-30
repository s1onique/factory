/**
 * CORRECTION06 §3: generic observer seam for the spawn→ownership gap.
 *
 * Production code calls {@link SpawnOwnershipObserver.afterOsSpawnBeforeOwnershipCommit}
 * once the OS spawn has succeeded and the pid+pgid are known, BEFORE
 * the durable process_spawned critical commit can settle. The
 * observer fires synchronously (or returns a Promise) so test helpers
 * can exit the supervisor process before the commit / its failure
 * compensation runs. This is the small, generic hook used by CP03
 * to crash inside the actual gap.
 *
 * NOT a test-only production branch: production code can install any
 * observer (e.g. for metrics) without affecting normal behavior.
 */

import type { ProcessId } from "./process-types.js";

export type SpawnOwnershipObservation = {
  readonly processId: ProcessId;
  readonly pid: number;
  readonly pgid: number;
};

export interface SpawnOwnershipObserver {
  /**
   * Called immediately after the OS spawn has produced a real
   * pid+pgid and before the process_spawned critical commit has
   * settled. If the observer throws or its returned Promise rejects,
   * the supervisor treats this as an observer malfunction and
   * continues with the durable commit (observers are passive).
   *
   * Implementations that want to CRASH the supervisor (CP03) should
   * call process.exit directly; the durable commit never gets to run.
   */
  afterOsSpawnBeforeOwnershipCommit(observation: SpawnOwnershipObservation): void | Promise<void>;
}

export const NOOP_SPAWN_OWNERSHIP_OBSERVER: SpawnOwnershipObserver = {
  afterOsSpawnBeforeOwnershipCommit(): void { /* passive */ },
};

export async function runSpawnOwnershipObserver(
  observer: SpawnOwnershipObserver | undefined,
  observation: SpawnOwnershipObservation,
): Promise<void> {
  if (observer === undefined) return;
  try {
    await observer.afterOsSpawnBeforeOwnershipCommit(observation);
  } catch (e: unknown) {
    // Observers are passive. Swallow exceptions; production behavior is unchanged.
    return;
  }
}
