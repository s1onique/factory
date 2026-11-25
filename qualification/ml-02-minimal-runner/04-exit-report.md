# ML-02 — Exit report

> ACT: `ACT-FACTORY-ML-02-MINIMAL-RUNNER-01`.
>
> The overall disposition is
> **RUNNER_READY_LIVE_QUALIFICATION_PENDING**.
>
> The runner is implemented, verified and committed. The LIVE execution was
> NOT performed: no model was executed, and provider fidelity is NOT
> established.

## The independent dispositions

| Disposition | Value | Evidence |
| --- | --- | --- |
| `ENTRY_BASELINE` | **PASS** | ENTRY_HEAD `016816625601fcde1eae3c140c7e7d7b2fb33fd2`, branch `main`, parent `df77c61a8daa15dadfc1424054b3edb37436cb40`, clean tracked/untracked/staged state, one worktree, zero detached, no stashes. |
| `REVIEW_COUNTEREXAMPLES` | **REPRODUCED_AND_CORRECTED** | A–G in `01-review-counterexamples.md`, each reproduced against the ACTUAL committed implementation before the correction. |
| `ORACLE_AUTHORITY` | **PASS** | The mutation exit is EXACTLY 1; the completion record carries the WHOLE counter contract; the tree identity is versioned and binds directories/types/modes; the shell orchestration is fail-closed; an unauthorized in-file patch is rejected BEFORE execution. 187 decision-logic controls + 51 real-fixture controls green. |
| `ORDINARY_GATE` | **PASS** | `scripts/verify_factory.sh` → `FACTORY_VERIFY_DISPOSITION=OK`, **3.02 s** on a quiet host (below the five-second target). The acceptance criteria were NOT weakened to recover the time. |
| `AUTHORITATIVE_QUALIFICATION` | **PASS** | `scripts/verify_factory_qualification.sh` → `FACTORY_VERIFY_QUALIFICATION_DISPOSITION=PASS`, 340.8 s. |
| `ML06A_CONTRACT_V1` | **ESTABLISHED** | `ml-06a-contract/v1`: the frozen candidate-visible task text, the allowed-path policy, the dependency and scratch policy, the acceptance contract, the qualification-reuse conditions and the experimental limitations are all recorded in `labs/model-lab/README.md`. |
| `ML06A_FIXTURE_IDENTITY` | **CONFIRMED** | Base `0bd72f4b97486b9b95cbb75e7e384586d03aa22f` and known-good `5b7508fa09e6f10b6ec683e94a35758a15f9d827` are real commits; the known-good revision is the known-bad revision's descendant. |
| `CANDIDATE_DEPENDENCY_POLICY` | **ESTABLISHED** | The candidate's dependency tree is independent of the evaluator's; the evaluator materializes its own disposable COPY; there are no writable symlinks or hardlink aliases to evaluator-owned dependency files; the designated scratch path is explicit and narrow; network installation is prohibited in the candidate-visible task. |
| `RUNNER_IMPLEMENTATION` | **PASS** | `ml_02_client.mjs` (the ACTUAL native NDJSON/AF_UNIX client + the simulated counterpart), `ml_02_runner.mjs` (readiness, single-start authority, event collection, quiescence, independent evaluation), `ml_02_cli.mjs` (`prepare`, `verify`, `execute`, `evaluate`, `inspect`). |
| `SIMULATED_LIFECYCLE` | **PASS** | 58 runner controls, exercising the REAL client and the REAL runner against the simulated native seam. No model and no paid inference. |
| `REAL_FIXTURE_EVALUATION` | **PASS** | The known-bad ML-06A FAILS for the intended reason (ML06A-02/03/04/10 fail; ML06A-01/05/06/07/08 pass); the known-good PASSES; a differently-shaped valid fix PASSES. |
| `PATCH_IDENTITY_BINDING` | **PASS** | The captured patch's digest matches the patch bytes; the evaluator receives the CAPTURED bytes, never a later re-read of the mutable candidate tree. |
| `SOLUTION_LEAKAGE_SCOPE` | **CLEAN (INSPECTED ARTIFACT CONTENTS ONLY)** | The candidate-visible fixture carries no historical solution marker, no evaluator-only ML-06A file, no Git history and no ML-06A correction evidence. This establishes the CONTENTS of the inspected artifacts ONLY; it does NOT establish adversarial inaccessibility. |
| `CONTAINMENT` | **DISCLOSED LIMITATION** | A separate VSCodium profile is NOT a sandbox. The candidate and the evaluator run as the SAME OS USER on the SAME host. Absence of registered supervisory MCP tools does NOT establish OS-level inaccessibility of the supervisory socket. The runner is for COOPERATIVE engineering experiments under this disclosed limitation and makes NO claim of adversarially trustworthy evaluation. |
| `PROVIDER_FIDELITY` | **NOT_VERIFIED** | No wire-level capture, no effective reasoning-effort proof, no TTFT, no throughput, no provider billable-token counter. The separate ClineMM reasoning-round-trip investigation remains INDEPENDENT and its outcome was NOT assumed. No comparative eligibility is published. |
| `LIVE_EXECUTION` | **NOT_EXECUTED** | No model was executed against ML-06A or any other fixture. No paid inference occurred. |

