/**
 * FOUNDATION04 - PHASE D - Experiment Subject Contract.
 *
 * The JSON-value trust boundary.
 *
 * `model.configuration` is the only OPEN-WORLD substructure
 * of a SubjectManifest. Every other field is closed-world.
 * This module defines:
 *
 *   - the JsonValue type (a subset of `unknown` that
 *     canonicalize() can encode without loss or throwing)
 *   - `snapshotJsonValue`, which BOTH validates AND produces
 *     an INERT OWNED deep-clone - a freshly-allocated
 *     primitive/array/plain-object tree built from the
 *     caller-controlled input but containing NO references
 *     back to it.
 *
 * Why "snapshot, don't bless" (D-M05):
 *
 *   A trust boundary that returns the caller's live object
 *   graph - even after validating it - is still leaking
 *   storage. The caller can mutate the object after we
 *   returned it; a getter can change its returned value
 *   between two reads; a Proxy can rearrange its keys.
 *   None of those is a "validation bug" in the classical
 *   sense, but ALL of them violate the Phase D identity
 *   invariant: the SubjectId must be a function of the
 *   captured content, not of a particular moment in some
 *   attacker's mutable graph.
 *
 *   The fix: every JsonValue the boundary accepts is
 *   CONSTRUCTED by this module. The caller never sees a
 *   reference; the returned tree contains only owned
 *   primitives, freshly-allocated Arrays, and freshly-
 *   allocated plain records.
 *
 * Rejected shapes (D-M06):
 *
 *   The snapshotter REJECTS:
 *     - symbol own-keys
 *     - non-enumerable own-keys
 *     - accessor descriptors (get/set present)
 *     - sparse-array holes
 *     - exotic prototypes (anything other than
 *       Object.prototype or null)
 *     - non-plain values (Date, Map, Set, Promise, ...)
 *     - non-finite numbers
 *     - undefined / bigint / function primitives
 *     - Proxy traps that throw (boundary_exception)
 *
 * Path-cycle semantics (D-M02):
 *
 *   The same object reached via two different paths in an
 *   acyclic DAG is FINE. We CLONE it at each occurrence so
 *   the resulting snapshot has independent storage; the
 *   caller can mutate one without affecting the other.
 *   True recursive back-edges (obj.self = obj) are
 *   REJECTED with reason `cyclic value is not a JsonValue`.
 *
 * Proxy / hostile-input semantics (D-M01, D-M04):
 *
 *   Every Reflect/Object operation that can be intercepted
 *   by a Proxy runs inside an outer try/catch. The catch
 *   NEVER inspects the thrown value via `instanceof Error`
 *   or `String(e)` - both of those can themselves throw on
 *   hostile thrown Proxies whose own getPrototypeOf /
 *   toString traps escape during the introspection.
 *
 *   The catch returns a constant opaque reason:
 *     `${path}: boundary_exception: opaque thrown value`
 *
 *   The kind is the evidence; the message is intentionally
 *   opaque to the attacker.
 */

/**
 * The closed-world definition of a JSON value.
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
 * Recursively snapshot a caller-controlled unknown into an
 * INERT OWNED JsonValue. NEVER throws on hostile input.
 */
export function snapshotJsonValue(
  value: unknown,
  path: string = "$",
): JsonValidation {
  // The OUTER try/catch converts thrown Proxy traps into a
  // typed failure. It must NEVER inspect the caught value
  // (D-M04) - `instanceof Error` and `String(e)` can both
  // throw on hostile thrown Proxies whose own getPrototypeOf
  // / toString traps escape during the introspection.
  try {
    return snapshotJsonValueInner(value, path, new Set<object>());
  } catch {
    return {
      ok: false,
      reason:
        `${path}: boundary_exception: opaque thrown value`,
    };
  }
}

