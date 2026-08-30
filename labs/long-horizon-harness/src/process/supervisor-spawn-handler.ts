/**
 * CORRECTION06 §25: extracted from supervisor-builder. Owns the
 * spawn→ownership gap wiring: when the Node child emits spawn,
 * resolve pid+pgid, observe the SpawnOwnershipObserver seam,
 * emit process_spawned, and resolve spawnResolution based on
 * the durable commit outcome.
 */
import type { ProcessId, RuntimeEvent } from "./process-types.js";
import type { SpawnedChild, SpawnResolution } from "./process-types.js";
import type { SpawnOwnershipObserver } from "./supervisor-spawn-ownership.js";
import { runSpawnOwnershipObserver } from "./supervisor-spawn-ownership.js";
import { requireCriticalCommit } from "./critical-commit.js";
import type { ProcessEvidenceCommitResult } from "./process-evidence-sink.js";

export function wireSpawnOwnershipHandler(args: {
  readonly id: ProcessId;
  readonly child: SpawnedChild;
  readonly safeEmit: (e: RuntimeEvent) => void;
  readonly cachedPidRef: { current: number | null };
  readonly cachedPgidRef: { current: number | null };
  readonly resolveSpawnResolution: (r: SpawnResolution) => void;
  readonly ownershipCommitRef: { current: Promise<unknown> | null };
  readonly spawnOwnershipObserver: SpawnOwnershipObserver | undefined;
  readonly setSpawnEventSeen: (v: boolean) => void;
}): void {
  // CORRECTION08 §28: Node's EventEmitter does NOT await
  // returned Promises. The async listener body MUST be
  // wrapped in a catch so a rejection cannot escape.
  const onSpawn = async (): Promise<void> => {
    args.setSpawnEventSeen(true);
    const pid = args.child.pid;
    const pgid = args.child.pgid !== null && args.child.pgid !== undefined
      ? args.child.pgid
      : (pid !== null && pid !== undefined ? pid : null);
    if (pid === null || pid === undefined) {
      args.resolveSpawnResolution({ kind: "spawn_failed", failure: { kind: "internal_process_failure", message: "spawn event fired but pid is null" } });
      return;
    }
    args.cachedPidRef.current = pid;
    args.cachedPgidRef.current = pgid;
    // CORRECTION06 §3: observer seam BEFORE process_spawned commit.
    // CORRECTION06 §4: await the observer BEFORE emitting process_spawned
    await runSpawnOwnershipObserver(args.spawnOwnershipObserver, { processId: args.id, pid, pgid: pgid ?? pid });
    args.safeEmit({ kind: "process_spawned", processId: args.id, pid, processGroupId: pgid ?? pid });
    const awaitOwnership = async (): Promise<void> => {
      const p = args.ownershipCommitRef.current;
      if (p === null) {
        args.resolveSpawnResolution({ kind: "spawned", pid, pgid: pgid ?? pid });
        return;
      }
      const outcome = await requireCriticalCommit(p as Promise<ProcessEvidenceCommitResult>);
      if (outcome.kind === "ok") {
        args.resolveSpawnResolution({ kind: "spawned", pid, pgid: pgid ?? pid });
        return;
      }
      args.resolveSpawnResolution({
        kind: "ownership_persistence_failed",
        pid,
        pgid: pgid ?? pid,
        failure: {
          kind: "evidence_persistence_failure",
          stage: "ownership",
          message: outcome.stage === "internal_malfunction" ? `process_spawned commit threw: ${outcome.message}` : `process_spawned commit failed: ${outcome.message}`,
        },
      });
    };
    await awaitOwnership();
  };
  // Attach the wrapped listener so unhandled rejections cannot escape.
  args.child.on("spawn", () => {
    onSpawn().catch((_e: unknown) => {
      // Swallow: observers are passive and the supervisor's
      // own await path is what drives spawn resolution.
      // Listener exceptions must not crash the process.
    });
  });
}
