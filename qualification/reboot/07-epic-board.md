# Factory Reboot — Epic Board

> ACT: `ACT-FACTORY-REBOOT-01`
> Follows the conventions of `docs/templates/epic.md`.
>
> **No epic history existed before this ACT** — `docs/templates/epic.md` was the
> only epic artifact in the repository. Nothing was erased.

---

## Title

Factory Reboot — Model Evaluation and Continuous Engineering Improvement

## Status

`In Progress`

## Problem

Factory built machinery to supervise complicated, long-running agentic
processes. That machinery is valuable, but it has not yet made Factory
exceptionally effective at *ordinary* engineering tasks, and it has not
produced any systematic, independently-verified evidence about model
behaviour.

Concretely:

- No model has ever been compared to another under identical, reproducible
  conditions with an independent acceptance oracle.
- No discipline change (rule, skill, architectural constraint) has been
  measured for its incremental contribution.
- The long-horizon lab consumed large effort while its live campaign was
  halted at the budget-authorization boundary (`HALT_BUDGET`, 0 of 24 runs).
- Factory's own ACT prompts accumulated defensive requirements, so simple
  changes became expensive.

## Goal

Establish a measured improvement cycle:

1. One independently verified fixture that reproduces a real historical defect.
2. A minimal deterministic runner that produces one candidate result.
3. A Discipline Lab that measures whether engineering-environment changes
   improve correctness and speed.

Success for this epic is **not** "the best model of the month". It is "we can
now measure whether our own environment makes agents better, and we do".

## Non-goals

- Long-horizon (24h) autonomy — deferred, not abandoned.
- A generalized benchmark definition language.
- A sophisticated agent workflow engine.
- Multi-agent reviewer panels.
- A universal skill registry or an evidence database.
- A composite leaderboard that conceals individual failure modes.

## Context / Evidence

- LH-07 halted at `HALT_BUDGET`; the corpus was proposed but never qualified.
  See `qualification/lh07/06-campaign-disposition.json` (preserved unchanged).
- The D01 fixture has now been qualified as a smoke fixture with an
  evaluator-owned oracle, including a mutation control.
  See `02-d01-fixture-qualification.md`.
- Two environment defects were discovered that silently defeat a naive gate
  (ambient `.tmp-home`; long `TMPDIR`).
- The ClineMM control transport is a Unix-domain-socket "control seam", not an
  MCP server. See `06-codium-lab-capability-matrix.md`.

## Constraints

- One canonical Git worktree (`FACTORY_GIT_WORKTREE_POLICY`).
- Correctness is established only by an external gate, never by agent
  self-report.
- No paid inference without explicit operator authorization.
- No new dependencies without a reported requirement.
- Failure and unavailable checks are preserved truthfully.

---

## ACT Board

### Model Lab (ML) — variable: the model

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| REBOOT-01 | Preserve LH-07, establish baseline, qualify first fixture | P0 | **In Progress** | This ACT |
| ML-01 | Qualify the initial historical fixture | P0 | **Done (smoke)** | D01 qualified as smoke fixture; token-level leakage scan outstanding |
| ML-02 | Minimal single-run executor | P0 | Proposed | Scope in `08-ml02-scope.md` |
| ML-03 | MiniMax baseline execution | P0 | Proposed | Requires budget authorization |
| ML-04 | Model comparison report | P0 | Proposed | Needs ≥2 models |
| ML-05 | Qwen3.8 / Basalt qualification | P1 | Awaiting backend | Endpoint `http://192.168.50.111:8080/v1` already configured in `codium-clinemm`; reachability untested |
| ML-06 | Expand fixture corpus | P2 | Proposed | D02–D06 unqualified; corpus defects recorded |

### Discipline Lab (DL) — variable: the engineering environment

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| DL-01 | pstack source and Factory discipline crosswalk | P0 | **Done** | `04-pstack-discipline-crosswalk.md`; upstream `9e278fe4` |
| DL-02 | Factory verification skill (`verify-factory`) | P0 | Proposed | Must invoke existing verifiers, not reimplement them |
| DL-03 | First blinded skill A/B experiment | P0 | Proposed | Depends on ML-02 and DL-02 |
| DL-04 | Feedback compiler prototype (5-way routing) | P1 | Proposed | architecture / gate / skill / rule / no-change |
| DL-05 | Complexity and simplicity measurements | P1 | Proposed | LOC delta, new deps, new public interfaces |
| DL-06 | Model × discipline experiments | P1 | Proposed | The 2×4 matrix |