function snapshotJsonValueInner(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): JsonValidation {
  if (value === null) {
    return ok(null);
  }
  if (typeof value === "boolean") {
    return ok(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail(`${path}: non-finite number is not a JsonValue`);
    }
    return ok(value);
  }
  if (typeof value === "string") {
    return ok(value);
  }
  if (typeof value !== "object") {
    return fail(
      `${path}: unsupported JSON-value type ${typeof value} ` +
        `(undefined, bigint, symbol, function)`,
    );
  }

  const obj = value as object;

  // Cycle guard (D-M02): reject recursive back-edges;
  // allow acyclic shared substructure (each occurrence is
  // independently cloned).
  if (ancestors.has(obj)) {
    return fail(`${path}: cyclic value is not a JsonValue`);
  }
  ancestors.add(obj);
  try {
    if (Array.isArray(value)) {
      const src = value as ReadonlyArray<unknown>;
      const len = src.length;
      const out: JsonValue[] = [];
      // Build a FRESH dense Array via explicit push. We
      // never use `new Array(len)` because it produces a
      // sparse array; instead we push each slot. This
      // rejects any array with holes (D-M06).
      for (let i = 0; i < len; i++) {
        if (!(i in src)) {
          return fail(`${path}[${i}]: sparse array hole`);
        }
        const elem = src[i];
        if (elem === undefined) {
          return fail(`${path}[${i}]: undefined is not a JsonValue`);
        }
        const r = snapshotJsonValueInner(elem, `${path}[${i}]`, ancestors);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return ok(out as ReadonlyArray<JsonValue>);
    }

    // Reject non-plain objects (Date, Map, Set, Promise, ...).
    const proto = Reflect.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return fail(`${path}: non-plain object is not a JsonValue`);
    }

    // Walk the OWN keys via Reflect.ownKeys, then classify
    // each one with Object.getOwnPropertyDescriptor. This
    // path catches (D-M06):
    //   - symbol keys
    //   - non-enumerable string keys
    //   - accessor descriptors
    const ownKeys = Reflect.ownKeys(obj);
    const out: { [k: string]: JsonValue } = {};
    for (const k of ownKeys) {
      if (typeof k !== "string") {
        return fail(`${path}: symbol own-key is not a JsonValue`);
      }
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (d === undefined) {
        // A Proxy could return a key from ownKeys that has
        // no descriptor. Reject - the boundary is hostile.
        return fail(
          `${path}.${k}: own-key returned by Reflect.ownKeys has no descriptor`,
        );
      }
      if (!d.enumerable) {
        return fail(`${path}.${k}: non-enumerable own-key`);
      }
      if (d.get !== undefined || d.set !== undefined) {
        return fail(`${path}.${k}: accessor property`);
      }
      // Data descriptor. Note: Node's Proxy handler
      // normalization (ToPropertyDescriptor) fills in
      // `{value: undefined, writable: false}` when the trap
      // returns a malformed descriptor like
      // `{enumerable:true, configurable:true}` — so we
      // cannot reliably distinguish "hostile getter" from
      // "honest undefined property" at this layer. Either
      // way the snapshotter rejects `value: undefined`,
      // so the hostile trap cannot smuggle a getter-fired
      // value past the boundary.
      const v: unknown = d.value;
      if (v === undefined) {
        return fail(`${path}.${k}: undefined is not a JsonValue`);
      }
      const r = snapshotJsonValueInner(v, `${path}.${k}`, ancestors);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return ok(out as { readonly [k: string]: JsonValue });
  } finally {
    ancestors.delete(obj);
  }
}

/**
 * Backwards-compatible validator. Internally calls
 * snapshotJsonValue and discards the cloned value, returning
 * only the boolean decision and reason. Existing callers
 * that only need the "is this a valid JsonValue?" answer
 * keep working unchanged. NEVER throws on hostile input
 * (D-M01, D-M04).
 */
export function validateJsonValue(
  value: unknown,
  path: string = "$",
): JsonValidation {
  const r = snapshotJsonValue(value, path);
  if (r.ok) {
    return { ok: true, value: null };
  }
  return r;
}
