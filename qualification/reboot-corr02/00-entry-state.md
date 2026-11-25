# REBOOT-CORR02 — Entry State

> ACT: `ACT-FACTORY-REBOOT-CORR02-HAR02`
> Date: 2026-11-25

---

## 1. Identity at entry

| Field | Value |
| --- | --- |
| `HEAD` | `df77c61a8daa15dadfc1424054b3edb37436cb40` |
| branch | `main` |
| worktrees | 1 main, 0 linked, 0 detached |
| linked worktrees | 0 |
| detached HEADs | 0 |

The expected HEAD in the ACT was `df77c61a8daa15dadfc1424054b3edb37436cb40`.
The actual HEAD matched it. The operator had not committed reviewed changes.

## 2. Dirty state at entry

```text
 M scripts/verify_factory.sh
?? labs/model-lab/
?? qualification/lh07-duty-corpus.json
?? qualification/lh07/
?? qualification/reboot-corr01/
?? qualification/reboot/
?? tests/model_lab/
```

The ACT expected **31 untracked files and one modified tracked file**
(`scripts/verify_factory.sh`). The actual state matched: one modified
tracked file, and the untracked set belonging to the LH-07 campaign, the
REBOOT-01 campaign, the REBOOT-CORR01 correction, and the Model Lab
fixture/oracle/controls.

## 3. What was preserved

- **LH-07 artifacts** (`qualification/lh07/`, `qualification/lh07-duty-corpus.json`)
  are untouched. The LH-07 historical disposition remains `HALT_BUDGET`.
- **Frozen long-horizon substrates** (the LH-03..LH-06 frozen-contract
  guards and their data files) are untouched. All four guards still pass.
- **REBOOT-01 evidence** (`qualification/reboot/`) and **REBOOT-CORR01
  evidence** (`qualification/reboot-corr01/`) are untouched, including the
  verbatim preserved defective oracle at
  `qualification/reboot-corr01/superseded/d01_acceptance_oracle.sh`.

No destructive reconciliation was performed. Nothing was removed, reset, or
rewritten.

## 4. The distinction between the historical and the current correction

| Campaign | Directory | Oracle | Status |
| --- | --- | --- | --- |
| REBOOT-01 | `qualification/reboot/` | `d01_acceptance_oracle.sh` (removed, preserved verbatim under `reboot-corr01/superseded/`) | historical; demonstrated false PASS |
| REBOOT-CORR01 | `qualification/reboot-corr01/` | `ml_smoke_01_acceptance_oracle.sh` (CORR01 revision) | historical; five authority defects remained open |
| **REBOOT-CORR02** | `qualification/reboot-corr02/` (this directory) | `ml_smoke_01_acceptance_oracle.sh` (current revision) | **current** |

The CORR02 records are **additional** to the CORR01 records. The CORR01
records were not rewritten; they remain an accurate account of what was true
at that time.

## 5. Out of scope, and confirmed untouched

- No Model Lab runner was built.
- No frozen long-horizon machinery was modified.
- No paid inference was initiated.
- No automatic commit and no push.
