# REBOOT-CORR01 — ML-SMOKE-01 Fixture Qualification

> The historical LH-07 D01 definition is **unchanged**. ML-SMOKE-01 is a
> new, Model-Lab-specific fixture with exactly **one** defect.

---

## 1. Why a new fixture

The REBOOT-01 oracle required two repairs while the historical D01 task
prompt asked for one. That mismatch would have made the first experiment
unfair: a candidate following the prompt perfectly could fail the gate for an
undisclosed defect.

The two defects are independent:

| Defect | File | Required change |
| --- | --- | --- |
| REC-TMP01 | `test/recovery/cp-crash.test.ts` | correct temporary-directory construction |
| SOCK06 | `test/ledger-writer/ledger-writer-socket-probe.test.ts` | correct a non-portable Unix socket assertion |

ML-SMOKE-01 = the historical base **with the SOCK06 correction pre-applied**,
so REC-TMP01 is the single defect under test.

`ML-SMOKE-02` (the mirror: REC-TMP01 pre-applied, SOCK06 under test) is
**defined but not implemented** in this ACT, as instructed.

## 2. Preparation overlay

`labs/model-lab/prepare_ml_smoke_01.sh` builds the fixture:

1. materializes the base snapshot with `git archive`;
2. derives the overlay as
   `git diff <base> <historical_fix> -- <SOCK06 file>`;
3. applies it with `patch -p1`;
4. **proves** the overlay corrected only SOCK06 and left REC-TMP01 intact;
5. records the overlay SHA-256 and a fixture digest;
6. supplies the harness dependencies as an **evaluator-owned symlink**, never
   copied from a candidate workspace.

The proof in step 4 is mechanical:

```text
grep -q 'fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"))' <workspace>/cp-crash.test.ts
    -> the pre-fix REC-TMP01 seam is still present

grep -q 'MUST be absent after helper close boundary' <workspace>/socket-probe.test.ts
    -> absent: the SOCK06 ENOENT assertion is gone
```

Both assertions must hold, or preparation fails with a typed error.

## 3. Fixture identity

```text
ML_SMOKE_01_BASE_COMMIT=09fc12c6fb051dce096252bf30c2e96debed962c
ML_SMOKE_01_OVERLAY_SOURCE=5c51615f80aa7dfaec53ff0918c8688cfecb9a02
ML_SMOKE_01_OVERLAY_SCOPE=labs/long-horizon-harness/test/ledger-writer/ledger-writer-socket-probe.test.ts
ML_SMOKE_01_OVERLAY_SHA256=eb59a9eab4d341c429f94934ffc982fb877402083b433fdcfd57ece0be4506c5
ML_SMOKE_01_FIXTURE_SHA256=cd269fa584b1a547aeb165b5e19cbd509fe3df6cd47a9f4547a92a6031ecf677
ML_SMOKE_01_SINGLE_DEFECT=REC-TMP01
ML_SMOKE_01_ALLOWED_PATH=labs/long-horizon-harness/test/recovery/cp-crash.test.ts
```

## 4. The task prompt

The candidate-visible task, restricted to one defect and one file:

> In `test/recovery/cp-crash.test.ts`, the REC-TMP01 test constructs its
> hermetic seam by calling `fs.mkdtemp(join(process.cwd(), '.tmp-home',
> 'tmp01-'))` directly. `fs.mkdtemp` does NOT create missing parents. On a
> clean worktree `process.cwd()/.tmp-home` does not exist, so `mkdtemp` throws
> `ENOENT` and the test fails for fixture-construction reasons rather than
> qualifying `tmpDir(base)`. Anchor the seam under `os.tmpdir()` (an
> always-present parent) instead. Do not change any production source under
> `src/`.

**Known limitation, carried forward honestly:** this prompt states the remedy.
ML-SMOKE-01 is a **smoke fixture**. It can establish that the pipeline, the
fixture and the oracle work; it **cannot** rank models, and it must not be
used to interpret DL-03 skill effectiveness (the review's ceiling-effect
concern is correct). A solution-blind fixture is ML-06's job.

