# Source Size Discipline (FOUNDATION03 §29)

## Default rule

All production TypeScript files in `labs/long-horizon-harness/src/**/*.ts` MUST be
no more than **400 LOC** (lines of code, excluding blank lines and pure comments).

This rule is enforced by review at every CORRECTION checkpoint.

## Frozen inherited waiver

The following pre-existing file is granted a one-time inherited waiver because it
is part of the FOUNDATION01 evidence ledger surface:

| File | LOC at CORRECTION10 baseline | Reason |
|------|-----------------------------|--------|
| `src/evidence/jsonl-ledger.ts` | 465 | Pre-existing FOUNDATION01 ledger; modifying it would re-open FOUNDATION01 and break the durability invariants that the entire lab depends on. |

### Conditions

1. The waiver is **frozen** at the SHA recorded in the next section.
2. Any modification of the waived file outside of a targeted, reviewed,
   FOUNDATION01-only commit is a **discipline violation**.
3. The waiver is automatically void if the file's content is changed
   outside a FOUNDATION01 commit (a subsequent SHA diff against this
   baseline MUST be empty for `jsonl-ledger.ts`).

### Frozen hash anchor

The file's frozen content anchor is the SHA of the
`ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION03-CORRECTION10` commit.