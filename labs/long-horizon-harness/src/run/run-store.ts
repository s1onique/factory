/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Append-only in-memory event store (E9, E10). Pure: no fs,
 * no network. Exposes ONLY append + readRun + the internal
 * projector helper — no mutation API (E9 doctrine).
 *
 * Invariants enforced by `append`:
 *
 *   E-C01  committed graph is OWNED + deeply frozen.
 *   E-C05  idempotent on (event_id, content); rejects on
 *          (event_id, different content).
 *   E-C12  no semantic observation of the raw caller graph
 *          happens before the snapshot+decode boundary.
 *   E-C13  unknown own keys are rejected by the closed-world
 *          decode before any commit.
 *
 * Production persistence is deferred to a later ACT.
 */

import { createHash } from "node:crypto";

import type {
  CommittedRunEvent,
  RunEvent,
  RunEventId,
  RunId,
  RunManifest,
} from "./run-types.js";
import { RUN_EVENT_SCHEMA_VERSION, makeRunEventId } from "./run-types.js";
import { snapshotJsonValue } from "./run-json.js";
import { canonicalEventBytes } from "./run-serialize.js";
import { projectRun } from "./run-projector.js";
import { decodeRunEventPayload } from "./run-decode-payload.js";
import type { ProjectionResult } from "./run-types.js";

/**
 * Failure shapes for the append API.
 */
export type StoreFailure =
  | { readonly kind: "identity_mismatch"; readonly field: string; readonly reason: string }
  | { readonly kind: "duplicate_event_id_with_changed_content"; readonly reason: string }
  | { readonly kind: "hostile_payload"; readonly stage: "snapshot" | "decode"; readonly reason: string }
  | { readonly kind: "boundary_exception"; readonly reason: string };

export type StoreResult =
  | { readonly ok: true; readonly value: CommittedRunEvent }
  | { readonly ok: false; readonly failure: StoreFailure };

/**
 * Opaque clock. The store does not consult wall-clock directly;
 * the caller passes the observed_at value. This keeps the store
 * pure (and testable).
 */
export type Clock = { readonly nowMs: () => number };

/**
 * Opaque event-id factory. The store does NOT generate event_ids
 * implicitly; the caller supplies them. (This matches the E10
 * content-bound identity model: the id is a function of content.)
 */
export type EventIdSource = {
  readonly next: (
    runId: RunId,
    event: RunEvent,
    sequence: number,
  ) => RunEventId;
};

/**
 * Default event-id source: a content-derived id (sha-256 of the
 * canonical bytes of the event + run_id + sequence). E-C10: the
 * canonical encoder is the same one used by the store and
 * projector — there is exactly ONE canonical encoder in Phase E.
 */
export function makeContentBoundEventIdSource(): EventIdSource {
  return {
    next: (
      runId: RunId,
      event: RunEvent,
      sequence: number,
    ): RunEventId => {
      const canonical = canonicalEventBytes(event);
      const material =
        `factory:phase-e:event:id:v1\u0000` +
        `run:${runId}|seq=${sequence}|` +
        canonical;
      const hex = createHash("sha256")
        .update(material, "utf8")
        .digest("hex");
      return makeRunEventId("evt:" + hex);
    },
  };
}

/**
 * Per-run append-only ledger.
 *
 * E-C05: idempotency is tracked via `seenCommits`, a Map from
 * event_id to the canonical CommittedRunEvent. A retry with
 * identical content returns the original CommittedRunEvent
 * (not a reallocated copy) so callers can compare object
 * identity, not just byte equality.
 */
export type RunLedger = {
  readonly runId: RunId;
  readonly events: ReadonlyArray<CommittedRunEvent>;
  readonly seenCommits: Map<string, CommittedRunEvent>;
};

function emptyLedger(runId: RunId): RunLedger {
  return {
    runId,
    events: Object.freeze([]) as ReadonlyArray<CommittedRunEvent>,
    seenCommits: new Map<string, CommittedRunEvent>(),
  };
}

/**
 * Re-export of the SINGLE canonical-content authority for
 * `RunEvent` (defined in `run-serialize.ts`). E-C10: there is
 * exactly one encoder. E-C15: inside `src/run/` consumers must
 * import it from `run-serialize.ts` directly; this re-export
 * exists for the public barrel.
 */
export { canonicalEventBytes };

