/**
 * FOUNDATION04 — public codec surface.
 *
 * Re-exports the canonical signing payload, framing, and typed
 * message encode/decode from the sibling codec files. Consumers
 * import from this module so the layout can be re-arranged
 * internally without breaking call sites.
 */

export * from "./witness-codec-payload.js";
export * from "./witness-codec-framing.js";
export * from "./witness-codec-messages.js";
export * from "./witness-codec-decode.js";
export { WitnessCodecError } from "./witness-codec-messages.js";
