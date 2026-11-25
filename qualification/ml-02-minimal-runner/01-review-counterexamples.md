# ML-02 — Reproduced review findings and their corrections

> ACT: `ACT-FACTORY-ML-02-MINIMAL-RUNNER-01`.
>
> Every finding below was REPRODUCED against the ACTUAL committed
> implementation at ENTRY_HEAD before the correction was written. Where a
> counterexample is executable, it is executable.

## The 19 recorded identities, re-verified against the actual local files

The independent review reconstructed the relevant files from the supplied
full diff and verified 19 recorded hashes. All 19 matched. The five
ML-06A evaluator/control identities and the four ML-SMOKE-01 evaluator
implementation identities were re-verified against the ACTUAL local files
at ENTRY_HEAD.

### The 5 ML-06A evaluator/control hashes

| File | Recorded hash | At ENTRY_HEAD | Match |
| --- | --- | --- | --- |
| `labs/model-lab/ml_06a_acceptance_oracle.sh` | `534364bb1735de595b8c4670975a4cf207440c6b20d0e309c20410a4b0714f2c` | `534364bb1735de595b8c4670975a4cf207440c6b20d0e309c20410a4b0714f2c` | YES |
| `labs/model-lab/ml_06a_acceptance.test.ts` | `85a1ca886fdcb3587b03818a19bd58084509a503a66f5624a30b7643a91a1db6` | `85a1ca886fdcb3587b03818a19bd58084509a503a66f5624a30b7643a91a1db6` | YES |
| `labs/model-lab/ml_06a_observations.test.ts` | `fcf0ff934068f3ed1e5894605c684b242c4c669becbbd9771e2ab850933d9d42` | `fcf0ff934068f3ed1e5894605c684b242c4c669becbbd9771e2ab850933d9d42` | YES |
| `labs/model-lab/prepare_ml_06a.sh` | `92725420dc855ce93a45b06de685f82f948d7c09a88793100df540f9e2a83ffa` | `92725420dc855ce93a45b06de685f82f948d7c09a88793100df540f9e2a83ffa` | YES |
| `tests/model_lab/test_ml_06a_qualification.sh` | `194b8536fdfb7f7565b8b45f5c44aafaab1e77a2539c969897530deb0e77b85d` | `194b8536fdfb7f7565b8b45f5c44aafaab1e77a2539c969897530deb0e77b85d` | YES |

### The 4 ML-SMOKE-01 evaluator implementation hashes

| File | Hash at ENTRY_HEAD |
| --- | --- |
| `labs/model-lab/ml_smoke_01_lib.mjs` | `8b5ac66de455279d3f26999119fd13a14f9be1574090992c93319fdeb134c19e` |
| `labs/model-lab/ml_smoke_01_tool.mjs` | `7df47e4945d6121f94a1754faa0ff7cc63caa7e05a521c48e4817389d6354ce1` |
| `labs/model-lab/ml_smoke_01_test_reporter.mjs` | `200ea356d84a1bac4d2de35601eda688a203782be3930dee0748eb784af0a87d` |
| `labs/model-lab/ml_smoke_01_acceptance_oracle.sh` | `c4f647c5a8286cb0d6971da962e3858dcecfd0ad45c4582494db893e8b8ca21b` |

The 10 LIVE-SMOKE-01B bundle artifact hashes are recorded in
`qualification/live-smoke-01b/05-bundle/manifest.json` and are PRESERVED
VERBATIM. They were not rewritten by this ACT.

---

## A — Positive mutation-exit authorization

**Reproduced.** `decideMutation()` refused only exit 124 (the timeout
sentinel) and exits `>= 128` (a signal death). Every other status was
accepted as a detection, INCLUDING exits 2, 125, 126 and 127 — none of
which is the Node test runner's failure exit.

```text
$ decideMutation(classifyEvents(stream_with_own_ENOENT), REC1, "ENOENT",
                 { processExit: 2 })
  -> { status: "DETECTED", detected: true }   <-- the defect
$ ... { processExit: 125 } -> DETECTED   <-- the defect
$ ... { processExit: 126 } -> DETECTED   <-- the defect
$ ... { processExit: 127 } -> DETECTED   <-- the defect
```