/**
 * E-C12 + E-C13 — hardened ownership + closed-world gate.
 *
 * Two steps in strict order, BOTH must succeed before commit:
 *
 *   (a) snapshot the caller input through the Phase D
 *       snapshotter. The snapshotter may fire `Reflect.ownKeys`
 *       and `getOwnPropertyDescriptor` traps as part of the
 *       defensive structural boundary; the result is validated
 *       and found non-extensible / non-plain, so Proxy inputs
 *       are rejected before any property GET, accessor
 *       execution, canonicalization, EventId generation, or
 *       idempotency-content lookup can observe the raw caller
 *       graph.
 *   (b) closed-world RunEvent decode on the snapshot. Rejects
 *       unknown own keys (e.g. an extra `__proto__` field on
 *       ACTION_STARTED) before any commit.
 *
 * The returned RunEvent is deeply frozen + typed + closed-
 * world-validated. The caller retains zero references into it.
 * On failure we surface a typed `StoreFailure` (never throw).
 *
 * Phase-D D-M04 (precise, not overclaimed):
 *   NO [[Get]] / accessor / canonicalization / EventId /
 *   idempotency-content lookup BEFORE ownership.
 *   `ownKeys` + `getOwnPropertyDescriptor` traps MAY fire as
 *   bounded, fail-closed structural probes.
 */
function snapshotDecodeOwnedRunEvent(
  event: RunEvent,
):
  | { readonly ok: true; readonly value: RunEvent }
  | { readonly ok: false; readonly failure: StoreFailure } {
  // (a) Snapshot first.
  const r = snapshotJsonValue(event);
  if (!r.ok) {
    return {
      ok: false,
      failure: { kind: "hostile_payload", stage: "snapshot", reason: r.reason },
    };
  }
  // (b) Closed-world decode on the snapshot. Unknown own keys
  // are rejected here. The snapshotter may produce null-
  // prototype records; the decoder accepts them per Phase D.
  const decode = decodeRunEventPayload(r.value);
  if (!decode.ok) {
    return {
      ok: false,
      failure: {
        kind: "hostile_payload",
        stage: "decode",
        reason: decodeFailureReason(decode.failure),
      },
    };
  }
  return { ok: true, value: deepFreeze(decode.value) };
}

function decodeFailureReason(f: {
  readonly kind: string;
  readonly reason?: string;
  readonly field?: string;
  readonly version?: string;
}): string {
  if (f.kind === "unknown_field") return `unknown_field '${f.field}'`;
  if (f.kind === "unsupported_schema_version")
    return `unsupported_schema_version '${f.version}'`;
  return f.reason ?? `decode failure kind='${f.kind}'`;
}

function snapshotCommittedEnvelope(env: CommittedRunEvent): CommittedRunEvent {
  return deepFreeze(env);
}

/**
 * Recursively freeze a value. Operates only on plain objects
 * and arrays; primitives pass through. Combined with the
 * snapshotter it produces an owned, immutable graph that the
 * caller cannot mutate, in either strict or sloppy mode.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const k of Object.keys(value as Record<string, unknown>)) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }
  return value;
}

/**
 * Append-only in-memory store. There is exactly ONE append path
 * and ONE read path per run.
 */
export class InMemoryRunStore {
  private readonly ledgers: Map<string, RunLedger> = new Map();
  private readonly clock: Clock;
  private readonly eventIdSource: EventIdSource;

  constructor(clock: Clock, eventIdSource: EventIdSource) {
    this.clock = clock;
    this.eventIdSource = eventIdSource;
  }

  /**
   * Initialize a run ledger. Idempotent: re-initializing with
   * the same runId does NOT clobber existing events. A future
   * persistence layer may tighten this; for now the in-memory
   * store is permissive so tests can re-seed without ceremony.
   */
  init(manifest: RunManifest): void {
    if (!this.ledgers.has(manifest.run_id)) {
      this.ledgers.set(manifest.run_id, emptyLedger(manifest.run_id));
    }
  }

