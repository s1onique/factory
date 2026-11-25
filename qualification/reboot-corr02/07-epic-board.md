# Factory Reboot — Epic Board (after CORR02)

> ACT: `ACT-FACTORY-REBOOT-CORR02-HAR02`
> Supersedes `qualification/reboot-corr01/05-epic-board.md`. **No epic history
> was erased**: the REBOOT-01 and REBOOT-CORR01 boards remain on disk as the
> record of what was believed at those times.

---

## Title

Factory Reboot — Model Evaluation and Continuous Engineering Improvement

## Status

`In Progress`

## Problem

Unchanged from the CORR01 board. The verification machinery, not the
engineering, is the binding constraint: the Model Lab cannot mint a
trustworthy verdict until the acceptance oracle's authority is established,
and the repository cannot be verified cheaply enough to be useful as
everyday feedback while that authority is being established.

## What changed in CORR02

| Board item | Before | After |
| --- | --- | --- |
| Oracle authority | seven defects open | **closed**; 44 fast + 41 real-fixture controls green |
| Verification cost | 225.81 s for the ordinary gate | **~2.5 s** for the ordinary gate; ~215 s for the authoritative gate |
| `codium-lab` | blocked by the sandbox | **provisioned and verified read-only**; MCP proxy verified live |
| MCP client registration | not attempted | fragment and operator command supplied; write blocked by the sandbox |

## Active board

| ID | Item | Priority | Status |
| --- | --- | --- | --- |
| **CORR02** | Close the remaining oracle authority defects; restore the gate cost; qualify the `codium-lab` read-only control path | P0 | **Done** |
| **LIVE-SMOKE-01B** | One authorized real candidate execution against ML-SMOKE-01, with the corrected oracle as the sole verdict authority | P0 | **Done — the full lifecycle was observed.** The workspace binding RESOLVED, the mutation authorization was ESTABLISHED, and exactly ONE candidate execution ran (session `1795576254184_48ilz`, 77.58 s, 0 feedback, 0 retries, cost $0.0138). The oracle's verdict on the candidate AS EXECUTED is **FAIL**: the candidate created a candidate-owned dependency tree (`npm ci`), which is a `FORBIDDEN_DEPENDENCY` scope violation, and the oracle rejected the patch BEFORE executing it (`GATE_EXECUTED=NO`, 0.68 s). The patch ITSELF is technically correct — evaluated independently in a fresh evaluator reconstruction it yields `DISPOSITION=PASS`, 23/23 gate tests, 11/11 required tests, mutation DETECTED. Evidence: `qualification/live-smoke-01b/`. |
| **DL-02** | Factory verification skill (`verify-factory`) — the first verification skill | P0 | **Restored to the ACTIVE backlog.** Must invoke the existing verifiers, not reimplement them. |
| **ML-06A** | The first solution-blind production-code fixture | P0 | **QUALIFIED.** Pure `validateJsonValue` path-cycle defect; known-bad `0bd72f4`, known-good `5b7508f`; NO overlay; the entire allowed production file stays editable and the historical patch's shape is NOT imposed (a differently-shaped fix is proven to pass). The known-bad revision FAILS for the intended behavioral reason; the known-good revision PASSES; the solution-leakage scan is CLEAN. NOT executed against any model. Evidence: `qualification/live-smoke-01b/06-ml06a/`. |
| **ML-02** | The deterministic Model Lab runner | P1 | **Done — the runner is implemented; the LIVE execution is NOT.** `labs/model-lab/ml_02_client.mjs` (the ACTUAL native NDJSON/AF_UNIX client plus its simulated counterpart), `ml_02_runner.mjs` (readiness, single-start authority, event collection, quiescence, independent evaluation) and `ml_02_cli.mjs` (`prepare`, `verify`, `execute`, `evaluate`, `inspect`) exist. The oracle authority was corrected at the same time: the mutation verdict now requires EXACTLY the Node test-failure exit, the completion record must carry the WHOLE event-counter contract, the tree identity is now an explicitly versioned manifest that binds directories and types, the shell orchestration is fail-closed, and an unauthorized in-file patch is rejected BEFORE execution. 58 fast runner controls and 51 real-fixture controls are green; the ordinary gate is 3.87 s. **No model was executed**: `LIVE_EXECUTION = NOT_EXECUTED`. Evidence: `qualification/ml-02-minimal-runner/`. |
| DL-04 | Feedback compiler prototype (5-way routing) | P1 | One real mistake class identified and routed to a deterministic enforcer (`qualification/reboot-corr01/04-failure-identity-discipline.md`), classified PROVISIONAL |
| **ML-03** | One authorized live ML-06A execution through the new runner | P0 | **Next ACT.** The runner is ready; provider fidelity and live lifecycle qualification are NOT. |
| **DL-02** | Factory verification skill (`verify-factory`) — the first verification skill | P0 | **Prepared, not built.** The applicability and acceptance criteria are recorded in `qualification/ml-02-minimal-runner/03-discipline-lab.md`. A skill must guide the agent toward the EXISTING deterministic mechanisms, not reproduce them in prose. No skill registry is built and no skill A/B experiment is run. |
| DL-05 | A user-facing evidence dashboard | P2 | Deferred |

