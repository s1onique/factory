/**
 * Public entrypoints for the supervised-process runtime.
 *
 * The lifecycle internals live in supervisor-builder.ts and
 * lifecycle-runner.ts (split for the 400 LOC discipline).
 * This file owns the public surface: startSupervised (Result)
 * and the backwards-compatible createSupervisor wrapper.
 */

import { err, ok, type Result } from "../domain/result.js";
import { validateProcessSpec, type ProcessFailure } from "./process-types.js";
import {
  buildSupervisor,
  invalidSpecSupervisorResult,
  type CreateSupervisorArgs,
  type Supervisor,
  defaultIdFactory,
} from "./supervisor-builder.js";

export type { Supervisor, CreateSupervisorArgs } from "./supervisor-builder.js";
export { defaultIdFactory } from "./supervisor-builder.js";

/**
 * Preferred public API. Returns Result<Supervisor, ...> so an
 * invalid spec is reported as Result.error rather than as a
 * fake cleanup_failed.
 */
export function startSupervised(args: CreateSupervisorArgs): Result<Supervisor, ProcessFailure> {
  const v = validateProcessSpec(args.spec);
  if (v.ok === false) return err(v.error);
  return ok(buildSupervisor(args));
}

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
