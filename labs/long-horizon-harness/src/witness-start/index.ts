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
export { startWitness, makeProductionWitnessStart } from "./witness-start-gate.js";
export type { WitnessStartPorts } from "./witness-start-gate.js";
