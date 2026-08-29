/**
 * Branded identifier primitives.
 *
 * Branding prevents accidental interchange of semantically different identifier
 * strings (for example passing an AttemptId where a RunId is expected).
 *
 * The brand is purely a compile-time fiction: at runtime these are plain
 * strings. We never `as`-cast user input directly into a branded type; brand
 * values are produced only by explicit, validation-aware constructor
 * functions (see {@link makeRunId}, etc.).
 */

declare const __brand: unique symbol;

type Brand<T, B> = T & { readonly [__brand]: B };

export type RunId = Brand<string, "RunId">;
export type MissionId = Brand<string, "MissionId">;
export type AttemptId = Brand<string, "AttemptId">;
export type EventId = Brand<string, "EventId">;
export type HarnessHandle = Brand<string, "HarnessHandle">;

const NON_EMPTY = /^[A-Za-z0-9_-]{1,128}$/;

function check(value: string, label: string): void {
  if (!NON_EMPTY.test(value)) {
    throw new Error(`Invalid ${label}: must match ${NON_EMPTY}`);
  }
}

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

/**
 * Equality of branded identifiers is structural string equality.
 * The brand never affects identity.
 */
export function idEquals(a: string, b: string): boolean {
  return a === b;
}
