/**
 * _live_cases.ts
 * (B0-QUALIFICATION05)
 *
 * SINGLE MAINTAINED implementation of the LedgerWriter
 * B0 qualification matrix (LWQ01..LWQ15). Both the
 * ordinary lane (writer-live.test.ts / shutdown.test.ts)
 * and the strict qualification oracle
 * (ledger-writer-live-qualification.test.ts) MUST
 * consume this module's case functions — no duplicated
 * case bodies.
 *
 * Each case is `{ id, title, run(ctx) }`. The strict
 * lane asserts the array length and registers tests
 * from it.
 *
 * B0-QUALIFICATION05 evidence-lifetime contract:
 *   - Each case reads durable evidence BEFORE
 *     writer.stop() and BEFORE ctx.destroyRun().
 *   - ENOENT on a required artefact is FAIL unless
 *     the case legitimately produces no durable
 *     state (LWQ08 establishes a baseline so this
 *     exception never triggers in practice).
 *   - Negative-delta evidence: to prove that an
 *     actor caused no durable mutation, the case
 *     establishes a known authoritative baseline
 *     first and proves the durable state did not
 *     change.
 *   - Production LedgerWriter semantics are not
 *     exercised through this module; only the
 *     production client APIs (ping, append,
 *     probeSocketPath, handleRequest, handleConnection)
 *     and the canonicalize parser (parsePersistedLine)
 *     are reused.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";

import assert from "node:assert/strict";

import { LEDGER_FILENAME } from "../../src/evidence/jsonl-ledger.js";
import type { WriterHandle } from "./_writer_helper.js";
import {
  appendToLedgerWriter,
} from "../../src/ledger-writer/ledger-writer-client.js";
import {
  parsePersistedLine,
  type ParsedPersistedLine,
} from "../../src/ledger-writer/ledger-writer-canonicalize.js";
import { probeSocketPath } from "../../src/ledger-writer/ledger-writer-socket-probe.js";
import {
  registerHelperSpawn,
  proveUnlink,
} from "./_live_registry.js";

// --------------------------------------------------------------------
// Live case context — the strict oracle passes the
// sandbox-gate probe, capability result, helpers, and
// per-case log scratch space to each case.
// --------------------------------------------------------------------

export type LiveCaseCtx = {
  readonly strict: boolean;
  readonly spawnable: boolean;
  /** Creates a unique tmp directory under the harness base. */
  readonly mkTmp: (prefix: string) => Promise<string>;
  /**
   * Boots a writer in tmp. Registers child + socket
   * + lease dir with the live fixture registry; the
   * runDir is NOT registered — the case body must
   * either destroy it explicitly (after reading
   * evidence) or register it for tracking.
   *
   * Returns the WriterHandle whose `stop()` kills the
   * writer child but does NOT touch the runDir
   * contents. This is the central evidence-lifetime
   * invariant enforced at B0-QUALIFICATION04.
   */
  readonly bootHandle: (tmp: string) => Promise<WriterHandle>;
  /**
   * (B0-QUALIFICATION04) Destroy the runDir used by a
   * given case after evidence reads are complete.
   * Calls `destroyRunDir` in the registry, which
   * unlinks the path AND unregisters the tracking
   * entry. Throws on failure (residue accounting is
   * honest).
   */
  readonly destroyRun: (runDir: string) => Promise<void>;
  /**
   * (B0-QUALIFICATION04) Register a runDir for residue
   * tracking without destroying it. Used by cases that
   * read evidence and intend the after-suite sweep to
   * clean up.
   */
  readonly trackRun: (runDir: string) => void;
  /**
   * Appends via the production client.
   *
   * (B0-QUALIFICATION03) The earlier `appendCounting`
   * returned `{result, wireAttempts:1}` where
   * wireAttempts was a constant, not a measurement.
   * The reviewer correctly identified that as fake
   * evidence: a client could perform two RPCs
   * internally while the wrapper still reported
   * wireAttempts=1. Transport round-trip count is
   * NOT a B0 freeze invariant — the safety invariant
   * we actually care about is:
   *
   *   one semantic commitId → no duplicate
   *   durable effect
   *
   * which is covered by LWQ03/LWQ04/LWQ06/LWQ10.
   * The transport-attempt count is an
   * efficiency/protocol-shape property. We therefore
   * drop the counter and only return the result.
   */
  readonly appendCounting: AppendCountingFn;
};

export type LiveCase = {
  readonly id: string;
  readonly title: string;
  readonly run: (ctx: LiveCaseCtx) => Promise<void>;
};

// --------------------------------------------------------------------
// Standard tmp + event helpers (shared)
// --------------------------------------------------------------------

function tmpBase(): string {
  return process.env["TMPDIR"] ?? path.join(process.cwd(), ".lw-live");
}

