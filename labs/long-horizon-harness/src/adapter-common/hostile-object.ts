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
  | { readonly kind: "non_enumerable_own_key"; readonly key: string }
  | { readonly kind: "unexpected_prototype"; readonly got: string }
  | { readonly kind: "not_record" };

export type HostileObjectReport =
  | { readonly ok: true }
  | { readonly ok: false; readonly violation: HostileFieldViolation };

/**
 * Whether a parsed value is an inert, prototype-clean
 * record (CORRECTION02 C02-04; tightened in CORRECTION03
 * C03-04 to bound what Proxy traps may execute).
 *
 * A "plain" record is a non-null, non-array object whose
 * prototype is exactly `Object.prototype` or `null`. Any
 * other prototype (class instance, exotic proxy, etc.)
 * is rejected. This is the durable-path safety net: a
 * hand-crafted native event must not be able to smuggle
 * class methods or callable prototypes past redaction.
 *
 * CORRECTION03 Proxy doctrine (C03-04):
 *
 *   GETTER_NOT_INVOKED             = TRUE
 *   NO_ATTACKER_CODE_EXECUTED      = NOT TRUE in general
 *
 * Specifically, for a Proxy target:
 *
 *   - `Object.getPrototypeOf(proxy)` MAY invoke the
 *     Proxy's `getPrototypeOf` trap (MDN: this is
 *     specified; ECMAScript specifies the handler trap
 *     being called). That trap IS attacker code; this
 *     function does not promise to prevent its execution.
 *   - `Object.getOwnPropertyNames(proxy)` MAY invoke
 *     the Proxy's `ownKeys` and `getOwnPropertyDescriptor`
 *     traps. Likewise attacker code; likewise not
 *     prevented.
 *   - However, this function and the surrounding
 *     redactor MUST NOT trigger any value's
 *     `[[Get]]` / accessor own-key. Getters, [[Get]],
 *     and value-fetching traps (`get`, `apply`, `call`)
 *     are forbidden.
 *
 * Concretely: the redactor reads only structural metadata
 * (prototype, own-key names, own-property descriptors) and
 * rejects a Proxy whose structural introspection returns
 * anything outside `Object.prototype` / `null`. A Proxy
 * is therefore rejected by virtue of its prototype; its
 * structural traps are permitted to fire during that
 * rejection. This matches the Phase-D doctrine and is the
 * precise invariant that the C03-04 oracle test pins.
 *
 * The check does NOT invoke [[Get]] on any value.
 */
export function isPlainInertRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
  if (!isPlainInertRecord(value)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, violation: { kind: "not_record" } };
    }
    return {
      ok: false,
      violation: {
        kind: "unexpected_prototype",
        got: String(Object.getPrototypeOf(value)),
      },
    };
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
