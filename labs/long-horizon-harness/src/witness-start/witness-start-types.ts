/**
 * FOUNDATION04 — PHASE A — Witness pre-spawn durable-intent gate.
 *
 * Public types and ports for the witness start boundary. The
 * gate (witness-start-gate.ts) consumes these ports; the
 * production adapters (witness-start-spawn.ts and the
 * LedgerWriter evidence adapter) provide concrete
 * implementations.
 *
 * Doctrine:
 *   "Exactly one sequence-allocation authority may exist for
 *    the run."                                (B0-QUALIFICATION06)
 *
 * Phase A doctrine:
 *
 *   Intent-before-reality law:
 *     When an operation can create external reality, durable
 *     intent must be acknowledged before the creation syscall
 *     is permitted.
 *
 *   Identity-continuity law:
 *     The identity durably authorized before creation must be
 *     the same identity presented to the created authority
 *     carrier.
 *
 *   Pre-creation failure law:
 *     Failure to durably authorize creation means there is
 *     nothing to compensate; creation must simply not occur.
 *
 *   Durable-intent non-existence law:
 *     Durable intent proves authorization to create; it does
 *     not prove that creation actually happened.
 *
 * Crash points intentionally left unresolved (doctrine):
 *
 *   A1:  witness_start_requested durable
 *        CRASH
 *        before witness spawn
 *
 *        Recovery sees: intent exists, no proof witness exists.
 *        Phase A does NOT resolve this ambiguity. Recorded as
 *        input to the later witness-recovery phase.
 *
 *   A2:  spawn() succeeds in OS
 *        CRASH
 *        before witness readiness is durably observed
 *
 *        Also unresolved in Phase A. This is why later
 *        cryptographic witness authentication exists. PID/PGID
 *        are NOT sufficient recovery authority. FOUNDATION03
 *        doctrine remains unchanged.
 *
 * This module contains NO node: imports and no I/O. Pure types
 * + pure functions (commitId derivation, validation).
 */

import { createHash } from "node:crypto";

import type { AttemptId, MissionId, RunId } from "../domain/ids.js";
import { makeEventId } from "../domain/ids.js";
import type { ProcessId } from "../process/process-types.js";
import type { WitnessId, WitnessInstanceId } from "../witness/witness-types.js";
import { makeCommitId, type CommitId } from "../ledger-writer/ledger-writer-types.js";
import type { PersistedWitnessEvidence } from "../witness/witness-types-persisted.js";

/**
 * Identity allocated exactly once per witness-start attempt.
 *
 * Branded types are imported from existing domain modules; we
 * never cast raw strings here. IDENTITY_FACTORY_CALLS must be
 * 1 per startWitness() invocation.
 */
export type WitnessStartIdentity = {
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
};

/**
 * Specification supplied by the supervisor (or test). The
 * gate validates this BEFORE any identity allocation or
 * commit attempt (WS07).
 *
 * NOTE: this spec carries an *unsigned* set of identifiers.
 * Phase A does not authenticate them. Authentication is
 * Phase D.
 */
export type WitnessStartSpec = {
  readonly runDir: string;
  readonly controlDir: string;
  readonly suggestedWitnessId: WitnessId;
  readonly socketPath: string;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly protocolVersion: number;
  readonly bootstrapLeaseMs: number;
  readonly ledgerWriterSocketPath: string;
  /** Path to the witness entry script (TS source). */
  readonly witnessesEntry: string;
  /** TS loader name (tsx, ts-node, etc.). */
  readonly tsxLoader: string;
  /** Node executable. */
  readonly nodePath: string;
};

/**
 * Why a startWitness() call did not produce a started witness.
 *
 * The four shapes are mutually exclusive at the result level.
 */
export type WitnessStartFailure =
  | {
      readonly kind: "intent_persistence_failed";
      readonly cause: IntentPersistenceFailure;
    }
  | {
      readonly kind: "spawn_failed";
      readonly identity: WitnessStartIdentity;
      readonly cause: WitnessSpawnFailure;
    }
  | {
      readonly kind: "invalid_spec";
      readonly reason: string;
    }
  | {
      readonly kind: "unknown";
      readonly message: string;
    };

