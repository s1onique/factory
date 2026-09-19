/**
 * LH-05 expected forbidden-outcomes comparator.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Split from `expected.ts` for source-size discipline.
 */
import type { ForbiddenOutcomes, ForbiddenOutcomesActual } from "../types.js";

export function checkForbiddenOutcomes(
  expected: ForbiddenOutcomes,
  actual: {
    readonly terminal_outcome: string | null;
    readonly lifecycle_state: string | null;
    readonly success_normalized_metrics_emitted: boolean;
  } | null,
): ForbiddenOutcomesActual {
  const observed: string[] = [];
  if (actual === null) return { all_absent: true, observed };
  if (expected.terminal_outcome_in !== null) {
    for (const bad of expected.terminal_outcome_in) {
      if (actual.terminal_outcome === bad) observed.push(`terminal_outcome=${bad} (forbidden)`);
    }
  }
  if (expected.lifecycle_state_in !== null) {
    for (const bad of expected.lifecycle_state_in) {
      if (actual.lifecycle_state === bad) observed.push(`lifecycle_state=${bad} (forbidden)`);
    }
  }
  if (expected.success_normalized_metrics_emitted === true && actual.success_normalized_metrics_emitted === true)
    observed.push("success_normalized_metrics_emitted (forbidden)");
  return { all_absent: observed.length === 0, observed };
}
