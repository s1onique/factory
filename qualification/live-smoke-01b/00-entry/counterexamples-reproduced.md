# LIVE-SMOKE-01B — The Reproduced Counterexamples and Their Corrections

> ACT: `ACT-FACTORY-LIVE-SMOKE-01B`
> Continuation of `ACT-FACTORY-LIVE-SMOKE-01`.
> Every counterexample below was reproduced on THIS host, against the ACTUAL
> corrected-in-progress code, before the correction was written.
>
> The predecessor's counterexamples (`qualification/live-smoke-01/00-entry/`)
> are PRESERVED and are NOT rewritten.

---

## E1 — `decideMutation` accepted the intended ENOENT failure with process exits 0 and 137

**Reproduced.** `decideMutation()` refused only exit 124 (the timeout
sentinel) and accepted every other status.

```text
$ decideMutation(classifyEvents(stream_with_own_ENOENT), REC1, "ENOENT",
                 { processExit: 0 })
  -> { status: "DETECTED", detected: true }   <-- the defect

$ decideMutation(classifyEvents(stream_with_own_ENOENT), REC1, "ENOENT",
                 { processExit: 137 })
  -> { status: "DETECTED", detected: true }   <-- the defect
```

Exit 0 means the runner reported SUCCESS while the required test was
observed failing: the two observations contradict each other. Exit 137 is
SIGKILL: the event stream was cut short by the kill, so it is not the
runner's own completed verdict.

**Correction.** A detection requires the EXPECTED MUTANT TEST-FAILURE
EXIT: a non-zero status that is neither the timeout sentinel nor a signal
death. Exit 0, exit >= 128 and an unknown exit are all classified, never
counted. Control **L24**.

## E2 — `classifyEvents` accepted a completion record with null counts

**Reproduced.** The completion record's counts were used only as a
lower-bound total.

```text
$ classifyEvents(record + completion{counts: null})
  -> { complete: true }   <-- the defect
$ classifyEvents(record + completion{})          # no counts at all
  -> { complete: true }   <-- the defect
```

**Correction.** A completion record that carries no counts is not
completion evidence. Controls **L25**.

## E3 — `classifyEvents` accepted an inconsistent total

**Reproduced.** The runner's own per-status counts did not sum to the
runner's own total, and the record was accepted.

```text
$ classifyEvents(1 record + completion{tests: 5, passed: 1, ...})
  -> { complete: true }   <-- the defect
```

**Correction.** The completion record's per-status counts must sum to its
own total. Control **L25**.

## E4 — `classifyEvents` accepted contradictory status counts

**Reproduced.** The runner reported `passed: 1` while the stream carried a
failure. The old check compared only the TOTAL, so the contradiction was
invisible.

```text
$ classifyEvents(1 failing record + completion{tests: 1, passed: 1, failed: 0})
  -> { complete: true }   <-- the defect
```

**Correction.** Every per-status count the runner reports must equal the
number of observations with that status. Control **L25**.

## E5 — The shell oracle executed candidate-modified code before rejecting scope violations

**Reproduced.** The oracle computed the scope verdict and then ran the
gate on the candidate's code anyway. The candidate's bytes reached the
evaluator's own reconstruction, its dependency tree and its process before
the verdict was computed.

```text
$ <oracle> <workspace with an unauthorised change>
  SCOPE_VIOLATION MODIFIED labs/long-horizon-harness/src/recovery/process-reconciler.ts
  ML_SMOKE_01_SCOPE_VIOLATIONS=1
  ... the gate ran anyway, and the mutant gate ran too ...
  ML_SMOKE_01_DISPOSITION=FAIL
```

**Correction.** An unauthorised patch is REJECTED BEFORE EXECUTION. The
rejection is a FAIL, never a HALT: the oracle's own authorities were all
established. The measured rejection now takes 0.68 s instead of ~120 s,
and the oracle reports `ML_SMOKE_01_GATE_EXECUTED=NO`. Controls **C18**
(and **M04** for ML-06A).

**THE ONE EXCEPTION, AND WHY.** The single ALLOWED file is the file the
fixture is about: the evaluator deliberately runs it, and the allowed-region
rule is a CONTENT check on it, not a statement that its bytes are
untrusted. A candidate that tampers with the assertions inside it is caught
by the allowed-region verdict, which contributes to the final FAIL. Every
OTHER class of unauthorised change — a modified protected file, an added
file, a changed mode, a candidate-owned dependency tree — is rejected
before execution. This distinction was established by execution, not by
assumption: the first attempt treated an allowed-region violation as a
pre-execution rejection too, and the real-fixture controls C03–C08, C11
then failed, because those controls need the in-region diagnostics that the
allowed file's execution produces.

