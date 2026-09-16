/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * The JSON-value trust boundary.
 *
 * `model.configuration` is the only OPEN-WORLD substructure
 * of a SubjectManifest. Every other field is closed-world.
 * This module defines:
 *
 *   - the JsonValue type (a subset of `unknown` that
 *     canonicalize() can encode without loss or throwing)
 *   - a recursive validator that REJECTS every JavaScript
 *     value that canonicalize() would either throw on or
 *     silently reshape
 *
 * Why a separate module:
 *
 *   The decoder (subject-decode.ts) accepts `unknown`. Per
 *   doctrine it NEVER throws. canonicalize() throws on
 *   unsupported value types and on non-finite numbers. So if
 *   the decoder passes a raw `unknown` containing, say,
 *   `undefined` or `NaN` into computeSubjectId(), the decoder
 *   breaks its own contract.
 *
 *   The fix is a recursive JsonValue validator that runs at
 *   the trust boundary, BEFORE computeSubjectId. After it
 *   passes, canonicalize() is mechanically total over the
 *   remaining value.
 *
 * Design choices (doctrine):
 *
 *   - "JSON value" is defined as: null, boolean, finite number,
 *     string, array of JSON values, plain object of JSON values.
 *   - The validator REJECTS BigInt, Symbol, Function, Date, Map,
 *     Set, Promise, ArrayBuffer, TypedArray, RegExp, and any
 *     other exotic object — even if their `toJSON()` would
 *     round-trip. The reason is that RFC 8785 / JCS only
 *     accepts a closed set of shapes, and silent coercion is
 *     exactly the failure mode Phase D doctrine prohibits.
 *   - Cycles are rejected. Acyclic is enforced.
 *
 *   The validator NEVER throws. It returns a discriminated
 *   union so callers can present every problem at once.
 *
 * This module is pure: no I/O, no fs, no network.
 */

/**
 * The closed-world definition of a JSON value.
 *
 *   - JsonPrimitive : null | boolean | finite number | string
 *   - JsonValue     : JsonPrimitive | JsonArray | JsonObject
 *   - JsonArray     : readonly array of JsonValue
 *   - JsonObject    : plain object whose values are JsonValue
 *
 * The "finite number" constraint is enforced at runtime by
 * validateJsonValue; the type expresses the domain.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export type JsonValidation =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly reason: string };

function ok(value: JsonValue): JsonValidation {
  return { ok: true, value };
}

function fail(reason: string): JsonValidation {
  return { ok: false, reason };
}

/**
 * Recursively validate that `value` is a well-formed JsonValue
 * (i.e. encodeable by canonicalize without throwing or silent
 * reshaping). NEVER throws.
 *
 * On success returns `{ ok: true, value }` where `value` is the
 * SAME object reference as the input (no defensive copy is
 * made; the decoder is responsible for the closed-world
 * reshape and the deep-freeze step).
 *
 * On failure returns `{ ok: false, reason }` describing the
 * FIRST violation found. The validator short-circuits at the
 * first violation — JsonValue has no notion of "partial
 * validity".
 */
export function validateJsonValue(
  value: unknown,
  path: string = "$",
  seen: WeakSet<object> = new WeakSet(),
): JsonValidation {
  // null
  if (value === null) {
    return ok(null);
  }

  // primitive: boolean
  if (typeof value === "boolean") {
    return ok(value);
  }

  // primitive: number — must be finite
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail(`${path}: non-finite number is not a JsonValue`);
    }
    return ok(value);
  }

  // primitive: string
  if (typeof value === "string") {
    return ok(value);
  }

  // Anything else with `typeof === "object"` must be either
  // an array or a plain object. Everything else (Date, Map,
  // Set, Promise, ArrayBuffer, TypedArray, RegExp, custom
  // class instances, etc.) is rejected.
  if (typeof value !== "object") {
    return fail(
      `${path}: unsupported JSON-value type ${typeof value} ` +
        `(undefined, bigint, symbol, function)`,
    );
  }

  // Cycle guard. If we have already visited this exact object
  // along the current recursion path, the input is cyclic.
  const obj = value as object;
  if (seen.has(obj)) {
    return fail(`${path}: cyclic value is not a JsonValue`);
  }
  seen.add(obj);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = validateJsonValue(value[i], `${path}[${i}]`, seen);
      if (!r.ok) return r;
    }
    return ok(value as ReadonlyArray<JsonValue>);
  }

  // Reject non-plain objects (Date, Map, Set, Promise, ...).
  // The discriminator is the prototype: only Object.prototype
  // and null are accepted as "plain object".
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return fail(
      `${path}: non-plain object (proto=${proto?.constructor?.name ?? "null"}) is not a JsonValue`,
    );
  }

  // Recurse into each property.
  const record = obj as Record<string, unknown>;
  for (const k of Object.keys(record)) {
    const r = validateJsonValue(record[k], `${path}.${k}`, seen);
    if (!r.ok) return r;
  }
  return ok(obj as { readonly [key: string]: JsonValue });
}