**Correction.** A detection requires EXACTLY the established Node
test-runner test-failure exit: `processExit === 1`
(`MUTANT_FAILURE_EXIT`). A timeout, a signal death, a missing exit, a
parser failure and any other exit are unrelated execution failures and
are classified, never counted. The note names the unexpected exit:
`mutant_process_exit_unexpected_<n>`.

**Control.** Table-driven regression control **L30** in
`tests/model_lab/test_ml_smoke_01_lib.mjs`.

## B — Complete event-counter contract

**Reproduced.** `classifyEvents()` compared only the per-status counters
that happened to be PRESENT (`if (typeof runnerValue !== "number")
continue`). A completion record carrying only `{"counts":{"tests":9}}`
after nine passing observations was accepted as complete, and its missing
per-status counters were silently ignored.

```text
$ classifyEvents(nine_passing_observations + {"kind":"complete","counts":{"tests":9}})
  -> { complete: true }   <-- the defect
```

**Correction.** The completion record must carry the WHOLE pinned runner
contract: `tests`, `passed`, `failed`, `skipped`, `todo`, `cancelled`,
each present, a nonnegative integer. The reconciliation is UNCONDITIONAL:
the five per-status counters must SUM to the reported total, and each
must equal the number of observed terminal observations with that status.
A zero sum is NOT exempt. Malformed or unknown terminal observations are
no longer silently discarded: they make the stream INCOMPLETE with the
reason `malformed_terminal_observations`.

The reporter's completion record was also verified against the ACTUAL Node
test runner on THIS host (Node v26.0.0): the LAST `test:summary` event is
the FINAL cumulative invocation (2 files, 2 tests), while the per-file
summaries are 1 test each. The reporter keeps the LAST summary, so the
completion record is the cumulative one.

**Control.** Regression controls **L31** in
`tests/model_lab/test_ml_smoke_01_lib.mjs`.

## C — Tree identity and scope

**Reproduced.** `compareTrees()` compared modes only for NON-DIRECTORY
entries and never compared directory presence or object type. A candidate
could therefore:

- remove a protected EMPTY directory (it contributes no file, so the
  historical `v1` digest could not see it either);
- replace a protected regular file with a DIRECTORY (a type substitution).

**Correction.** Two changes, kept separate:

1. `compareTrees()` now reports a DELETED protected directory (including
   an EMPTY one), a TYPE_SUBSTITUTED protected entry, and a MODE_CHANGED
   protected directory. Unsupported objects in the protected tree remain a
   hard error.
2. A NEW, EXPLICITLY VERSIONED tree manifest (`ml-tree-manifest/v2`) binds
   the relative path, the object type, the mode and the file-content
   SHA-256 of EVERY entry, including EMPTY directories. Its serialization
   is one JSON object per line, ordered by relative path, with the format
   version on the first line: unambiguous, and free of timestamps,
   absolute paths and other ambient state.

**HISTORICAL MEANING IS PRESERVED.** `digestOfDirectory()` is UNCHANGED:
it remains the historical `v1` digest. The new digest is a DIFFERENT
identity, reached through `digestOfDirectoryVersioned()`; the two are
never compared with each other, and no historical digest was overwritten
or reinterpreted.

**Control.** Regression controls **L32** in
`tests/model_lab/test_ml_smoke_01_lib.mjs`.

## D — Fail-closed shell orchestration

**Reproduced.** Both oracles invoked the scope tool WITHOUT checking its
exit status, then used a NUMERIC shell comparison on whatever the tool
printed. Bash treats an invalid integer comparison as a failed CONDITION,
so an EMPTY scope result could reach the execution path: the empty
string is not "0", and `[ "" -ne 0 ]` is a failed condition.

**Correction.** A new fail-closed invocation surface,
`labs/model-lab/ml_failclosed.mjs`, performs the invocation and refuses
to hand the oracle anything unless ALL of the following hold:

1. the CLI invocation EXITED SUCCESSFULLY;
2. the CLI produced a NON-EMPTY payload;
3. the payload is VALID STRUCTURED JSON;
4. the required field is present and, where it is a count, is a VALID
   NONNEGATIVE INTEGER.

