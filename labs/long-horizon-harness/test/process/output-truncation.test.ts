/**
 * output-truncation.test.ts
 *
 * Truncation invariant:
 *   truncated === (bytesSeen > bytesRetained)
 *
 * Required cases:
 *   O01 below limit
 *   O02 exactly limit
 *   O03 one byte above
 *   O04 zero limit / zero output
 *   O05 zero limit / nonzero output
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { attachBoundedSink } from "../../src/process/output-capture.js";

function makeSink(
  limitBytes: number,
  streamKind: "stdout" | "stderr",
): {
  sink: ReturnType<typeof attachBoundedSink>;
  push: (b: Buffer) => void;
  end: () => Promise<void>;
} {
  const stream = new Readable({ read() {} });
  let closed = false;
  const sink = attachBoundedSink({
    stream,
    limitBytes,
    streamKind,
    processId: "test",
    onProgress: () => {},
    onStdioError: () => {},
    onClosed: () => {
      closed = true;
    },
  });
  return {
    sink,
    push: (b) => stream.push(b),
    end: () =>
      new Promise<void>((resolve) => {
        if (!closed) stream.push(null);
        // Wait for the sink's onClosed callback to fire.
        const tick = (): void => {
          if (closed) resolve();
          else setImmediate(tick);
        };
        tick();
      }),
  };
}

test("O01 below limit", async () => {
  const { sink, push, end } = makeSink(1024, "stdout");
  push(Buffer.from("hello"));
  await end();
  const c = sink.captured();
  assert.equal(c.bytesSeen, 5);
  assert.equal(c.bytesRetained, 5);
  assert.equal(c.truncated, false);
});

test("O02 exactly limit", async () => {
  const { sink, push, end } = makeSink(5, "stdout");
  push(Buffer.from("hello"));
  await end();
  const c = sink.captured();
  assert.equal(c.bytesSeen, 5);
  assert.equal(c.bytesRetained, 5);
  assert.equal(c.truncated, false);
});

test("O03 one byte above", async () => {
  const { sink, push, end } = makeSink(5, "stdout");
  push(Buffer.from("hello!"));
  await end();
  const c = sink.captured();
  assert.equal(c.bytesSeen, 6);
  assert.equal(c.bytesRetained, 5);
  assert.equal(c.truncated, true);
});

test("O04 zero limit / zero output", async () => {
  const { sink, end } = makeSink(0, "stdout");
  await end();
  const c = sink.captured();
  assert.equal(c.bytesSeen, 0);
  assert.equal(c.bytesRetained, 0);
  assert.equal(c.truncated, false);
});

test("O05 zero limit / nonzero output", async () => {
  const { sink, push, end } = makeSink(0, "stdout");
  push(Buffer.from("x"));
  await end();
  const c = sink.captured();
  assert.equal(c.bytesSeen, 1);
  assert.equal(c.bytesRetained, 0);
  assert.equal(c.truncated, true);
});

test("O06 multi-chunk: chunked flood respects bytesSeen/bytesRetained", async () => {
  const { sink, push, end } = makeSink(1024, "stdout");
  push(Buffer.from("a".repeat(512)));
  push(Buffer.from("b".repeat(512)));
  push(Buffer.from("c".repeat(512)));
  await end();
  const c = sink.captured();
  assert.equal(c.bytesSeen, 1536);
  assert.equal(c.bytesRetained, 1024);
  assert.equal(c.truncated, true);
  assert.equal(c.buffer.length, 1024);
  assert.equal(c.buffer.subarray(0, 512).toString(), "a".repeat(512));
  assert.equal(c.buffer.subarray(512, 1024).toString(), "b".repeat(512));
});
