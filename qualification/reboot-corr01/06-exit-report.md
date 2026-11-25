# REBOOT-CORR01-HAR01 — Exit Report

> ACT: `ACT-FACTORY-REBOOT-CORR01-HAR01`
> Date: 2026-11-24

> **HISTORICAL — SUPERSEDED BY `ACT-FACTORY-REBOOT-CORR02-HAR02`.**
> This report is an accurate account of the CORR01 exit. The oracle and the
> controls it describes were later superseded: seven further authority
> defects were reproduced and closed by CORR02, and the controls were split
> into a fast deterministic level and a real-fixture qualification level.
> The current evidence is `qualification/reboot-corr02/`.
> The CORR01 records are preserved unrewritten as the historical record.

---

## 1. Entry and exit identity

| Field | Entry | Exit |
| --- | --- | --- |
| `HEAD` | `df77c61a8daa15dadfc1424054b3edb37436cb40` | `df77c61a8daa15dadfc1424054b3edb37436cb40` (unchanged) |
| branch | `main` | `main` |
| worktrees | 1 main, 0 linked, 0 detached | identical |
| modified tracked files | 0 | **0** |
| staged changes | 0 | **0** |

No commit and no push. The operator had not committed the REBOOT-01
artifacts, so the expected HEAD was unchanged.

## 2. Reproduced review counterexamples

All findings were reproduced by executing the **actual** REBOOT-01 oracle.

| Finding | Reproduced | Evidence |
| --- | --- | --- |
| P0.1 invalid mutation | **YES** | the mutation produced `Expected ";" but found ")"`; the file failed to load; REC-TMP01 never ran; the oracle still said `MUTATION_DETECTED=YES` |
| P0.2 skipped tests counted as passed | **YES** | TAP reported `pass 0 / skipped 2`; the oracle reported `GATE_PASSED=2` |
| Full false PASS | **YES** | `SCOPE_VIOLATIONS=0, ACCEPTANCE=PASS, MUTATION_DETECTED=YES, DISPOSITION=PASS` |
| P0.3 task/oracle defect-set mismatch | **YES** | the historical prompt allows 1 file; the oracle required 2 |
| P1.1 scope weaknesses | **YES** | confirmed by inspection |
| P1.2 README omitted from the manifest | **YES** | 20 untracked files, 11 listed |
| MCP conclusion too broad | **YES** | an MCP control seam exists in ClineMM **source** |

The preserved copy at `qualification/reboot-corr01/superseded/d01_acceptance_oracle.sh`
still reproduces the false PASS, so the evidence remains re-checkable:

```text
D01_ORACLE_ACCEPTANCE=PASS
D01_ORACLE_MUTATION_DETECTED=YES
D01_ORACLE_DISPOSITION=PASS
```

## 3. Before / after regression results

| Control | Case | Before (REBOOT-01) | After (corrected) |
| --- | --- | --- | --- |
| C01 | prepared known-bad fixture | FAIL | **FAIL** (unchanged) |
| C02 | known-good fixture | FAIL (wrongly) | **PASS** |
| C03 | REC-TMP01 deleted | FAIL | **FAIL** |
| C04 | REC-TMP01 skipped | PASS (wrongly, via P0.2) | **FAIL** |
| C05 | all tests skipped | PASS (wrongly, via P0.2) | **FAIL** |
| C06 | syntactically invalid mutation | DETECTED (wrongly, via P0.1) | **NOT DETECTED** (`INVALID_MUTATION`) |
| C07 | mutation fails for an unrelated reason | DETECTED (wrongly) | **NOT DETECTED** (`WRONG_FAILURE`) |
| C08 | required regression test skipped | PASS (wrongly, via P0.2) | **FAIL** |
| C09 | unauthorized changed file | FAIL | **FAIL** |
| C10 | invalid base commit | FAIL | **HALT** (exit 2) |
| C11 | historical false-PASS counterexample | **PASS (wrongly)** | **FAIL** |

```text
tests/model_lab/test_ml_smoke_01_oracle.sh
PASS=20  FAIL=0
```

