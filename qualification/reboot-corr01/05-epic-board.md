# Factory Reboot — Epic Board (after independent review)

> ACT: `ACT-FACTORY-REBOOT-CORR01-HAR01`
> Supersedes `qualification/reboot/07-epic-board.md`. **No epic history was
> erased**: the REBOOT-01 board remains on disk as the record of what was
> believed at that time.

---

## Title

Factory Reboot — Model Evaluation and Continuous Engineering Improvement

## Status

`In Progress`

## Problem

Unchanged from the REBOOT-01 board, with one correction: the REBOOT-01
acceptance oracle produced a **demonstrated false PASS**. The verification
machinery, not the task design, was the blocking defect. That has been
corrected and is now guarded by executable regression controls.

## Goal

Unchanged. Establish a measured improvement cycle: one independently verified
fixture, a minimal deterministic runner, and a Discipline Lab that measures
whether engineering-environment changes improve correctness and speed.

## Non-goals

Unchanged. Long-horizon autonomy, generalized benchmark languages, workflow
engines, reviewer panels, skill registries, evidence databases and composite
leaderboards all remain out of scope.

## ACT Board

### Model Lab (ML) — variable: the model

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| REBOOT-01 | Preserve LH-07, establish baseline, qualify first fixture | P0 | **Accepted in part** | Baseline accepted; D01 qualification suspended and superseded |
| **REBOOT-CORR01** | Repair the oracle and the task contract; provision `codium-lab` | P0 | **Done (this ACT)** | Oracle re-qualified; `codium-lab` blocked by sandbox writes |
| ML-01 | Qualify the initial historical fixture | P0 | **Re-established as ML-SMOKE-01** | Single defect, one allowed file, evaluator-owned oracle; 20/20 regression controls pass |
| ML-02 | Minimal single-run executor | P0 | Proposed | Scope in `qualification/reboot/08-ml02-scope.md`; must use the corrected oracle and reconstruct the evaluator workspace |
| ML-03 | MiniMax baseline execution | P0 | Proposed | Requires budget authorization |
| ML-04 | Model comparison report | P0 | Proposed | Needs ≥2 models |
| ML-05 | Qwen3.8 / Basalt qualification | P1 | Awaiting backend | Endpoint already configured in `codium-clinemm`; reachability untested |
| ML-06 | Expand fixture corpus | P2 | Proposed | **Needs a solution-blind fixture** before DL-03 can be interpreted |

### Discipline Lab (DL) — variable: the engineering environment

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| DL-01 | pstack source and Factory discipline crosswalk | P0 | **Accepted** | `qualification/reboot/04-pstack-discipline-crosswalk.md`; upstream `9e278fe4` |
| DL-02 | Factory verification skill (`verify-factory`) | P0 | **Ready after correction** | Now that the oracle is trustworthy, the skill can be written against it |
| DL-03 | First blinded skill A/B experiment | P0 | Proposed — **scope narrowed** | ML-SMOKE-01 has a solution-bearing prompt and a ceiling effect; it may establish that a skill is *discoverable and executable*, but it cannot establish skill *effectiveness*. A discriminating fixture (ML-06) is required first. |
| DL-04 | Feedback compiler prototype (5-way routing) | P1 | **First real case identified** | See `qualification/reboot-corr01/04-failure-identity-discipline.md` — one real mistake class, routed to a deterministic enforcer, classified PROVISIONAL |
| DL-05 | Complexity and simplicity measurements | P1 | Proposed | LOC delta, new deps, new public interfaces |
| DL-06 | Model × discipline experiments | P1 | Proposed | The 2×4 matrix |