export type IntentPersistenceFailure =
  | { readonly kind: "writer_unavailable"; readonly socketPath: string }
  | { readonly kind: "writer_crashed"; readonly message: string }
  | { readonly kind: "invalid_envelope"; readonly reason: string }
  | { readonly kind: "conflicting_commit"; readonly message: string }
  | { readonly kind: "append_failed"; readonly message: string }
  | { readonly kind: "writer_rejected"; readonly reason: string }
  | { readonly kind: "transport_rejected"; readonly reason: string };

export type WitnessSpawnFailure =
  | { readonly kind: "spawn_threw"; readonly message: string }
  | { readonly kind: "spawn_error_event"; readonly message: string }
  | { readonly kind: "spawn_exited"; readonly code: number | null; readonly signal: NodeJS.Signals | null };

/**
 * What a successful startWitness() returns. Provides identity
 * continuity: the returned identity equals the committed
 * intent identity equals the spawned process identity.
 */
export type StartedWitness = {
  readonly identity: WitnessStartIdentity;
  readonly child: WitnessSpawnHandle;
};

/**
 * WitnessSpawnHandle abstracts over a spawned child. Tests
 * substitute a fake; production wraps node:child_process
 * ChildProcess.
 */
export type WitnessSpawnHandle = {
  readonly pid: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
};

/**
 * Result returned by the commit port.
 *
 *   "appended" : intent is durably committed at sequence N.
 *   "replay"   : the same commitId was already durably
 *                committed; sequence N is the original. Phase
 *                A treats replay and appended identically
 *                (WS05).
 */
export type IntentCommitOutcome =
  | { readonly kind: "appended"; readonly seq: number; readonly contentHash: string }
  | { readonly kind: "replay"; readonly seq: number; readonly contentHash: string };

export type IntentCommitResult =
  | { readonly ok: true; readonly outcome: IntentCommitOutcome }
  | { readonly ok: false; readonly failure: IntentPersistenceFailure };

/**
 * The pre-spawn commit port. Production binds this to the
 * existing appendWitnessEvidence adapter; tests bind it to a
 * fake that lets WS01..WS06 stage each outcome.
 *
 * P1#4 correction: the port carries an explicit eventId
 * parameter. The gate is the sole producer of valid
 * EventIds; the adapter MUST NOT manufacture them. The
 * eventId MUST satisfy IDENTIFIER_GRAMMAR.
 */
export interface WitnessIntentCommitPort {
  commit(args: {
    readonly binding: { readonly runDir: string; readonly socketPath: string };
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly observedAt: number;
    readonly commitId: string;
    readonly eventId: import("../domain/ids.js").EventId;
    readonly payload: Extract<
      PersistedWitnessEvidence,
      { readonly kind: "witness_start_requested" }
    >;
  }): Promise<IntentCommitResult>;
}

/**
 * The spawn port. Production adapter wraps node:child_process.
 * Tests count SPAWN_CALLS, observe the spec, and may inject
 * synthetic spawn failures (WS08) or successful spawns.
 *
 * ASYNC by contract (P1#2 / WS09): the Promise MUST NOT
 * resolve ok:true before the underlying Node `'spawn'`
 * event has fired. The Node documentation is explicit:
 *
 *   "The 'spawn' event is emitted once the child process
 *    has spawned successfully. If the child process does
 *    not spawn successfully, the 'error' event is emitted
 *    instead."
 *
 * Source: Node.js Child Process documentation. A returned
 * ChildProcess object is NOT proof of OS-level witness
 * creation. Only `'spawn'` is.
 *
 * Implementations MUST attach listeners synchronously
 * inside spawn() before returning the Promise, so no event
 * can be missed.
 */
export interface WitnessSpawnPort {
  spawn(spec: WitnessSpawnSpec): Promise<WitnessSpawnSpecResult>;
}

