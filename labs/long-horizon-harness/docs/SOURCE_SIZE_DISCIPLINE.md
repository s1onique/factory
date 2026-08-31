# Source Size Discipline (FOUNDATION03 §29)

## Default rule

All production TypeScript files in `labs/long-horizon-harness/src/**/*.ts` MUST be
no more than **400 LOC** (lines of code, excluding blank lines and pure comments).

This rule is enforced by review at every CORRECTION checkpoint.

## Frozen inherited waiver

The following pre-existing file is granted a one-time inherited waiver because it
is part of the FOUNDATION01 evidence ledger surface:

| File | LOC at CORRECTION11 baseline | Reason |
|------|-----------------------------|--------|
| `src/evidence/jsonl-ledger.ts` | 465 | Pre-existing FOUNDATION01 ledger; modifying it would re-open FOUNDATION01 and break the durability invariants that the entire lab depends on. |

### Conditions

1. The waiver is **frozen** at the SHA-256 recorded below.
2. Any modification of the waived file outside of a targeted, reviewed,
   FOUNDATION01-only commit is a **discipline violation**.
3. The waiver is automatically void if the file's content hash changes
   outside a FOUNDATION01 commit (a subsequent SHA-256 comparison against
   the anchor below MUST match exactly for `jsonl-ledger.ts`).

### Frozen hash anchor

```
WAIVED_FILE=src/evidence/jsonl-ledger.ts
WAIVED_CONTENT_SHA256=6d58a4c95ebc7a029d643980b2190db234f9556437f0667caf01acb311b31cf4
WAIVER_ESTABLISHED_AT=53124dd733f1fb25c1e3aa2c6c2144d8c766b32a
WAIVER_REINFORCED_AT=<sha of CORRECTION11 commit — see git log>

> Note: the SHA of the commit that introduces/updates this
> block IS itself content of this block, which creates a
> chicken-and-egg. The authoritative SHA is the git-log
> `CORRECTION11:` and `CORRECTION12:` commits immediately
> following the `CORRECTION10:` commit on `main`. The
> mechanical SHA-256 gate below is the actual lock; this
> value is informational.
```

### Mechanical verification

The CI gate `scripts/run-tests.mjs` enforces:

```
sha256sum src/evidence/jsonl-ledger.ts | grep -q "6d58a4c95ebc7a029d643980b2190db234f9556437f0667caf01acb311b31cf4"
```

If the sha256 changes outside of a FOUNDATION01 commit, the gate fails
discipline. Re-anchoring requires an explicit waiver-revision doc entry
pointing to a new SHA-256 + the reviewed commit that authorized the change.
