import { spawn, type ChildProcess } from "node:child_process";

import type {
  WitnessSpawnHandle,
  WitnessSpawnPort,
  WitnessSpawnSpec,
  WitnessSpawnSpecResult,
} from "./witness-start-types.js";

function buildArgv(spec: WitnessSpawnSpec): string[] {
  return [
    "--import", spec.tsxLoader,
    spec.witnessesEntry,
    "--run-dir", spec.runDir,
    "--control-dir", spec.controlDir,
    "--witness-id", spec.witnessId,
    "--witness-instance-id", spec.witnessInstanceId,
    "--socket-path", spec.socketPath,
    "--run-id", spec.runId,
    "--mission-id", spec.missionId,
    "--attempt-id", spec.attemptId,
    "--process-id", spec.processId,
    "--bootstrap-lease-ms", String(spec.bootstrapLeaseMs),
    "--protocol-version", String(spec.protocolVersion),
  ];
}

/**
 * Overloaded `on` so the listener parameter type matches
 * the underlying ChildProcess contract. Returns the wrapped
 * handle for chaining (consistent with EventEmitter).
 */
type ExitListener = (
  code: number | null,
  signal: NodeJS.Signals | null,
) => void;
type ErrorListener = (err: Error) => void;

function wrapChild(child: ChildProcess): WitnessSpawnHandle {
  const on = (event: "exit" | "error", listener: unknown): WitnessSpawnHandle => {
    if (event === "exit") {
      const exitL = listener as ExitListener;
      child.on("exit", (code, signal) => exitL(code, signal));
    } else {
      const errL = listener as ErrorListener;
      child.on("error", (err: Error) => errL(err));
    }
    return handle;
  };
  const handle: WitnessSpawnHandle = {
    pid: child.pid === undefined ? null : child.pid,
    kill: (signal?: NodeJS.Signals): boolean => child.kill(signal),
    on: on as WitnessSpawnHandle["on"],
  };
  return handle;
}

/**
 * Pure state machine for spawn-event classification.
 *
 *   pending -- spawn  --> spawned (terminal, ok)
 *   pending -- error  --> failed  (terminal, ok:false)
 *   spawned -- error  --> spawned (terminal, no relabel)
 *
 * The Node runtime emits exactly one of {'spawn', 'error'}
 * for the spawn step itself; if 'spawn' fires, the child
 * is created. A later 'error' event is about the
 * *post-spawn* lifecycle (e.g. failed to start the next
 * command) and must NOT be relabeled `spawn_failed`.
 *
 * This function exists so the doctrine can be tested
 * mechanically without spinning up a real Node child.
 *
 *   classifySpawnEvent(state, event) -> { state, terminal, ok }
 */
export type SpawnState = "pending" | "spawned" | "failed";

export type SpawnEvent = "spawn" | "error";

export type SpawnClassification = {
  readonly state: SpawnState;
  readonly terminal: boolean;
  readonly ok: boolean;
};

export function classifySpawnEvent(
  state: SpawnState,
  event: SpawnEvent,
): SpawnClassification {
  if (state === "spawned") {
    // Once spawned, any further event is post-spawn.
    // It does NOT change the ok:true classification.
    return { state: "spawned", terminal: true, ok: true };
  }
  if (state === "failed") {
    // Symmetric for the failure side; once failed,
    // additional 'error' events (rare; e.g. process
    // teardown) do NOT change the classification.
    return { state: "failed", terminal: true, ok: false };
  }
  // state === "pending"
  if (event === "spawn") {
    return { state: "spawned", terminal: true, ok: true };
  }
  // event === "error" while pending == pre-spawn failure
  return { state: "failed", terminal: true, ok: false };
}

/**
 * Production spawn port. P1#2 / WS09a / WS09b / WS09c:
 *
 *   spawn() returns a Promise that resolves only after
 *   the underlying Node `'spawn'` event has fired. A
 *   pre-spawn `'error'` event (ENOENT, EACCES, etc.)
 *   resolves the Promise with a `spawn_failed` result
 *   BEFORE the supervisor ever observes ok:true. A
 *   post-spawn `'error'` (or 'exit') does NOT trigger
 *   `spawn_failed`; the spawned witness is already
 *   authoritative and its lifecycle is owned by the
 *   supervisor / recovery layer.
 *
 * Node documentation reference:
 *   "The 'spawn' event is emitted once the child process
 *    has spawned successfully. If the child process does
 *    not spawn successfully, the 'error' event is emitted
 *    instead."
 *
 * The listeners are attached SYNCHRONOUSLY inside spawn()
 * before any I/O can complete, so no event can be missed.
 */
export function nodeSpawnWitnessPort(): WitnessSpawnPort {
  return {
    spawn(spec: WitnessSpawnSpec): Promise<WitnessSpawnSpecResult> {
      const argv = buildArgv(spec);
      let child: ChildProcess;
      try {
        child = spawn(spec.nodePath, argv, {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        });
      } catch (e: unknown) {
        // Synchronous throw from spawn (very rare; usually
        // invalid options or OOM). Map to spawn_threw.
        const msg = e instanceof Error ? e.message : String(e);
        return Promise.resolve({
          ok: false,
          failure: { kind: "spawn_threw", message: msg },
        });
      }
      return new Promise<WitnessSpawnSpecResult>((resolve) => {
        let settled = false;
        const settle = (r: WitnessSpawnSpecResult): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        // Attach listeners synchronously so no event can
        // be lost between spawn() returning and us listening.
        child.once("spawn", () => {
          settle({ ok: true, handle: wrapChild(child) });
        });
        child.once("error", (err: Error) => {
          settle({
            ok: false,
            failure: { kind: "spawn_error_event", message: err.message },
          });
        });
        // WS09c: a POST-spawn 'error' (e.g. the spawned
        // process later emits 'error') does NOT trigger
        // spawn_failed. We deliberately do NOT attach a
        // listener to that case; the supervisor / recovery
        // layer owns post-spawn lifecycle.
      });
    },
  };
}
