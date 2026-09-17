/**
 * Deterministic native schema fingerprint (LH-03 §7).
 *
 * The fingerprint algorithm MUST be deterministic and
 * tested. It MUST NOT hash prose documentation; it MUST NOT
 * depend on wall-clock or random IDs.
 *
 * Inputs are:
 *
 *   protocol_mode           — ProtocolMode
 *   event_kinds             — sorted list of observed event
 *                             kind strings (e.g. "tool_start",
 *                             "agent_end")
 *   required_fields         — sorted list of field names
 *                             required by the closed-world
 *                             envelope
 *   version                 — candidate-reported version
 *
 * Outputs: a 64-character lowercase hex SHA-256.
 */

import { createHash } from "node:crypto";
import type { ProtocolMode } from "../protocol/harness-identity.js";

export type SchemaFingerprintInput = {
  readonly protocol_mode: ProtocolMode;
  readonly event_kinds: ReadonlyArray<string>;
  readonly required_fields: ReadonlyArray<string>;
  readonly version: string | null;
};

/**
 * Produce a deterministic JSON serialisation for a schema
 * fingerprint input. The canonical form:
 *
 *   - object keys are sorted
 *   - arrays are sorted ascending by their string element
 *     (after a stable stringification)
 *   - no whitespace
 *   - UTF-8
 */
export function canonicaliseFingerprintInput(
  input: SchemaFingerprintInput,
): string {
  const event_kinds = [...new Set(input.event_kinds)].sort();
  const required_fields = [...new Set(input.required_fields)].sort();
  const obj = {
    protocol_mode: input.protocol_mode,
    event_kinds,
    required_fields,
    version: input.version,
  };
  return stableStringify(obj);
}

/**
 * Compute the schema fingerprint (SHA-256, hex, lowercase).
 */
export function computeSchemaFingerprint(
  input: SchemaFingerprintInput,
): string {
  const canonical = canonicaliseFingerprintInput(input);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Stable, sorted-key JSON serialisation. The result has no
 * whitespace, sorted object keys, and arrays in caller-
 * determined order (callers MUST pre-sort).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const v of value) {
      parts.push(stableStringify(v));
    }
    return "[" + parts.join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ":" + stableStringify(obj[k]));
  }
  return "{" + parts.join(",") + "}";
}