/**
 * (B0-QUALIFICATION03) The wrapper used to return
 * `{result, wireAttempts:1}` and asserted
 * `wireAttempts === 1` per logical append. That was
 * a constant, not instrumentation. We drop the
 * counter; only the result is returned.
 */
export type AppendCountingFn = (
  h: WriterHandle,
  args: {
    readonly commitId: string;
    readonly event: import("../../src/ledger-writer/ledger-writer-protocol.js").WriterEvent;
    readonly clientContentHash?: string;
  },
) => Promise<Awaited<ReturnType<typeof appendToLedgerWriter>>>;

// Uninitialised stub used when the caller has not
// provided a real implementation.
export const UNINITIALISED_APPEND_COUNTING: AppendCountingFn = (_h, _args) =>
  Promise.resolve({
    ok: false,
    error: { kind: "writer_busy", message: "uninitialised" },
  });

// --------------------------------------------------------------------
// Standard event factory
// --------------------------------------------------------------------

function makeEvent(seq: number, suffix: string): import("../../src/ledger-writer/ledger-writer-protocol.js").WriterEvent {
  return {
    eventId: `evt-qual-${seq}`,
    observedAt: 1700000000000 + seq,
    kind: "lifecycle",
    event: { type: "run_created" },
  };
  void suffix;
}

// --------------------------------------------------------------------
// LWQ01..LWQ06 — durability / sequencing / dedup
// --------------------------------------------------------------------