## Milestone path

```text
CORR02 ──► LIVE-SMOKE-01 ──► ML-06A (solution-blind fixture) ──► ML-02 ──► ML-03 ──► ML-04
                 │
                 └──► DL-02 (first verification skill, restored to the active backlog)
```

## Explicit non-goals for this board

- No Model Lab runner was built in CORR02.
- No frozen long-horizon machinery was modified.
- No paid inference was initiated.
- The qualification campaign was not expanded beyond what is necessary to
  reach the LIVE-SMOKE-01 → ML-06 milestone.

## Amendment — ACT-FACTORY-LIVE-SMOKE-01B

The LIVE-SMOKE-01 preflight is complete and the oracle is qualified. The
LIVE candidate execution did **not** start: `codium-lab` had no folder
open, so the control seam's mutation grant was bound to the SDK's
no-workspace chat fallback. No inference was initiated and no tokens were
spent.

The next milestone is **ML-06A**, the first meaningful solution-blind
production-code fixture, whose proposal is recorded at
`qualification/live-smoke-01/05-bundle/ml-06a-fixture-proposal.md`.

## Amendment — ACT-FACTORY-LIVE-SMOKE-01B

**The LIVE-SMOKE-01 lifecycle is COMPLETE.** The workspace binding is
RESOLVED, the mutation authorization is ESTABLISHED, and exactly ONE
candidate execution ran. The oracle's verdict on the candidate AS
EXECUTED is **FAIL** — the candidate installed a candidate-owned
dependency tree, and the oracle rejected the patch before executing it.
The patch itself is technically correct, and that is recorded separately
as an independent diagnostic, not as a second verdict.

**ML-06A is QUALIFIED** and its solution-leakage scan is CLEAN. It has
NOT been executed against any model.

Eleven oracle authority defects were reproduced against the actual
implementation and corrected before the execution, each with a cheap
executable control. The ordinary gate is ~1.9 s; the authoritative
qualification gate is ~162 s and is green. The authoritative gate was run
**three** times (the ACT asked for once): the first attempt FAILED with 9
controls and drove the correction that separates out-of-region from
in-region violations; the second, green run established the oracle's
authority BEFORE the candidate started; the third confirmed the final
state afterwards. All three are disclosed in the exit report.

**The next ACT is ML-02**: the minimal deterministic execution of a
qualified production-code fixture. ML-06A is qualified and ready for it.

Evidence: `qualification/live-smoke-01b/`. The predecessor's report at
`qualification/live-smoke-01/` is PRESERVED and was NOT rewritten.
