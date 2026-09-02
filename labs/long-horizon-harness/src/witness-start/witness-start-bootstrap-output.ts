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
 *   underlying Readable's `'end'` (push-mode completion)
 *   is the only event that proves the producer has
 *   stopped and the kernel has delivered everything it
 *   will ever deliver. The owner MUST NOT take any
 *   exact-equality measurement of `bytesSeen` until that
 *   boundary has been observed by the drain that owns the
 *   stream. A wall-clock fence (e.g. `setTimeout(N)`)
 *   after `'exit'` is not a substitute.
 *
 * Doctrine (end-vs-close algebra — CORRECTION11):
 *   CORRECTION10 settled the completion on the FIRST of
 *   `'end'` / `'close'` / `'error'` and treated `'close'`
 *   as a synonym for clean completion. Node's documented
 *   contract is sharper: `'end'` means no more data will
 *   arrive; `'close'` means the resource was released. A
 *   Readable that emits `'close'` without first emitting
 *   `'end'` has closed **prematurely** — bytes that the
 *   producer intended to send are lost or undelivered.
 *   `stream.finished()` makes this distinction explicit
 *   by rejecting its returned promise with
 *   `ERR_STREAM_PREMATURE_CLOSE` (a synthesized Node
 *   error with code "ERR_STREAM_PREMATURE_CLOSE" and
 *   message "Premature close") whenever `'close'` lands
 *   before `'end'`. CORRECTION11 routes
 *   `drainBounded`'s terminal observation through
 *   `finished()` (with `{ cleanup: true }`) instead of
 *   hand-rolling a close-equivalent; only `'end'` (clean
 *   completion) can mint `kind: "ended"`. `'close'`
 *   before `'end'` mints `kind: "premature_close"` with
 *   the synthesized Node error attached.
 *
 * This is a tiny primitive. It deliberately does not
 * buffer to a string: it retains raw bytes up to the
 * cap and never grows past it. Callers can decode to
 * UTF-8 lazily if and when they need to.
 */
import { finished } from "node:stream/promises";
import type { Readable } from "node:stream";

export type BoundedOutputStats = {
  readonly bytesRetained: number;
  readonly bytesSeen: number;
  readonly truncated: boolean;
};

/**
 * Terminal settlement of a `drainBounded` lifetime.
 *
 *   - `ended`           — the underlying Readable reached
 *      `'end'` (push-mode clean completion). The producer
 *      has stopped, the kernel has delivered everything,
 *      and `stats` are final.
 *   - `stream_error`    — the underlying Readable emitted
 *      `'error'` before terminal `'end'`. The drain
 *      consumed what arrived before the error; the stats
 *      are partial and the caller MUST treat them as such
 *      (it does not claim `bytesSeen` is the terminal
 *      count of all data the producer ever intended to
 *      send).
 *   - `premature_close` — the underlying Readable emitted
 *      `'close'` without first emitting `'end'`. This is
 *      the documented Node "Premature close" condition
 *      (`ERR_STREAM_PREMATURE_CLOSE`); some bytes the
 *      producer intended to send were lost or never
 *      delivered. The attached `error` is the synthesized
 *      Node error. Stats are partial and the caller MUST
 *      treat them as such. **A `premature_close` MUST
 *      NEVER be coerced into `ended`** — that would
 *      authorize an exact-equality byte total against a
 *      stream that never reached terminal.
 */
export type DrainCompletion =
  | { readonly kind: "ended"; readonly stats: BoundedOutputStats }
  | { readonly kind: "stream_error"; readonly error: Error }
  | { readonly kind: "premature_close"; readonly error: Error };

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
   * lifecycle boundary:
   *
   *   - `'end'` clean completion  → `kind: "ended"`
   *   - `'error'` before `'end'`  → `kind: "stream_error"`
   *   - `'close'` before `'end'`  → `kind: "premature_close"`
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
 * Listener ownership (CORRECTION11):
 *
 *   1. `'data'`                  — byte accounting (drain
 *      keeps the producer from blocking on a full kernel
 *      pipe). This is the only listener we author by
 *      hand; the data path is a pure accounting concern
 *      and `finished()` does not handle it.
 *   2. `finished(stream, { cleanup: true })` — Node's
 *      canonical terminal-state machine. It awaits
 *      `'end'` (clean completion) and rejects on `'error'`
 *      OR on `'close'`-before-`'end'` (the documented
 *      "Premature close" condition, code
 *      `ERR_STREAM_PREMATURE_CLOSE`). We translate each
 *      outcome into a typed `DrainCompletion`. Only
 *      `'end'` can mint `kind: "ended"`; close-before-end
 *      is NEVER coerced into `ended`.
 *
 * The Promise is cached; `whenEnded()` is idempotent.
 * `finished()` with `cleanup: true` registers its own
 * listeners and removes them once the terminal boundary
 * is observed, so it does not leak.
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

  // Terminal settlement state machine (CORRECTION11):
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

  // 1. Data accounting — the only hand-rolled listener.
  //    `finished()` does not own this concern; we
  //    continuously drain so the producer cannot block on
  //    a full kernel pipe regardless of how the stream
  //    eventually terminates.
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

  // 2. Terminal observation via Node's canonical
  //    `finished()`. The algebra is:
  //
  //      `end`           → resolve (clean)
  //      `error`         → reject (stream_error)
  //      `close`-no-end  → reject (premature_close)
  //
  //    We translate each outcome into a typed
  //    `DrainCompletion`. Only `end` can mint
  //    `kind: "ended"`; close-before-end is NEVER coerced
  //    into ended. `finished()` with `{ cleanup: true }`
  //    removes its own listeners once the terminal
  //    boundary is observed, so no leak.
  void finished(stream, { cleanup: true }).then(
    () => {
      settle({ kind: "ended", stats: snapshot() });
    },
    (err: unknown) => {
      const e = err instanceof Error
        ? err
        : new Error(
            "drainBounded: finished() rejected with non-Error: " +
              String(err),
          );
      // Node's ERR_STREAM_PREMATURE_CLOSE has code
      // "ERR_STREAM_PREMATURE_CLOSE". Distinguish it from
      // any other rejection cause (typically 'error' from
      // the underlying source) so the caller can branch on
      // the typed outcome without string-matching.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ERR_STREAM_PREMATURE_CLOSE") {
        settle({ kind: "premature_close", error: e });
      } else {
        settle({ kind: "stream_error", error: e });
      }
    },
  );

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