A missing, malformed or failed inspection result is a typed FAILURE and
HALTs the oracle. The same principle is applied to the digest
calculation, the reference validation, the classification, the acceptance
classification and the observation classification.

**NOT** a blanket `set -e`: the oracles still handle EXPECTED non-zero
outcomes (a rejected candidate is a FAIL, not a HALT), and the oracle
distinguishes an EXPECTED candidate failure from an UNEXPECTED evaluator
failure (`ML_06A_DISPOSITION=FAIL` vs `ML_06A_DISPOSITION=HALT`).

**Control.** Regression control **L33** (the fail-closed surface against
a controlled tool failure) in
`tests/model_lab/test_ml_smoke_01_lib.mjs`.

## E — Reject unauthorized patches before executing them

**Reproduced.** The smoke oracle executed modifications that violated the
permitted content region INSIDE its editable test file. The previous
revision excluded the allowed file from the pre-execution rejection,
because the evaluator deliberately RUNS that file and the allowed-region
rule is a CONTENT check on it. That exemption let a candidate whose bytes
violated the permitted region reach the evaluator's process.

**Correction.** The AUTHORITATIVE path is now UNIFORM: nothing of the
candidate's is executed until BOTH the out-of-file scope verdict AND the
in-file allowed-region verdict are clean. An in-file violation is now
rejected before execution with `ML_SMOKE_01_GATE_EXECUTED=NO`.

The DIRECT behavioural and mutation controls, which need the allowed
file's own diagnostics to be observable, were SEPARATED into an
explicitly NON-AUTHORITATIVE `--behavioral-probe` mode. That mode mints
NO verdict: its disposition is `BEHAVIORAL` and its exit code is 3. The
substance of the previous negative controls (C03, C04, C05, C06, C07,
C08, C11) is preserved: they still assert the exact missing/skipped/
ambiguous/wrong-failure identity, and they now assert it through the
behavioural probe.

**The EXECUTION SENTINEL.** Elapsed time alone is not a proof of
non-execution: a fast rejection and a fast execution are indistinguishable
by elapsed time alone. Control **C16** now uses an EVALUATOR-OWNED
EXECUTION SENTINEL: the tampered candidate bytes carry a statement that
would create a sentinel file if they were ever executed, at a path taken
from an environment variable the evaluator sets for the run. The
authoritative path does not create the sentinel; the behavioural probe
DOES. The control therefore proves both that the prohibited bytes never
executed AND that the sentinel is an effective witness rather than a
sentinel that can never fire.

**ML-06A needs no smoke-specific allowed-region machinery.** The entire
production file stays editable and ML-06A does not restrict the edit to a
sub-region. The ML-06A oracle's rejection path is the ordinary scope
path.

## F — Strengthen the existing qualification witnesses

### The ML-06A M01 control

**Reproduced.** The M01 control searched the human-readable `spec`
reporter output for several identifiers (`ML06A-02`, `ML06A-03`,
`ML06A-04`, `✔ ML06A-01`, `✖ ML06A-10`, …) WITHOUT requiring the
corresponding FAILED or PASSED status. A free-text search is not an
observation.

**Correction.** M01 now reads the STRUCTURED event stream and requires
the exact terminal STATUS of every one of the nine assertions:

- ML06A-01 (ordinary tree) — PASSED;
- ML06A-02 (shared sibling OBJECTS) — FAILED;
- ML06A-03 (shared sibling ARRAYS) — FAILED;
- ML06A-04 (shared substructure at different depths) — FAILED;
- ML06A-05 (direct cycle) — PASSED;
- ML06A-06 (indirect cycle) — PASSED;
- ML06A-07 (cycle within shared substructure) — PASSED;
- ML06A-08 (invalid-value behaviour) — PASSED;
- ML06A-10 (the SAME underlying defect) — FAILED;

plus the exact counts: 4 failures and 5 passes. The ML06A-10 failure is
recorded as a CONSEQUENCE of the same defect: the known-bad validator
refuses the shared-substructure manifest, so the immutability assertion's
precondition does not hold.
