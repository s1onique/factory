# REBOOT-01 — Exit Report

> ACT: `ACT-FACTORY-REBOOT-01`
> Date: 2026-11-24

---

## Summary

REBOOT-01 established the Factory baseline, preserved the LH-07 historical
campaign unchanged, qualified the first Model Lab fixture (D01) behind an
evaluator-owned acceptance oracle with a mutation control, inventoried the
existing machinery, produced the pstack→Factory discipline crosswalk, and
completed read-only `codium-lab` discovery. One shell script was added. No
paid inference, no commits, no pushes.

## Files changed

| File | Change | Notes |
| --- | --- | --- |
| `labs/model-lab/d01_acceptance_oracle.sh` | **Add** | Evaluator-owned D01 acceptance oracle (scope + gate + mutation control) |
| `qualification/reboot/00-entry-state.md` | Add | Entry state, fingerprints, sensitive-info inspection |
| `qualification/reboot/01-operator-decision.md` | Add | New operator decisions, separate from history |
| `qualification/reboot/02-d01-fixture-qualification.md` | Add | D01 qualification record with all six controls |
| `qualification/reboot/03-machinery-inventory.md` | Add | Existing machinery inventory and reuse map |
| `qualification/reboot/04-pstack-discipline-crosswalk.md` | Add | Crosswalk + 3 recommended experiments |
| `qualification/reboot/05-verification-log.md` | Add | Commands, exit codes, elapsed times, and checks NOT run |
| `qualification/reboot/06-codium-lab-capability-matrix.md` | Add | Amendment A discovery result |
| `qualification/reboot/07-epic-board.md` | Add | Updated epic board (ML / DL / HAR / deferred) |
| `qualification/reboot/08-ml02-scope.md` | Add | Proposed exact scope for ML-02 |
| `qualification/reboot/09-exit-report.md` | Add | This report |

**Modified tracked files: 0. Deleted tracked files: 0. Staged changes: 0.**
The eight LH-07 artifacts were **not** modified (fingerprints re-verified at
exit).

## Behavior changed

Nothing executable changed except the addition of one new, self-contained
oracle script. The repository's existing gate behaviour is identical.

## Verification

```text
bash scripts/verify_factory.sh          -> exit 0, FACTORY_VERIFY_DISPOSITION=OK (2.98 s)
bash scripts/verify_worktree_policy.sh   -> exit 0, DISPOSITION=OK (1 worktree, 0 linked)
bash scripts/check_links.sh              -> exit 0, All checks passed
bash scripts/verify_lh03_frozen.sh       -> exit 0, FACTORY_LH03_FROZEN_DISPOSITION=OK
bash scripts/verify_lh04_frozen.sh       -> exit 0, FACTORY_LH04_FROZEN_DISPOSITION=OK
bash scripts/verify_lh05_frozen.sh       -> exit 0, FACTORY_LH05_VERIFY_DISPOSITION=OK
bash scripts/verify_lh06_frozen.sh       -> exit 0, FACTORY_LH06_VERIFY_DISPOSITION=OK
tests/worktree_policy/…                  -> exit 0, PASS=9  FAIL=0
tests/lh06-frozen/…                      -> exit 0, PASS=16 FAIL=0
```

Oracle controls (re-run at exit):

```text
base   09fc12c -> DISPOSITION=FAIL (exit 1, 21.48 s)
fixed  5c51615 -> DISPOSITION=PASS (exit 0, 21.91 s)
neuter (test deleted) -> DISPOSITION=FAIL (exit 1, 17.13 s)  [gate alone said PASS]
```

Full detail: `05-verification-log.md`.

## Risks / limitations

1. **D01 is a smoke fixture only.** Its task prompt describes the remedy. It
   cannot rank models.
2. **The token-level leakage scan is outstanding.** Structural leakage
   properties were verified; a substring scan was not run.
3. **`codium-lab` does not exist.** It must be created before any candidate
   execution.
