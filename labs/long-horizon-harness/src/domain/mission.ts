/**
 * Mission: a static description of what a run is trying to accomplish and
 * the budgets it must obey.
 *
 * Missions are immutable inputs to a run. A mission and its ID are the only
 * things the supervisor needs to know up-front.
 */

import type { MissionId } from "./ids.js";
import type { BudgetLimit } from "./budget.js";

export type Mission = {
  readonly missionId: MissionId;
  readonly name: string;
  readonly description: string;
  readonly budgets: ReadonlyArray<BudgetLimit>;
  /** Maximum number of repair loops the supervisor may execute. */
  readonly maxRepairs: number;
};

export function makeMission(args: {
  readonly missionId: MissionId;
  readonly name: string;
  readonly description: string;
  readonly budgets: ReadonlyArray<BudgetLimit>;
  readonly maxRepairs: number;
}): Mission {
  if (args.name.trim().length === 0) {
    throw new Error("Mission name must be non-empty");
  }
  if (!Number.isInteger(args.maxRepairs) || args.maxRepairs < 0) {
    throw new Error(`maxRepairs must be a non-negative integer; got ${args.maxRepairs}`);
  }
  // Reject duplicate budget kinds: a mission declares each budget at most once.
  const seen = new Set<string>();
  for (const b of args.budgets) {
    if (seen.has(b.kind)) {
      throw new Error(`Duplicate budget kind: ${b.kind}`);
    }
    seen.add(b.kind);
  }
  return {
    missionId: args.missionId,
    name: args.name,
    description: args.description,
    budgets: args.budgets.slice(),
    maxRepairs: args.maxRepairs,
  };
}