## 4. Exact fixture and oracle identities

```text
ML_SMOKE_01_BASE_COMMIT=09fc12c6fb051dce096252bf30c2e96debed962c
ML_SMOKE_01_OVERLAY_SOURCE=5c51615f80aa7dfaec53ff0918c8688cfecb9a02
ML_SMOKE_01_OVERLAY_SCOPE=labs/long-horizon-harness/test/ledger-writer/ledger-writer-socket-probe.test.ts
ML_SMOKE_01_OVERLAY_SHA256=eb59a9eab4d341c429f94934ffc982fb877402083b433fdcfd57ece0be4506c5
ML_SMOKE_01_FIXTURE_SHA256=cd269fa584b1a547aeb165b5e19cbd509fe3df6cd47a9f4547a92a6031ecf677
ML_SMOKE_01_SINGLE_DEFECT=REC-TMP01
ML_SMOKE_01_ALLOWED_PATH=labs/long-horizon-harness/test/recovery/cp-crash.test.ts
```

The historical LH-07 D01 definition is **unchanged**.

## 5. `codium-lab` provisioning and read-only probe results

**Provisioning mechanism discovered** (documented in
`03-codium-lab-provisioning.md`): `--user-data-dir` + `--extensions-dir` +
`CLINE_DATA_DIR`, with the extension build `s1onique.clinemm 4.1.26-821b20e7a`.

**Provisioning result: BLOCKED.** The sandbox permits writes only to the
repository tree and `/tmp`; the whole `~` tree is read-only. The exact
operator commands are recorded in `03-codium-lab-provisioning.md` §5.

**Read-only control path**: already verified in substance against the running
`codium-clinemm` instance (`clinemm_capabilities` and `clinemm_get_run` both
returned `ok:true`). Not re-verified for `codium-lab`, because the instance
does not exist.

## 6. Existing MCP bridge discovery result

**The reviewer's objection was correct.** An embedded MCP control seam exists
in the ClineMM source tree
(`~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/`), including a
real `McpServer` + `StdioServerTransport` proxy, with prior Factory evidence
`PASS_STRUCTURAL_ONLY`.

**But the proxy is not in the installed build** (`grep -c runControlSeamProxy`
→ 0). The installed build ships the native NDJSON control seam, whose six
operations were confirmed present.

**No new MCP server was implemented.** The deterministic runner should use the
native seam; the MCP bridge remains a candidate for interactive supervision if
a build containing it is used.

## 7. Changed-file manifest and recommended commit boundaries

### Files added

| Path | Purpose |
| --- | --- |
| `labs/model-lab/ml_smoke_01_acceptance_oracle.sh` | The corrected oracle (failure-identity discipline) |
| `labs/model-lab/prepare_ml_smoke_01.sh` | Single-defect fixture preparation with a recorded overlay |
| `labs/model-lab/README.md` | **Corrected** — now describes the ML-SMOKE-01 oracle (the REBOOT-01 README described the superseded one) |
| `tests/model_lab/test_ml_smoke_01_oracle.sh` | 20 regression controls |
| `qualification/reboot-corr01/00-entry-state.md` | Entry state and preservation |
| `qualification/reboot-corr01/01-review-findings-reproduced.md` | Reproduced findings |
| `qualification/reboot-corr01/02-ml-smoke-01-fixture.md` | Fixture qualification record |
| `qualification/reboot-corr01/03-codium-lab-provisioning.md` | Provisioning discovery + blocker |
| `qualification/reboot-corr01/04-failure-identity-discipline.md` | First pstack-derived correction record |
| `qualification/reboot-corr01/05-epic-board.md` | Updated epic board |
| `qualification/reboot-corr01/06-exit-report.md` | This report |
| `qualification/reboot-corr01/07-verification-log.md` | Commands, exit codes, elapsed times, checks NOT run |
| `qualification/reboot-corr01/superseded/d01_acceptance_oracle.sh` | The reviewed artifact, preserved verbatim |

### Files removed

`labs/model-lab/d01_acceptance_oracle.sh` — superseded. Preserved verbatim
under `qualification/reboot-corr01/superseded/` so the false PASS stays
reproducible and the review remains auditable.