## E6 — Reconstruction and patch-copy return statuses were not checked

**Reproduced.** `build_reconstruction()` and `apply_allowed_patch()`
ignored their return status.

```text
$ build_reconstruction()   # `mkdir -p` failed; the status was discarded
$ apply_allowed_patch()    # `cp` failed; the status was discarded
  -> the gate then ran the RECONSTRUCTION's own pristine copy of the file
  -> a verdict about the WRONG bytes
```

**Correction.** Both functions return a status, and the oracle HALTs when
either fails. `apply_allowed_patch()` additionally verifies that the copy
is non-empty. Controls: the reconstruction and patch-copy failures are now
HALT paths (`evaluator_reconstruction_failed`, `allowed_patch_not_applied`).

## E7 — `compareTrees` missed protected directory mode changes

**Reproduced.** Modes were compared only for NON-DIRECTORY entries, so a
candidate could `chmod 700` a protected DIRECTORY and the change was
invisible: the directory's path was present in both trees, so it was not
an ADDED entry, and directories were excluded from the content comparison,
so their mode was never read.

```text
$ compareTrees(ref, ws_with_chmod_700_on_a_protected_dir)
  -> { error: null, violations: [] }   <-- the defect
```

**Correction.** Every directory present in BOTH trees must carry the SAME
mode. Controls **L26** (fast) and **C19** (real fixture).

## E8 — `describeRootOverlap` missed a nested directory named `..nested`

**Reproduced.** "Outside the base" was decided with `rel.startsWith("..")`,
a STRING test rather than a PATH test.

```text
$ describeRootOverlap("/base", "/base/..nested")
  -> null   <-- the defect: the nested root OVERLAPS the base
```

`path.relative("/base", "/base/..nested")` is `"..nested"`, which starts
with `".."` but names a directory INSIDE the base.

**Correction.** The decision is made on the FIRST PATH SEGMENT: only a
segment that is exactly `..` leaves the base. A genuinely disjoint sibling
that merely STARTS with `..` in its name (`..sibling`) is still reported
as disjoint. Control **L27**.

## E9 — The fixture preparation created its output directory non-atomically

**Reproduced.** The preparation tested for existence and then created the
directory with a separate `mkdir -p`, so two concurrent preparations could
both pass the existence test and both write into the same directory.

```text
$ (prepare A & prepare B)   # same target
  A: ML_SMOKE_01_PREPARE_CHECK_ONLY=YES
  B: ML_SMOKE_01_PREPARE_CHECK_ONLY=YES   <-- both created it
```

**Correction.** The creation is ATOMIC: a single `mkdir` (not `mkdir -p`),
whose failure IS the refusal. There is no lock, no ownership marker, no
directory recycling and no stale-lock reclamation. Control **L28**.

## E10 — The reporter counted a SUITE as a test observation

**Reproduced.** Node reports a suite's own terminal observation as a
`test:pass`/`test:fail` whose `details.type` is `"suite"`, and the runner
counts suites SEPARATELY (`counts.suites`), not in `counts.tests`. The
reporter did not distinguish the two, so a run with one suite produced ONE
MORE terminal observation than the runner's own `tests` count — and the
completion record could never reconcile.

**Correction.** The reporter emits a suite with its own `kind`, and the
classifier excludes it from the test counts. Control **L29** (against the
REAL Node test runner).

## E11 — The ML-06A oracle's first revision read its counts from free text

**Reproduced.** The ML-06A oracle's first revision read the pass/fail
counts from the `spec` reporter's summary lines and accepted the run when
the process exit was 0.

```text
$ <ML-06A oracle> <workspace whose acceptance test file was misnamed>
  ML_06A_GATE_EXIT=0
  ML_06A_ACCEPTANCE_TESTS_PASSED=0
  ML_06A_ACCEPTANCE_TESTS_FAILED=0
  -> the summary lines are ANSI-coloured, so the grep matched NOTHING,
     and the verdict was about ZERO observations
```

A run whose test file could not be found produced NO summary at all.

**Correction.** The ML-06A oracle reads the STRUCTURED event stream, and
its acceptance is bound to the EXACT identity of every required test: all
nine must be PRESENT, EXECUTED and PASSING, and the completion record must
reconcile. A missing test file, a truncated stream and a contradictory
completion record are all rejected. The evaluator's OBSERVATIONS run in
their OWN file and their OWN process, so a failing observation cannot
change the acceptance verdict.