export type WitnessSpawnSpecResult =
  | { readonly ok: true; readonly handle: WitnessSpawnHandle }
  | { readonly ok: false; readonly failure: WitnessSpawnFailure };

export type WitnessSpawnSpec = {
  readonly runDir: string;
  readonly controlDir: string;
  readonly socketPath: string;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly attemptId: AttemptId;
  readonly processId: ProcessId;
  readonly witnessId: WitnessId;
  readonly witnessInstanceId: WitnessInstanceId;
  readonly protocolVersion: number;
  readonly bootstrapLeaseMs: number;
  readonly ledgerWriterSocketPath: string;
  readonly witnessesEntry: string;
  readonly tsxLoader: string;
  readonly nodePath: string;
};

/**
 * Identity factory. Production binds this to mint WitnessId
 * + WitnessInstanceId; tests wrap it to count
 * IDENTITY_FACTORY_CALLS (WS04).
 *
 * P1#1 correction: the factory MUST receive missionId.
 * Phase A's identity-continuity law requires the
 * committed missionId == spec.missionId == spawned
 * missionId == returned missionId, byte-for-byte. A
 * factory that silently substitutes runId for missionId
 * breaks that law invisibly.
 */
export interface WitnessIdentityFactory {
  allocate(args: {
    readonly runId: RunId;
    readonly missionId: MissionId;
    readonly attemptId: AttemptId;
    readonly processId: ProcessId;
    readonly suggestedWitnessId: WitnessId;
  }): WitnessStartIdentity;
}

/**
 * Result of validating a WitnessStartSpec. Failures here are
 * intent-write-free (WS07).
 */
export type WitnessSpecValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate a WitnessStartSpec. Pure function.
 */
export function validateWitnessStartSpec(
  spec: WitnessStartSpec,
): WitnessSpecValidation {
  const reasons: string[] = [];
  const req = (
    cond: boolean, msg: string,
  ): void => { if (!cond) reasons.push(msg); };

  req(typeof spec.runDir === "string" && spec.runDir.length > 0, "runDir required");
  req(typeof spec.controlDir === "string" && spec.controlDir.length > 0, "controlDir required");
  req(typeof spec.socketPath === "string" && spec.socketPath.length > 0, "socketPath required");
  req(typeof spec.ledgerWriterSocketPath === "string" && spec.ledgerWriterSocketPath.length > 0,
    "ledgerWriterSocketPath required (B0 freeze: writer binding is mandatory)");
  req(spec.runId.length > 0, "runId required");
  req(spec.missionId.length > 0, "missionId required");
  req(spec.attemptId.length > 0, "attemptId required");
  req(spec.processId.length > 0, "processId required");
  req(spec.suggestedWitnessId.length > 0, "suggestedWitnessId required");
  req(Number.isInteger(spec.protocolVersion) && spec.protocolVersion > 0,
    "protocolVersion must be a positive integer");
  req(Number.isInteger(spec.bootstrapLeaseMs) && spec.bootstrapLeaseMs > 0,
    "bootstrapLeaseMs must be a positive integer");
  req(typeof spec.witnessesEntry === "string" && spec.witnessesEntry.length > 0,
    "witnessesEntry required");
  req(typeof spec.tsxLoader === "string" && spec.tsxLoader.length > 0,
    "tsxLoader required");
  req(typeof spec.nodePath === "string" && spec.nodePath.length > 0,
    "nodePath required");

  if (reasons.length > 0) {
    return { ok: false, reason: reasons.join("; ") };
  }
  return { ok: true };
}

