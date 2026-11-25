# REBOOT-CORR02 — Reproduced Counterexamples and Their Corrections

> Every finding below was reproduced by EXECUTING the actual CORR01 oracle
> (`labs/model-lab/ml_smoke_01_acceptance_oracle.sh` at the CORR01 revision)
> or, where the finding is about a control rather than the oracle, by
> executing the actual control. Nothing is a paraphrase of a digest.
>
> The CORR01 artifacts are **not** modified by this ACT. This document
> describes the defects that were open at the CORR01 exit and the
> corrections that close them.

---

## D1 — Failure identity contamination

### The defect

The mutant verdict was decided by searching the WHOLE mutant log for the
string `ENOENT`:

```bash
if grep -aqF "${INTENDED_FAILURE_SIGNATURE}" "${mutant_log}"; then
    mutation_status="DETECTED"
```

The log contains every test's output. An **unrelated** test that emitted an
ENOENT diagnostic satisfied the rule, so the oracle reported `DETECTED` for
a mutant whose required test failed for a completely different reason.

### Reproduction

Synthetic structured events (the same shape the corrected reporter emits):

```text
REC-TMP01                      status=fail  codes=[ERR_TEST_FAILURE, ERR_ASSERTION]
SOME-OTHER-TEST: unrelated     status=fail  codes=[ERR_TEST_FAILURE, ENOENT]
```

The CORR01 rule answered `DETECTED`. The corrected rule answers
`WRONG_FAILURE`.

### The correction

The gate results are read from a **structured** Node test reporter
(`labs/model-lab/ml_smoke_01_test_reporter.mjs`). Each record carries the
test's exact name, its status, and the **chain of error codes its own
failure produced**. The verdict is bound to the required test's own record:

```text
ML_SMOKE_01_MUTATION_STATUS=WRONG_FAILURE
ML_SMOKE_01_MUTATION_DETECTED=NO
```

The mechanism is the error code chain, not the message text. An assertion
failure produces `ERR_ASSERTION`; a missing path produces `ENOENT`. Both are
in the chain, so the oracle can tell them apart without reading prose.

**Controls:** L01, L01b (fast) and C07 (full qualification).

---

## D2 — The optional reference

### The defect

The prepared reference was an OPTIONAL fourth argument. Without it the
oracle set

```bash
reference_dir="${workspace}"
reference_kind="WORKSPACE"
```

and compared the candidate **against itself**. Every unauthorised change
produced zero scope violations.

### Reproduction

Invoke the CORR01 oracle with three arguments against a workspace that has
an unauthorised modification:

```text
$ bash ml_smoke_01_acceptance_oracle.sh <repo_root> <base> <workspace>
ML_SMOKE_01_REFERENCE_KIND=WORKSPACE
ML_SMOKE_01_SCOPE_VIOLATIONS=0        <-- the unauthorised change is invisible
```

### The correction

The prepared reference is **REQUIRED**. Without it the oracle emits
`ML_SMOKE_01_ERROR=prepared_reference_required` and `DISPOSITION=HALT`. There
is no self-comparison fallback.

In addition, the reference is **bound to its expected fixture identity**: the
digest recorded in `identity.txt` when the fixture was prepared must equal
the digest the oracle computes from the reference tree. A reference that does
not match its own recorded identity is a `HALT`.

```text
ML_SMOKE_01_REFERENCE_DIGEST=cd269fa584b1a547aeb165b5e19cbd509fe3df6cd47a9f4547a92a6031ecf677
ML_SMOKE_01_EXPECTED_REFERENCE_DIGEST=cd269fa584b1a547aeb165b5e19cbd509fe3df6cd47a9f4547a92a6031ecf677
ML_SMOKE_01_REFERENCE_IDENTITY=VALID
```

**Controls:** L02 (fast), C12 (full qualification).

---

## D3 — Dependency trust

### The defect

The dependency tree was excluded from the scope diff, and its integrity was
asserted by a **path-resolution** check alone:

```bash
if [ -e "${dep_path}" ]; then
    dep_real="$(cd "${dep_path}" 2>/dev/null && pwd -P || echo UNRESOLVABLE)"
    dependency_trust="TRUSTED"
```

Any `node_modules` directory whose path resolved was classified `TRUSTED`. A
candidate that replaced the tree with its own copy was therefore trusted. The
candidate's dependencies would have become the evaluator's dependencies.

### The correction

Three things now hold:

1. the workspace must **not** own a dependency tree — a candidate-created
   `node_modules` is a `FORBIDDEN_DEPENDENCY` scope violation;
2. if the workspace does have one, it must resolve to the **evaluator's own**
   real path; anything else is `UNTRUSTED`;
3. the gate runs in an evaluator reconstruction that the oracle builds
   itself, and the oracle links the **evaluator's** tree into it. The
   candidate's tree is never used.

