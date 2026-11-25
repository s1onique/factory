# REBOOT-CORR01 — First pstack-Derived Correction Record

> Work package A5. The first observed mistake class of the Factory Reboot,
> routed to deterministic enforcement. **Provisional** until independently
> reviewed.

> **HISTORICAL.** This record describes the CORR01 implementation of the
> discipline. It was subsequently strengthened by
> `ACT-FACTORY-REBOOT-CORR02-HAR02`: the negative evidence is now bound to
> the exact test identity and to that test's own error-code chain, read from
> a structured reporter, rather than to a substring of the run log. The
> current evidence is `qualification/reboot-corr02/`.

---

## 1. The observed mistake class

The REBOOT-01 acceptance oracle accepted an **arbitrary failure** as proof of
an **intended failure**. Two independent manifestations, both reproduced:

| # | Manifestation | Consequence |
| --- | --- | --- |
| 1 | The known-bad mutation produced a **syntax error**, and any nonzero mutant exit was accepted as "mutation detected". | The mutation witness never exercised the intended behavioral defect. The oracle's own non-vacuity guarantee was unfounded. |
| 2 | Every TAP line beginning with `ok ` was counted as a pass, including `ok N - name # SKIP reason`. | A fixture whose every test was skipped was accepted as `ACCEPTANCE=PASS`, producing a **demonstrated false PASS**. |

These are not two independent bugs. They are one mistake class: **the oracle
did not check that the failure it observed was the failure it asked for.**

The deeper form of the mistake is familiar to us: *the model identified a
genuine environmental defect, designed a reasonable defence, implemented that
defence incorrectly, and produced convincing evidence that appeared to
establish correctness.* Nothing about that is a model-capability finding. We
have no comparative evidence about any model, and none is claimed. The lesson
is about **our verification machinery**.

## 2. The discipline (provisional)

> **Failure identity discipline.** A negative control is successful only if it
> establishes the specified negative outcome through the specified mechanism.

| Observation | Expected verdict |
| --- | --- |
| Intended assertion fails | Mutation detected |
| Compilation / parse fails | Invalid mutation |
| Test is skipped | Required evidence absent |
| Unrelated assertion fails | Wrong failure |
| Process times out | Execution failure |
| Dependency is missing | Environment failure |
| Mutant unexpectedly passes | Mutation survived |

**Status: PROVISIONAL.** It is encoded as executable behaviour first, in one
concrete implementation, with regression controls. It is **not** promoted to
Factory doctrine, **not** turned into a skill, and **not** generalised into a
mutation-testing framework.

## 3. The concrete enforcer

`labs/model-lab/ml_smoke_01_acceptance_oracle.sh` — the mutation-control
step and the TAP-classification step.

### Enforced conditions

For a mutation to count as detected, **all four** must hold:

| # | Condition | Implementation |
| --- | --- | --- |
| 1 | applied to the intended statement | statement-level regex `const tmpRoot = await fs\.mkdtemp\([^;]*\);` replaced wholesale |
| 2 | mutated source is syntactically valid | `esbuild.transform(..., { loader: "ts" })` — the **same loader the harness uses** |
| 3 | the required test EXECUTES in the mutant | the mutant's TAP line for the required test must exist and must not carry `# SKIP` / `# TODO` / `# CANCEL` |
| 4 | it fails with the intended signature | the mutant log must contain `ENOENT` |

Anything else is **classified**, not counted:

```text
ML_SMOKE_01_MUTATION_STATUS=DETECTED|INVALID_MUTATION|WRONG_FAILURE|EXECUTION_FAILURE|MUTATION_SURVIVED|NOT_APPLIED
ML_SMOKE_01_MUTATION_DETECTED=YES   # only for DETECTED
```

For the acceptance gate, TAP results are classified into
passed / failed / skipped / todo / cancelled, and the two **required** tests
must each be **present, executed, and passing**.

### Why esbuild and not `node --check`

`node --check` does **not** parse TypeScript. During this ACT it accepted a
deliberately broken `.ts` file with exit 0. Had the oracle used it, condition
2 would have been vacuous — the same class of defect one level down. The
oracle now uses the harness's own loader, and **fails closed** if that loader
is unavailable.

This is itself an instance of the discipline: the check for "is this source
valid?" must use the mechanism that will actually load the source.

## 4. The counterexample that must never pass again

The historical false-PASS counterexample is preserved as an executable control
(**C11**) in `tests/model_lab/test_ml_smoke_01_oracle.sh`:

```text
fixture: required test skipped + a helper test that passes
expected: ML_SMOKE_01_DISPOSITION=FAIL
```

Before the correction, the REBOOT-01 oracle returned `DISPOSITION=PASS` on this
input. After the correction it returns `FAIL`.

## 5. The regression controls

`tests/model_lab/test_ml_smoke_01_oracle.sh` — **20 assertions, all passing**
(as of the CORR01 exit; the control set was later rewritten by CORR02 into
a fast level and a real-fixture level, and the C11 control was corrected
because it did not establish its stated failure mechanism).

| Control | Case | Expected |
| --- | --- | --- |
| C01 | prepared known-bad fixture | FAIL — intended REC-TMP01 defect |
| C02 | known-good fixture | PASS |
| C03 | REC-TMP01 deleted | FAIL |
| C04 | REC-TMP01 skipped | FAIL |
| C05 | all tests skipped | FAIL |
| C06 | syntactically invalid mutation | NOT DETECTED (`INVALID_MUTATION`) |
| C07 | mutation fails for an unrelated reason | NOT DETECTED (`WRONG_FAILURE`) |
| C08 | required regression test skipped | FAIL |
| C09 | unauthorized changed file | FAIL |
| C10 | invalid base commit | HALT (exit 2), never PASS |
| C11 | the historical false-PASS counterexample | FAIL |

C06 and C07 are the direct executable expression of the discipline. C06 is the
REBOOT-01 P0.1 failure mode **inverted**: there, an invalid mutant was
accepted as a detection; here, an invalid mutant must be rejected.

## 6. What was deliberately NOT created

Per the review's instruction and Factory's own simplicity constraint:

- no generic mutation-testing framework;
- no new global doctrine page;
- no skill registry;
- no generic feedback compiler;
- no additional executor, runner, or benchmark engine.

One concrete implementation plus its regression controls. That is the whole
change.

## 7. Routing decision (pstack `correct` levels)

The lesson was routed to the **highest level that works**:

| Level considered | Why not |
| --- | --- |
| Architecture | the oracle's structure was already correct; the defect was in what it *checked*, not in how it was organised |
| **Deterministic gate** | **CHOSEN** — the failure-identity check is mechanical, executable, and prevents the error class for every future user of the oracle |
| Skill | insufficient: a skill teaches, it does not enforce; the failure mode was a machine accepting bad evidence |
| Rule | insufficient: a rule would be advisory, and the failure mode was a machine accepting bad evidence |
| No change | rejected: the error class was demonstrated twice and produced a false PASS |

**Enforcer:** `labs/model-lab/ml_smoke_01_acceptance_oracle.sh`, mutation step
+ TAP classification.
**Counterexample:** control C11, plus C06 and C07.
