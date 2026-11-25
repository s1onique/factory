# LIVE-SMOKE-01 — Changed-File Manifest and Recommended Commit Boundaries

> ACT: `ACT-FACTORY-LIVE-SMOKE-01`

> **No commit and no push were made.** The operator has not committed the reviewed work.

---

## 1. Files changed in THIS ACT

| Path | Change |
| --- | --- |
| `labs/model-lab/README.md` | The two gate levels, the corrected components, the new dispositions, the measured runtimes. |
| `labs/model-lab/ml_smoke_01_acceptance_oracle.sh` | Supervisor-supplied expected reference digest; HALTs on a self-comparison or overlapping root; absolute path resolution; disposable COPY of the evaluator dependencies instead of a symlink; process-exit-bound acceptance; the SOCK tests are required. |
| `labs/model-lab/ml_smoke_01_lib.mjs` | NDJSON event parsing with explicit completion evidence; file-bound required-test identity; duplicate/ambiguity rejection; root-identity and root-overlap refusal; strict import preservation; process-exit-bound acceptance; mechanism-bound mutation. |
| `labs/model-lab/ml_smoke_01_test_reporter.mjs` | The REAL Node event contract: boolean and string skip/TODO, cancellation by error shape, file-level failures, relative file identity, NDJSON output terminated by a completion record. |
| `labs/model-lab/ml_smoke_01_tool.mjs` | The decision-logic CLI surface for the new library API (process exit, SOCK requirements, file-bound mutation). |
| `labs/model-lab/prepare_ml_smoke_01.sh` | A FRESH output directory is required; a collision is refused, not recycled. The ownership marker, the destructive reuse and the stale-lock reclamation are gone. |
| `labs/model-lab/verify_codium_lab_readonly.sh` | Unchanged in this ACT. |
| `qualification/live-smoke-01/00-entry/counterexamples-reproduced.md` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/00-entry/entry-state.json` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/01-fixture/fixture-identity.json` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/02-codium-lab/codium-lab-identity.json` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/03-candidate/candidate-run.json` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/04-evaluator/evaluator-result.json` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/05-bundle/exit-report.md` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/05-bundle/manifest.json` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `qualification/live-smoke-01/05-bundle/ml-06a-fixture-proposal.md` | The ACT-FACTORY-LIVE-SMOKE-01 run bundle. |
| `scripts/verify_factory_fast.sh` | The ordinary gate as a standalone entry point. |
| `scripts/verify_factory_qualification.sh` | The authoritative gate: the ordinary gate plus the real-fixture controls. |
| `tests/model_lab/test_ml_smoke_01_lib.mjs` | 99 fast controls, including L15..L23 for every reproduced defect and L23 against GENUINE Node test events. |
| `tests/model_lab/test_ml_smoke_01_oracle.sh` | The real-fixture controls now supply the expected reference digest independently; the executed-test denominator reflects the SOCK requirement. |

## 2. Preserved, unchanged (LH-07 historical artifacts and frozen substrates)

| Path | Note |
| --- | --- |
| `qualification/lh07-duty-corpus.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/00-entry-state.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/01-candidate-discovery.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/02-auth-readiness.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/03-protocol-selection.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/04-model-parity.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/05-duty-corpus-proposal.md` | LH-07 historical artifact — UNCHANGED. |
| `qualification/lh07/06-campaign-disposition.json` | LH-07 historical artifact — UNCHANGED. |
| `qualification/reboot-corr01/00-entry-state.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/01-review-findings-reproduced.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/02-ml-smoke-01-fixture.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/03-codium-lab-provisioning.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/04-failure-identity-discipline.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/05-epic-board.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/06-exit-report.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/07-verification-log.md` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr01/superseded/d01_acceptance_oracle.sh` | REBOOT-CORR01 history, including the verbatim preserved defective oracle — UNCHANGED. |
| `qualification/reboot-corr02/00-entry-state.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/01-counterexamples-reproduced.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/02-verification-performance.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/03-codium-lab-readonly.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/04-mcp-client-configuration.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/05-changed-file-manifest.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/06-exit-report.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot-corr02/07-epic-board.md` | REBOOT-CORR02 history — the epic board was amended in this ACT; the rest is unchanged. |
| `qualification/reboot/00-entry-state.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/01-operator-decision.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/02-d01-fixture-qualification.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/03-machinery-inventory.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/04-pstack-discipline-crosswalk.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/05-verification-log.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/06-codium-lab-capability-matrix.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/07-epic-board.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/08-ml02-scope.md` | REBOOT-01 history — UNCHANGED. |
| `qualification/reboot/09-exit-report.md` | REBOOT-01 history — UNCHANGED. |

## 3. Recommended commit boundaries

Four commits, in this order. **None of them was made in this ACT.**

### Commit 1 — `factory: correct the ML-SMOKE-01 oracle's acceptance defects`

```text
labs/model-lab/ml_smoke_01_lib.mjs
labs/model-lab/ml_smoke_01_test_reporter.mjs
labs/model-lab/ml_smoke_01_tool.mjs
labs/model-lab/ml_smoke_01_acceptance_oracle.sh
labs/model-lab/prepare_ml_smoke_01.sh
labs/model-lab/README.md
tests/model_lab/test_ml_smoke_01_lib.mjs
tests/model_lab/test_ml_smoke_01_oracle.sh
scripts/verify_factory.sh
scripts/verify_factory_fast.sh
scripts/verify_factory_qualification.sh
```

This is ONE commit because the oracle, its decision logic, its regression
controls and the gates that invoke them are a single authority. Splitting
them would put the repository in a state where a gate runs controls that
describe an oracle that does not exist.

### Commit 2 — `factory: LIVE-SMOKE-01 preflight evidence and the ML-06A proposal`

```text
qualification/live-smoke-01/**
```

### Commit 3 — `factory: amend the epic board for ACT-FACTORY-LIVE-SMOKE-01`

```text
qualification/reboot-corr02/07-epic-board.md
```

### Commit 4 — `factory: preserve the REBOOT-01 / CORR01 / LH-07 history`

```text
qualification/reboot/**
qualification/reboot-corr01/**
qualification/reboot-corr02/**   (everything except 07-epic-board.md)
qualification/lh07/**
qualification/lh07-duty-corpus.json
```

This is the historical-artifact commit. It is separate so that the
evidence in commit 2 and the board amendment in commit 3 can be reviewed
without the preserved history in the diff.

## 4. Not committed

- No automatic commit was made.
- No push was made.
- No linked worktree was created.
- No destructive reconciliation was performed.