  /**
   * Append an event to a run. The store allocates the next
   * sequence number, stamps observed_at, and commits the entire
   * event atomically. Idempotent on (event_id, content); rejects
   * on (event_id, different content).
   *
   * Invariants:
   *
   *   E-C01  committed graph is OWNED + deeply frozen.
   *   E-C05  idempotency returns the ORIGINAL committed event
   *          on a retry; ledger length and sequence unchanged.
   *   E-C12  no semantic observation of the raw caller graph
   *          happens before the snapshot+decode boundary. The
   *          canonical-bytes hash, the EventIdSource, and the
   *          idempotency lookup MUST consume the OWNED typed
   *          event — never the raw caller input.
   *   E-C13  the snapshot is followed by a closed-world RunEvent
   *          decode so unknown own keys (e.g. an injected
   *          `__proto__` field on ACTION_STARTED) are rejected
   *          before any commit. After this gate the canonical
   *          bytes authority computes its fingerprint of a
   *          closed-world-validated event so COMMITTED ↔ ENCODE
   *          round-trips without content drift.
   */
  append(
    manifest: RunManifest,
    event: RunEvent,
    explicitId?: RunEventId,
  ): StoreResult {
    try {
      if (!this.ledgers.has(manifest.run_id)) {
        this.ledgers.set(manifest.run_id, emptyLedger(manifest.run_id));
      }
      const ledger = this.ledgers.get(manifest.run_id);
      if (ledger === undefined) {
        return {
          ok: false,
          failure: {
            kind: "boundary_exception",
            reason: "ledger map returned undefined after init",
          },
        };
      }

      // -----------------------------------------------------------------
      // E-C12 + E-C13 — hardened ownership + closed-world gate FIRST.
      // -----------------------------------------------------------------
      // From this point on we MUST NOT touch the raw caller input. The
      // `ownedEvent` is a snapshotter-built, null-prototype, deeply-
      // frozen, closed-world-typed RunEvent. Every downstream consumer
      // (canonicalization, EventIdSource, idempotency) consumes ONLY
      // `ownedEvent`.
      const decodeResult = snapshotDecodeOwnedRunEvent(event);
      if (!decodeResult.ok) {
        return { ok: false, failure: decodeResult.failure };
      }
      const ownedEvent: RunEvent = decodeResult.value;

      const sequence = ledger.events.length + 1;
      // Default EventIdSource consumes the OWNED typed event, never
      // the raw caller graph (E-C12).
      const eventId =
        explicitId ??
        this.eventIdSource.next(manifest.run_id, ownedEvent, sequence);
      const bytes = canonicalEventBytes(ownedEvent);

      // E-C05: idempotency lookup by event_id → committed event.
      // Compare on the canonical bytes of the OWNED events on both
      // sides; the original committed event is itself an owned typed
      // value, so this is a fair comparison.
      const existing = ledger.seenCommits.get(eventId);
      if (existing !== undefined) {
        const existingBytes = canonicalEventBytes(existing.event);
        if (existingBytes !== bytes) {
          return {
            ok: false,
            failure: {
              kind: "duplicate_event_id_with_changed_content",
              reason:
                `event_id '${eventId}' already seen with different content`,
            },
          };
        }
        // Identical retry: return the ORIGINAL committed event;
        // ledger length and sequence are unchanged.
        return { ok: true, value: existing };
      }

      // E-C01: own the committed graph. The typed envelope is built
      // from the already-owned `ownedEvent` so the caller retains
      // zero references into the committed graph.
      const committed: CommittedRunEvent = snapshotCommittedEnvelope({
        schema_version: RUN_EVENT_SCHEMA_VERSION,
        event_id: eventId,
        run_id: manifest.run_id,
        subject_id: manifest.subject_id,
        sequence,
        event: ownedEvent,
        observed_at: this.clock.nowMs(),
      });
      const nextEvents: ReadonlyArray<CommittedRunEvent> = Object.freeze(
        [...ledger.events, committed],
      ) as ReadonlyArray<CommittedRunEvent>;
      const nextCommits = new Map(ledger.seenCommits);
      nextCommits.set(eventId, committed);
      this.ledgers.set(manifest.run_id, {
        runId: ledger.runId,
        events: nextEvents,
        seenCommits: nextCommits,
      });
      return { ok: true, value: committed };
    } catch {
      return {
        ok: false,
        failure: {
          kind: "boundary_exception",
          reason: "boundary_exception during append: opaque thrown value",
        },
      };
    }
  }

  /**
   * Read all committed events for a run, in order.
   */
  readRun(runId: RunId): ReadonlyArray<CommittedRunEvent> {
    const ledger = this.ledgers.get(runId);
    if (ledger === undefined) return [];
    return ledger.events;
  }

  /**
   * Project a run using the canonical projector (E12). The
   * projector is the single authority for state derivation; the
   * store does NOT maintain a parallel live projection.
   */
  project(manifest: RunManifest): ProjectionResult {
    return projectRun(manifest, this.readRun(manifest.run_id));
  }
}

/**
 * Convenience constructor: build a store with a content-bound
 * event-id source and a caller-supplied clock.
 */
export function makeInMemoryRunStore(
  clock: Clock,
  eventIdSource: EventIdSource = makeContentBoundEventIdSource(),
): InMemoryRunStore {
  return new InMemoryRunStore(clock, eventIdSource);
}
