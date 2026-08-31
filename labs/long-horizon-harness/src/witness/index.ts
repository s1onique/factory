/**
 * FOUNDATION04 — witness public surface.
 *
 * Pure re-exports for typed protocol/state ADTs and pure helpers.
 * The witness process entry point and runtime ports live in
 * separate sibling files; this module is the canonical import
 * path for tests and external callers.
 */

export * from "./witness-types.js";
export * from "./witness-types-persisted.js";
export * from "./witness-protocol.js";
export * from "./witness-codec.js";
export * from "./witness-crypto.js";
export * from "./witness-key-store.js";
export * from "./witness-projector.js";
export * from "./witness-server.js";
export * from "./witness-client.js";
export * from "./witness-runtime-types.js";
export * from "./witness-runtime-sm.js";