/**
 * Canonical CommitId for a witness-start intent.
 *
 *   commitId = "w-start:" + sha256(canonical-identity)
 *
 * Determinism is the contract: same seven-tuple -> same
 * commitId -> writer dedups -> WS11 holds.
 *
 * Why a domain-separated hash:
 *  - the identity tuple contains slash-bearing tokens and
 *    characters outside COMMIT_ID_GRAMMAR (^[A-Za-z0-9_.:-]{1,128}$).
 *    Embedding them directly would be rejected at the wire
 *    boundary by the frozen B0 validator (P1#5).
 *  - the FULL identity tuple is hashed so a regression that
 *    drops a field changes the CommitId (CID05).
 *  - missionId IS included — the writer's envelope records
 *    missionId, but the CommitId is the dedup key, and
 *    omitting missionId would let two different missions
 *    share a slot. (CORRECTION05: previous implementation
 *    left missionId out.)
 *
 * The namespace prefix "w-start:" is reserved for
 * witness-start intents. No other code path mints commitIds
 * in this namespace.
 *
 * Branded as `CommitId` so the grammar check runs at
 * construction time, not at the wire boundary (P1#5).
 */
export function computeWitnessStartCommitId(
  identity: WitnessStartIdentity,
): CommitId {
  return makeCommitId(
    "w-start:" +
      createHash("sha256")
        .update(WSTART_COMMIT_V1_TAG + "\u0000", "utf8")
        .update(
          [
            identity.runId,
            identity.missionId,
            identity.attemptId,
            identity.processId,
            identity.witnessId,
            identity.witnessInstanceId,
          ].join("\u0000"),
          "utf8",
        )
        .digest("hex"),
  );
}

/**
 * Domain tag for the witness-start CommitId hash input.
 *
 * WHY A DOMAIN TAG: two producers with the same canonical
 * bytes but different meanings must NEVER share a hash.
 * Without a tag, an EventId and a CommitId could collide.
 * The tag is the Factory rule:
 *   - "factory:witness-start:commit:v1"
 *   - "factory:witness-start:event:v1"
 * The colon-separated tag is human-readable and contains
 * only ASCII alphanumerics + ':' (grammar-safe).
 */
const WSTART_COMMIT_V1_TAG = "factory:witness-start:commit:v1";

/**
 * Derive a grammar-valid EventId for a witness_start_requested
 * intent.
 *
 *   eventId = "w-start-" + sha256(domain-tag || canonical-identity)
 *
 * Why a hash:
 *   - the canonical identity tuple contains slash-bearing
 *     tokens; embedding it directly would violate
 *     IDENTIFIER_GRAMMAR (no slashes allowed)
 *   - the previous implementation concatenated
 *     "w-start-" + commitId, which used `as never` to bypass
 *     the grammar check (P1#4). That was a type-system
 *     escape hatch, not a real conversion.
 *
 * Why a domain tag (CORRECTION05):
 *   - the EventId and the CommitId MUST NEVER collide even
 *     when derived from the same identity. Domain-separated
 *     input ensures distinct hashes.
 *
 * Why a NUL separator (CORRECTION05):
 *   - "a/b" + "c" and "a" + "b/c" use the same tokens but
 *     have different meanings. A NUL (0x00) separator
 *     eliminates field-collision ambiguity — NUL is illegal
 *     in identifier fields by construction.
 *
 * Why the full SHA-256 digest (64 hex chars):
 *   - deterministic from the identity
 *   - bounded (≤72 chars total: "w-start-" + 64 hex),
 *     comfortably under IDENTIFIER_GRAMMAR's 128-char cap
 *   - uses only ASCII alphanumerics + hyphen (grammar-clean)
 *   - 256 bits is meaningfully stronger than any prefix
 *     we could truncate to; identity uniqueness is not
 *     justified by truncating when we have the budget
 *
 * Note: EventId is informational. The writer's seq is the
 * authoritative ordering key. EventId uniqueness is for
 * observability only; same identity -> same EventId ->
 * writers and readers can dedup or cross-reference.
 */
export function makeEventIdFromIdentity(
  identity: WitnessStartIdentity,
): import("../domain/ids.js").EventId {
  const canonical = [
    identity.runId,
    identity.missionId,
    identity.attemptId,
    identity.processId,
    identity.witnessId,
    identity.witnessInstanceId,
  ].join("\u0000");
  const hex = createHash("sha256")
    .update(WSTART_EVENT_V1_TAG + "\u0000", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
  return makeEventId("w-start-" + hex);
}

const WSTART_EVENT_V1_TAG = "factory:witness-start:event:v1";
