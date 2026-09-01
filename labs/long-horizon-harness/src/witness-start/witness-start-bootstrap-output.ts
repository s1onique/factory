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

const DEFAULT_CAP_BYTES = 64 * 1024;

/**
 * Continuously drain a single Readable stream into a
 * bounded buffer.
 *
 *   capBytes — the largest number of bytes the buffer
 *   will retain. Past that, bytes are counted in
 *   `bytesSeen` and the `truncated` bit is set; we
 *   still consume them so the child cannot block.
 */
export function drainBounded(
  stream: Readable,
  capBytes: number = DEFAULT_CAP_BYTES,
): {
  readonly stats: () => BoundedOutputStats;
  readonly bytes: () => Uint8Array;
} {
  const chunks: Buffer[] = [];
  let bytesRetained = 0;
  let bytesSeen = 0;
  let truncated = false;
  let total = 0;
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
  return {
    stats: (): BoundedOutputStats => ({
      bytesRetained,
      bytesSeen,
      truncated,
    }),
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
  };
}
