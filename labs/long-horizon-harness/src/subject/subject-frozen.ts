/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * `freezeSubject`: produce a deeply-frozen wrapper around a
 * DecodedSubject such that ANY attempt to mutate either
 * properties or arrays is rejected by JavaScript runtime
 * immutability (TypeError in strict mode).
 *
 * Phase D doctrine (MUTATION_AFTER_CREATION):
 *
 *   A SubjectManifest is immutable. Once frozen, any attempt
 *   to alter its content is rejected by JavaScript's
 *   runtime freeze semantics — adding, removing, writing,
 *   reconfiguring, or array-pushing all throw TypeError in
 *   strict mode.
 *
 *   Doctrine parity: this module does NOT introduce a custom
 *   typed error. The contract is: mutation IS rejected by
 *   JavaScript object immutability; strict-mode writes
 *   throw TypeError. This is the simple, honest contract;
 *   no Proxy machinery, no error-class wrappers, no
 *   try/catch dance at every call site. (See D-C07.)
 *
 * Design:
 *
 *   `freezeSubject` accepts a {@link DecodedSubject} (a
 *   fully-validated manifest + the SubjectId the decoder
 *   derived from it). It then:
 *
 *     1. RE-DERIVES the SubjectId via computeSubjectId and
 *        verifies that it is byte-identical to the one the
 *        caller passed. This is the manifest ↔ SubjectId
 *        binding guarantee (D-C03): it is impossible to
 *        construct a FrozenSubject whose identity names
 *        different content. On mismatch, returns a typed
 *        SubjectFreezeFailure rather than throwing.
 *     2. DEEP-FREEZES the manifest in place, recursing into
 *        every nested object/array. The recursion does NOT
 *        stop at already-frozen nodes (D-C02): the freeze
 *        property is per-object, so a frozen parent does not
 *        freeze children. A WeakSet guards against cycles
 *        (defense in depth, since the manifest is acyclic
 *        by construction).
 *     3. Freezes the wrapper itself so callers cannot
 *        reassign `subject.manifest = ...`.
 *
 *   This module is pure: no I/O.
 */

import { computeSubjectId } from "./subject-id.js";
import type { DecodedSubject } from "./subject-decode.js";
import type { SubjectManifest } from "./subject-types.js";

/**
 * Frozen, read-only view of a DecodedSubject.
 *
 * Both fields are readonly types and runtime-frozen. Any
 * attempt to mutate throws TypeError (strict mode) per
 * JavaScript's Object.freeze semantics.
 */
export type FrozenSubject = {
  readonly manifest: Readonly<SubjectManifest>;
  readonly subjectId: DecodedSubject["subjectId"];
};

/**
 * Closed-world failure shape for freezeSubject.
 *
 *   "manifest_id_mismatch" : the caller-supplied SubjectId
 *                            does not match what
 *                            computeSubjectId derives from
 *                            the supplied manifest. This
 *                            indicates either a programming
 *                            error (manifest constructed by
 *                            hand) or an attempt to bind an
 *                            identity to different content.
 *                            Either way it is rejected; we
 *                            never produce a FrozenSubject
 *                            whose identity lies.
 *   "boundary_exception"    : a Proxy trap or throwing
 *                            getter escaped during freeze
 *                            traversal (D-M01).
 */
export type SubjectFreezeFailure =
  | {
    readonly kind: "manifest_id_mismatch";
    readonly expected: string;
    readonly actual: string;
  }
  | {
    readonly kind: "boundary_exception";
    readonly reason: string;
  };

export type SubjectFreezeResult =
  | { readonly ok: true; readonly value: FrozenSubject }
  | { readonly ok: false; readonly failure: SubjectFreezeFailure };

/**
 * The error class previously defined here (SubjectMutation-
 * Rejected) has been REMOVED (D-C07). Mutation rejection is
 * JavaScript's TypeError — see the module header.
 */
/**
 * Freeze a DecodedSubject into a {@link FrozenSubject}.
 *
 *   - RE-DERIVES the SubjectId and verifies the manifest ↔
 *     id binding. Mismatch returns a typed failure
 *     (SubjectFreezeFailure). NEVER throws on mismatch.
 *   - Deep-freezes the manifest. Recursion does NOT stop at
 *     already-frozen nodes (D-C02). A WeakSet cycle guard
 *     is defense in depth.
 *   - Freezes the wrapper itself.
 *
 * Proxy / hostile-input semantics (D-M01):
 *
 *   `freezeSubject` accepts a `DecodedSubject` whose
 *   manifest came from the decoder. Although the decoder
 *   already vetted the manifest, the freeze operation
 *   re-derives the SubjectId and traverses every nested
 *   object via `Object.values`. A defensive try/catch
 *   keeps the public contract (NEVER throws) literally
 *   true in the rare case that a Proxy trap on a nested
 *   object throws during traversal.
 */
export function freezeSubject(
  decoded: DecodedSubject,
): SubjectFreezeResult {
  try {
    const expected = computeSubjectId(decoded.manifest);
    if (expected !== decoded.subjectId) {
      return {
        ok: false,
        failure: {
          kind: "manifest_id_mismatch",
          expected,
          actual: decoded.subjectId,
        },
      };
    }

    // Re-freeze the manifest root and every nested object/
    // array in place. The recursion does NOT skip already-
    // frozen children: a frozen parent does not imply frozen
    // children, and the contract is that EVERY nested node is
    // immutable. The WeakSet is cycle defense.
    deepFreeze(decoded.manifest);

    const wrapper: FrozenSubject = {
      manifest: decoded.manifest,
      subjectId: decoded.subjectId,
    };
    Object.freeze(wrapper);
    return { ok: true, value: wrapper };
  } catch {
    return {
      ok: false,
      failure: {
        kind: "boundary_exception",
        reason:
          "boundary_exception during freeze: opaque thrown value",
      },
    };
  }
}

/**
 * Recursively freeze a value in place.
 *
 *   - Primitives are returned untouched.
 *   - null is returned untouched.
 *   - For any object, we freeze it FIRST and then recurse
 *     into its enumerable own properties. Crucially, we do
 *     NOT early-return on already-frozen nodes — that was
 *     the Phase D-original bug (D-C02). Freezing is per-
 *     object; freezing the parent does not freeze the
 *     children.
 *   - A WeakSet guards against cycles.
 */
function deepFreeze(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (seen.has(value as object)) {
    return;
  }
  seen.add(value as object);

  Object.freeze(value);

  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v !== null && typeof v === "object") {
      deepFreeze(v, seen);
    }
  }
}
