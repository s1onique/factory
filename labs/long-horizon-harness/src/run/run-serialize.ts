/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Canonical JSON serialization for the RunManifest and the
 * CommittedRunEvent envelope (E17).
 *
 * Doctrine:
 *
 *   - VERSIONED: every emitted envelope carries a schema_version.
 *   - DETERMINISTIC: the encoder emits fields in a stable order
 *     so two encloses of the same logical event round-trip to
 *     byte-equal bytes. (Phase E uses an explicit ordered
 *     builder; it does NOT rely on JSON.stringify key order.)
 *   - ROUND_TRIPPABLE: encoding an event and decoding the
 *     resulting bytes yields a structurally identical typed value.
 *   - NO SILENT FIELD DROPPING: every typed field is encoded.
 *   - NO UNKNOWN FIELD ACCEPTANCE: the decoder rejects unknown
 *     fields (closed-world).
 *
 * Phase E does NOT introduce a parallel JSON implementation; it
 * reuses the hardened Phase D snapshotter (snapshotJsonValue)
 * for any payload that may carry caller-controlled data, and
 * emits its own deterministic ordered JSON for the envelope and
 * manifest.
 *
 * This module is pure: no I/O.
 */

import type {
  CommittedRunEvent,
  RunManifest,
} from "./run-types.js";
import { RUN_EVENT_SCHEMA_VERSION, RUN_MANIFEST_SCHEMA_VERSION } from "./run-types.js";
import { snapshotJsonValue } from "./run-json.js";
import { encodeRunEvent } from "./run-serialize-payload.js";

/**
 * E-C10: this is the SINGLE authority for canonical event
 * content. It is consumed by:
 *
 *   - the store's idempotency / same-id-different-content check
 *   - the projector's same-id-different-content check
 *   - the default content-derived EventIdSource
 *   - the envelope encoder (encodeRunEventEnvelope)
 *   - the manifest encoder (encodeRunManifest)
 *
 * The encoder is recursively deterministic: nested objects are
 * sorted at every level. Two payloads that differ ONLY in
 * insertion order round-trip to byte-equal canonical bytes.
 *
 * The encoder rejects non-finite numbers and unsupported value
 * types at runtime.
 */
export function deterministicJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("deterministicJson: non-finite number encountered");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ",";
      out += deterministicJson(value[i]);
    }
    out += "]";
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    let out = "{";
    let first = true;
    for (const k of keys) {
      if (!first) out += ",";
      first = false;
      out += JSON.stringify(k);
      out += ":";
      out += deterministicJson(obj[k]);
    }
    out += "}";
    return out;
  }
  throw new Error(
    `deterministicJson: unsupported value type ${typeof value}`,
  );
}

/**
 * E-C15 / E-C10: single canonical-content authority for the
 * `RunEvent` payload. Every consumer in Phase E (the store's
 * idempotency check, the projector's same-id-different-content
 * check, the default content-derived EventIdSource, and any
 * future JSONL writer) MUST consume this function. Defining it
 * here (in the neutral pure encoder module, alongside
 * `deterministicJson`) prevents the cycle
 *
 *   run-events -> run-store -> run-projector -> run-events
 *
 * because `run-events` now depends only on `run-serialize` and
 * not on `run-store`. `run-store` re-exports this symbol for
 * backwards compatibility with the public barrel.
 */
export const canonicalEventBytes = deterministicJson;

// ---------------------------------------------------------------------------
// Public API: encode + decode envelope
// ---------------------------------------------------------------------------

/**
 * Encode a CommittedRunEvent envelope to a deterministic JSON
 * string. The string is intended for persistence (Phase E does
 * not yet wire fs).
 */
export function encodeRunEventEnvelope(event: CommittedRunEvent): string {
  const obj: Record<string, unknown> = {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: event.event_id,
    run_id: event.run_id,
    subject_id: event.subject_id,
    sequence: event.sequence,
    observed_at: event.observed_at,
    event: encodeRunEvent(event.event),
  };
  return deterministicJson(obj);
}

/**
 * Encode a RunManifest to a deterministic JSON string.
 */
export function encodeRunManifest(manifest: RunManifest): string {
  const obj: Record<string, unknown> = {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    run_protocol_version: manifest.run_protocol_version,
    runner_revision: manifest.runner_revision,
    started_by: manifest.started_by,
    created_at: manifest.created_at,
    repetition: manifest.repetition,
  };
  return deterministicJson(obj);
}

/**
 * Round-trip the envelope through snapshotJsonValue so the
 * caller can be sure no Proxy / accessor / exotic prototype
 * ever survives serialization. The decoder expects this kind
 * of inert input.
 */
export function snapshotRunEventEnvelope(
  raw: unknown,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string } {
  const r = snapshotJsonValue(raw);
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
}

/**
 * Encode an envelope and produce a deterministic JSON line
 * (single newline-terminated). This is the on-disk format
 * Phase E would emit for JSONL persistence. Phase E does NOT
 * yet own filesystem persistence; this helper is provided for
 * the eventual writer.
 */
export function encodeRunEventLine(event: CommittedRunEvent): string {
  return encodeRunEventEnvelope(event) + "\n";
}