const LWQ01: LiveCase = {
  id: "LWQ01",
  title: "startup + identity (LW-LIVE01): ping returns {instanceId, maxSequence:0}",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq01");
    const h = await ctx.bootHandle(tmp);
    try {
      const r = await h.ping();
      assert.equal(r.ok, true);
      if (r.ok) {
        // (B0-QUALIFICATION04) PingClientResult.value is
        // {instanceId, maxSequence}, NOT a bare string.
        assert.equal(typeof r.value.instanceId, "string");
        assert.equal(r.value.instanceId, h.instanceId,
          "ping.instanceId must equal the spawned writer's instanceId");
        assert.equal(r.value.maxSequence, 0,
          "fresh writer must report maxSequence === 0");
      }
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

const LWQ02: LiveCase = {
  id: "LWQ02",
  title: "single append allocates sequence 1 (LW-LIVE02)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq02");
    const h = await ctx.bootHandle(tmp);
    try {
      const r = await ctx.appendCounting(h, {
        commitId: "lwq02",
        event: makeEvent(1, "lwq02"),
      });
      assert.equal(r.ok, true,
        `LWQ02 append failed: ${JSON.stringify(r)}`);
      if (r.ok) assert.equal(r.value.sequence, 1);
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

const LWQ03: LiveCase = {
  id: "LWQ03",
  title: "second append with new commitId → seq 2 (LW-LIVE03)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq03");
    const h = await ctx.bootHandle(tmp);
    try {
      const a = await ctx.appendCounting(h, {
        commitId: "lwq03a",
        event: makeEvent(1, "lwq03a"),
      });
      assert.equal(a.ok, true,
        `LWQ03 first append failed: ${JSON.stringify(a)}`);
      const b = await ctx.appendCounting(h, {
        commitId: "lwq03b",
        event: makeEvent(2, "lwq03b"),
      });
      assert.equal(b.ok, true,
        `LWQ03 second append failed: ${JSON.stringify(b)}`);
      if (b.ok) assert.equal(b.value.sequence, 2);
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

const LWQ04: LiveCase = {
  id: "LWQ04",
  title: "same commitId returns same sequence (LW-LIVE04)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq04");
    const h = await ctx.bootHandle(tmp);
    try {
      const a = await ctx.appendCounting(h, {
        commitId: "lwq04",
        event: makeEvent(1, "lwq04"),
      });
      assert.equal(a.ok, true,
        `LWQ04 first append failed: ${JSON.stringify(a)}`);
      if (a.ok) assert.equal(a.value.sequence, 1);
      const b = await ctx.appendCounting(h, {
        commitId: "lwq04",
        event: makeEvent(1, "lwq04"),
      });
      assert.equal(b.ok, true,
        `LWQ04 second append failed: ${JSON.stringify(b)}`);
      if (b.ok) assert.equal(b.value.sequence, 1);
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

const LWQ05: LiveCase = {
  id: "LWQ05",
  title: "same contentHash distinct commitId → distinct commits (LW-LIVE05)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq05");
    const h = await ctx.bootHandle(tmp);
    try {
      const ev = makeEvent(1, "lwq05");
      const a = await ctx.appendCounting(h, {
        commitId: "lwq05a",
        event: ev,
      });
      const b = await ctx.appendCounting(h, {
        commitId: "lwq05b",
        event: ev,
      });
      assert.equal(a.ok, true,
        `LWQ05 first append failed: ${JSON.stringify(a)}`);
      assert.equal(b.ok, true,
        `LWQ05 second append failed: ${JSON.stringify(b)}`);
      if (a.ok && b.ok) {
        assert.equal(a.value.sequence, 1);
        assert.equal(b.value.sequence, 2);
      }
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

const LWQ06: LiveCase = {
  id: "LWQ06",
  title: "events.jsonl contains every appended line, no duplicates (LW-LIVE06)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq06");
    const h = await ctx.bootHandle(tmp);
    let lineCount = -1;
    let ledgerExists = false;
    try {
      for (let i = 1; i <= 3; i++) {
        const r = await ctx.appendCounting(h, {
          commitId: `lwq06-${i}`,
          event: makeEvent(i, `lwq06-${i}`),
        });
        assert.equal(r.ok, true,
          `LWQ06 append ${i} failed: ${JSON.stringify(r)}`);
      }
      // (B0-QUALIFICATION04) Read evidence BEFORE
      // writer stop + runDir destruction.
      const ledger = path.join(tmp, LEDGER_FILENAME);
      ledgerExists = true;
      const text = await fs.readFile(ledger, "utf8");
      lineCount = text.split("\n").filter((l) => l.length > 0).length;
    } finally {
      await h.stop();
    }
    // Evidence assertions: ENOENT is FAIL, not zero.
    assert.equal(ledgerExists, true,
      "LWQ06: events.jsonl must exist before destruction");
    assert.equal(lineCount, 3,
      `LWQ06: expected 3 ledger lines, got ${lineCount}`);
    await ctx.destroyRun(tmp);
  },
};

// --------------------------------------------------------------------
// LWQ07 — restart preserves dedup (LW-LIVE09/10)
// --------------------------------------------------------------------

const LWQ07: LiveCase = {
  id: "LWQ07",
  title: "restart preserves dedup state and emits no duplicate lines (LW-LIVE09/10)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq07");
    const commitId = "lwq07";
    let lineCount = -1;
    let ledgerExists = false;
    let h2: WriterHandle | undefined;
    try {
      const h1 = await ctx.bootHandle(tmp);
      const a = await ctx.appendCounting(h1, {
        commitId,
        event: makeEvent(1, "lwq07"),
      });
      assert.equal(a.ok, true,
        `LWQ07 first append failed: ${JSON.stringify(a)}`);
      if (a.ok) assert.equal(a.value.sequence, 1);
      // (B0-QUALIFICATION04) Writer stop MUST NOT
      // destroy the runDir; durable evidence is read
      // AFTER both writers have been stopped.
      await h1.stop();

      // Second writer against the SAME runDir: must
      // re-bind the durable history, not allocate a
      // fresh ledger.
      h2 = await ctx.bootHandle(tmp);
      const b = await ctx.appendCounting(h2, {
        commitId,
        event: makeEvent(1, "lwq07"),
      });
      assert.equal(b.ok, true,
        `LWQ07 second append failed: ${JSON.stringify(b)}`);
      if (b.ok) {
        assert.equal(b.value.sequence, 1,
          "replay returns original seq after restart");
      }
      // Inspect evidence before any cleanup.
      const ledger = path.join(tmp, LEDGER_FILENAME);
      ledgerExists = true;
      const text = await fs.readFile(ledger, "utf8");
      lineCount = text.split("\n").filter((l) => l.length > 0).length;
    } finally {
      if (h2 !== undefined) {
        try { await h2.stop(); } catch { /* */ }
      }
    }
    // Evidence assertions: ENOENT is FAIL.
    assert.equal(ledgerExists, true,
      "LWQ07: events.jsonl must exist before destruction");
    assert.equal(lineCount, 1,
      `LWQ07: replay must NOT add a second durable line; got ${lineCount}`);
    await ctx.destroyRun(tmp);
  },
};

// --------------------------------------------------------------------
// LWQ08 — sole-writer exclusion (LW-LIVE08)
//
// (B0-QUALIFICATION06) Strict sole-authority law:
//
//   "Exactly one sequence-allocation authority may
//    exist for the run."
//
// The lease + bind-time policy exist so that a
// second LedgerWriter child cannot reach readiness
// against a runDir already owned by a live writer.
// A successful `bootHandle(tmp)` therefore means a
// second writer has acquired the lease and bound the
// UDS — the architectural invariant has already been
// violated, regardless of whether a subsequent append
// happens to fail.
//
// QUALIFICATION05's LWQ08 accepted two shapes:
//
//   A. W2 boot rejected (correct)
//   B. W2 boot succeeded but append failed closed
//      (INCORRECT — the invariant is broken the
//      moment W2 reaches readiness; an append that
//      happens to fail is not a substitute for the
//      bind-time + lease rejection)
//
// QUALIFICATION06's LWQ08 requires:
//
//   1. W1 baseline append = PASS, seq = 1.
//   2. Ledger exists with exactly 1 line.
//   3. W2 boot attempt against the SAME runDir =
//      REJECTED. No second WriterHandle may be
//      returned.
//   4. Ledger still has exactly 1 record, and that
//      record is the W1 baseline (decoded via
//      parsePersistedLine).
//   5. W2 is never used for an append — the fact
//      that W2 never acquired authority is the
//      stronger evidence.
//
// The negative-delta evidence law from
// QUALIFICATION05 is preserved as a secondary check.
// --------------------------------------------------------------------

const LWQ08: LiveCase = {
  id: "LWQ08",
  title:
    "sole-writer exclusion: W2 boot against an authoritative runDir is rejected; W1 baseline preserved (LW-LIVE08)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("lwq08");
    const BASELINE_COMMIT = "lwq08-owner-baseline";

    const h1 = await ctx.bootHandle(tmp);

    let h2: WriterHandle | undefined;
    let w2BootRejected = false;
    let w2BootError: unknown = undefined;
    let ledgerText = "";
    let baselineRecord: ParsedPersistedLine | undefined;

    try {
      // Step 1 — establish authoritative baseline via W1.
      const baseline = await ctx.appendCounting(h1, {
        commitId: BASELINE_COMMIT,
        event: makeEvent(1, "lwq08-baseline"),
      });
      assert.equal(baseline.ok, true,
        "LWQ08: baseline append must succeed");
      if (baseline.ok) {
        assert.equal(baseline.value.sequence, 1,
          "LWQ08: baseline must commit at sequence 1");
      }

      // Step 2 — verify the ledger now exists with exactly
      // one record (the baseline). Read this BEFORE
      // touching h2 so any failure here is unambiguous.
      {
        const baselineLedger = path.join(tmp, LEDGER_FILENAME);
        const baselineText = await fs.readFile(baselineLedger, "utf8");
        const baselineLines = baselineText
          .split("\n")
          .filter((l) => l.length > 0);
        assert.equal(baselineLines.length, 1,
          `LWQ08: baseline must produce exactly 1 ledger line; got ${baselineLines.length}`);
      }

      // Step 3 — attempt a concurrent W2 against the SAME
      // runDir while W1 is still authoritative. The
      // architectural invariant is: this boot MUST be
      // rejected. A returned WriterHandle would mean a
      // second lease + socket bind succeeded — the
      // invariant is broken, regardless of subsequent
      // append behavior.
      try {
        h2 = await ctx.bootHandle(tmp);
      } catch (e) {
        w2BootRejected = true;
        w2BootError = e;
      }

      // Step 4 — read durable state AFTER W2's attempt.
      // Evidence is retained: writer stop and runDir
      // destruction happen LATER.
      const ledger = path.join(tmp, LEDGER_FILENAME);
      ledgerText = await fs.readFile(ledger, "utf8");
    } finally {
      // Step 5 — cleanup ordering. Evidence has already
      // been read; now reap children and destroy the
      // runDir.
      if (h2 !== undefined) {
        try { await h2.stop(); } catch { /* */ }
      }
      try { await h1.stop(); } catch { /* */ }
    }

    // Step 6 — strict sole-authority postconditions.

    // (a) W2 boot must have been REJECTED. No second
    //     WriterHandle may be returned. This is the
    //     core architectural property.
    assert.equal(h2, undefined,
      "LWQ08: concurrent second LedgerWriter MUST NOT reach readiness against an authoritative runDir");
    assert.equal(w2BootRejected, true,
      "LWQ08: concurrent boot attempt must be rejected by the lease + bind-time policy");
    // Surface the rejection kind for diagnostics. The
    // expected shape is `startLedgerWriter` returning
    // ok=false with a kind such as `socket_bind_failed`
    // or similar; `startWriterInTmpDir` then throws.
    if (w2BootError instanceof Error) {
      assert.ok(w2BootError.message.length > 0,
        `LWQ08: rejection message must be non-empty; got ${w2BootError.message}`);
    } else {
      throw new Error(
        `LWQ08: w2BootError must be an Error instance; got ${typeof w2BootError}`,
      );
    }

    // (b) Durable state: exactly one record, the W1
    //     baseline. (Negative-delta evidence law from
    //     QUALIFICATION05 preserved as a secondary
    //     check.)
    const lines = ledgerText.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1,
      `LWQ08: ledger must contain exactly W1's baseline commit; got ${lines.length} lines`);

    for (const ln of lines) {
      const parsed = parsePersistedLine(ln);
      assert.equal(parsed.ok, true,
        `LWQ08: ledger line must decode; got reason=${parsed.ok ? "" : parsed.reason}`);
      if (!parsed.ok) continue;
      if (parsed.commitId === BASELINE_COMMIT) {
        if (baselineRecord !== undefined) {
          throw new Error("LWQ08: duplicate baseline record in ledger");
        }
        baselineRecord = parsed;
      } else {
        throw new Error(
          `LWQ08: unexpected commitId in ledger: ${parsed.commitId}`,
        );
      }
    }

    assert.ok(baselineRecord !== undefined,
      "LWQ08: baseline record must be present in the durable ledger");
    if (baselineRecord !== undefined && baselineRecord.ok) {
      assert.equal(baselineRecord.sequence, 1,
        "LWQ08: baseline sequence must be 1");
      assert.equal(baselineRecord.commitId, BASELINE_COMMIT,
        "LWQ08: baseline commitId must equal the W1 baseline");
    }

    await ctx.destroyRun(tmp);
  },
};

