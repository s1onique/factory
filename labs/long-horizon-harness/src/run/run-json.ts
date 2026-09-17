/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Re-export of the Phase D hardened JSON trust boundary for use by
 * Phase E payload validation. Per E8 ("prefer reusing the hardened
 * Phase-D JSON machinery if its semantics are appropriate"),
 * Phase E does NOT introduce a parallel JSON implementation.
 *
 * The Phase D snapshotter (subject-json.ts) already implements:
 *   - inert owned deep-clone (callers cannot mutate captured storage)
 *   - rejection of Proxy / accessor / symbol / non-enumerable / sparse
 *     / exotic-prototype / cyclic / Date / Map / Set / BigInt inputs
 *   - defensive boundary that never invokes toString on the thrown
 *     value
 *
 * For Phase E payload snapshotting we re-use this machinery directly
 * via `snapshotJsonValue`. Callers wanting to lift an untrusted
 * payload into a typed Phase E payload MUST call snapshotJsonValue
 * first and then decode the snapshot into a typed envelope (see
 * run-decode.ts).
 *
 * This module is pure: no I/O.
 */

export {
  validateJsonValue,
  snapshotJsonValue,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type JsonValidation,
} from "../subject/subject-json.js";
