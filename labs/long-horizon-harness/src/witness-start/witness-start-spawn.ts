import { spawn, type ChildProcess } from "node:child_process";

import type {
  WitnessSpawnHandle,
  WitnessSpawnPort,
  WitnessSpawnSpec,
  WitnessSpawnSpecResult,
  WitnessSpawnFailure,
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

export function nodeSpawnWitnessPort(): WitnessSpawnPort {
  return {
    spawn(spec: WitnessSpawnSpec): WitnessSpawnSpecResult {
      const argv = buildArgv(spec);
      let child: ChildProcess;
      try {
        child = spawn(spec.nodePath, argv, {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          failure: { kind: "spawn_threw", message: msg } satisfies WitnessSpawnFailure,
        };
      }
      return { ok: true, handle: wrapChild(child) };
    },
  };
}
