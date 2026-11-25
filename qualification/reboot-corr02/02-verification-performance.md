# REBOOT-CORR02 — Verification Performance

> The Factory gate went from **1.35 s** to **225.81 s**. That is
> unacceptable as ordinary development feedback. This document records the
> measurement, the separation, and the measured result.

---

## 1. The measurement

Measured on the same host (macOS/darwin, Node `v26.0.0` at
`/opt/homebrew/bin/node`), with `time` around the whole command.

### Before (CORR01 revision, single gate)

```text
$ time bash scripts/verify_factory.sh
...
=== Factory gate complete ===
FACTORY_VERIFY_DISPOSITION=FAIL (1 verifier(s) failed)

bash scripts/verify_factory.sh  48.83s user 33.51s system 97% cpu 1:24.87 total
```

The CORR01 exit report recorded **225.81 s** as the observed gate time. The
re-measurement above was **84.87 s** on the CORR01 tree with its controls
failing early; the CORR01 report's 225.81 s is the figure carried forward
from the CORR01 observation.

### The cause

Step 7 of the gate ran `tests/model_lab/test_ml_smoke_01_oracle.sh`, whose
eleven controls each executed the **real** fixture **twice** — once for the
candidate, once for the mutant. Each execution started a real Node test
runner over the historical `cp-crash.test.ts` and
`ledger-writer-socket-probe.test.ts`. Eleven controls times two executions
times a multi-second harness is minutes of wall clock.

## 2. The separation

Three levels, each with a distinct command and a distinct claim.

| Level | Command | What it establishes | Runtime |
| --- | --- | --- | --- |
| **Fast deterministic** | `bash scripts/verify_factory.sh` | Worktree topology, documentation links, the four frozen-contract guards, and the oracle's DECISION LOGIC. | **1.39 - 1.69 s** |
| **Fast deterministic** (standalone) | `bash scripts/verify_factory_fast.sh` | The same set. | **1.45 - 1.66 s** |
| **Real historical fixture integration** | `bash tests/model_lab/test_ml_smoke_01_oracle.sh` | Seventeen controls that execute the real historical fixture end to end. | ~3 min |
| **Full adversarial qualification** | `bash scripts/verify_factory_qualification.sh` | The fast gate PLUS the real-fixture controls. | **232.112 s** |

### What made it fast

The decision logic was extracted from the shell into
`labs/model-lab/ml_smoke_01_lib.mjs`, and the controls for it were rewritten
against **synthetic structured-event inputs** and **synthetic filesystem
trees**:

- `tests/model_lab/test_ml_smoke_01_lib.mjs` — 44 assertions, **0.15 s**,
  no fixture execution, no Node test runner, no historical file touched.

The expensive inputs were reserved for the expensive controls. The
acceptance criteria were **not** weakened: every defect that had a control
still has one, and the real-fixture controls still execute the real fixture.

### What was NOT weakened

| Control | Fast level | Full level |
| --- | --- | --- |
| failure identity contamination | L01, L01b | C07 |
| self-comparison fallback | L02 | C12 |
| dependency trust | L03 | C13 |
| symlink substitution | L04 | C14 |
| enumeration failure swallowed | L05 | — |
| unauthorised mode change | L06 | C15 |
| skipped required test | L07 | C04, C05 |
| the historical false-PASS counterexample | L08 | C11 |
| allowed-region validation | L09 | C16 |
| invalid-source mutation | L10 | C06 |
| destructive output-directory reuse | L11 | — |
| concurrent preparation | L14 | — |
| concurrent oracle runs | — | C17 |
| known-bad fixture | — | C01 |
| known-good fixture | — | C02 |
| deleted / skipped required test | — | C03, C04, C08 |
| invalid base commit | — | C10 |

## 3. The result

Five consecutive runs of the ordinary gate, wall clock:

```text
$ for i in 1 2 3 4 5; do /usr/bin/time -p bash scripts/verify_factory.sh; done
verify_factory.sh run1 real 1.59
verify_factory.sh run2 real 1.43
verify_factory.sh run3 real 1.39
verify_factory.sh run4 real 1.42
verify_factory.sh run5 real 1.69

$ for i in 1 2 3; do /usr/bin/time -p bash scripts/verify_factory_fast.sh; done
verify_factory_fast.sh run1 real 1.66
verify_factory_fast.sh run2 real 1.62
verify_factory_fast.sh run3 real 1.45
```

The authoritative gate remains a real gate:

```text
$ time bash scripts/verify_factory_qualification.sh
...
PASS=41  FAIL=0
  [OK]  Model Lab real-fixture qualification controls

=== Factory QUALIFICATION gate complete ===
FACTORY_VERIFY_QUALIFICATION_DISPOSITION=PASS

bash scripts/verify_factory_qualification.sh  150.61s user 38.64s system 81% cpu 3:52.09 total
```

**1.39 - 1.69 s** (median ~1.45 s) against a target of **5 s**, and against
the 1.35 s pre-regression baseline. The target is met with a ~3.5x margin,
and the ordinary gate is back to its original cost.

## 4. Concurrent-gate interference

### Observed

The CORR01 oracle ran the gate **directly in the candidate's workspace** and
removed `.tmp-home` from it. Two concurrent runs against one workspace
therefore fought over the same directory, and one saw the other's residue.

### The correction — subtraction, not a requirement

The CORR02 oracle does not run the gate in the candidate's workspace at all.
It builds a **fresh evaluator reconstruction** per run, from the trusted
fixture, the evaluator's own dependency tree and the validated allowed
patch. Each run therefore owns its own directory, and concurrent runs are
independent **by construction**. This is measured, not documented:

```text
--- C17 two concurrent oracle runs on the same workspace -> identical verdicts ---
  [PASS] C17 both concurrent runs reached DISPOSITION=PASS
  [PASS] C17 run A observed no scope violation
  [PASS] C17 run B observed no scope violation
```

and by an ad-hoc reproduction during this ACT:

```text
A exit=0    B exit=0
A: ML_SMOKE_01_DISPOSITION=PASS
B: ML_SMOKE_01_DISPOSITION=PASS
```

### The fixture preparation

The preparation is the one place where two processes legitimately contend
for the SAME directory. It now takes an **exclusive lock keyed by the
absolute output directory path**, held outside `out_dir` so that taking it
never creates a file in a directory the script does not own. A stale lock
whose owner is gone is detected and removed.

```text
PREPARE_ERROR=output_directory_preparation_in_progress
```

This is an enforced mechanism, not a documented requirement: control **L14**
holds a live lock and asserts that the preparation is refused, then plants a
stale lock and asserts that the preparation still succeeds.

## 5. A defect in the fast controls, found by measurement

The first version of the fast controls took **4.23 s** of wall clock for
**0.37 s** of CPU. The CPU profile located the cost precisely:

```text
3826.4 ms  spawnSync  child_process:1111
```

The controls that exercise the preparation's ownership rule and its
exclusion lock invoked the **whole** preparation, which materialises the
fixture with a `git archive` of the historical base — an expense those
controls do not need, because what they test is the ownership decision and
the lock, not the fixture.

Two corrections:

1. the preparation gained a `--check-only` mode that exercises the ownership
   check and the lock and stops before the fixture is materialised;
2. the lock acquisition now **fails fast** when the owner is alive, instead
   of polling. A stale lock (owner gone) is still detected and removed.

The fast controls then ran in **0.32 s**.

### A second defect, in the control itself

The correction above exposed a defect in the **L14 control**: it computed
the lock key from the unresolved path, while the preparation computes it
from the **resolved** path (`cd ... && pwd`, which follows symlinks). The
two therefore disagreed, and L14 was planting a lock the preparation never
looked at — it was passing for the wrong reason.

The control now resolves the path the same way the preparation does.

The fix was verified by **breaking the mechanism on purpose**: disabling the
live-owner branch of the lock made L14 fail, and restoring it made L14 pass
again.

```text
mechanism disabled
  [FAIL] L14 a concurrent preparation of the same out_dir is refused
RESTORED
PASS=44  FAIL=0
```

This is the failure-identity discipline applied to the controls themselves:
a control that cannot fail is not evidence.

## 6. Which command establishes which level of assurance

| Question | Command |
| --- | --- |
| Is the repository canonically shaped? | `scripts/verify_worktree_policy.sh` |
| Do the documents still link? | `scripts/check_links.sh` |
| Are the frozen long-horizon substrates intact? | `scripts/verify_lh0{3,4,5,6}_frozen.sh` |
| Does the oracle still classify and scope correctly? | `tests/model_lab/test_ml_smoke_01_lib.mjs` (**fast**) |
| Does the oracle still work against the REAL fixture? | `tests/model_lab/test_ml_smoke_01_oracle.sh` (**mandatory** when authority changes) |
| Is everything green, including the real fixture? | `scripts/verify_factory_qualification.sh` (**authoritative**) |
| Is the `codium-lab` control path still sound? | `labs/model-lab/verify_codium_lab_readonly.sh` |

**Full qualification remains mandatory when the oracle authority changes.**
The fast gate does not replace it; it precedes it.
