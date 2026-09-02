/**
 * FOUNDATION04 — PHASE A — Witness pre-spawn durable-intent
 * gate. Public re-exports.
 *
 * The published surface is intentionally tiny:
 *   - startWitness: the gate
 *   - types: identity / failure / ports
 *   - computeWitnessStartCommitId / validateWitnessStartSpec:
 *     pure helpers
 *
 * Production adapters (appendWitnessEvidencePort,
 * defaultIdentityFactory, nodeSpawnWitnessPort) are not
 * re-exported here; tests construct their own ports.
 */

export * from "./witness-start-types.js";
// MICROFIX: handle types now live in witness-start-handle.ts.
// Re-export them directly so external consumers importing
// from the package root keep seeing them. (witness-start-types
// also re-exports them, but the direct re-export here makes
// the new home explicit.)
export type {
  WitnessBootstrapOutput,
  WitnessExitInfo,
  WitnessSpawnHandle,
} from "./witness-start-handle.js";
export { startWitness, makeProductionWitnessStart } from "./witness-start-gate.js";
export type { WitnessStartPorts } from "./witness-start-gate.js";
