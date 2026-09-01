/**
 * FOUNDATION04 — PHASE A — Witness pre-spawn durable-intent gate.
 *
 * Composes validate -> allocate -> commit -> spawn -> return.
 * The mechanical ordering is the load-bearing property.
 *
 * Internal ordering is explicit (no Promise.race tricks):
 *   1. validate(spec)             pure; failures short-circuit
 *   2. allocate(identityFactory)  exactly once
 *   3. await commit(...)          durable ACK or reject
 *   4. spawn(...)                 only after ACK
 *   5. return { identity, child }
 *
 * Published surface: startWitness only. Everything else is
 * private. There is no separate "evidence-enabled spawner"
 * type because there is only one kind of spawn: the one
 * gated by intent.
 */

import {
  appendWitnessEvidence,
  type WitnessLedgerBinding,
  type WitnessLedgerError,
  type WitnessLedgerResult,
} from "../witness/witness-ledger.js";
import { makeWitnessInstanceId } from "../witness/witness-types.js";
import type {
  StartedWitness,
  WitnessIdentityFactory,
  WitnessIntentCommitPort,
  WitnessSpawnPort,
  WitnessSpecValidation,
  WitnessSpawnSpecResult,
  WitnessStartFailure,
  WitnessStartIdentity,
  WitnessStartSpec,
  IntentCommitOutcome,
  IntentCommitResult,
  IntentPersistenceFailure,
} from "./witness-start-types.js";
import {
  computeWitnessStartCommitId,
  makeEventIdFromIdentity,
  validateWitnessStartSpec,
} from "./witness-start-types.js";

/**
 * Production commit port: thin adapter over
 * appendWitnessEvidence.
 *
 * P1#4 correction: the adapter accepts an explicit
 * eventId from the gate (already grammar-valid) and
 * passes it through. It does NOT manufacture an eventId
 * itself. The previous "w-start-" + commitId cast was a
 * type-system escape hatch producing an invalid EventId
 * (slashes embedded).
 */
function appendWitnessEvidencePort(): WitnessIntentCommitPort {
  return {
    async commit(args): Promise<IntentCommitResult> {
      const r: WitnessLedgerResult<{
        readonly seq: number;
        readonly contentHash: string;
      }> = await appendWitnessEvidence({
        binding: args.binding as WitnessLedgerBinding,
        runId: args.runId,
        missionId: args.missionId,
        eventId: args.eventId,
        observedAt: args.observedAt,
        commitId: args.commitId,
        payload: args.payload,
      });
      if (!r.ok) {
        return { ok: false, failure: mapLedgerError(r.error) };
      }
      const outcome: IntentCommitOutcome = {
        kind: "appended",
        seq: r.value.seq,
        contentHash: r.value.contentHash,
      };
      return { ok: true, outcome };
    },
  };
}

function mapLedgerError(e: WitnessLedgerError): IntentPersistenceFailure {
  switch (e.kind) {
    case "writer_unavailable":
      return { kind: "writer_unavailable", socketPath: e.socketPath };
    case "writer_crashed":
      return { kind: "writer_crashed", message: e.message };
    case "invalid_envelope":
      return { kind: "invalid_envelope", reason: e.reason };
    case "conflicting_commit":
      return { kind: "conflicting_commit", message: e.message };
    case "append_failed":
      return { kind: "append_failed", message: e.message };
    case "writer_rejected":
      return { kind: "writer_rejected", reason: e.reason };
  }
}

/**
 * Production identity factory: mints a fresh
 * WitnessInstanceId. The WitnessId is taken from the spec.
 * IDENTITY_FACTORY_CALLS is 1 per WS04.
 *
 * P1#1 correction: missionId MUST come from args.missionId,
 * not from any other field. The previous version silently
 * substituted args.runId, corrupting missionId continuity.
 */
function defaultIdentityFactory(): WitnessIdentityFactory {
  return {
    allocate(args): WitnessStartIdentity {
      const rand = Date.now().toString(36) + "-" +
        Math.floor(Math.random() * 1e9).toString(36);
      const witnessInstanceId = makeWitnessInstanceId(
        "wi-" + args.runId + "-" + args.attemptId + "-" +
          args.processId + "-" + args.suggestedWitnessId + "-" + rand,
      );
      return {
        runId: args.runId,
        missionId: args.missionId,
        attemptId: args.attemptId,
        processId: args.processId,
        witnessId: args.suggestedWitnessId,
        witnessInstanceId,
      };
    },
  };
}

/**
 * The dependency ports for the gate.
 */
export type WitnessStartPorts = {
  readonly commit: WitnessIntentCommitPort;
  readonly spawn: WitnessSpawnPort;
  readonly identity: WitnessIdentityFactory;
  readonly observedAt: () => number;
};

/**
 * The single public function.
 *
 * Critical contract (the entire reason Phase A exists):
 *   - ok:true implies the durable intent for that identity
 *     was acknowledged before spawn was called.
 *   - intent_persistence_failed: no spawn occurred.
 *   - spawn_failed: intent durably present; future phase
 *     drives recovery from it.
 */
export async function startWitness(
  spec: WitnessStartSpec,
  ports: Partial<WitnessStartPorts> = {},
): Promise<
  | { readonly ok: true; readonly value: StartedWitness }
  | { readonly ok: false; readonly failure: WitnessStartFailure }
