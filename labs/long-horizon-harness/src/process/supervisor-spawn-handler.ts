/**
 * CORRECTION06 §25: extracted from supervisor-builder. Owns the
 * spawn→ownership gap wiring: when the Node child emits spawn,
 * resolve pid+pgid, observe the SpawnOwnershipObserver seam,
 * emit process_spawned, and resolve spawnResolution based on
 * the durable commit outcome.
 *
 * CORRECTION09 §19: if the async listener body throws an
 * unexpected rejection (programming bug, sink malfunction
 * surfaced through the listener path, etc.), the supervisor
 * MUST NOT leave spawnResolution pending. Instead it
 * resolves `spawn_failed(internal_process_failure)` so the
 * supervisor's current-owner cleanup path can run.
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
  // CORRECTION09 §22: Node's EventEmitter does NOT await
  // returned Promises. The async listener body MUST be
  // wrapped in a catch. The catch converts any unexpected
  // rejection into a typed spawn failure (fail-closed) —
  // it does NOT silently drop the rejection.
  const onSpawn = async (): Promise<void> => {
    args.setSpawnEventSeen(true);
    const pid = args.child.pid;
    const pgid = args.child.pgid !== null && args.child.pgid !== undefined
      ? args.child.pgid
      : (pid !== null && pid !== undefined ? pid : null);
    if (pid === null || pid === undefined) {
      args.resolveSpawnResolution({
        kind: "spawn_failed",
        failure: {
          kind: "internal_process_failure",
          message: "spawn event fired but pid is null",
        },
      });
      return;
    }
    args.cachedPidRef.current = pid;
    args.cachedPgidRef.current = pgid;
    await runSpawnOwnershipObserver(args.spawnOwnershipObserver, {
      processId: args.id,
      pid,
      pgid: pgid ?? pid,
    });
    args.safeEmit({
      kind: "process_spawned",
      processId: args.id,
      pid,
      processGroupId: pgid ?? pid,
    });
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
        message:
          outcome.stage === "internal_malfunction"
            ? `process_spawned commit threw: ${outcome.message}`
            : `process_spawned commit failed: ${outcome.message}`,
      },
    });
  };
  args.child.on("spawn", () => {
    onSpawn().catch((e: unknown) => {
      // CORRECTION10 §10-§19: by the time `spawn` fires,
      // Node has already created the child. We MUST NOT
      // resolve as `spawn_failed` (semantically "creation
      // never happened"). The OS process exists; the current
      // supervisor owns it and must run bounded cleanup.
      //
      // Fail-closed via `post_spawn_internal_failure`:
      //   - carries the real pid/pgid (read AFTER spawn)
      //   - preserves the typed cause
      //   - is routed through cleanupPath by runLifecycle
      const message =
        e instanceof Error ? e.message : String(e);
      const pid = args.child.pid;
      const pgid = args.child.pgid !== null && args.child.pgid !== undefined
        ? args.child.pgid
        : (pid !== null && pid !== undefined ? pid : null);
      if (pid === null || pid === undefined || pgid === null || pgid === undefined) {
        // No real pid/pgid available → we genuinely cannot
        // claim ownership; this is the only legal path back
        // to `spawn_failed` post-spawn.
        args.resolveSpawnResolution({
          kind: "spawn_failed",
          failure: {
            kind: "internal_process_failure",
            message: `async spawn-handler rejected without pid/pgid: ${message}`,
          },
        });
        return;
      }
      args.resolveSpawnResolution({
        kind: "post_spawn_internal_failure",
        pid,
        pgid,
        failure: {
          kind: "internal_process_failure",
          message: `async spawn-handler rejected: ${message}`,
        },
      });
    });
  });
}
