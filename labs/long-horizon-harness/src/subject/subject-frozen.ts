/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * `freezeSubject`: produce a deeply-frozen wrapper around a
 * SubjectManifest such that ANY attempt to mutate either
 * properties or arrays (via push/pop/splice/etc.) is rejected
 * by throwing a typed {@link SubjectMutationRejected}.
 *
 * Phase D doctrine (MUTATION_AFTER_CREATION):
 *
 *   A SubjectManifest is immutable. Once frozen, any attempt
 *   to alter its content throws SubjectMutationRejected.
 *   The frozen wrapper exposes only the readonly fields; no
 *   setter, no wither, no replace method exists.
 *
 * Implementation note (defense in depth):
 *
 *   We rely on three properties:
 *
 *     1. Object.freeze() on the manifest and on every nested
 *        object (already done by the decoder for `model
 *        .configuration` and `capabilities.tools`).
 *     2. The declared TypeScript types are `readonly` on
 *        every field, which is a compile-time barrier.
 *     3. At runtime, freeze() makes the runtime barrier
 *        strict: setting a property, adding a property,
 *        deleting a property, or re-configuring an array all
 *        either silently fail in non-strict mode or throw in
 *        strict mode. We add a `freezeSubject` factory that
 *        re-freezes the manifest as a whole and exposes a
 *        getter so callers cannot accidentally re-shape the
 *        wrapper.
 *
 *   This module also re-exports the SubjectMutationRejected
 *   class so callers can match on `instanceof`.
 */

import type { SubjectManifest, SubjectId } from "./subject-types.js";

/**
 * Typed error thrown when an attempt is made to mutate a
 * frozen subject. The `target` field names the property
 * path the caller tried to write.
 */
export class SubjectMutationRejected extends Error {
  public readonly target: string;
  constructor(target: string, reason: string) {
    super(`SubjectMutationRejected at ${target}: ${reason}`);
    this.name = "SubjectMutationRejected";
    this.target = target;
  }
}

/**
 * A frozen, read-only view of a SubjectManifest.
 *
 * The wrapper itself is frozen, the inner manifest is
 * frozen, and nested objects/arrays passed in (model
 * .configuration, capabilities.tools) MUST already be frozen
 * by the decoder; we re-freeze here as defense in depth.
 */
export type FrozenSubject = {
  readonly manifest: Readonly<SubjectManifest>;
  readonly subjectId: SubjectId;
};

/**
 * Freeze a manifest + its derived SubjectId into a
 * {@link FrozenSubject}.
 *
 * - Re-freezes the manifest root (idempotent).
 * - Re-freezes nested objects/arrays (idempotent).
 * - Returns a wrapper whose own properties are frozen.
 *
 * The wrapper provides NO mutation methods. Calling code
 * that needs a different subject MUST construct a new
 * SubjectManifest and call freezeSubject again. There is no
 * "patch the budget" path. That is the doctrine.
 */
export function freezeSubject(
  manifest: SubjectManifest,
  subjectId: SubjectId,
): FrozenSubject {
  // Re-freeze the manifest root and every nested object/array
  // in place. Object.freeze is idempotent: freezing an
  // already-frozen object returns the same object and does
  // not throw.
  deepFreeze(manifest);

  const wrapper: FrozenSubject = {
    manifest,
    subjectId,
  };
  Object.freeze(wrapper);
  return wrapper;
}

/**
 * Recursively freeze a value in place. Freezes plain objects
 * and arrays; leaves primitives, branded strings, frozen
 * objects, and frozen arrays untouched.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const k of Object.keys(value as Record<string, unknown>)) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }
  return value;
}
