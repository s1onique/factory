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
 * reshaping). NEVER throws on hostile JavaScript input.
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
 *
 * Path-cycle semantics (D-M02):
 *
 *   `ancestors` is a RECURSION-STACK set: the object currently
 *   being traversed on the active call path. It is added on
 *   entry and removed on exit (try/finally). Acyclic shared
 *   substructure — `{ left: shared, right: shared }` — is
 *   accepted, because `shared` is on the stack only during
 *   the traversal of one branch and removed before the next.
 *   True recursive back-edges — `obj.self = obj` — are
 *   rejected, because `obj` is still on the stack when
 *   re-encountered.
 *
 * Proxy / hostile-input semantics (D-M01):
 *
 *   JavaScript Proxy traps can throw on `Object.keys`,
 *   `Object.getPrototypeOf`, or property access. To keep the
 *   `validateJsonValue(unknown): JsonValidation` contract
 *   literally true (NEVER throws), the entire body runs
 *   inside an outer try/catch that converts any escape into
 *   a typed `boundary_exception` reason.
 */
export function validateJsonValue(
  value: unknown,
  path: string = "$",
  ancestors: Set<object> = new Set<object>(),
): JsonValidation {
  try {
    return validateJsonValueInner(value, path, ancestors);
  } catch (e: unknown) {
    return {
      ok: false,
      reason:
        `${path}: boundary_exception during JsonValue validation: ` +
        (e instanceof Error ? e.message : String(e)),
    };
  }
}

function validateJsonValueInner(
  value: unknown,
  path: string,
  ancestors: Set<object>,
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

  const obj = value as object;

  // Cycle guard (D-M02): the object is on the CURRENT
  // recursion path iff ancestors has it. The set is
  // maintained as a stack — add on entry, delete on exit —
  // so acyclic shared substructure is accepted and only true
  // back-edges are rejected.
  if (ancestors.has(obj)) {
    return fail(`${path}: cyclic value is not a JsonValue`);
  }
  ancestors.add(obj);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const r = validateJsonValueInner(
          value[i],
          `${path}[${i}]`,
          ancestors,
        );
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
      const r = validateJsonValueInner(
        record[k],
        `${path}.${k}`,
        ancestors,
      );
      if (!r.ok) return r;
    }
    return ok(obj as { readonly [key: string]: JsonValue });
  } finally {
    ancestors.delete(obj);
  }
}