## Overall disposition

```text
RUNNER_READY_LIVE_QUALIFICATION_PENDING
```

`READY_FOR_ML03_BASELINE` is **NOT** declared: it requires all applicable
prerequisites to be established independently, and provider fidelity is
NOT established.

## The commits created by this ACT

| Commit | Message |
| --- | --- |
| (see the handover) | `feat(model-lab): implement deterministic ML-06A single-run executor` |

ENTRY_HEAD: `016816625601fcde1eae3c140c7e7d7b2fb33fd2`.
FINAL_HEAD: (recorded in the handover after the commit).

## The exact commands

Prepare, without inference:

```bash
node labs/model-lab/ml_02_cli.mjs prepare --out <out_dir> --run-id <run_id>
```

Verify readiness, without inference:

```bash
node labs/model-lab/ml_02_cli.mjs verify \
  --seam "$HOME/.vscodium-lab/cline-data/control-seam" \
  --workspace <out_dir>/workspace \
  --extension 4.1.26-821b20e7a
```

Execute exactly one authorized experiment:

```bash
node labs/model-lab/ml_02_cli.mjs execute \
  --manifest <out_dir>/experiment.json \
  --authorization <out_dir>/authorization.json \
  --seam "$HOME/.vscodium-lab/cline-data/control-seam" \
  --deadline 300
```

Collect, evaluate and inspect:

```bash
node labs/model-lab/ml_02_cli.mjs evaluate \
  --manifest <out_dir>/experiment.json \
  --seam "$HOME/.vscodium-lab/cline-data/control-seam"
node labs/model-lab/ml_02_cli.mjs inspect --bundle <out_dir>/bundle
```

## The remaining limitations and blockers

1. **The live native transport has NOT been exercised.** The runner's
   client is written against the ACTUAL protocol and is exercised against
   a simulated seam, but the LIVE extension host has not answered a start
   through this runner. The next ACT must establish that.
2. **Provider fidelity is NOT established.** The configured reasoning
   effort is not proof of the effective wire-level effort.
3. **The candidate's dependency materialization is a POLICY, not yet an
   OBSERVATION.** The runner's preparation currently materializes the
   fixture; the candidate's disposable dependency tree must be supplied
   independently BEFORE the live execution, and its identity recorded.
4. **The `codium-lab` instance's workspace binding must be re-established**
   for the new prepared workspace: the operator must open it in
   `codium-lab` before the live start. The runner returns a typed blocker
   if the assertion does not hold.
5. **The 300-second deadline is a wall-clock bound**, not a
   provider-enforceable cap.
6. **No adversarial containment.** Same-user access remains.

## The next recommended ACT

**ML-03 — one authorized live ML-06A execution through the new runner.**

Its scope: establish the live native transport against the ACTUAL
extension host; establish the candidate's disposable dependency tree and
its identity; obtain the operator's explicit authorization bound to the
prepared experiment; execute EXACTLY ONE candidate task; collect the
deliverable; evaluate it independently through the qualified oracle; and
record the run bundle with the usage, timing and fidelity observations.

If, and only if, that execution succeeds AND the provider fidelity
observations are established, ML-03 may declare the runner LIVE-QUALIFIED
and unblock ML-04's repeated baseline experiments.