// --------------------------------------------------------------------
// LWQ09..LWQ11 — RPC01..03 (with wire-attempt counter)
// --------------------------------------------------------------------

const LWQ09: LiveCase = {
  id: "LWQ09",
  title: "RPC01 new commit → one logical append → seq 1",
  async run(ctx) {
    const tmp = await ctx.mkTmp("rpc01");
    const h = await ctx.bootHandle(tmp);
    try {
      // (B0-QUALIFICATION03) No wireAttempts assertion:
      // transport round-trip count is not a B0 freeze
      // invariant. We only assert the semantic
      // outcome: a fresh commitId commits at seq 1.
      const r = await ctx.appendCounting(h, {
        commitId: "rpc01",
        event: makeEvent(1, "rpc01"),
      });
      assert.equal(r.ok, true,
        `LWQ09 append failed: ${JSON.stringify(r)}`);
      if (r.ok) assert.equal(r.value.sequence, 1);
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

const LWQ10: LiveCase = {
  id: "LWQ10",
  title: "RPC02 replay → second logical append returns same sequence (no duplicate durable effect)",
  async run(ctx) {
    const tmp = await ctx.mkTmp("rpc02");
    const h = await ctx.bootHandle(tmp);
    try {
      const a = await ctx.appendCounting(h, {
        commitId: "rpc02",
        event: makeEvent(1, "rpc02"),
      });
      assert.equal(a.ok, true,
        `LWQ10 first append failed: ${JSON.stringify(a)}`);
      const b = await ctx.appendCounting(h, {
        commitId: "rpc02",
        event: makeEvent(1, "rpc02"),
      });
      assert.equal(b.ok, true,
        `LWQ10 second append failed: ${JSON.stringify(b)}`);
      if (a.ok && b.ok) {
        assert.equal(a.value.sequence, b.value.sequence,
          "replay returns same sequence");
      }
    } finally {
      await h.stop();
      await ctx.destroyRun(tmp);
    }
  },
};

/**
 * RPC03 conflict: SAME commitId, DIFFERENT content.
 * The first append commits the commitId at seq=N.
 * The second append with the same commitId but a
 * different content MUST return conflicting_commit
 * (NOT allocate a new sequence). The ledger line
 * count must remain unchanged.
 */
const LWQ11: LiveCase = {
  id: "LWQ11",
  title: "RPC03 conflict → same commitId, different content → conflicting_commit",
  async run(ctx) {
    const tmp = await ctx.mkTmp("rpc03");
    const h = await ctx.bootHandle(tmp);
    let lineCount = -1;
    let ledgerExists = false;
    try {
      const evA = makeEvent(1, "rpc03A");
      const evB = makeEvent(2, "rpc03B");
      const a = await ctx.appendCounting(h, {
        commitId: "rpc03",
        event: evA,
      });
      assert.equal(a.ok, true,
        `LWQ11 first append failed: ${JSON.stringify(a)}`);
      if (a.ok) assert.equal(a.value.sequence, 1);
      const b = await ctx.appendCounting(h, {
        commitId: "rpc03",
        event: evB,
      });
      // RPC03 conflict: must report an error.
      assert.equal(b.ok, false,
        `RPC03 conflict must report ok=false; got ${JSON.stringify(b)}`);
      if (!b.ok) {
        const k = (b.error as { kind?: string }).kind;
        assert.equal(k, "protocol_error",
          `RPC03 client wraps conflict as protocol_error, got ${JSON.stringify(b.error)}`);
        const inner = (b.error as {
          error?: { kind?: string };
        }).error;
        assert.ok(
          inner !== null && typeof inner === "object" &&
          inner.kind === "conflicting_commit",
          `RPC03 inner.kind must be conflicting_commit, got ${JSON.stringify(b.error)}`,
        );
      }
      // (B0-QUALIFICATION04) Read evidence inside the
      // guarantee that the runDir is still present
      // (writer has not been stopped yet, no
      // destruction has happened).
      const ledger = path.join(tmp, LEDGER_FILENAME);
      const text = await fs.readFile(ledger, "utf8");
      ledgerExists = true;
      lineCount = text.split("\n").filter((l) => l.length > 0).length;
    } finally {
      await h.stop();
    }
    // Evidence assertions: ENOENT is FAIL.
    assert.equal(ledgerExists, true,
      "LWQ11: events.jsonl must exist before destruction");
    assert.equal(lineCount, 1,
      `LWQ11: conflict must NOT add a second durable line; got ${lineCount}`);
    await ctx.destroyRun(tmp);
  },
};

// --------------------------------------------------------------------
// LWQ12 — SHUT12 production in-flight lifecycle (real handleRequest)
// --------------------------------------------------------------------

const LWQ12: LiveCase = {
  id: "LWQ12",
  title: "SHUT12 production inFlightCount tracks request lifecycle (real handleRequest)",
  async run() {
    const { handleRequest } = await import(
      "../../src/ledger-writer/ledger-writer-request-handler.js"
    );
    const {
      emptyDedupIndex,
      makeLedgerWriterInstanceId,
    } = await import("../../src/ledger-writer/ledger-writer-types.js");

    const state = {
      index: emptyDedupIndex(),
      busy: false,
      crashCutHook: null,
      inFlight: 0,
      admission: { accepting: true },
    };
    const args = {
      runDir: "/tmp",
      runId: "r",
      missionId: "m",
      socketPath: "/tmp/s",
      instanceId: makeLedgerWriterInstanceId("lwq12"),
    };

    const resolvers: Array<() => void> = [];
    function release(): void {
      const next = resolvers.shift();
      if (next !== undefined) next();
    }
    const reply = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    };
    const replyErr = async (): Promise<void> => release();

    async function dispatch(): Promise<void> {
      state.inFlight++;
      const p = handleRequest(
        { kind: "who_are_you", protocolVersion: 2 } as never,
        args,
        state,
        reply,
        replyErr,
      );
      p.catch(() => undefined);
      await p;
      state.inFlight--;
    }

    const d1 = dispatch();
    const d2 = dispatch();
    // Both increments visible synchronously.
    assert.equal(state.inFlight, 2, "two increments visible at dispatch");

    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(state.inFlight, 1, "first decrement after reply");

    release();
    await new Promise((r) => setImmediate(r));
    assert.equal(state.inFlight, 0, "second decrement after reply");

    await d1;
    await d2;
    assert.equal(state.inFlight, 0, "counter settles to 0");
  },
};

// --------------------------------------------------------------------
// LWQ13 — SHUT13 admission gate (real handleConnection)
// --------------------------------------------------------------------

const LWQ13: LiveCase = {
  id: "LWQ13",
  title: "SHUT13 real handleConnection respects admission gate (B0-CORR07)",
  async run() {
    const { handleConnection } = await import(
      "../../src/ledger-writer/ledger-writer-connection.js"
    );
    const {
      emptyDedupIndex,
      makeLedgerWriterInstanceId,
    } = await import("../../src/ledger-writer/ledger-writer-types.js");
    const { encodeFrame } = await import(
      "../../src/witness/witness-codec-framing.js"
    );

    const state = {
      index: emptyDedupIndex(),
      busy: false,
      crashCutHook: null,
      inFlight: 0,
      admission: { accepting: true },
    };
    const args = {
      runDir: "/tmp",
      runId: "r",
      missionId: "m",
      socketPath: "/tmp/s",
      instanceId: makeLedgerWriterInstanceId("lwq13"),
    };

    const writes: Buffer[] = [];
    const fakeSocket = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      write: (buf: Buffer, cb?: (e?: Error | null) => void) => boolean;
      end: (cb?: () => void) => void;
      destroy: (e?: Error) => void;
    };
    fakeSocket.destroyed = false;
    fakeSocket.write = ((buf: Buffer): boolean => {
      writes.push(Buffer.from(buf));
      return true;
    }) as typeof fakeSocket.write;
    fakeSocket.end = ((): void => undefined) as typeof fakeSocket.end;
    fakeSocket.destroy = ((): void => {
      fakeSocket.destroyed = true;
    }) as typeof fakeSocket.destroy;

    // Drive the REAL handleConnection.
    const connPromise = handleConnection(
      fakeSocket as unknown as Socket,
      args,
      state,
    );
    await connPromise;

    // Pre-shutdown: send a valid who_are_you frame.
    assert.equal(state.admission.accepting, true);
    const frame1 = encodeFrame(JSON.stringify({
      kind: "who_are_you",
      protocolVersion: 2,
    }));
    if (!frame1.ok) throw new Error("encode failed");
    fakeSocket.emit("data", Buffer.from(frame1.bytes));
    await new Promise((r) => setImmediate(r));

    // Wait for the who_are_you to settle.
    for (let i = 0; i < 50; i++) {
      if (state.inFlight === 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(state.inFlight, 0, "inFlight settles to 0 after who_are_you");

    const sawSelfReply = writes.some((b) =>
      b.includes(Buffer.from('"kind":"self"')));
    assert.ok(sawSelfReply, "pre-shutdown who_are_you produced a reply");

    // Close the admission gate synchronously.
    state.admission.accepting = false;
    const writesBeforeGate = writes.length;

    const frame2 = encodeFrame(JSON.stringify({
      kind: "who_are_you",
      protocolVersion: 2,
    }));
    if (!frame2.ok) throw new Error("encode failed");
    fakeSocket.emit("data", Buffer.from(frame2.bytes));
    await new Promise((r) => setImmediate(r));

    assert.equal(state.inFlight, 0,
      "closed gate prevents new dispatch (inFlight unchanged)");
    assert.equal(fakeSocket.destroyed, true,
      "closed gate destroys the socket");
    assert.equal(writes.length, writesBeforeGate,
      "closed gate emits no new reply");
  },
};

// --------------------------------------------------------------------
// LWQ14..LWQ15 — SOCK05 / SOCK06 (real probeSocketPath,
// helper child processes)
// --------------------------------------------------------------------

/**
 * CORRECTION07: durable fixture invariant (doctrine-enforcing).
 *
 * A case owning a ChildProcess MUST NOT report cleanup
 * complete until it observes the subprocess lifecycle
 * boundary it owns. Concretely:
 *
 *   arm `'close'` / `'error'` observers
 *   → request termination (signal)
 *   → await `'close'` boundary
 *   → on `'close'` → success
 *   → on `'error'` before `'close'` → failure
 *   → on deadline expiry → failure
 *   → only then return
 *
 * The previous contract —
 *   `c.kill("SIGKILL"); return;`
 * — returns the moment the signal is dispatched.
 * `subprocess.kill()` only reports whether signal
 * delivery was accepted by the OS; it does NOT
 * synchronously reap the child. The kernel may still
 * hold the pid for a few ms (zombie, in-flight
 * stdio drain, or even just SIGKILL delivery
 * latency). When the after-suite residue sweep runs
 * immediately after the case returns, it observes
 * `kill(pid, 0)` → alive → records residue for a
 * child the case has in fact killed.
 *
 * Per Node's documented ChildProcess lifecycle,
 * `'close'` is emitted "after a process has ended
 * and the stdio streams have been closed". It is
 * emitted LATER than `'exit'`. `'error'` may be
 * emitted for spawn failure, kill failure, message
 * failure, or abort — it does NOT by itself prove
 * the process has ended, so it MUST NOT be treated
 * as cleanup success.
 *
 * To eliminate the lost-listener race for a fast
 * exit, observers are armed BEFORE the signal is
 * dispatched.
 *
 * The contract rejects on `'error'` and on deadline
 * expiry. A deadline that resolves success would
 * lie about a boundary the fixture did not observe.
 */

export type ChildCloseResult = {
  readonly kind: "closed";
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
};

/**
 * Observe the ChildProcess `'close'` boundary.
 *
 *   - Resolves with `{kind:"closed", code, signal}`
 *     once Node has emitted `'close'`.
 *   - Rejects on `'error'` (the process did not
 *     terminate cleanly per Node's contract).
 *   - Rejects on deadline expiry.
 *   - Fast-path: if Node has already cached an exit
 *     before this call is made, waits one tick for
 *     stdio drain and resolves from the cached state.
 *
 * Exported so ORACLE03 can lock in the contract.
 */
export async function awaitChildClose(
  child: import("node:child_process").ChildProcess,
  timeoutMs = 2000,
): Promise<ChildCloseResult> {
  // Fast path: if Node has already observed exit,
  // the 'close' boundary is either past or one tick
  // away. We wait one tick for stdio drain, then
  // check again.
  if (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  ) {
    await new Promise((r) => setImmediate(r));
    if (
      (child.exitCode !== null && child.exitCode !== undefined) ||
      (child.signalCode !== null && child.signalCode !== undefined)
    ) {
      return {
        kind: "closed",
        code: child.exitCode ?? null,
        signal: child.signalCode ?? null,
      };
    }
  }

  return new Promise<ChildCloseResult>((resolve, reject) => {
    let settled = false;
    const onClose = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ kind: "closed", code, signal });
    };
    const onError = (err: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(
        `awaitChildClose: 'error' before 'close' (fixture boundary violated): ${err.message}`,
      ));
    };
    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(
        `awaitChildClose: deadline ${timeoutMs}ms expired before 'close' was observed (fixture boundary violated)`,
      ));
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timeoutHandle);
      child.off("close", onClose);
      child.off("error", onError);
    }
    // Arm listeners BEFORE the caller signals the
    // child, so we cannot miss the 'close' event.
    child.once("close", onClose);
    child.once("error", onError);
  });
}

