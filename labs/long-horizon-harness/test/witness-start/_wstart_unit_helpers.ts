/**
 * FOUNDATION04 — PHASE A — Unit-test scaffolding for the
 * witness-start gate.
 *
 * Provides in-memory fake ports (commit, spawn, identity)
 * with instrumentation hooks.
 *
 * NO real Node.spawn. NO real LedgerWriter. Pure in-memory.
 */

import type {
  WitnessIdentityFactory,
  WitnessIntentCommitPort,
  WitnessSpawnHandle,
  WitnessSpawnPort,
  WitnessSpawnSpec,
  WitnessSpawnSpecResult,
  WitnessStartIdentity,
  IntentCommitOutcome,
  IntentCommitResult,
  IntentPersistenceFailure,
  WitnessSpawnFailure,
} from "../../src/witness-start/witness-start-types.js";

export type StagedSpawn =
  | { readonly kind: "ok"; readonly handle: WitnessSpawnHandle }
  | { readonly kind: "failure"; readonly failure: WitnessSpawnFailure };

export interface FakeCommit extends WitnessIntentCommitPort {
  calls: number;
  lastCommitId: string | null;
  lastPayloadKind: string | null;
  lastObservedAt: number | null;
  stageNext(result: IntentCommitResult): void;
  /**
   * Convenience: stage the success shorthand
   * `stage.ok(outcome)` or `stage.fail(failure)`.
   */
  ok(outcome: IntentCommitOutcome): void;
  fail(failure: IntentPersistenceFailure): void;
  resolvePending(result: IntentCommitResult): void;
  /**
   * Stage a Promise rejection for the next commit call.
   * The gate catches it and maps to transport_rejected.
   */
  stageReject(reason: string): void;
}

export interface FakeSpawn extends WitnessSpawnPort {
  calls: number;
  lastSpec: WitnessSpawnSpec | null;
  setNext(stage: StagedSpawn): void;
}

export interface FakeIdentity extends WitnessIdentityFactory {
  calls: number;
  next: WitnessStartIdentity;
  setNextIdentity(id: WitnessStartIdentity): void;
}

export function makeFakeCommit(): FakeCommit {
  let pendingResolve: ((r: IntentCommitResult) => void) | null = null;
  let staged: IntentCommitResult | null = null;
  let rejectReason: string | null = null;
  const c: FakeCommit = {
    calls: 0,
    lastCommitId: null,
    lastPayloadKind: null,
    lastObservedAt: null,
    stageNext(result: IntentCommitResult): void {
      staged = result;
    },
    ok(outcome: IntentCommitOutcome): void {
      staged = { ok: true, outcome };
    },
    fail(failure: IntentPersistenceFailure): void {
      staged = { ok: false, failure };
    },
    stageReject(reason: string): void {
      rejectReason = reason;
    },
    resolvePending(result: IntentCommitResult): void {
      if (pendingResolve === null) {
        throw new Error("FakeCommit.resolvePending: no commit is pending");
      }
      const pr = pendingResolve;
      pendingResolve = null;
      pr(result);
    },
    commit(args): Promise<IntentCommitResult> {
      c.calls += 1;
      c.lastCommitId = args.commitId;
      c.lastPayloadKind = args.payload.kind;
      c.lastObservedAt = args.observedAt;
      if (rejectReason !== null) {
        const reason = rejectReason;
        rejectReason = null;
        return Promise.reject(new Error(reason));
      }
      if (staged !== null) {
        const r = staged;
        staged = null;
        return Promise.resolve(r);
      }
      return new Promise<IntentCommitResult>((resolve) => {
        pendingResolve = resolve;
      });
    },
  };
  return c;
}

export function makeFakeHandle(pid = 99999): WitnessSpawnHandle {
  return {
    pid,
    kill: (_signal?: NodeJS.Signals): boolean => true,
    on: (_event: "exit" | "error", _listener: unknown): WitnessSpawnHandle => {
      void _event;
      void _listener;
      return makeFakeHandle(pid);
    },
  };
}

export function makeFakeSpawn(): FakeSpawn {
  let staged: StagedSpawn | null = {
    kind: "ok",
    handle: makeFakeHandle(),
  };
  const s: FakeSpawn = {
    calls: 0,
    lastSpec: null,
    setNext(stage: StagedSpawn): void {
      staged = stage;
    },
    spawn(spec: WitnessSpawnSpec): WitnessSpawnSpecResult {
      s.calls += 1;
      s.lastSpec = spec;
      if (staged === null) {
        return { ok: true, handle: makeFakeHandle() };
      }
      if (staged.kind === "ok") {
        return { ok: true, handle: staged.handle };
      }
      return { ok: false, failure: staged.failure };
    },
  };
  return s;
}

export function makeFakeIdentity(
  base: Partial<WitnessStartIdentity> = {},
): FakeIdentity {
  let n = 0;
  const f: FakeIdentity = {
    calls: 0,
    next: makeIdentity(),
    setNextIdentity(id: WitnessStartIdentity): void {
      f.next = id;
    },
    allocate(args): WitnessStartIdentity {
      f.calls += 1;
      n += 1;
      const wid = "w-n" + n.toString();
      const wii = "wi-n" + n.toString();
      const id: WitnessStartIdentity = {
        runId: base.runId ?? args.runId,
        missionId: base.missionId ?? (args.runId as never),
        attemptId: base.attemptId ?? args.attemptId,
        processId: base.processId ?? args.processId,
        witnessId: base.witnessId ?? (wid as never),
        witnessInstanceId: base.witnessInstanceId ?? (wii as never),
      };
      f.next = id;
      return id;
    },
  };
  return f;
}

function makeIdentity(): WitnessStartIdentity {
  return {
    runId: "r" as never,
    missionId: "m" as never,
    attemptId: "a" as never,
    processId: "p" as never,
    witnessId: "w" as never,
    witnessInstanceId: "wi" as never,
  };
}

export const FAILURES = {
  writer_unavailable: (sock = "/tmp/x.sock"): IntentPersistenceFailure => ({
    kind: "writer_unavailable",
    socketPath: sock,
  }),
  invalid_envelope: (r = "bad"): IntentPersistenceFailure => ({
    kind: "invalid_envelope",
    reason: r,
  }),
  conflicting_commit: (m = "different payload same id"): IntentPersistenceFailure => ({
    kind: "conflicting_commit",
    message: m,
  }),
  append_failed: (m = "io"): IntentPersistenceFailure => ({
    kind: "append_failed",
    message: m,
  }),
  transport_rejected: (r = "econnreset"): IntentPersistenceFailure => ({
    kind: "transport_rejected",
    reason: r,
  }),
};

export const SUCCESSES = {
  appended: (seq = 1): IntentCommitOutcome => ({
    kind: "appended",
    seq,
    contentHash: "h-" + seq.toString(16),
  }),
  replay: (seq = 1): IntentCommitOutcome => ({
    kind: "replay",
    seq,
    contentHash: "h-" + seq.toString(16),
  }),
};

export const SPAWN_FAILURES = {
  threw: (m = "spawn threw"): WitnessSpawnFailure => ({
    kind: "spawn_threw",
    message: m,
  }),
  error_event: (m = "enoent"): WitnessSpawnFailure => ({
    kind: "spawn_error_event",
    message: m,
  }),
  exited: (code: number | null = null): WitnessSpawnFailure => ({
    kind: "spawn_exited",
    code,
    signal: null,
  }),
};
