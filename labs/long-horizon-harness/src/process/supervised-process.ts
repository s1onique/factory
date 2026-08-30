/**
 * Public entrypoints for the supervised-process runtime.
 *
 * The lifecycle internals live in supervisor-builder.ts and
 * lifecycle-runner.ts (split for the 400 LOC discipline).
 * This file owns the public surface: startSupervised and
 * the backwards-compatible createSupervisor wrapper.
 *
 * CORRECTION08:
 *   - `startSupervised(args)` is SYNCHRONOUS for the
 *     no-sink fast path (FOUNDATION02 preservation) and
 *     ASYNCHRONOUS when an evidence sink is configured
 *     (the pre-spawn durable intent gate MUST be awaited
 *     before the OS spawn). The overload signatures below
 *     give callers precise types in each branch.
 *   - `startSupervisor(args)` is the always-async API used
 *     by the FOUNDATION03 evidence-enabled path and by the
 *     CP03/CP06/CP07 crash helpers.
 */

import { err, ok, type Result } from "../domain/result.js";
import { validateProcessSpec, type ProcessFailure } from "./process-types.js";
import {
  buildSupervisor,
  startSupervisor,
  invalidSpecSupervisorResult,
  type CreateSupervisorArgs,
  type Supervisor,
  defaultIdFactory,
} from "./supervisor-builder.js";

export type { Supervisor, CreateSupervisorArgs } from "./supervisor-builder.js";
export { defaultIdFactory } from "./supervisor-builder.js";

/**
 * Type guard: does this arg have an evidence sink configured?
 */
function hasEvidenceSink(
  args: CreateSupervisorArgs,
): args is CreateSupervisorArgs & { evidenceSink: NonNullable<CreateSupervisorArgs["evidenceSink"]> } {
  return args.evidenceSink !== undefined;
}

/**
 * Preferred public API. Overloaded:
 *   - with evidenceSink → Promise<Result<Supervisor, ProcessFailure>>
 *     (the pre-spawn durability gate is awaited before spawn)
 *   - without evidenceSink → Result<Supervisor, ProcessFailure>
 *     (FOUNDATION02 synchronous spawn, no durability gate)
 */
export function startSupervised(
  args: CreateSupervisorArgs & { evidenceSink: NonNullable<CreateSupervisorArgs["evidenceSink"]> },
): Promise<Result<Supervisor, ProcessFailure>>;
export function startSupervised(
  args: CreateSupervisorArgs & { evidenceSink?: undefined },
): Result<Supervisor, ProcessFailure>;
export function startSupervised(
  args: CreateSupervisorArgs,
): Result<Supervisor, ProcessFailure> | Promise<Result<Supervisor, ProcessFailure>>;
export function startSupervised(
  args: CreateSupervisorArgs,
): Result<Supervisor, ProcessFailure> | Promise<Result<Supervisor, ProcessFailure>> {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) return err(v.error);
  if (!hasEvidenceSink(args)) {
    return ok(buildSupervisor(args));
  }
  return startSupervisor(args);
}

/**
 * Always-async start function. Used by the FOUNDATION03
 * evidence-enabled path. Awaits the durable intent ACK
 * before performing the OS spawn.
 */
export { startSupervisor };

/**
 * Backwards-compatible wrapper for tests that want a single
 * call. Validates the spec and converts an invalid spec into a
 * typed spawn_failed ProcessResult so callers that awaited
 * via the old API do not see an unhandled rejection. Production
 * code should use startSupervised.
 */
export function createSupervisor(args: CreateSupervisorArgs): Supervisor {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) {
    return invalidSpecSupervisorResult(args.spec, v.error, args.idFactory ?? defaultIdFactory);
  }
  return buildSupervisor(args);
}