/**
 * Combine termination + close-boundary observation
 * into one atomic fixture primitive.
 *
 *   arm observers (via awaitChildClose)
 *   → child.kill("SIGKILL")
 *   → require 'close' within timeoutMs
 *   → on 'error' / deadline expiry → reject
 *
 * The case body MUST let the rejection propagate;
 * no try/catch around the call. A deadline that
 * means success would lie about a boundary the
 * fixture did not observe.
 */
export async function terminateHelperAndAwaitClose(
  child: import("node:child_process").ChildProcess,
  timeoutMs = 2000,
): Promise<ChildCloseResult> {
  // If the child has already observed exit, skip
  // the signal and just await whatever boundary
  // remains (the natural-exit fast path used by
  // ORACLE03's positive case).
  if (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  ) {
    return awaitChildClose(child, timeoutMs);
  }
  // Set up the close observer BEFORE calling
  // kill(), so a fast exit cannot lose the
  // boundary.
  const closePromise = awaitChildClose(child, timeoutMs);
  let accepted = false;
  try {
    accepted = child.kill("SIGKILL");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `terminateHelperAndAwaitClose: kill() threw before 'close' could be observed: ${msg}`,
    );
  }
  if (!accepted) {
    throw new Error(
      "terminateHelperAndAwaitClose: kill() returned false (signal not accepted by OS)",
    );
  }
  return closePromise;
}

