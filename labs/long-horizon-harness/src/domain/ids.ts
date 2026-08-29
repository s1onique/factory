/**
 * Branded identifier primitives.
 *
 * Branding prevents accidental interchange of semantically different identifier
 * strings (for example passing an AttemptId where a RunId is expected).
 *
 * The brand is purely a compile-time fiction: at runtime these are plain
 * strings. Two construction paths exist:
 *
 *  - {@link makeRunId} / family: trusted internal use. Throws on invalid
 *    input because the call site has already vetted the value.
 *  - {@link parseRunId} / family: trust-boundary use. NEVER throws; returns
 *    a typed {@link InvalidId} on any failure, so the evidence decoder can
 *    surface persisted bytes as `invalid_evidence` rather than as an
 *    uncaught exception.
 *
 * Domain code MUST NOT obtain a branded identifier by any other means.
 */

declare const __brand: unique symbol;

type Brand<T, B> = T & { readonly [__brand]: B };

export type RunId = Brand<string, "RunId">;
export type MissionId = Brand<string, "MissionId">;
export type AttemptId = Brand<string, "AttemptId">;
export type EventId = Brand<string, "EventId">;
export type HarnessHandle = Brand<string, "HarnessHandle">;

/**
 * The single identifier grammar enforced at construction time.
 *
 * Constraints:
 *  - length in [1, 128]
 *  - characters: ASCII letters, digits, underscore, hyphen, dot, colon
 *  - must not be empty
 *  - must not contain whitespace, slashes, control characters, quotes
 *
 * This grammar is intentionally narrow. It rejects whitespace, slashes,
 * embedded nulls, and the empty string. The decoder MUST apply it to
 * every persisted identifier before that identifier is allowed into the
 * trusted domain.
 */
export const IDENTIFIER_GRAMMAR = /^[A-Za-z0-9_.:-]{1,128}$/;

function check(value: string, label: string): void {
  if (!IDENTIFIER_GRAMMAR.test(value)) {
    throw new Error(`Invalid ${label}: must match ${IDENTIFIER_GRAMMAR}`);
  }
}

export type InvalidId = {
  readonly kind: "invalid_id";
  readonly field: string;
  readonly reason: string;
};

export function makeRunId(value: string): RunId {
  check(value, "RunId");
  return value as RunId;
}

export function makeMissionId(value: string): MissionId {
  check(value, "MissionId");
  return value as MissionId;
}

export function makeAttemptId(value: string): AttemptId {
  check(value, "AttemptId");
  return value as AttemptId;
}

export function makeEventId(value: string): EventId {
  check(value, "EventId");
  return value as EventId;
}

export function makeHarnessHandle(value: string): HarnessHandle {
  check(value, "HarnessHandle");
  return value as HarnessHandle;
}

import { err, map, ok, type Result } from "./result.js";

function parseId<F extends string>(
  value: unknown,
  field: F,
): Result<string, InvalidId> {
  if (typeof value !== "string") {
    return err({
      kind: "invalid_id",
      field,
      reason: `expected string, got ${value === null ? "null" : typeof value}`,
    });
  }
  if (!IDENTIFIER_GRAMMAR.test(value)) {
    return err({
      kind: "invalid_id",
      field,
      reason: `value does not match identifier grammar ${IDENTIFIER_GRAMMAR}`,
    });
  }
  return ok(value);
}

export function parseRunId(value: unknown): Result<RunId, InvalidId> {
  return map(parseId(value, "RunId"), (s) => s as RunId);
}

export function parseMissionId(value: unknown): Result<MissionId, InvalidId> {
  return map(parseId(value, "MissionId"), (s) => s as MissionId);
}

export function parseAttemptId(value: unknown): Result<AttemptId, InvalidId> {
  return map(parseId(value, "AttemptId"), (s) => s as AttemptId);
}

export function parseEventId(value: unknown): Result<EventId, InvalidId> {
  return map(parseId(value, "EventId"), (s) => s as EventId);
}

export function parseHarnessHandle(
  value: unknown,
): Result<HarnessHandle, InvalidId> {
  return map(parseId(value, "HarnessHandle"), (s) => s as HarnessHandle);
}

/**
 * Equality of branded identifiers is structural string equality.
 * The brand never affects identity.
 */
export function idEquals(a: string, b: string): boolean {
  return a === b;
}
