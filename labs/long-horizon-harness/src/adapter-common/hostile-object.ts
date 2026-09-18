/**
 * Closed-world hostile-object inspector (LH-03 H-C04).
 *
 * Adapters MUST NOT trust a parsed native record just
 * because it has the right discriminator. An attacker that
 * can inject a record directly into the decoder (via a
 * compromised JSON codec, a crafted stdout line, or a
 * fixture authored by hand) can still smuggle data through:
 *
 *   - extra own string keys (e.g. `__proto__`, `__lookupGetter__`)
 *   - symbol own keys (rare in JSON but possible via crafted
 *     parse paths; the decoder must reject them on principle)
 *   - non-enumerable hidden own fields via `Object.defineProperty`
 *   - accessor properties (getter / setter) on own slots
 *   - wrong scalar/container type for a required field
 *
 * The inspector exposes a deterministic check that the
 * decoder can call before accepting a record. Reusing one
 * helper keeps the contract candidate-neutral and
 * auditable.
 *
 * Doctrine (LH-03 H-C04):
 *
 *   "Do not treat known discriminator as sufficient
 *    validation. The decoder output must be owned/inert
 *    before durable storage."
 */

export type HostileFieldViolation =
  | { readonly kind: "extra_string_key"; readonly key: string }
  | { readonly kind: "symbol_own_key"; readonly description: string }
  | { readonly kind: "accessor_own_key"; readonly key: string }
  | { readonly kind: "non_enumerable_own_key"; readonly key: string };

export type HostileObjectReport =
  | { readonly ok: true }
  | { readonly ok: false; readonly violation: HostileFieldViolation };

/**
 * Inspect a parsed native record for hostile own-property
 * usage. The `admitted` set is the closed-world list of
 * string keys the decoder expects. Any other own string
 * key is a violation. Symbol own-keys and accessor own-keys
 * are always rejected.
 *
 * The function does NOT recurse — the caller decides the
 * admitted set per record shape.
 */
export function inspectOwnProperties(
  value: unknown,
  admitted: ReadonlySet<string>,
): HostileObjectReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, violation: { kind: "non_enumerable_own_key", key: "<not-an-object>" } };
  }
  const obj = value as object;
  // Detect non-enumerable own keys (Object.defineProperty
  // with enumerable:false, or accessor descriptors that
  // change enumerability). Symbols are tracked separately.
  const ownNames = Object.getOwnPropertyNames(obj);
  for (const name of ownNames) {
    const desc = Object.getOwnPropertyDescriptor(obj, name);
    if (!desc) continue;
    if (!admitted.has(name)) {
      return { ok: false, violation: { kind: "extra_string_key", key: name } };
    }
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      return { ok: false, violation: { kind: "accessor_own_key", key: name } };
    }
    if (desc.enumerable === false) {
      return { ok: false, violation: { kind: "non_enumerable_own_key", key: name } };
    }
  }
  const ownSymbols = Object.getOwnPropertySymbols(obj);
  if (ownSymbols.length > 0) {
    return {
      ok: false,
      violation: {
        kind: "symbol_own_key",
        description: ownSymbols.map((s) => String(s)).join(","),
      },
    };
  }
  return { ok: true };
}

/**
 * Whether a parsed value is a plain string.
 */
export function isPlainString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * Whether a parsed value is a non-negative integer (finite).
 */
export function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

/**
 * Whether a parsed value is a finite number.
 */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Whether a parsed value is a boolean.
 */
export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}
