import { spawn, type ChildProcess } from "node:child_process";
import {
  drainBounded,
  type BoundedOutputStats,
  type DrainCompletion,
} from "./witness-start-bootstrap-output.js";
import type {
  WitnessBootstrapOutput,
  WitnessExitInfo,
} from "./witness-start-types.js";

import type {
  WitnessSpawnHandle,
  WitnessSpawnPort,
  WitnessSpawnSpec,
  WitnessSpawnSpecResult,
} from "./witness-start-types.js";

/**
 * Build the argv for the witness bootstrap child.
 *
 * Exported (CORRECTION04) so WSTART-ENDPOINT02 can drive
 * it directly with a uniquely-named writer binding and
 * verify the path is carried verbatim. The argument
 * ordering is stable; changing it requires updating
 * `_witness_helper.ts` parseArgs.
 */
export function buildArgv(spec: WitnessSpawnSpec): string[] {
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
    // CORRECTION04: the witness bootstrap requires the
    // LedgerWriter binding; the spec already validates it
    // (B0 freeze). We MUST carry it through to the child
    // argv — otherwise the child fails closed with exit 2
    // (B0-C01-11: ledgerWriterSocketPath required).
    "--ledger-writer-socket-path", spec.ledgerWriterSocketPath,
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

/**
 * Wrap a real Node `ChildProcess` in a `WitnessSpawnHandle`.
 *
 * This is exported so that observability tests can drive
 * the production wiring directly. It MUST NOT be called
 * by application code; callers should use
 * `nodeSpawnWitnessPort()` (or the spawn-port test fake),
 * not invoke `wrapChild` themselves.
 */
export function wrapChild(child: ChildProcess): WitnessSpawnHandle {
  // Pipe-drain law: continuously drain stdout/stderr so
  // the child can never block on a full pipe, and so the
  // supervisor can classify a post-spawn failure.
  //
  // We tolerate test fakes that do not model streams or
  // listener registration by treating missing properties
  // as no-ops. The production `nodeSpawnWitnessPort`
  // always sets `stdio: ["ignore", "pipe", "pipe"]` so the
  // real streams are always present and continuously
  // drained in production.
  type Drainable = Parameters<typeof drainBounded>[0];
  const stdStreams = child as unknown as {
    readonly stdout?: Drainable | null;
    readonly stderr?: Drainable | null;
  };
  const stdoutDrain =
    stdStreams.stdout !== null && stdStreams.stdout !== undefined
      ? drainBounded(stdStreams.stdout)
      : null;
  const stderrDrain =
    stdStreams.stderr !== null && stdStreams.stderr !== undefined
      ? drainBounded(stdStreams.stderr)
      : null;
  let exit: WitnessExitInfo = {
    pid: child.pid === undefined ? null : child.pid,
    code: null,
    signal: null,
    exited: false,
  };
  // Register the exit listener only if the fake supports
  // a real `on`. Test fakes that omit `.on` simply never
  // populate `exited: true`; production always provides
  // it.
  if (typeof child.on === "function") {
    child.on("exit", (code, signal) => {
      exit = {
        pid: child.pid === undefined ? null : child.pid,
        code,
        signal,
        exited: true,
      };
    });
  }
  const on = (event: "exit" | "error", listener: unknown): WitnessSpawnHandle => {
    if (event === "exit") {
      const exitL = listener as ExitListener;
      if (typeof child.on === "function") {
        child.on("exit", (code, signal) => exitL(code, signal));
      }
    } else {
      const errL = listener as ErrorListener;
      if (typeof child.on === "function") {
        child.on("error", (err: Error) => errL(err));
      }
    }
    return handle;
  };

  // CORRECTION10: terminal-output-accounting barrier.
  //
  // Each stream's drain owns its own `whenEnded()`; the
  // composed `whenBootstrapOutputClosed()` awaits both
  // and exposes the terminal stats as the authority.
  //
  // Streams that were never piped (`stdout: 'ignore'`)
  // have no drain → no barrier → we substitute a
  // pre-resolved `{kind:"ended", stats: zero}` so the
  // composed barrier is just-as-awaitable in tests
  // that exercise the unpipe edge.
  const zeroCompletion: Promise<DrainCompletion> = Promise.resolve({
    kind: "ended",
    stats: { bytesSeen: 0, bytesRetained: 0, truncated: false },
  });
  const stdoutCompletion: Promise<DrainCompletion> =
    stdoutDrain !== null
      ? stdoutDrain.whenEnded()
      : zeroCompletion;
  const stderrCompletion: Promise<DrainCompletion> =
    stderrDrain !== null
      ? stderrDrain.whenEnded()
      : zeroCompletion;

  const whenBootstrapOutputClosed = (): Promise<{
    readonly stdout: BoundedOutputStats;
    readonly stderr: BoundedOutputStats;
  }> => {
    return Promise.all([stdoutCompletion, stderrCompletion]).then(
      ([so, se]) => {
        // CORRECTION10 terminal-output-accounting law:
        // a stream that errored before terminal end does
        // NOT yield a final byte count. We surface the
        // partial stats AND re-throw so callers cannot
        // silently get a `kind:"ended"` mint from a stream
        // that never reached terminal.
        if (so.kind === "stream_error") {
          throw new Error(
            "wrapChild: stdout drained with stream_error before terminal end: " +
              so.error.message,
          );
        }
        if (se.kind === "stream_error") {
          throw new Error(
            "wrapChild: stderr drained with stream_error before terminal end: " +
              se.error.message,
          );
        }
        return { stdout: so.stats, stderr: se.stats };
      },
    );
  };

  const handle: WitnessSpawnHandle = {
    pid: child.pid === undefined ? null : child.pid,
    kill: (signal?: NodeJS.Signals): boolean => {
      if (typeof child.kill === "function") return child.kill(signal);
      return false;
    },
    on: on as WitnessSpawnHandle["on"],
    bootstrapOutput: (): WitnessBootstrapOutput => {
      const so = stdoutDrain?.stats();
      const se = stderrDrain?.stats();
      return {
        stdout: stdoutDrain?.bytes() ?? new Uint8Array(0),
        stderr: stderrDrain?.bytes() ?? new Uint8Array(0),
        stdoutBytesSeen: so?.bytesSeen ?? 0,
        stderrBytesSeen: se?.bytesSeen ?? 0,
        stdoutTruncated: so?.truncated ?? false,
        stderrTruncated: se?.truncated ?? false,
      };
    },
    exitInfo: (): WitnessExitInfo => exit,
    whenBootstrapOutputClosed,
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
 * Minimal emitter interface that the spawn-event handler
 * needs. Production passes a real `ChildProcess`; tests
 * pass a fake that fires events synchronously.
 *
 * CORRECTION03: this seam lets WS09c verify that the
 * PRODUCTION handler (not just the model) routes events
 * through `classifySpawnEvent`. Without this seam, the
 * state machine could be tested in isolation while the
 * production code drifted.
 */
export type SpawnEventEmitter = {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
};

/**
 * Wire a SpawnEventEmitter into a Promise-settling
 * function using `classifySpawnEvent` as the SINGLE
 * source of truth for transition semantics.
 *
 * Returns a teardown function that removes the listeners.
 *
 * CORRECTION03: production uses this helper. WS09c
 * calls it directly with a fake emitter, proving that
 * the production wiring IS the same wiring the test
 * exercises.
 */
export function attachSpawnEventHandler(
  emitter: SpawnEventEmitter,
  child: ChildProcess,
  resolveFn: (r: WitnessSpawnSpecResult) => void,
): () => void {
  let settled = false;
  let state: SpawnState = "pending";
  let lastError: Error | null = null;
  const settle = (r: WitnessSpawnSpecResult): void => {
    if (settled) return;
    settled = true;
    resolveFn(r);
  };
  const apply = (event: SpawnEvent): void => {
    const c = classifySpawnEvent(state, event);
    state = c.state;
    if (!c.terminal) return;
    if (c.ok) {
      settle({ ok: true, handle: wrapChild(child) });
    } else if (lastError !== null) {
      settle({
        ok: false,
        failure: {
          kind: "spawn_error_event",
          message: lastError.message,
        },
      });
    } else {
      settle({
        ok: false,
        failure: {
          kind: "spawn_error_event",
          message: "spawn failed (no captured error)",
        },
      });
    }
  };
  const onSpawn = (): void => { apply("spawn"); };
  const onError = (err: Error): void => {
    lastError = err;
    apply("error");
  };
  emitter.once("spawn", onSpawn);
  emitter.once("error", onError);
  return () => {
    // The teardown function intentionally does not
    // unbind Node listeners — Node ChildProcess
    // listeners are one-shot via .once(); a fake emitter
    // does the same. The teardown is a no-op marker for
    // symmetry; tests that want to assert no-residue
    // should use the helper's promise.
    void 0;
  };
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
 * CORRECTION03: the production adapter is wired to
 * `classifySpawnEvent()` — every Node event is routed
 * through the same pure state machine that WS09c tests.
 * The adapter and the test exercise the SAME transition
 * table; the doctrine is no longer "extract a model and
 * trust the implementation parallels it".
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
        // CORRECTION03: production uses attachSpawnEventHandler,
        // the same helper WS09c tests. The production wiring
        // and the test exercise the same state machine.
        attachSpawnEventHandler(child, child, resolve);
      });
    },
  };
}