### Harness / candidate-control track (HAR) — Amendment A

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| HAR-01 | `codium-lab` identity and capability discovery | P0 | **Done** | `06-codium-lab-capability-matrix.md` |
| HAR-02 | MCP / control-path qualification | P0 | Proposed | Control seam identified; read-only probes succeeded |
| HAR-03 | Fresh-session isolation qualification | P0 | Proposed | `epoch`/`stateVersion` reset must be proven |
| HAR-04 | Minimal deterministic Factory-to-control-seam adapter | P0 | Proposed | **Explicitly NOT in REBOOT-01**; extend `cline-adapter.ts` |
| HAR-05 | Programmatic model selection | P1 | Proposed | Requires authorization |
| HAR-06 | Optional headless execution backend | P2 | Proposed | NOT_TESTED |
| HAR-07 | Optional parallel candidate execution | P2 | Proposed | NOT_TESTED |

### Deferred (history preserved, not resumed)

| ID | Scope | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| LH-07 | Real-harness production qualification | P2 | **Deferred** | Historical disposition `HALT_BUDGET` preserved |
| LH-24H | Long-horizon execution | P3 | Deferred | Postponed by operator decision |
| MEMLAB | Agentic memory evaluation | P2 | Deferred | — |

---

## Dependency order

```text
REBOOT-01 ──► ML-01 ──► ML-02 ──► ML-03 ──► ML-04
                 │         │
                 │         └──► DL-03 (with DL-02) ──► DL-06
                 │                        │
                 │                        └──► DL-04
                 │
                 └──► DL-01 ──► DL-02

HAR-01 ──► HAR-02 ──► HAR-03 ──► HAR-04 ──► ML-02 (candidate transport)
                                        └──► HAR-05, HAR-06, HAR-07
```

## Verification Strategy

| Claim | Verified by |
| --- | --- |
| Repository baseline is canonical | `scripts/verify_factory.sh` (exit 0) |
| Historical LH-07 evidence is intact | SHA-256 fingerprints of all 8 artifacts, before and after |
| D01 fixture is qualified | `labs/model-lab/d01_acceptance_oracle.sh` against base / fixed / neutered workspaces |
| The oracle is not vacuous | Mutation control: a neutered test must still FAIL the oracle |
| A candidate result is correct | Only the evaluator oracle may produce a verdict |
| A model is better | Requires ML-02 + ML-03 + ML-04; **no such claim is made today** |

## Risks and Unknowns

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A naive gate gives a false PASS because of ambient state | **Observed** | High | Oracle sanitizes `.tmp-home` and pins `TMPDIR`; keep this rule |
| The candidate deletes or neuters the qualifying test | Medium | High | Mutation control + scope check; oracle fails closed |
| `codium-lab` instance never gets created | Medium | High | HAR-01-02 is the recommended next ACT |
| Mutation grant is armed without authorization | Low | Critical | Grant is fail-closed; keep it unarmed outside a live campaign |
| D01 leaks the solution and cannot rank models | **Certain** | Medium | D01 is a smoke fixture only; do not use it for comparison |
| A separate VSCodium profile is mistaken for a sandbox | Medium | High | Recorded explicitly: it is identity separation, not containment |

## Close Criteria

- [ ] ML-02 produces one candidate run against the qualified D01 fixture
- [ ] An independent verdict is produced by the oracle, not the candidate
- [ ] ML-03 establishes a MiniMax baseline on the same fixture
- [ ] ML-04 compares two models on identical fixtures with identical oracles
- [ ] DL-03 runs a blinded skill A/B with a pre-registered metric
- [ ] The `codium-lab` control path is qualified end to end

## Follow-ups

- [ ] Token-level leakage scan over the D01 fixture tree (outstanding from ML-01)
- [ ] Repair the LH-07 corpus defects (D02 mutation controls, D04 oracle
      self-reference, D05 capture-reuse ambiguity) before ML-06
- [ ] Decide whether the graduated-rigor modes (FAST/STANDARD/STRICT/
      QUALIFICATION) become deterministic policy
