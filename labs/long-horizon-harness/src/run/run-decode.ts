/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Shared trust-boundary types and helpers used by run-decode-manifest.ts
 * and run-decode-envelope.ts.
 *
 * Doctrine (E8, E15):
 *
 *   decoders NEVER throw. They return a discriminated union:
 *     { ok: true,  value: T }   |   { ok: false, failure: ... }
 *
 *   Defense in depth:
 *     - All Reflect/Object operations run inside an outer try/catch.
 *     - The catch NEVER inspects the thrown value via `instanceof Error`
 *       or `String(e)` — both can themselves throw on hostile Proxies.
 *     - The catch returns a constant opaque reason.
 *
 * Doctrine (E13):
 *
 *   Identity binding. The decoder re-derives the RunId from the
 *   declared manifest content and verifies it matches the supplied
 *   run_id field. A mismatch is rejected as `identity_mismatch`.
 *
 * Doctrine (E10):
 *
 *   Same event_id + same content is accepted idempotently. Same
 *   event_id + different content is rejected as
 *   `event_identity_mismatch`.
 *
 * Doctrine (E17):
 *
 *   Each persisted envelope MUST contain exactly the closed-world
 *   key set. Unknown keys fail closed.
 *
 * This module is pure: no I/O.
 */

import { snapshotJsonValue } from "./run-json.js";

// ---------------------------------------------------------------------------
// Shared failure shape
// ---------------------------------------------------------------------------

export type RunDecodeFailure =
  | { readonly kind: "not_an_object"; readonly reason: string }
  | { readonly kind: "schema_validation"; readonly reason: string }
  | { readonly kind: "unknown_field"; readonly field: string }
  | { readonly kind: "identity_mismatch"; readonly field: string; readonly reason: string }
  | { readonly kind: "boundary_exception"; readonly reason: string }
  | { readonly kind: "event_identity_mismatch"; readonly reason: string }
  | { readonly kind: "unsupported_schema_version"; readonly version: string };

export type RunDecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: RunDecodeFailure };

export function fail<T>(failure: RunDecodeFailure): RunDecodeResult<T> {
  return { ok: false, failure };
}
export function pass<T>(value: T): RunDecodeResult<T> {
  return { ok: true, value };
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  reasons: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const k of Object.keys(obj)) {
    if (!allowedSet.has(k)) {
      reasons.push(`unknown field '${k}'`);
    }
  }
}

/**
 * Re-export snapshotJsonValue so decoder modules have a single
 * import boundary. Per E8, Phase E reuses the hardened Phase D
 * JSON snapshotter.
 */
export { snapshotJsonValue };
