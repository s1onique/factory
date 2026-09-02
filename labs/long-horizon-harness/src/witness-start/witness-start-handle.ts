/**
 * FOUNDATION04 — PHASE A — Witness spawn-handle types.
 *
 * Extracted from `witness-start-types.ts` in MICROFIX
 * (source-discipline closure) to keep that file under the
 * 400-LOC discipline. The handle is the post-spawn
 * abstraction: the boundary between "the OS has a child
 * running" and "the caller observes what the kernel
 * delivered." It is intentionally narrow — tests can
 * substitute a fake without exposing raw mutable Node
 * streams.
 *
 * Doctrine (bootstrap-observability law):
 *   A spawned process that dies before readiness MUST leave
 *   bounded diagnostic evidence sufficient to classify the
 *   bootstrap failure; an exit code alone is not a
 *   diagnosis.
 *
 * Doctrine (terminal-output-accounting law — CORRECTION10):
 *   Exact byte-accounting on the handle's stdio is
 *   authoritative ONLY after `whenBootstrapOutputClosed()`
 *   resolves. Before that barrier, `bootstrapOutput()`
 *   returns PARTIAL values (the kernel may still have bytes
 *   buffered in the pipe that `'exit'` does not imply have
 *   been delivered).
 *
 * Doctrine (end-vs-close algebra — CORRECTION11):
 *   `'end'` is the ONLY event that authorizes a clean
 *   terminal observation. A Readable that emits `'close'`
 *   without first emitting `'end'` is documented by Node as
 *   a "Premature close" condition
 *   (`ERR_STREAM_PREMATURE_CLOSE`); the composed barrier
 *   `whenBootstrapOutputClosed()` rejects in that case and
 *   the byte total returned is partial.
 *
 * This module is pure types — no I/O, no Node-specific
 * imports. The `NodeJS.Signals` reference is a domain-level
 * type alias for an OS-kernel signal name (one of a small
 * fixed set of strings); it does not require any node:
 * import at runtime.
 */

/**
 * Bounded child stdio evidence (pipe-drain law).
 * Continuously drained; `truncated` is truthful; raw
 * bytes are retained up to a host-defined cap.
 */
export type WitnessBootstrapOutput = {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly stdoutBytesSeen: number;
  readonly stderrBytesSeen: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
};

/**
 * Captured final child completion record. Filled in once
 * the child has actually exited. `null` until then.
 *
 * Doctrine (bootstrap-observability law):
 *   A spawned process that dies before readiness MUST
 *   leave bounded diagnostic evidence sufficient to
 *   classify the bootstrap failure; an exit code alone
 *   is not a diagnosis.
 */
export type WitnessExitInfo = {
  readonly pid: number | null;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly exited: boolean;
};

/**
 * WitnessSpawnHandle abstracts over a spawned child. Tests
 * substitute a fake; production wraps node:child_process
 * ChildProcess.
 *
 * The handle is intentionally narrow. It does NOT expose
 * raw mutable Node streams (that would let tests hide
 * pipe-pressure bugs). The diagnostic surface is the
 * read-only `bootstrapOutput()` and `exitInfo()` methods
 * plus the terminal-output barrier
 * `whenBootstrapOutputClosed()` (CORRECTION10).
 */
export type WitnessSpawnHandle = {
  readonly pid: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  /**
   * Bounded, drain-continuous child stdio evidence.
   * Always non-null; safe to call after the child has
   * exited (the bounded buffer has already absorbed
   * whatever the kernel delivered), but the values
   * returned are FINAL ONLY when the
   * `whenBootstrapOutputClosed()` barrier has resolved.
   */
  bootstrapOutput(): WitnessBootstrapOutput;
  /**
   * Final child completion record. `exited: false` while
   * the child is still running; `exited: true` once.
   */
  exitInfo(): WitnessExitInfo;
  /**
   * Terminal-output-accounting barrier (CORRECTION10).
   *
   * Resolves when both stdout and stderr bounded drains
   * have observed their terminal lifecycle boundary
   * (clean `'end'` on the underlying Readable), yielding
   * the FINAL stats for each stream. The returned
   * `bytesSeen` / `truncated` are authoritative after this
   * resolves; before this resolves, `bootstrapOutput()`
   * returns partial values.
   *
   * Rejects if either stream errors before terminal end OR
   * if either stream closes before `'end'` (Node
   * `ERR_STREAM_PREMATURE_CLOSE`; CORRECTION11). Never
   * fabricates a deadline-resolved success.
   */
  whenBootstrapOutputClosed(): Promise<{
    readonly stdout: import("./witness-start-bootstrap-output.js").BoundedOutputStats;
    readonly stderr: import("./witness-start-bootstrap-output.js").BoundedOutputStats;
  }>;
};
