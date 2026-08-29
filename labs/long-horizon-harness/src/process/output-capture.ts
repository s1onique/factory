/**
 * Bounded output capture.
 *
 * Truncation invariant:
 *   truncated = bytesSeen > bytesRetained
 *
 * Pipes are ALWAYS drained; once the retention cap is reached,
 * additional bytes are discarded but counted toward bytesSeen.
 *
 * Memory bound: at most `limitBytes + (one pending chunk)` per
 * stream.
 *
 * Stream errors are recorded. `onStdioError` is called once per
 * error; the sink is then closed so subsequent data is not
 * captured (the pipe still drains to the child). The error is
 * carried in the resulting close event for the supervisor to
 * classify.
 */

import type { CapturedOutput, ProcessFailure } from "./process-types.js";

export type StreamKind = "stdout" | "stderr";

export type BoundedSinkOptions = {
  readonly stream: NodeJS.ReadableStream | null;
  readonly limitBytes: number;
  readonly streamKind: StreamKind;
  readonly processId: string;
  readonly onProgress: (
    bytesSeen: number,
    bytesRetained: number,
    truncated: boolean,
  ) => void;
  readonly onStdioError: (
    code: string | undefined,
    message: string,
  ) => void;
  readonly onClosed: (stdioFailure: ProcessFailure | null) => void;
};

export type BoundedSink = {
  readonly captured: () => CapturedOutput;
  readonly closed: () => boolean;
  readonly stdioFailure: () => ProcessFailure | null;
};

export function attachBoundedSink(opts: BoundedSinkOptions): BoundedSink {
  let bytesSeen = 0;
  let bytesRetained = 0;
  const chunks: Buffer[] = [];
  let closed = false;
  let firstFailure: ProcessFailure | null = null;

  const flushRetained = (chunk: Buffer): void => {
    const remaining = opts.limitBytes - bytesRetained;
    if (remaining <= 0) {
      return; // already at cap; bytes still counted in bytesSeen
    }
    if (chunk.length <= remaining) {
      chunks.push(chunk);
      bytesRetained += chunk.length;
    } else {
      chunks.push(chunk.subarray(0, remaining));
      bytesRetained = opts.limitBytes;
    }
  };

  const closeOnce = (failure: ProcessFailure | null): void => {
    if (closed) return;
    closed = true;
    opts.onClosed(failure);
  };

  if (opts.stream === null) {
    closeOnce(null);
  } else {
    opts.stream.on("data", (chunk: Buffer | string) => {
      const buf =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytesSeen += buf.length;
      flushRetained(buf);
      opts.onProgress(bytesSeen, bytesRetained, bytesSeen > bytesRetained);
    });
    opts.stream.on("end", () => {
      closeOnce(null);
    });
    opts.stream.on("close", () => {
      closeOnce(null);
    });
    opts.stream.on("error", (e: Error) => {
      const code = (e as unknown as { code?: unknown }).code;
      const message = e.message;
      if (firstFailure === null) {
        const stdioFailure: ProcessFailure = {
          kind: "stdio_failure",
          stream: opts.streamKind,
          message,
          ...(typeof code === "string" ? { code } : {}),
        };
        firstFailure = stdioFailure;
        opts.onStdioError(
          typeof code === "string" ? code : undefined,
          message,
        );
      }
      closeOnce(firstFailure);
    });
  }

  return {
    captured: () => ({
      bytesSeen,
      bytesRetained,
      // truncation is evaluated against the final counts
      truncated: bytesSeen > bytesRetained,
      buffer: Buffer.concat(chunks, bytesRetained),
    }),
    closed: () => closed,
    stdioFailure: () => firstFailure,
  };
}
