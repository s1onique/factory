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
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue =
  | JsonPrimitive
  | ReadonlyArray<JsonValue>
  | JsonObject;

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
      return snapshotArray(value as ReadonlyArray<unknown>, path, ancestors);
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
    // D-M10: null-prototype output preserves "__proto__"
    // as DATA.
    const ownKeys = Reflect.ownKeys(obj);
    // D-M10: use a null-prototype record. An ordinary
    // `{}` would, on assignment to "__proto__", trigger
    // the inherited Object.prototype.__proto__ setter and
    // CORRUPT THE PROTOTYPE instead of creating an own
    // data property. A null-prototype object has no such
    // setter, so "__proto__" is just an own string key
    // like any other.
    const out = Object.create(null) as { [k: string]: JsonValue };
    for (const k of ownKeys) {
      if (typeof k !== "string") {
        return fail(`${path}: symbol own-key is not a JsonValue`);
      }
      const d = Object.getOwnPropertyDescriptor(obj, k);
      if (d === undefined) {
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
      const v: unknown = d.value;
      if (v === undefined) {
        return fail(`${path}.${k}: undefined is not a JsonValue`);
      }
      const r = snapshotJsonValueInner(v, `${path}.${k}`, ancestors);
      if (!r.ok) return r;
      // Direct assignment into a null-prototype record is
      // safe even when k === "__proto__": no inherited
      // setter can hijack the assignment.
      out[k] = r.value;
    }
    Object.freeze(out);
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

/**
 * Array-specific snapshot (D-M09).
 *
 *   Arrays get the same descriptor discipline as ordinary
 *   objects: walk own-keys, restrict the permitted set to
 *   EXACTLY "length" and the string keys "0".."len-1",
 *   reject every other own-key (including symbols and
 *   "extra" string properties), validate the descriptor
 *   for each index, and never execute a getter by reading
 *   `src[i]` directly.
 *
 *   Without this discipline the snapshotter would:
 *     - silently drop `arr.foo = "bar"` (extra string key)
 *     - silently drop `arr[Symbol(...)] = "x"` (symbol key)
 *     - execute accessor getters for individual indices
 *       (mutating caller's state, drifting identity
 *        between two reads)
 *     - silently reshape non-enumerable index descriptors
 *       and sparse holes
 *   None of those are honest capture; all violate the
 *   Phase D identity invariant.
 */
function snapshotArray(
  src: ReadonlyArray<unknown>,
  path: string,
  ancestors: Set<object>,
): JsonValidation {
  // (1) Walk own-keys. The permitted set is exactly
  //     "length" plus the string indices "0".."len-1".
  //     Anything else (symbol, extra string, ...) is a
  //     shape violation.
  const ownKeys = Reflect.ownKeys(src);
  let declaredLen = -1;
  for (const k of ownKeys) {
    if (k === "length") {
      const d = Object.getOwnPropertyDescriptor(src, "length");
      if (d === undefined) {
        return fail(
          `${path}.length: array length key has no descriptor`,
        );
      }
      if (d.get !== undefined || d.set !== undefined) {
        return fail(`${path}.length: array length accessor`);
      }
      declaredLen = Number(d.value);
      continue;
    }
    if (typeof k !== "string") {
      return fail(`${path}: array symbol own-key is not a JsonValue`);
    }
    // Index must be a non-negative integer in canonical
    // string form. Anything else (a numeric-looking key
    // like "01", a negative, a float, a string that
    // happens to look like an integer but isn't one)
    // is rejected.
    if (!/^(0|[1-9][0-9]*)$/.test(k)) {
      return fail(
        `${path}: array own-key "${k}" is not a permitted index or "length"`,
      );
    }
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0) {
      return fail(
        `${path}: array own-key "${k}" is not a permitted index`,
      );
    }
    if (declaredLen !== -1 && i >= declaredLen) {
      return fail(
        `${path}[${i}]: array own-key beyond declared length ${declaredLen}`,
      );
    }
    const d = Object.getOwnPropertyDescriptor(src, k);
    if (d === undefined) {
      return fail(
        `${path}[${i}]: array index has no descriptor`,
      );
    }
    if (d.get !== undefined || d.set !== undefined) {
      return fail(`${path}[${i}]: array accessor element`);
    }
    if (!d.enumerable) {
      return fail(`${path}[${i}]: non-enumerable array element`);
    }
    const v: unknown = d.value;
    if (v === undefined) {
      return fail(`${path}[${i}]: undefined is not a JsonValue`);
    }
  }

  // (2) Build the dense fresh array. We do NOT read
  //     `src[i]` (which would execute getters); we re-use
  //     the descriptors we already validated above.
  const declaredLength = declaredLen === -1 ? src.length : declaredLen;
  const out: JsonValue[] = [];
  for (let i = 0; i < declaredLength; i++) {
    const d = Object.getOwnPropertyDescriptor(src, String(i));
    if (d === undefined) {
      // Index not in ownKeys: hole. Reject.
      return fail(`${path}[${i}]: sparse array hole`);
    }
    const v: unknown = d.value;
    if (v === undefined) {
      return fail(`${path}[${i}]: undefined is not a JsonValue`);
    }
    const r = snapshotJsonValueInner(v, `${path}[${i}]`, ancestors);
    if (!r.ok) return r;
    out.push(r.value);
  }
  Object.freeze(out);
  return ok(out as ReadonlyArray<JsonValue>);
}