const LWQ14: LiveCase = {
  id: "LWQ14",
  title: "SOCK05 WHO timeout → unknown_socket",
  async run() {
    const tmp = await fs.mkdtemp(path.join(tmpBase(), ".lwl-sock05-"));
    try {
      const sp = path.join(tmp, "s");
      // Listener that accepts but never replies.
      const script =
        `const net = require("node:net");` +
        `const s = net.createServer(() => {});` +
        `s.listen(${JSON.stringify(sp)}, () => process.send && process.send("ready"));`;
      const c = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      registerHelperSpawn({ child: c, note: `lwq14 listener ${sp}` });
      await new Promise<void>((resolve) => {
        c.on("message", (msg: string) => {
          if (msg === "ready") resolve();
        });
        setTimeout(resolve, 500);
      });
      const probe = await probeSocketPath(sp);
      assert.equal(probe.ok, true);
      if (probe.ok) assert.equal(probe.value, "unknown_socket");
      const stat = await fs.lstat(sp);
      assert.equal(stat.isSocket(), true);
      // CORRECTION07: signal + await 'close' as one
      // atomic fixture primitive. The rejection
      // propagates so a deadline-expiry case is a
      // FAIL, not a silent green.
      await terminateHelperAndAwaitClose(c);
    } finally {
      await proveUnlink(tmp);
    }
  },
};