```text
ML_SMOKE_01_DEPENDENCY_TRUST=EVALUATOR_SUPPLIED   <-- workspace owns none
ML_SMOKE_01_DEPENDENCY_TRUST=TRUSTED               <-- workspace has the evaluator's
ML_SMOKE_01_DEPENDENCY_TRUST=UNTRUSTED             <-- workspace owns its own
```

**Controls:** L03 (fast), C13 (full qualification).

---

## D4 — Symlink substitution and unsupported object types

### The defect

The scope walk compared content digests and skipped anything that was not a
regular file:

```bash
if [ ! -f "${workspace}/${path}" ]; then
    echo "DELETED ${path}" >> "${changed_list}"
    continue
fi
```

A protected regular file replaced with a **symlink to identical content**
produced **zero** scope violations: the digest matched the target, and the
object type was never checked.

Unauthorised **mode** changes were invisible for the same reason — only
content was compared.

### The correction

The comparison records the object type and the mode of every entry:

- a symlink where the reference has a regular file → `UNSUPPORTED_OBJECT`;
- any other unsupported object type → `UNSUPPORTED_OBJECT`;
- a mode that differs from the reference's → `MODE_CHANGED`;
- an enumeration error → the comparison returns an error and the oracle
  **halts**. It is never swallowed.

**Controls:** L04, L05, L06 (fast), C14, C15 (full qualification).

---

## D5 — Destructive output-directory reuse

### The defect

The fixture preparation began with:

```bash
rm -rf "${out_dir}"
```

on a **caller-supplied** path, with no check that the directory belonged to
the preparation. A caller passing an unrelated directory would lose it.

### The correction

The preparation refuses a non-empty directory it does not own, and never
deletes anything from a directory it did not create:

```text
PREPARE_ERROR=output_directory_not_owned_and_not_empty
```

A directory the script created itself carries a marker file and may be
replaced.

**Controls:** L11 (fast).

---

## D6 — Concurrent preparation interference

### The defect

Two concurrent preparations of the SAME `out_dir` raced: both saw the marker,
both deleted the tree, and one materialised the fixture into a tree the other
had just removed. The result was a corrupted fixture presented as a valid
one.

### The correction

The preparation takes an **exclusive lock keyed by the absolute output
directory path**. The lock lives outside `out_dir`, so taking it never
creates a file in a directory the script does not own. A stale lock (its
owner is gone) is detected and removed, so a killed run cannot block forever.

```text
PREPARE_ERROR=output_directory_preparation_in_progress
```

Separately, the **oracle** is now immune to concurrent runs on the same
workspace, because it runs the gate in its own reconstruction instead of in
the candidate's directory. Two concurrent oracle runs against one workspace
reach the same verdict (control C17).

**Controls:** L14 (fast), C17 (full qualification).

---

## D7 — C01 and C11 did not establish their stated failure mechanisms

### C01

The CORR01 control asserted `GATE_FAILED=1`. That establishes that **some**
test failed. It does not establish that the failure was **REC-TMP01's** — the
defect under test. The control could have passed for the wrong reason.

The corrected C01 asserts that REC-TMP01 itself failed while REC-TMP02 — the
regression half — still executed and passed, and that the mutation control
reports `NOT_APPLIED` (there is nothing to mutate in the known-bad fixture).

### C11

The CORR01 control's "skip" was applied by this regex:

```python
re.sub(r'(test\("REC-TMP01[^"]*", async \(\) => \{)', r'\1 t.skip("vacuous"); return;', t, count=1)
```

The file's actual shape is `async () => {`, and the pattern did not match.
The replacement was never applied, so the counterexample **THREW** a
`ReferenceError` (`t is not defined`) instead of skipping. The control
passed — DISPOSITION was FAIL — **for the wrong reason**: it was a thrown
error, not a skip.

The corrected C11 asserts that the required test was actually **SKIPPED**:

```text
ML_SMOKE_01_REQUIRED_SKIPPED REC-TMP01
```

and that it did **not** fail through an unrelated mechanism.

---

## Summary

| ID | Defect | Reproduced | Correction | Fast control | Full control |
| --- | --- | --- | --- | --- | --- |
| D1 | failure identity contamination | YES | structured reporter + per-test error-code chain | L01, L01b | C07 |
| D2 | optional reference / self-comparison | YES | reference REQUIRED and identity-bound | L02 | C12 |
| D3 | dependency trust by path resolution | YES | identity-bound dependency trust; candidate tree is a violation | L03 | C13 |
| D4 | symlink substitution, mode changes, swallowed enumeration errors | YES | object type and mode are compared; enumeration fails closed | L04, L05, L06 | C14, C15 |
| D5 | destructive output-directory reuse | YES | ownership check; never deletes a foreign directory | L11 | — |
| D6 | concurrent preparation interference | YES | exclusive per-output-directory lock; per-run gate reconstruction | L14 | C17 |
| D7 | C01 and C11 did not establish their stated mechanisms | YES | controls now assert the mechanism itself | — | C01, C11 |
