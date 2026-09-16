/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * Pure canonicalization machinery for deriving a deterministic
 * byte representation of an experiment subject manifest, used as
 * the input to the content-addressed SubjectId hash.
 *
 * Doctrine (Phase D, immutable subject):
 *
 *   RUN EVIDENCE MAY REFER TO AN EXPERIMENT SUBJECT.
 *   IT MAY NEVER SILENTLY REDEFINE THAT SUBJECT.
 *
 *   A SubjectId is a function ONLY of the canonical bytes of a
 *   validated manifest. Two manifests with the same set of
 *   field/value pairs (regardless of source-object key order,
 *   whitespace, or platform line endings) MUST produce the same
 *   SubjectId. One-byte changes in any required dimension MUST
 *   produce a different SubjectId.
 *
 * Design choices (doctrine):
 *
 *   - Sorted-key recursive canonicalization of plain JSON
 *     values (objects, arrays, primitives). Mirrors RFC 8785
 *     (JCS) semantics at the level required for stable hashing
 *     but does NOT depend on a JCS library, because JCS's full
 *     number-canonicalization rule set (e.g. exponent
 *     normalization for doubles) is overkill for our typed
 *     domain and would introduce a drift surface between
 *     "what the JSON Schema says" and "what we hash".
 *
 *   - A domain tag (SUBJECT_ID_V1_TAG) is hashed into the
 *     digest input BEFORE the canonical bytes, so a SubjectId
 *     can never collide with any other Factory content
 *     identifier that uses the same canonical bytes.
 *
 *   - The hash is FULL SHA-256 (no truncation), 64 hex chars,
 *     prefixed with "subject:" to namespace it inside the
 *     IDENTIFIER_GRAMMAR (which forbids slashes).
 *
 *   - NUL (0x00) byte separates the domain tag from the
 *     canonical payload. NUL is not legal inside any JSON
 *     string after JSON encoding (encoding rules reject it
 *     inside string scalars) so field-boundary ambiguity is
 *     eliminated.
 *
 * This module is pure: no I/O, no fs, no network.
 */

/**
 * Domain tag for the Phase D SubjectId hash input.
 *
 * STABLE: changing this tag invalidates every persisted
 * SubjectId; treat as a wire-protocol-breaking change.
 */
export const SUBJECT_ID_V1_TAG = "factory:phase-d:subject:id:v1";

/**
 * Canonical byte representation of a JSON value for hashing.
 *
 * Rules:
 *   - objects: keys emitted in ascending lexicographic order
 *     (code-point order on the raw UTF-16 string), each key
 *     followed by ":" then the canonical value
 *   - arrays: elements emitted in source order, comma-separated
 *   - strings: UTF-16 JSON-encoded (no extra whitespace)
 *   - numbers: Number.toString() for integers; for floats we
 *     use the shortest round-trippable JSON form via
 *     JSON.stringify which is what downstream code already
 *     produces
 *   - booleans: "true" / "false"
 *   - null: "null"
 *
 * Wrapping characters:
 *   - object: "{" keys ":" values "}"
 *   - array:  "[" values "]"
 *
 * The output is deterministic for any given plain JSON value.
 * Two callers producing the same logical manifest (regardless
 * of source-object key insertion order) MUST produce byte-
 * equal canonical output.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      // JSON cannot represent NaN/Infinity; any manifest
      // containing them is rejected upstream by the decoder.
      // We surface this as an explicit throw because reaching
      // here is a programming error in the typed decoder, not
      // a runtime event.
      throw new Error(
        "canonicalize: non-finite number reached canonicalize",
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ",";
      out += canonicalize(value[i]);
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
      out += canonicalize(obj[k]);
    }
    out += "}";
    return out;
  }
  throw new Error(
    `canonicalize: unsupported value type ${typeof value}`,
  );
}