> {
  const commit = ports.commit ?? appendWitnessEvidencePort();
  const spawnPort = ports.spawn;
  const identity = ports.identity ?? defaultIdentityFactory();
  const now = ports.observedAt ?? ((): number => Date.now());

  // 1. Validate spec. No identity allocation on failure (WS07).
  const v: WitnessSpecValidation = validateWitnessStartSpec(spec);
  if (!v.ok) {
    return {
      ok: false,
      failure: { kind: "invalid_spec", reason: v.reason },
    };
  }

  // 2. Allocate identity exactly once (WS04). The factory
  //    receives missionId explicitly; production must not
  //    substitute any other field for it (P1#1).
  const startIdentity: WitnessStartIdentity = identity.allocate({
    runId: spec.runId,
    missionId: spec.missionId,
    attemptId: spec.attemptId,
    processId: spec.processId,
    suggestedWitnessId: spec.suggestedWitnessId,
  });

  // 3. Compose intent and commit it. Awaiting here is the
  //    load-bearing line: spawn cannot begin until the
  //    writer has fsynced the intent.
  const commitId = computeWitnessStartCommitId(startIdentity);
  const payload = {
    kind: "witness_start_requested" as const,
    witness_id: startIdentity.witnessId,
    witness_instance_id: startIdentity.witnessInstanceId,
  };
  // P1#4: the EventId must satisfy the project's
  // IDENTIFIER_GRAMMAR (^[A-Za-z0-9_.:-]{1,128}$). It MUST
  // NOT embed the slash-bearing commitId; the cast
  // `as never` used to bypass this was a type-system
  // escape hatch, not a real conversion. We derive a
  // bounded, slash-free, deterministic EventId from the
  // identity via sha256.
  const eventId = makeEventIdFromIdentity(startIdentity);
  const commitResult: IntentCommitResult = await (async (): Promise<IntentCommitResult> => {
    try {
      return await commit.commit({
        binding: {
          runDir: spec.runDir,
          socketPath: spec.ledgerWriterSocketPath,
        },
        runId: startIdentity.runId,
        missionId: startIdentity.missionId,
        observedAt: now(),
        commitId,
        eventId,
        payload,
      });
    } catch (e: unknown) {
      // WS03: a Promise rejection from the commit port is
      // a transport-level failure, distinct from a
      // domain-level ok:false. Surface it as
      // transport_rejected so the caller can tell them
      // apart.
      const reason = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        failure: { kind: "transport_rejected", reason },
      };
    }
  })();
  if (!commitResult.ok) {
    return {
      ok: false,
      failure: {
        kind: "intent_persistence_failed",
        cause: commitResult.failure,
      },
    };
  }

  // 4. Spawn. Only reached after durable ACK.
  //
  // P1#2 correction: the spawn port is ASYNC. Its Promise
  // must not resolve ok:true before Node's `'spawn'` event
  // has fired (WS09 / WS09a). This is what gives the
  // algebra a real meaning: ok:true is now "OS witness
  // creation observed" (Node semantics), not "Node
  // returned a ChildProcess object."
  if (spawnPort === undefined) {
    return {
      ok: false,
      failure: {
        kind: "unknown",
        message: "spawn port not provided; startWitness requires explicit spawn wiring",
      },
    };
  }
  // Try/catch around the await to surface a synchronous
  // throw from the spawn port (rare but possible if the
  // port adapter is malformed) as a typed failure.
  let spawnResult: WitnessSpawnSpecResult;
  try {
    spawnResult = await spawnPort.spawn({
      runDir: spec.runDir,
      controlDir: spec.controlDir,
      socketPath: spec.socketPath,
      runId: startIdentity.runId,
      missionId: startIdentity.missionId,
      attemptId: startIdentity.attemptId,
      processId: startIdentity.processId,
      witnessId: startIdentity.witnessId,
      witnessInstanceId: startIdentity.witnessInstanceId,
      protocolVersion: spec.protocolVersion,
      bootstrapLeaseMs: spec.bootstrapLeaseMs,
      ledgerWriterSocketPath: spec.ledgerWriterSocketPath,
      witnessesEntry: spec.witnessesEntry,
      tsxLoader: spec.tsxLoader,
      nodePath: spec.nodePath,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      failure: {
        kind: "spawn_failed",
        identity: startIdentity,
        cause: { kind: "spawn_threw", message: msg },
      },
    };
  }
  if (!spawnResult.ok) {
    return {
      ok: false,
      failure: {
        kind: "spawn_failed",
        identity: startIdentity,
        cause: spawnResult.failure,
      },
    };
  }

  // 5. Return.
  return {
    ok: true,
    value: {
      identity: startIdentity,
      child: spawnResult.handle,
    },
  };
}

/**
 * Convenience constructor for production wiring.
 */
export function makeProductionWitnessStart(): (
  spec: WitnessStartSpec,
) => Promise<
  | { readonly ok: true; readonly value: StartedWitness }
  | { readonly ok: false; readonly failure: WitnessStartFailure }
> {
  let cached: WitnessStartPorts | null = null;
  return async (spec: WitnessStartSpec) => {
    if (cached === null) {
      const { nodeSpawnWitnessPort } = await import(
        "./witness-start-spawn.js"
      );
      cached = {
        commit: appendWitnessEvidencePort(),
        spawn: nodeSpawnWitnessPort(),
        identity: defaultIdentityFactory(),
        observedAt: (): number => Date.now(),
      };
    }
    return startWitness(spec, cached);
  };
}
