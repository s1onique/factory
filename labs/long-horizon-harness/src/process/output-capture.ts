/**
 * Bounded output capture.
 *
 * Tracks total bytes seen and total bytes retained. Once retained
 * bytes reach the configured limit, further chunks are dropped (but
 * the underlying stream is still drained so the child does not block
 * on a full pipe).
 *
 * Memory bound: at most `limit + (one pending chunk)` per stream.
 * No `string += chunk` concatenation.
 *
 * UTF-8 handling: bytes-only. The supervisor does not decode
 * captured output to UTF-8 anywhere on the hot path; consumers that
 * need text must decode with replacement semantics explicitly.
 */

import type { CapturedOutput } from "./process-types.js";

export type BoundedSinkOptions = {
  readonly stream: NodeJS.ReadableStream | null;
  readonly limitBytes: number;
  readonly streamKind: "stdout" | "stderr";
  readonly onProgress: (bytesSeen: number, truncated: boolean) => void;
  readonly onStdioError: (
    code: string | undefined,
    message: string,
  ) => void;
  readonly onClose: () => void;
};

export type BoundedSink = {
  readonly captured: () => CapturedOutput;
  readonly closed: () => boolean;
};

/**
 * Attach a bounded byte-capture sink to a stream. Returns a sink
 * whose `captured()` reports the current aggregate.
 *
 * If `stream === null` (e.g. child stdio was not piped), the sink
 * is immediately closed with empty bytes.
 */
export function attachBoundedSink(opts: BoundedSinkOptions): BoundedSink {
  let bytesSeen = 0;
  let bytesRetained = 0;
  let truncated = false;
  const chunks: Buffer[] = [];
  let closed = false;

  const flushRetained = (chunk: Buffer): void => {
    const remaining = opts.limitBytes - bytesRetained;
    if (remaining <= 0) {
      return;
    }
    if (chunk.length <= remaining) {
      chunks.push(chunk);
      bytesRetained += chunk.length;
      if (bytesRetained >= opts.limitBytes) {
        truncated = true;
      }
    } else {
      chunks.push(chunk.subarray(0, remaining));
      bytesRetained = opts.limitBytes;
      truncated = true;
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    opts.onClose();
  };

  if (opts.stream === null) {
    close();
  } else {
    opts.stream.on("data", (chunk: Buffer | string) => {
      const buf =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytesSeen += buf.length;
      if (!truncated) {
        flushRetained(buf);
      }
      opts.onProgress(bytesSeen, truncated);
    });
    opts.stream.on("end", () => {
      close();
    });
    opts.stream.on("close", () => {
      close();
    });
    opts.stream.on("error", (e: Error) => {
      const code = (e as unknown as { code?: unknown }).code;
      opts.onStdioError(
        typeof code === "string" ? code : undefined,
        e.message,
      );
      close();
    });
  }

  return {
    captured: () => ({
      bytesSeen,
      bytesRetained,
      truncated,
      buffer: Buffer.concat(chunks, bytesRetained),
    }),
    closed: () => closed,
  };
}
