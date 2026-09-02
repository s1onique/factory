/**
 * FOUNDATION04 — bootstrap-output bounded buffer.
 *
 * Doctrine (pipe-drain law):
 *   If a long-lived child is spawned with piped
 *   stdout/stderr, the owner MUST continuously drain
 *   those pipes even after the retained evidence cap is
 *   reached. The kernel will discard unread pipe data
 *   when the child exits; we therefore track
 *   `bytesSeen` separately from `bytesRetained` and
 *   publish a truthful `truncated` bit.
 *
 * Doctrine (terminal-output-accounting law — CORRECTION10):
 *   Exact byte-accounting is authoritative ONLY after the
 *   drain owning the stream has observed its terminal
 *   lifecycle boundary. Per Node's documented contract, a
 *   ChildProcess `'exit'` fires after the process has
 *   ended but BEFORE its stdio streams have closed; the
 *   underlying Readable's `'end'` (or `'error'` / later
 *   `'close'`) is the only event that proves the producer
 *   has stopped and the kernel has delivered everything
 *   it will ever deliver. The owner MUST NOT take any
 *   exact-equality measurement of `bytesSeen` until that
 *   boundary has been observed by the drain that owns the
 *   stream. A wall-clock fence (e.g. `setTimeout(N)`)
 *   after `'exit'` is not a substitute.
 *
 * This is a tiny primitive. It deliberately does not
 * buffer to a string: it retains raw bytes up to the
 * cap and never grows past it. Callers can decode to
 * UTF-8 lazily if and when they need to.
 */
import type { Readable } from "node:stream";

export type BoundedOutputStats = {
  readonly bytesRetained: number;
  readonly bytesSeen: number;
  readonly truncated: boolean;
};

/**
 * Terminal settlement of a `drainBounded` lifetime.
 *
 *   - `ended`        — the underlying Readable emitted
 *      `'end'` (push-mode) or `'close'` (pull-mode / late
 *      close). The producer has stopped, the kernel has
 *      delivered everything, and `stats` are final.
 *   - `stream_error` — the underlying Readable emitted
 *      `'error'` before terminal `end`/`close`. The
 *      drain consumed what arrived before the error; the
 *      stats are partial and the caller MUST treat them
 *      as such (it does not claim `bytesSeen` is the
 *      terminal count of all data the producer ever
 *      intended to send).
 */
export type DrainCompletion =
  | { readonly kind: "ended"; readonly stats: BoundedOutputStats }
  | { readonly kind: "stream_error"; readonly error: Error };

export interface BoundedDrain {
  /**
   * Snapshot of the drain's current accounting. Becomes
   * authoritative ONLY after `whenEnded()` resolves
   * with `{kind: "ended", stats}`. Callers reading this
   * before then are observing a partial count and MUST
   * not rely on it as a terminal measurement.
   */
  readonly stats: () => BoundedOutputStats;
  /**
   * Retained evidence (clipped to the cap). Raw bytes.
   */
  readonly bytes: () => Uint8Array;
  /**
   * Terminal observation barrier.
   *
   * Resolves once with a `DrainCompletion` exactly when
   * the underlying Readable reaches its terminal
   * lifecycle boundary (`'end'` or `'close'`, whichever
   * implementation chooses) OR fails with `'error'`
   * before reaching terminal.
   *
   * Settles ONCE. Repeated calls return the same value
   * (the underlying Promise is cached). Never throws a
   * wall-clock deadline; a stream that never closes is
   * the drain's problem, observable as an unresolved
   * promise, not as a fabricated success.
   */
  readonly whenEnded: () => Promise<DrainCompletion>;
}

const DEFAULT_CAP_BYTES = 64 * 1024;

/**
 * Continuously drain a single Readable stream into a
 * bounded buffer.
 *
 *   capBytes — the largest number of bytes the buffer
 *   will retain. Past that, bytes are counted in
 *   `bytesSeen` and the `truncated` bit is set; we
 *   still consume them so the child cannot block.
 *
 * Listeners are attached eagerly, in this order:
 *
 *   1. `'data'`     — byte accounting (drain keeps child
 *      from blocking on a full kernel pipe).
 *   2. `'end'`      — terminal settlement (push-mode).
 *   3. `'error'`    — terminal settlement.
 *   4. `'close'`    — terminal settlement (pull-mode /
 *      late close without prior `'end'`).
 *
 * Only the FIRST of `'end'` / `'close'` / `'error'`
 * settles the completion; subsequent events are ignored
 * because their statistics already include all bytes the
 * kernel ever delivered on this stream. The Promise is
 * cached; `whenEnded()` is idempotent.
 */
export function drainBounded(
  stream: Readable,
  capBytes: number = DEFAULT_CAP_BYTES,
): BoundedDrain {
  const chunks: Buffer[] = [];
  let bytesRetained = 0;
  let bytesSeen = 0;
  let truncated = false;
  let total = 0;

  // Terminal settlement state machine (CORRECTION10):
  // settles once, idempotent for all subsequent events.
  let settled = false;
  let resolveCompletion:
    | ((c: DrainCompletion) => void)
    | null = null;
  const completionPromise = new Promise<DrainCompletion>((resolve) => {
    resolveCompletion = resolve;
  });

  const snapshot = (): BoundedOutputStats => ({
    bytesRetained,
    bytesSeen,
    truncated,
  });

  const settle = (c: DrainCompletion): void => {
    if (settled) return;
    settled = true;
    const fn = resolveCompletion;
    resolveCompletion = null;
    if (fn !== null) fn(c);
  };

  // 1. Data accounting.
  stream.on("data", (chunk: Buffer | string) => {
    const c = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    bytesSeen += c.length;
    if (!truncated) {
      const room = capBytes - bytesRetained;
      if (c.length <= room) {
        chunks.push(c);
        bytesRetained += c.length;
        total += c.length;
      } else if (room > 0) {
        chunks.push(c.subarray(0, room));
        bytesRetained += room;
        total += room;
        truncated = true;
      } else {
        truncated = true;
      }
    }
  });

  // 2. Terminal end (push-mode streams): settle.
  stream.on("end", () => {
    settle({ kind: "ended", stats: snapshot() });
  });

  // 3. Stream error: settle as terminal with error.
  stream.on("error", (err: Error) => {
    settle({ kind: "stream_error", error: err });
  });

  // 4. Late / no-end close: also terminal.
  stream.on("close", () => {
    settle({ kind: "ended", stats: snapshot() });
  });

  return {
    stats: snapshot,
    bytes: (): Uint8Array => {
      if (total === 0) return new Uint8Array(0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        c.copy(out, off);
        off += c.length;
      }
      return out;
    },
    whenEnded: (): Promise<DrainCompletion> => completionPromise,
  };
}
