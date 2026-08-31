/**
 * Public entrypoints for the supervised-process runtime.
 *
 * The lifecycle internals live in supervisor-builder.ts and
 * lifecycle-runner.ts (split for the 400 LOC discipline).
 * This file owns the public surface: startSupervised and
 * the backwards-compatible createSupervisor wrapper.
 *
 * CORRECTION10 — arg-type split:
 *   - `startSupervised(EvidenceSupervisorArgs)` returns
 *     `Promise<Result<...>>`; the durability gate is
 *     awaited before spawn.
 *   - `startSupervised(NoEvidenceSupervisorArgs)` returns
 *     `Result<...>` (FOUNDATION02 synchronous spawn, no
 *     gate).
 *   - `createSupervisor(NoEvidenceSupervisorArgs)` is
 *     sync-only and refuses evidence.
 *   - `startSupervisor(EvidenceSupervisorArgs)` is the
 *     always-async evidence path.
 */

import { err, ok, type Result } from "../domain/result.js";
import { validateProcessSpec, type ProcessFailure } from "./process-types.js";
import {
  buildSupervisor,
  startSupervisor,
  invalidSpecSupervisorResult,
  type CreateSupervisorArgs,
  type EvidenceSupervisorArgs,
  type NoEvidenceSupervisorArgs,
  type Supervisor,
  defaultIdFactory,
} from "./supervisor-builder.js";

export type { Supervisor, CreateSupervisorArgs } from "./supervisor-builder.js";
export { defaultIdFactory } from "./supervisor-builder.js";

/**
 * Preferred public API. Overloaded (CORRECTION10):
 *   - EvidenceSupervisorArgs → Promise<Result<...>>
 *   - NoEvidenceSupervisorArgs → Result<...>
 */
export function startSupervised(
  args: EvidenceSupervisorArgs,
): Promise<Result<Supervisor, ProcessFailure>>;
export function startSupervised(
  args: NoEvidenceSupervisorArgs,
): Result<Supervisor, ProcessFailure>;
export function startSupervised(
  args: CreateSupervisorArgs,
): Result<Supervisor, ProcessFailure> | Promise<Result<Supervisor, ProcessFailure>>;
export function startSupervised(
  args: CreateSupervisorArgs,
): Result<Supervisor, ProcessFailure> | Promise<Result<Supervisor, ProcessFailure>> {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) return err(v.error);
  if (args.evidenceSink === undefined) {
    // NoEvidenceSupervisorArgs path: synchronous, no gate.
    return ok(buildSupervisor(args));
  }
  // EvidenceSupervisorArgs path: async, gate enforced.
  return startSupervisor(args);
}

/**
 * Always-async start function (CORRECTION10). Accepts ONLY
 * EvidenceSupervisorArgs. Awaits the durable intent ACK
 * before performing the OS spawn.
 */
export { startSupervisor };

/**
 * Backwards-compatible wrapper. Accepts ONLY
 * NoEvidenceSupervisorArgs; supplying evidence fields is a
 * compile error. Validates the spec and converts an invalid
 * spec into a typed spawn_failed ProcessResult so callers
 * that awaited via the old API do not see an unhandled
 * rejection. Production code should use startSupervised.
 */
export function createSupervisor(args: NoEvidenceSupervisorArgs): Supervisor {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) {
    return invalidSpecSupervisorResult(args.spec, v.error, args.idFactory ?? defaultIdFactory);
  }
  return buildSupervisor(args);
}