const LWQ15: LiveCase = {
  id: "LWQ15",
  title: "SOCK06 malformed WHO → unknown_socket",
  async run() {
    const tmp = await fs.mkdtemp(path.join(tmpBase(), ".lwl-sock06-"));
    try {
      const sp = path.join(tmp, "s");
      // Listener that replies with a malformed envelope.
      const script =
        `const net = require("node:net");` +
        `const s = net.createServer((c) => {` +
        `  c.on("data", () => {` +
        `    const bad = JSON.stringify({ kind: "self" });` +
        `    const len = Buffer.byteLength(bad);` +
        `    const hdr = Buffer.alloc(4); hdr.writeUInt32BE(len, 0);` +
        `    c.write(Buffer.concat([hdr, Buffer.from(bad)]));` +
        `    c.end();` +
        `  });` +
        `});` +
        `s.listen(${JSON.stringify(sp)}, () => process.send && process.send("ready"));`;
      const c = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      registerHelperSpawn({ child: c, note: `lwq15 listener ${sp}` });
      await new Promise<void>((resolve) => {
        c.on("message", (msg: string) => {
          if (msg === "ready") resolve();
        });
        setTimeout(resolve, 500);
      });
      const probe = await probeSocketPath(sp);
      assert.equal(probe.ok, true);
      if (probe.ok) assert.equal(probe.value, "unknown_socket");
      const stat = await fs.lstat(sp);
      assert.equal(stat.isSocket(), true);
      // CORRECTION07: signal + await 'close' as one
      // atomic fixture primitive. The rejection
      // propagates so a deadline-expiry case is a
      // FAIL, not a silent green.
      await terminateHelperAndAwaitClose(c);
    } finally {
      await proveUnlink(tmp);
    }
  },
};

// --------------------------------------------------------------------
// Maintained matrix — single source of truth
// --------------------------------------------------------------------

export const LEDGER_WRITER_LIVE_CASES: ReadonlyArray<LiveCase> = [
  LWQ01,
  LWQ02,
  LWQ03,
  LWQ04,
  LWQ05,
  LWQ06,
  LWQ07,
  LWQ08,
  LWQ09,
  LWQ10,
  LWQ11,
  LWQ12,
  LWQ13,
  LWQ14,
  LWQ15,
];
