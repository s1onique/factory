/**
 * Failure / budget decoders shared by the event decoder.
 */

import type { BudgetKind } from "../domain/budget.js";
import { isBudgetKind } from "../domain/budget.js";
import { isFailureKind, type FailureKind } from "../domain/failure.js";
import type { InvalidEvidence } from "../domain/failure.js";
import { andThen, err, map, ok, type Result } from "../domain/result.js";
import type {
  PersistedBudgetObservation,
  PersistedFailure,
} from "./codec-types.js";
import { decodeStringField } from "./codec-decode-internals.js";

export function decodeFailure(
  v: Record<string, unknown>,
  field: string,
): Result<PersistedFailure, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "object" || x === null) {
    return err({ kind: "invalid_evidence", reason: `Field '${field}' must be a non-null object.` });
  }
  const f = x as Record<string, unknown>;
  const k = f["kind"];
  if (typeof k !== "string" || !isFailureKind(k)) {
    return err({ kind: "invalid_evidence", reason: `Unknown failure kind '${String(k)}'.` });
  }
  const kind = k as FailureKind;
  switch (kind) {
    case "candidate_failure":
      return andThen(decodeStringField(f, "code"), (code) =>
        map(decodeStringField(f, "message"), (message) =>
          ({ kind, code, message } as PersistedFailure),
        ),
      );
    case "tool_failure":
      return andThen(decodeStringField(f, "tool"), (tool) =>
        map(decodeStringField(f, "message"), (message) =>
          ({ kind, tool, message } as PersistedFailure),
        ),
      );
    case "gate_failure":
      return andThen(decodeStringField(f, "gate"), (gate) =>
        map(decodeStringField(f, "message"), (message) =>
          ({ kind, gate, message } as PersistedFailure),
        ),
      );
    case "policy_denied":
      return andThen(decodeStringField(f, "policy"), (policy) =>
        map(decodeStringField(f, "message"), (message) =>
          ({ kind, policy, message } as PersistedFailure),
        ),
      );
    case "timeout":
      return andThen(decodeStringField(f, "subject"), (subject) =>
        map(decodeStringField(f, "message"), (message) =>
          ({ kind, subject, message } as PersistedFailure),
        ),
      );
    case "budget_exhausted":
      return andThen(decodeBudgetKindField(f, "budget"), (budget) =>
        andThen(decodePositiveIntField(f, "limit"), (limit) =>
          andThen(decodeNonNegativeIntField(f, "observed"), (observed) =>
            map(decodeStringField(f, "message"), (message) =>
              ({ kind, budget, limit, observed, message } as PersistedFailure),
            ),
          ),
        ),
      );
    case "invalid_evidence":
      return map(decodeStringField(f, "reason"), (reason) =>
        ({ kind, reason } as PersistedFailure),
      );
    case "invalid_transition":
      return andThen(decodeStringField(f, "from"), (from) =>
        andThen(decodeStringField(f, "event"), (ev) =>
          map(decodeStringField(f, "message"), (message) =>
            ({ kind, from, event: ev, message } as PersistedFailure),
          ),
        ),
      );
    case "internal_failure":
      return map(decodeStringField(f, "message"), (message) =>
        ({ kind, message } as PersistedFailure),
      );
  }
}

export function decodeBudgetKindField(
  v: Record<string, unknown>,
  field: string,
): Result<BudgetKind, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "string" || !isBudgetKind(x)) {
    return err({ kind: "invalid_evidence", reason: `Field '${field}' must be a valid BudgetKind.` });
  }
  return ok(x);
}

export function decodePositiveIntField(
  v: Record<string, unknown>,
  field: string,
): Result<number, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "number" || !Number.isInteger(x) || x < 1) {
    return err({ kind: "invalid_evidence", reason: `Field '${field}' must be a positive integer.` });
  }
  return ok(x);
}

export function decodeNonNegativeIntField(
  v: Record<string, unknown>,
  field: string,
): Result<number, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "number" || !Number.isInteger(x) || x < 0) {
    return err({ kind: "invalid_evidence", reason: `Field '${field}' must be a non-negative integer.` });
  }
  return ok(x);
}

export function decodeBudgetObservation(
  v: Record<string, unknown>,
  field: string,
): Result<PersistedBudgetObservation, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "object" || x === null) {
    return err({ kind: "invalid_evidence", reason: `Field '${field}' must be a non-null object.` });
  }
  const o = x as Record<string, unknown>;
  return andThen(decodeBudgetKindField(o, "kind"), (kind) =>
    andThen(decodePositiveIntField(o, "limit"), (limit) =>
      map(decodeNonNegativeIntField(o, "observed"), (observed) =>
        ({ kind, limit, observed } as PersistedBudgetObservation),
      ),
    ),
  );
}
