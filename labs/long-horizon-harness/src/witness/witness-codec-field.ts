/**
 * FOUNDATION04 — shared field decoders used by per-shape decoders.
 */

import { WitnessCodecError } from "./witness-codec-messages.js";
import { WITNESS_PROTOCOL_VERSION } from "./witness-protocol.js";

export function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") {
    throw new WitnessCodecError({ kind: "malformed_json", reason: `${field} must be string` });
  }
  return v;
}

export function requireInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: `${field} must be integer` });
  }
  return v;
}

export function requirePositiveInt(v: unknown, field: string): number {
  const n = requireInt(v, field);
  if (n <= 0) {
    throw new WitnessCodecError({ kind: "malformed_json", reason: `${field} must be positive` });
  }
  return n;
}

export function requireNullableInt(v: unknown, field: string): number | null {
  if (v === null) return null;
  return requireInt(v, field);
}

export function requireProtocolVersion(v: unknown, where: string): number {
  const n = requireInt(v, `${where}.protocol_version`);
  if (n !== WITNESS_PROTOCOL_VERSION) {
    throw new WitnessCodecError({
      kind: "protocol_version_mismatch",
      expected: WITNESS_PROTOCOL_VERSION,
      received: n,
    });
  }
  return n;
}