## 5. Scope

| Property | Value |
| --- | --- |
| Allowed path | `labs/long-horizon-harness/test/recovery/cp-crash.test.ts` (one file) |
| Forbidden | everything else, including `src/**` and the socket-probe file |
| Required test | `REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent` |
| Required regression test | `REC-TMP02: tmpDir() returns a unique dir per call` |

Both required tests must be **present, executed, and passing**. A skipped
required test is a FAIL, not a pass.

## 6. The corrected acceptance oracle

`labs/model-lab/ml_smoke_01_acceptance_oracle.sh` replaces the REBOOT-01
`d01_acceptance_oracle.sh`. It enforces **failure identity**: a negative
control counts only when it establishes the specified negative outcome
through the specified mechanism.

### Four mutation conditions, all required

| # | Condition | Failure classification |
| --- | --- | --- |
| 1 | the mutation was applied to the intended statement | `NOT_APPLIED` |
| 2 | the mutated source remains syntactically valid (`node --check`) | `INVALID_MUTATION` |
| 3 | the required test EXECUTES in the mutant | `EXECUTION_FAILURE` |
| 4 | it fails with the intended signature (`ENOENT`) | `WRONG_FAILURE` |
| — | it passes | `MUTATION_SURVIVED` |
| — | all four hold | `DETECTED` |

Only `DETECTED` sets `MUTATION_DETECTED=YES`. Everything else does not.

The mutation itself is a **statement-level regex**, not a prefix
replacement:

```text
pattern: const tmpRoot = await fs\.mkdtemp\([^;]*\);
bad:     const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));
```

This replaces the whole statement regardless of line layout, and always
yields syntactically valid source.

### TAP classification

The gate output is classified into passed / failed / skipped / todo /
cancelled. A skipped test is **never** counted as a pass. A gate that cannot
load at all reports `GATE_UNAVAILABLE=1` and cannot pass.

### Scope enforcement

- Enumeration failure → `HALT`, never `PASS`.
- A missing reference blob → a scope violation, not a silent skip.
- A symlink where the reference has a regular file → `UNSUPPORTED_OBJECT`.
- The dependency tree is evaluator-owned and excluded from the scope diff;
  its integrity is asserted separately by `ML_SMOKE_01_DEPENDENCY_TRUST`.
- The comparison reference is the **prepared fixture**, i.e. what the
  candidate actually sees — not the raw base.

### Machine-readable output

```text
ML_SMOKE_01_BASE_IDENTITY=VALID|INVALID
ML_SMOKE_01_PREPARED_IDENTITY=VALID|INVALID
ML_SMOKE_01_REFERENCE_KIND=PREPARED_DIR|WORKSPACE
ML_SMOKE_01_SCOPE_VIOLATIONS=<n>
ML_SMOKE_01_DEPENDENCY_TRUST=TRUSTED|UNRESOLVABLE|ABSENT
ML_SMOKE_01_GATE_PASSED=<n>
ML_SMOKE_01_GATE_FAILED=<n>
ML_SMOKE_01_GATE_SKIPPED=<n>
ML_SMOKE_01_GATE_TODO=<n>
ML_SMOKE_01_GATE_CANCELLED=<n>
ML_SMOKE_01_GATE_UNAVAILABLE=0|1
ML_SMOKE_01_REQUIRED_TESTS_PRESENT=YES|NO
ML_SMOKE_01_REQUIRED_TESTS_EXECUTED=<n>/<n>
ML_SMOKE_01_ACCEPTANCE=PASS|FAIL
ML_SMOKE_01_MUTATION_STATUS=DETECTED|INVALID_MUTATION|WRONG_FAILURE|EXECUTION_FAILURE|MUTATION_SURVIVED|NOT_APPLIED
ML_SMOKE_01_MUTATION_DETECTED=YES|NO
ML_SMOKE_01_DISPOSITION=PASS|FAIL|HALT
```

Exit code 0 on `PASS`, 1 on `FAIL`, 2 on `HALT`.
