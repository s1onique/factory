/**
 * Public re-exports of the evidence codec.
 *
 * The implementation is split across several sibling files:
 *   - `codec-types.ts`        — persisted-shape type definitions
 *   - `codec-encode.ts`       — typed RunEvent → persisted envelope
 *   - `codec-decode-envelope.ts` — JSON-decoded value → typed envelope
 *   - `codec-decode-internals.ts` — shared field decoders
 *   - `codec-decode-failure.ts`   — failure/budget decoders
 *   - `codec-decode-lift.ts`  — typed envelope → typed RunEvent
 */

export * from "./codec-types.js";
export * from "./codec-encode.js";
export * from "./codec-decode.js";
export type { EventEnvelope } from "./codec-types.js";