4. **MCP is not the control transport.** ClineMM exposes no inbound MCP server;
   the actual transport is a Unix-domain-socket control seam. This is a
   factual finding, not an implementation of the operator's stated preference.
5. **The scope check is path-based.** It does not yet detect semantically
   equivalent edits at other paths.
6. **No comparative claim about any model is made.** No model has been run.

## Follow-up ACTs

| ACT | Description | Priority | Depends on |
| --- | --- | --- | --- |
| `ACT-FACTORY-HAR-01-02` | Create `codium-lab`; qualify the control path read-only | P0 | operator authorization to create the instance |
| `ACT-FACTORY-ML-02` | Minimal single-run executor against the qualified D01 fixture | P0 | scope in `08-ml02-scope.md` |
| `ACT-FACTORY-HAR-03` | Fresh-session isolation qualification | P0 | HAR-01-02 |
| `ACT-FACTORY-HAR-04` | Minimal deterministic Factory-to-control-seam adapter (extend `cline-adapter.ts`) | P0 | HAR-02, HAR-03 |
| `ACT-FACTORY-DL-02` | Author the `verify-factory` skill | P0 | DL-01 (done) |
| `ACT-FACTORY-ML-03` | MiniMax baseline execution | P0 | ML-02 + budget authorization |
| `ACT-FACTORY-DL-03` | Blinded skill A/B experiment | P0 | ML-02 + DL-02 |

## Exit disposition

```text
REBOOT-01_DISPOSITION = READY_FOR_MODEL_LAB
```

**Justification:** the repository baseline was established and verified; the
first fixture (D01) was independently qualified behind an evaluator-owned
oracle whose anti-vacuity behaviour was proven by execution (a neutered test
fails the oracle even though the raw gate passes it). All six required
qualification controls passed.

**Tracked separately, as required:**

```text
PSTACK_CROSSWALK_DISPOSITION      = COMPLETE
CODIUM_LAB_DISCOVERY_DISPOSITION  = COMPLETE
```

**Explicit non-claims:**

- No model, harness, or skill has been comparatively qualified.
- No claim is made that D01 discriminates between capable models.
- No claim is made that `codium-lab` is ready for candidate execution; it
  does not yet exist.
- The LH-07 historical disposition remains `HALT_BUDGET`; the deferral is
  recorded separately in `01-operator-decision.md`.

## Recommended commit boundaries (for human review — nothing was committed)

**Commit 1 — archival of the LH-07 campaign evidence**

```text
qualification/lh07-duty-corpus.json
qualification/lh07/00-entry-state.json
qualification/lh07/01-candidate-discovery.json
qualification/lh07/02-auth-readiness.json
qualification/lh07/03-protocol-selection.json
qualification/lh07/04-model-parity.json
qualification/lh07/05-duty-corpus-proposal.md
qualification/lh07/06-campaign-disposition.json
```

Rationale: separately reviewed archival of historical evidence, exactly as
recorded at the time. The artifacts contain no secret material. The commit
message should state that the historical disposition is `HALT_BUDGET` and
that the campaign was later deferred (see Commit 2).

**Commit 2 — REBOOT-01 baseline, inventory, and qualification**

```text
labs/model-lab/d01_acceptance_oracle.sh
qualification/reboot/00-entry-state.md
qualification/reboot/01-operator-decision.md
qualification/reboot/02-d01-fixture-qualification.md
qualification/reboot/03-machinery-inventory.md
qualification/reboot/04-pstack-discipline-crosswalk.md
qualification/reboot/05-verification-log.md
qualification/reboot/06-codium-lab-capability-matrix.md
qualification/reboot/07-epic-board.md
qualification/reboot/08-ml02-scope.md
qualification/reboot/09-exit-report.md
```

Rationale: the executable oracle and the records that justify it. Committing
the oracle together with its qualification record keeps the anti-vacuity
evidence reviewable alongside the code it constrains.

**Ordering:** Commit 1 first, so the historical evidence is frozen before any
new record references it. Neither commit modifies an existing tracked file.
