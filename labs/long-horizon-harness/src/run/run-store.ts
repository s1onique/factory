/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Append-only in-memory event store abstraction (E9, E10).
 *
 * Phase E establishes the contract; production persistence is
 * deferred to a later ACT. The in-memory store:
 *
 *   - exposes append(event) and readRun(runId)
 *   - rejects any mutation API beyond append + read
 *   - commits whole events or nothing (atomicity at the event
 *     boundary)
 *   - owns sequence allocation per run
 *   - never rejects an event for an idempotent (event_id, content)
 *     pair; rejects same event_id + different content
 *
 * Doctrine (E9):
 *
 *   "No mutation API: updateEvent, replaceEvent, deleteEvent,
 *    setRunStatus ... unless explicitly required for test
 *    infrastructure and impossible to expose through the domain
 *    API."
 *
 *   The store therefore exposes ONLY append + readRun + the
 *   internal projector helper. There is no way to mutate
 *   evidence once appended.
 *
 * This module is pure (in-memory; no fs, no network).
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
import { deterministicJson } from "./run-serialize.js";
import { projectRun } from "./run-projector.js";
import type { ProjectionResult } from "./run-types.js";

/**
 * Failure shapes for the append API.
 */
export type StoreFailure =
  | { readonly kind: "identity_mismatch"; readonly field: string; readonly reason: string }
  | { readonly kind: "duplicate_event_id_with_changed_content"; readonly reason: string }
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
 * canonical bytes of the event + run_id + sequence). This makes
 * the event-id deterministic given the inputs.
 *
 * E-C10: the canonical bytes authority is the SAME
 * `deterministicJson` encoder the store and projector use to
 * compare two events with the same id. There is exactly ONE
 * canonical encoder in Phase E; the default EventIdSource
 * consumes it.
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
 * Canonical bytes for the inner RunEvent payload. Used as the
 * stable identity key for E10 same-id/different-content
 * detection.
 *
 * Per E-C06 the doctrine is EVENT_ID_STABLE +
 * SAME_ID_DIFFERENT_CONTENT_FAILS_CLOSED; the event-id itself
 * is a stable opaque token supplied by the caller (or the
 * default content-derived factory). This helper produces the
 * canonical form used to compare two events with the same id.
 *
 * Per E-C10, this is the SINGLE authority for canonical event
 * content. It is reused by:
 *   - the store's idempotency / same-id-different-content check
 *   - the projector's same-id-different-content check
 *   - the default content-derived EventIdSource
 *   - any future JSONL writer
 *
 * The encoder recurses into nested objects and arrays, sorting
 * object keys at every level. Two payloads that differ ONLY in
 * insertion order round-trip to byte-equal canonical bytes.
 */
export const canonicalEventBytes: (event: RunEvent) => string =
  deterministicJson;

/**
 * E-C09: ownership capture reuses the hardened Phase D
 * snapshotter (`snapshotJsonValue`). The snapshotter:
 *   - rejects Proxy / accessor / cyclic / exotic inputs
 *   - preserves `__proto__` as data via null-prototype output
 *     (D-M10)
 *   - rejects symbol / non-enumerable / undefined / BigInt
 *   - does NOT invoke any Reflect / Object method that can be
 *     trapped by caller-controlled Proxy getters
 *   - returns a frozen inert owned graph (Phase D behaviour)
 *
 * After snapshotting, the owned value is recursively frozen so
 * the caller cannot mutate it via the committed envelope
 * either. (snapshotJsonValue already freezes the top level;
 * nested levels are frozen by snapshotArrayHardened /
 * snapshotJsonValueInner; we add deepFreeze as defense in
 * depth for the resulting typed RunEvent shape.)
 */
function snapshotRunEvent(event: RunEvent): RunEvent {
  const r = snapshotJsonValue(event);
  if (!r.ok) {
    throw new Error(
      `append: hostile RunEvent rejected by snapshot boundary: ${r.reason}`,
    );
  }
  return deepFreeze(r.value as unknown as RunEvent);
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
   * E-C01: the committed graph is OWNED. The caller retains
   * zero references into the committed envelope — neither the
   * outer CommittedRunEvent nor any nested RunEvent field. The
   * committed value is deeply frozen so that:
   *
   *   - subsequent caller mutation of the input RunEvent does
   *     not mutate stored evidence;
   *   - in `strict` mode the runtime would throw, in non-strict
   *     mode the mutation is silently dropped by Object.freeze;
   *   - in both cases the stored bytes are unchanged.
   *
   * E-C05: idempotency lookup uses event_id -> committed event
   * (not just bytes). A repeated identical retry returns the
   * ORIGINAL committed event object; the ledger length and
   * sequence are unchanged.
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
      const sequence = ledger.events.length + 1;
      const eventId =
        explicitId ??
        this.eventIdSource.next(manifest.run_id, event, sequence);
      const bytes = canonicalEventBytes(event);

      // E-C05: idempotency lookup by event_id → committed event.
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

      // E-C01 + E-C09: own the committed graph via the
      // hardened Phase D snapshotter, then deeply freeze the
      // typed envelope. The caller can mutate its own `event`
      // reference after append returns without affecting
      // stored evidence.
      const ownedEvent = snapshotRunEvent(event);
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
