/**
 * Production adapters: spawn port around node:child_process.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { SpawnedChild, SpawnPort } from "./process-ports.js";

type ChildEventName = "spawn" | "error" | "exit" | "close";

type ChildListener<E extends ChildEventName> = E extends "spawn"
  ? () => void
  : E extends "error"
    ? (e: Error & { code?: string; syscall?: string; path?: string }) => void
    : (code: number | null, signal: NodeJS.Signals | null) => void;

export function nodeSpawnPort(): SpawnPort {
  return {
    spawn: (args) => {
      const child: ChildProcess = spawn(args.executable, [...args.argv], {
        cwd: args.cwd,
        env: { ...args.env },
        detached: args.detached,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return adaptChild(child);
    },
  };
}

function adaptChild(child: ChildProcess): SpawnedChild {
  const adapted = makeAdapted(child);
  return adapted;
}

function makeAdapted(child: ChildProcess): SpawnedChild {
  const obj = {
    get pid(): number | null {
      return child.pid === undefined ? null : child.pid;
    },
    get pgid(): number | null {
      return null;
    },
    get stdout(): NodeJS.ReadableStream | null {
      return child.stdout;
    },
    get stderr(): NodeJS.ReadableStream | null {
      return child.stderr;
    },
    on(event: ChildEventName, listener: (...args: unknown[]) => void): SpawnedChild {
      child.on(event as never, listener as never);
      return obj as unknown as SpawnedChild;
    },
    once(event: ChildEventName, listener: (...args: unknown[]) => void): SpawnedChild {
      child.once(event as never, listener as never);
      return obj as unknown as SpawnedChild;
    },
    kill(signal?: NodeJS.Signals | number): boolean {
      return child.kill(signal);
    },
  };
  // The type cast below collapses the heterogeneous get-method
  // shape into the declared SpawnedChild type. Runtime behavior is
  // identical; the cast is needed because TS cannot prove that
  // getters returning `T | null` satisfy an interface with `T`.
  return obj as unknown as SpawnedChild;
}

// Suppress unused-type lint: the alias is referenced for clarity at
// the boundary but not directly instantiated.
export type _ListenerAlias = ChildListener<ChildEventName>;
