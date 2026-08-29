/**
 * Budget model.
 *
 * Budgets are explicit typed values. The laboratory never relies on parsing
 * free-form strings to recover the budget kind, the limit, or the observed
 * usage; these three are all part of the type.
 *
 * FOUNDATION01 does not yet enforce budgets against real processes.
 * The types and events exist so that future ACTs (FOUNDATION02) can plug in
 * an executor without changing domain semantics.
 */

export type BudgetKind =
  | "wall_clock"
  | "attempts"
  | "tool_calls"
  | "model_turns";

export type BudgetLimit = {
  readonly kind: BudgetKind;
  /** Strictly positive integer. */
  readonly limit: number;
};

export type BudgetObservation = {
  readonly kind: BudgetKind;
  /** Observed usage at the moment the observation was recorded. >= 0. */
  readonly observed: number;
  /** Limit configured for the run. */
  readonly limit: number;
};

export const BUDGET_KINDS: readonly BudgetKind[] = [
  "wall_clock",
  "attempts",
  "tool_calls",
  "model_turns",
] as const;

export function isBudgetKind(value: unknown): value is BudgetKind {
  return (
    typeof value === "string" &&
    (BUDGET_KINDS as readonly string[]).includes(value)
  );
}

export function makeBudgetLimit(kind: BudgetKind, limit: number): BudgetLimit {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `Budget limit for ${kind} must be a positive integer; got ${limit}`,
    );
  }
  return { kind, limit };
}

export function makeBudgetObservation(
  kind: BudgetKind,
  observed: number,
  limit: number,
): BudgetObservation {
  if (!Number.isInteger(observed) || observed < 0) {
    throw new Error(
      `Budget observation for ${kind} must be a non-negative integer; got ${observed}`,
    );
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `Budget limit for ${kind} must be a positive integer; got ${limit}`,
    );
  }
  return { kind, observed, limit };
}

export function isExhausted(o: BudgetObservation): boolean {
  return o.observed >= o.limit;
}