### Harness / candidate-control track (HAR)

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| HAR-01 | `codium-lab` identity and capability discovery | P0 | **Partial** | Mechanism discovered; instance creation blocked by sandbox write restrictions |
| HAR-02 | Control-path qualification | P0 | **Partial** | Read-only path already verified against `codium-clinemm`; an MCP bridge exists in ClineMM **source** but is not in the installed bundle |
| HAR-03 | Fresh-session isolation qualification | P0 | Proposed | Blocked on HAR-01 |
| HAR-04 | Minimal deterministic Factory-to-control client | P0 | Proposed | **Do not modify the frozen `cline-adapter.ts`.** Reuse its compatible interfaces; do not inherit the whole long-horizon lifecycle architecture. |
| HAR-05 | Programmatic model selection | P1 | Proposed | Requires authorization |
| HAR-06 | Optional headless execution backend | P2 | Proposed | NOT_TESTED |
| HAR-07 | Optional parallel candidate execution | P2 | Proposed | NOT_TESTED |

### Deferred (history preserved, not resumed)

| ID | Scope | Priority | Status |
| --- | --- | --- | --- |
| LH-07 | Real-harness production qualification | P2 | Deferred — historical `HALT_BUDGET` preserved |
| LH-24H | Long-horizon execution | P3 | Deferred |
| MEMLAB | Agentic memory evaluation | P2 | Deferred |

## Dependency order

```text
REBOOT-CORR01 ──► ML-01 (ML-SMOKE-01) ──► ML-02 ──► ML-03 ──► ML-04
                            │                   │
                            │                   └──► DL-03 (needs a discriminating fixture first)
                            │                            │
                            │                            └──► DL-06
                            └──► DL-02 ──► DL-03
                                        └──► DL-04

HAR-01 ──► HAR-02 ──► HAR-03 ──► HAR-04 ──► ML-02 (candidate transport)
```

## Verification Strategy

| Claim | Verified by |
| --- | --- |
| Repository baseline is canonical | `scripts/verify_factory.sh` (exit 0) |
| Historical LH-07 evidence is intact | SHA-256 fingerprints, before and after |
| The oracle is not vacuous | 20 regression controls, including C11 (the historical false-PASS counterexample) |
| A negative control proves what it claims | C06 (`INVALID_MUTATION`) and C07 (`WRONG_FAILURE`) |
| A required test actually executed | C03 / C04 / C05 / C08 |
| A candidate result is correct | Only the evaluator oracle may produce a verdict |
| A model is better | Requires ML-02 + ML-03 + ML-04; **no such claim is made today** |

## Risks and Unknowns

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A naive gate gives a false PASS from ambient state | **Observed** | High | Oracle sanitizes `.tmp-home` and pins `TMPDIR` |
| An arbitrary failure is accepted as an intended failure | **Observed and fixed** | High | Failure-identity discipline; C06/C07/C11 |
| The candidate deletes or neuters the qualifying test | Medium | High | Required-test identity; mutation control; scope check |
| `codium-lab` cannot be provisioned in-sandbox | **Observed** | High | Operator action required; documented in `03-codium-lab-provisioning.md` |
| D01/ML-SMOKE-01 has a ceiling effect for DL-03 | **Certain** | Medium | ML-SMOKE-01 is a smoke fixture only; DL-03 needs a discriminating fixture |
| A separate VSCodium profile is mistaken for a sandbox | Medium | High | Recorded explicitly: identity separation, not containment |

## Close Criteria

- [ ] `codium-lab` provisioned and its read-only control path verified
- [ ] ML-02 produces one candidate run against ML-SMOKE-01
- [ ] An independent verdict is produced by the oracle, not the candidate
- [ ] ML-03 establishes a MiniMax baseline on the same fixture
- [ ] A solution-blind fixture (ML-06) exists before DL-03 is interpreted
- [ ] ML-04 compares two models on identical fixtures with identical oracles

## Follow-ups

- [ ] Operator creates `~/.vscodium-lab` (two commands, documented)
- [ ] Token-level leakage assessment (prerequisite for comparative fixtures)
- [ ] Repair the LH-07 corpus defects (D02 mutation controls, D04 oracle
      self-reference, D05 capture-reuse ambiguity) before ML-06
- [ ] Decide whether the graduated-rigor modes become deterministic policy
