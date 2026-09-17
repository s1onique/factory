/**
 * Candidate-neutral JSON trust-boundary codec (LH-03 §4).
 *
 * This module is the only place inside `src/adapter-common`
 * that calls `JSON.parse`. Adapters import
 * {@link parseNativeLine} from here; they MUST NOT call
 * `JSON.parse` directly. This preserves the trust-boundary
 * invariant enforced by `test/trust-boundary.test.ts`:
 * every `JSON.parse` in the lab lives in the codec or
 * ledger layers.
 *
 * The parser returns `unknown`; the caller is responsible
 * for routing the parsed value through its closed-world
 * decoder. Returning `unknown` is the entire point: no
 * `any` is allowed past this boundary.
 */

export type NativeLineParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: "MALFORMED_NATIVE_EVENT" };

/**
 * Parse a single harness-native line. Returns the parsed
 * value as `unknown` or a typed failure.
 *
 * Doctrine: callers MUST NOT treat `unknown` as trusted
 * until it has flowed through a closed-world decoder.
 */
export function parseNativeLine(line: string): NativeLineParseResult {
  try {
    const v = JSON.parse(line);
    return { ok: true, value: v };
  } catch {
    return { ok: false, reason: "MALFORMED_NATIVE_EVENT" };
  }
}

/**
 * Whether a parsed native line is structurally a JSON
 * object (i.e. a record). Used by adapter decoders before
 * they attempt to read fields.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
