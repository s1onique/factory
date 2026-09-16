/**
 * _seq05_admission_semaphore_adversarial.test.ts
 *
 * (FOUNDATION04 PHASE A — REBURN-CORRECTION01)
 *
 * Adversarial oracle matrix for the test-side
 * bounded admission semaphore that replaces the
 * reburn-falsified probe-before-call pacing
 * abstraction.
 *
 * Matrix (each oracle asserts a property the
 * semaphore actually has):
 *
 *   ADM01 — bound enforced
 *     limit=3, tasks=20
 *     maxObservedActive === 3
 *     active never > 3
 *     all tasks eventually admitted
 *
 *   ADM02 — FIFO order (controlled holders)
 *
 *   ADM03 — release on success
 *
 *   ADM04 — release on returned error
 *
 *   ADM05 — release on thrown harness fault
 *
 *   ADM06 — identity preservation (commitId /
 *           clientContentHash / event unchanged)
 *
 *   ADM07 — one canonical invocation per logical
 *           call (no retry inside the gate)
 *
 *   ADM08 — no probe dependency (static guard)
 *
 * The matrix is deliberately independent of any
 * real LedgerWriter; it pins the semaphore
 * mechanics with synthetic callbacks. The live
 * qualification burn wires the semaphore into the
 * real appendToLedgerWriter and asserts the same
 * properties through the typed observation stream
 * (writer-concurrent.test.ts SEQ05).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  makeAdmissionSemaphore,
  type AdmissionSemaphore,
  type CanonicalAppendIdentity,
} from "./_seq05_admission_semaphore.js";

// ────────────────────────────────────────────────
// ADM01 — bound enforced.
// ────────────────────────────────────────────────

test("ADM01: bound enforced — limit=3, tasks=20, maxObservedActive===3, all admitted", async () => {
  const sem = makeAdmissionSemaphore(3);
  let maxObserved = 0;
  // Sample `active` on every timer tick to catch
  // any peak that exceeds the limit.
  const sampler = setInterval(() => {
    const a = sem.active();
    if (a > maxObserved) maxObserved = a;
  }, 1);
  let admittedCount = 0;
  const tasks = Array.from({ length: 20 }, (_, i) => i);
  await Promise.all(tasks.map((i) => sem.withPermit(async () => {
    admittedCount += 1;
    const a = sem.active();
    if (a > maxObserved) maxObserved = a;
    assert.ok(a <= 3,
      `ADM01: active=${a} exceeded limit=3 at task ${i}`);
    // Hold for a few ms to encourage overlap among
    // the 20 logical operations.
    await new Promise((r) => setTimeout(r, 5));
  })));
  clearInterval(sampler);
  assert.equal(admittedCount, 20,
    "ADM01: all 20 tasks must be admitted");
  assert.equal(sem.maxObservedActive(), 3,
    `ADM01: maxObservedActive MUST equal limit; got ${sem.maxObservedActive()}`);
  assert.equal(maxObserved, 3,
    `ADM01: external sampler MUST observe max=3; got ${maxObserved}`);
  assert.equal(sem.active(), 0,
    `ADM01: post-burst active MUST be 0; got ${sem.active()}`);
});

// ────────────────────────────────────────────────
// ADM02 — FIFO order (controlled holders).
// ────────────────────────────────────────────────

test("ADM02: FIFO order — admission order equals queue order", async () => {
  const sem = makeAdmissionSemaphore(2);
  // First two permits are held by programmable
  // holders. Each holder's work() callback awaits
  // a deferred promise; we control when each
  // releases.
  const held: Array<{ release(): void }> = [];
  const blockers: Array<Promise<void>> = [];
  for (let i = 0; i < 2; i++) {
    let releaseFn!: () => void;
    const blockerPromise = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    blockers.push(sem.withPermit(() => blockerPromise));
    held.push({ release: releaseFn });
  }
  // Issue 8 waiters; each records its index on
  // admission AND awaits a deferred so the FIFO
  // ordering is observable across releases.
  const deferreds: Array<{ release(): void }> = [];
  const order: number[] = [];
  const waiters = Array.from({ length: 8 }, (_, i) => {
    let releaseFn!: () => void;
    const p = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    deferreds.push({ release: releaseFn });
    return sem.withPermit(async () => {
      order.push(i);
      await p;
    });
  });
  // Allow the queue to form.
  await new Promise((r) => setImmediate(r));
  assert.equal(sem.queued(), 8,
    `ADM02: 8 waiters must be queued; got ${sem.queued()}`);
  // Release holder A. The head waiter (index 0)
  // runs synchronously, records `0`, and then
  // awaits its own deferred (so it holds the
  // permit until we say so). We then release its
  // deferred so the waiter finishes, allowing the
  // next waiter (index 1) to run. Repeat for the
  // full FIFO sequence.
  held[0]!.release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [0],
    `ADM02: after releasing holder 0, only FIFO head (index 0) must have run; got ${JSON.stringify(order)}`);
  deferreds[0]!.release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [0, 1],
    `ADM02: after releasing waiter 0's deferral, FIFO head (index 1) must have run; got ${JSON.stringify(order)}`);
  deferreds[1]!.release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, [0, 1, 2],
    `ADM02: after releasing waiter 1's deferral, FIFO head (index 2) must have run; got ${JSON.stringify(order)}`);
  // Release the remaining waiter deferrals in
  // order; verify FIFO ordering holds for all 8.
  for (let i = 2; i < 8; i++) {
    deferreds[i]!.release();
    await new Promise((r) => setImmediate(r));
  }
  await Promise.all(waiters);
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7],
    `ADM02: FIFO order must equal submission order; got ${JSON.stringify(order)}`);
  // Cleanup: release the blockers (the holders
  // holding limit=2 permits).
  held[1]!.release();
  await Promise.all(blockers);
});

// ────────────────────────────────────────────────
// ADM03 — release on success.
// ────────────────────────────────────────────────

test("ADM03: release on success — canonical callback succeeds, permit returned", async () => {
  const sem = makeAdmissionSemaphore(1);
  let active = 0;
  let maxActive = 0;
  const r1 = await sem.withPermit(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1;
    return 42;
  });
  assert.equal(r1, 42,
    `ADM03: work() return value MUST be propagated; got ${r1}`);
  assert.equal(sem.active(), 0,
    `ADM03: permit MUST be released on success; active=${sem.active()}`);
  assert.equal(maxActive, 1,
    `ADM03: only one concurrent permit at a time; maxActive=${maxActive}`);
});

// ────────────────────────────────────────────────
// ADM04 — release on returned error.
// ────────────────────────────────────────────────

test("ADM04: release on returned error — typed failure, permit returned", async () => {
  const sem = makeAdmissionSemaphore(1);
  type WorkResult = { ok: true; v: number } | { ok: false; error: { kind: "writer_busy" } };
  const r1: WorkResult = await sem.withPermit(async () => {
    return { ok: false, error: { kind: "writer_busy" as const } };
  });
  assert.equal(r1.ok, false,
    "ADM04: returned failure MUST be propagated");
  assert.equal(sem.active(), 0,
    `ADM04: permit MUST be released on returned failure; active=${sem.active()}`);
  const r2 = await sem.withPermit(async () => {
    return { ok: true, v: 1 } as const;
  });
  assert.equal(r2.ok, true,
    "ADM04: subsequent admission MUST succeed after returned failure");
});

// ────────────────────────────────────────────────
// ADM05 — release on thrown harness fault.
// ────────────────────────────────────────────────

test("ADM05: release on thrown harness fault — permit returned, later tasks proceed", async () => {
  const sem = makeAdmissionSemaphore(1);
  await assert.rejects(
    () => sem.withPermit(async () => {
      throw new Error("synthetic harness fault");
    }),
    /synthetic harness fault/,
    "ADM05: thrown fault MUST propagate",
  );
  assert.equal(sem.active(), 0,
    `ADM05: permit MUST be released on thrown fault; active=${sem.active()}`);
  let laterRan = false;
  await sem.withPermit(async () => {
    laterRan = true;
  });
  assert.equal(laterRan, true,
    "ADM05: later task MUST proceed after thrown fault");
});

// ────────────────────────────────────────────────
// ADM06 — identity preservation.
// ────────────────────────────────────────────────

test("ADM06: identity preservation — commitId / clientContentHash / event unchanged", async () => {
  const sem = makeAdmissionSemaphore(4);
  const seen: CanonicalAppendIdentity[] = [];
  const inputs: CanonicalAppendIdentity[] = Array.from({ length: 50 }, (_, i) => ({
    commitId: `adm06-${i}`,
    clientContentHash: `hash-${i}-${"x".repeat(64)}`,
    event: {
      kind: "lifecycle",
      eventId: `evt-${i}`,
      observedAt: 1_700_000_000_000 + i,
      payload: { i, nested: { a: i, b: "y".repeat(10) } },
    },
  }));
  await Promise.all(inputs.map((id) => sem.withPermit(async () => {
    seen.push({
      commitId: id.commitId,
      clientContentHash: id.clientContentHash,
      event: JSON.parse(JSON.stringify(id.event)),
    });
    await new Promise((r) => setTimeout(r, 1));
  })));
  assert.equal(seen.length, inputs.length,
    `ADM06: all ${inputs.length} identities must round-trip`);
  for (let i = 0; i < inputs.length; i++) {
    const want = inputs[i]!;
    const got = seen[i]!;
    assert.equal(got.commitId, want.commitId,
      `ADM06[${i}]: commitId MUST be preserved verbatim`);
    assert.equal(got.clientContentHash, want.clientContentHash,
      `ADM06[${i}]: clientContentHash MUST be preserved verbatim`);
    assert.deepEqual(got.event, want.event,
      `ADM06[${i}]: event MUST be preserved verbatim`);
  }
});

// ────────────────────────────────────────────────
// ADM07 — one canonical invocation per logical call.
// ────────────────────────────────────────────────

test("ADM07: one canonical invocation per logical call — no retry inside the gate", async () => {
  const sem = makeAdmissionSemaphore(2);
  const callCounts = new Map<number, number>();
  const tasks = Array.from({ length: 30 }, (_, i) => sem.withPermit(async () => {
    callCounts.set(i, (callCounts.get(i) ?? 0) + 1);
    // Slow work — encourages the burst to queue.
    await new Promise((r) => setTimeout(r, 2));
    return i;
  }));
  const results = await Promise.all(tasks);
  assert.equal(results.length, 30,
    "ADM07: 30 logical calls must each resolve");
  for (const [i, n] of callCounts.entries()) {
    assert.equal(n, 1,
      `ADM07: logical call ${i} MUST invoke work() exactly once; got ${n}`);
  }
});

// ────────────────────────────────────────────────
// ADM08 — no probe dependency (static guard).
// ────────────────────────────────────────────────

test("ADM08: no probe dependency — SEQ05 correctness path does not call probe-pacing helpers", async () => {
  // Static guard. SEQ05's correctness path lives
  // in writer-concurrent.test.ts. We assert that
  // SEQ05 does NOT reference the reburn-falsified
  // probe-pacing adapter.
  const src = await fs.readFile(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "writer-concurrent.test.ts",
    ),
    "utf8",
  );
  // Locate the SEQ05 test body.
  const marker = `live("SEQ05 1000 concurrent appends`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1,
    "ADM08: SEQ05 test body must be present in writer-concurrent.test.ts");
  // Walk braces from `=> {` past the marker.
  const afterMarker = src.slice(start);
  const arrowAt = afterMarker.indexOf("=>");
  assert.notEqual(arrowAt, -1,
    "ADM08: SEQ05 body must open with `=> {`");
  const braceAt = afterMarker.indexOf("{", arrowAt);
  assert.notEqual(braceAt, -1,
    "ADM08: SEQ05 body must open with `{`");
  const bodyStart = start + braceAt;
  let depth = 0;
  let bodyEnd = -1;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { bodyEnd = i + 1; break; }
    }
  }
  assert.notEqual(bodyEnd, -1,
    "ADM08: SEQ05 body must close");
  const body = src.slice(bodyStart, bodyEnd);
  // The probe-pacing helper MUST NOT appear in
  // the SEQ05 body. The historical AP module
  // `_seq05_admission_pacing.ts` remains as an
  // experimental diagnostic, but SEQ05 PASS/FAIL
  // MUST NOT depend on it (Law B).
  assert.doesNotMatch(body,
    /appendToLedgerWriterWithAdmissionPacing/,
    "ADM08: SEQ05 MUST NOT call appendToLedgerWriterWithAdmissionPacing");
  // The SEQ05 body MUST drive the canonical
  // appendToLedgerWriter through the bounded
  // admission semaphore.
  assert.match(body,
    /makeAdmissionSemaphore\b/,
    "ADM08: SEQ05 MUST bound canonical calls with makeAdmissionSemaphore");
  // And the body MUST declare an
  // admission-limit output line per the reburn
  // acceptance contract (§8).
  assert.match(body,
    /SEQ05_ADMISSION_LIMIT/,
    "ADM08: SEQ05 MUST emit SEQ05_ADMISSION_LIMIT line");
  assert.match(body,
    /SEQ05_MAX_OBSERVED_ACTIVE/,
    "ADM08: SEQ05 MUST emit SEQ05_MAX_OBSERVED_ACTIVE line");
  // Use the typed import to keep `tsc` happy.
  const _sem: AdmissionSemaphore | null = null;
  void _sem;
});