### Files modified

| Path | Change | Why |
| --- | --- | --- |
| `scripts/verify_factory.sh` | **Modify** (18 insertions, 6 deletions) | The authoritative gate is extended from 6 to 7 steps; step 7 runs the Model Lab oracle regression controls, so a future regression of the oracle's semantics fails the repository gate instead of being found by hand |

No other tracked file was modified. The REBOOT-01 records were **not**
rewritten, and no historical LH-07 artifact was touched.

### Recommended commit boundaries

**Commit A — archival of the LH-07 campaign evidence** (unchanged from
REBOOT-01; 8 files)

```text
qualification/lh07-duty-corpus.json
qualification/lh07/00-entry-state.json … 06-campaign-disposition.json
```

**Commit B — REBOOT-01 baseline** (12 files, including the corrected
`labs/model-lab/README.md`)

```text
labs/model-lab/README.md
qualification/reboot/00-entry-state.md … 09-exit-report.md
```

**Commit C — the correction**

```text
labs/model-lab/ml_smoke_01_acceptance_oracle.sh
labs/model-lab/prepare_ml_smoke_01.sh
tests/model_lab/test_ml_smoke_01_oracle.sh
scripts/verify_factory.sh
qualification/reboot-corr01/**
```

Committing the corrected oracle together with the preserved defective one and
the regression controls makes the whole story reviewable in one place. The
gate change belongs with them: without it, the correction is not enforced.

## 8. Exact next action

**Operator action (two commands, outside this sandbox):**

```bash
mkdir -p ~/.vscodium-lab/{user-data,extensions,cline-data,workspaces}
cp -R ~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.26-821b20e7a \
      ~/.vscodium-lab/extensions/
```

**Then, in order:**

1. `ACT-FACTORY-HAR-01-02` — start `codium-lab` on a disposable empty
   workspace; probe `clinemm_capabilities` and `clinemm_get_run`; confirm the
   owner identity, extension identity, workspace identity, distinct
   `cline-data`, no inherited session, no active task, mutation disabled, and
   that no existing instance was modified.
2. **`ACT-FACTORY-LIVE-SMOKE-01`** — one real MiniMax candidate execution
   against ML-SMOKE-01, with the corrected oracle as the sole verdict
   authority. **This comes before ML-02**, as the review directs: observe one
   complete lifecycle before encoding assumptions about it into software.
3. `ACT-FACTORY-ML-02` — automate the observed lifecycle.
4. `ACT-FACTORY-ML-06` — build a **solution-blind** fixture, without which
   DL-03 cannot be interpreted.

## 9. Exit dispositions

Each work package reported independently:

```text
ORACLE_REQUALIFIED              = YES
CODIUM_LAB_PROVISIONING_BLOCKED = YES
```

**Overall:**

```text
REBOOT_CORR01_DISPOSITION = PARTIAL_REBOOT_CORRECTION
```

**Justification:** work package A is complete and independently verified — the
oracle is corrected, the task contract is fixed, the fixture is single-defect,
and 20 regression controls pass including the historical counterexample. Work
package B is blocked by an environmental write restriction, not by a design
gap; the provisioning mechanism and the operator's exact commands are
documented, and the read-only control path is already qualified in substance
against an existing instance.

**`READY_FOR_FIRST_LIVE_SMOKE` is NOT claimed**, because the live smoke needs
a `codium-lab` instance, which does not yet exist.

## 10. Explicit non-claims

- No model, harness, or skill has been comparatively qualified.
- No live candidate execution has occurred; no paid inference was performed.
- No claim that ML-SMOKE-01 discriminates between capable models — its prompt
  states the remedy, so it is a smoke fixture with a ceiling effect.
- No claim that a separate VSCodium profile is a security sandbox.
- No claim that the MCP bridge is available in the installed build.
- The failure-identity discipline is **PROVISIONAL** until independently
  reviewed; it is not doctrine, and no skill or framework was created for it.
- The LH-07 historical disposition remains `HALT_BUDGET`, unmodified.
