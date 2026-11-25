# REBOOT-CORR01-HAR01 — Entry State and Preservation Record

> ACT: `ACT-FACTORY-REBOOT-CORR01-HAR01`
> Date: 2026-11-24
> Purpose: close the independent review findings from REBOOT-01 and provision
> the dedicated `codium-lab` candidate environment.

---

## 1. Entry identity

| Field | Observed | Expected | Match |
| --- | --- | --- | --- |
| `HEAD` | `df77c61a8daa15dadfc1424054b3edb37436cb40` | `df77c61a8daa15dadfc1424054b3edb37436cb40` | YES |
| branch | `main` | `main` | YES |
| worktree count | 1 | 1 | YES |
| linked worktrees | 0 | 0 | YES |
| detached HEADs | 0 | 0 | YES |

No operator commit of reviewed artifacts had been made since REBOOT-01, so
the expected HEAD is unchanged.

## 2. Entry dirty state

```text
?? labs/model-lab/
?? qualification/lh07-duty-corpus.json
?? qualification/lh07/
?? qualification/reboot/
```

Expected: the eight historical LH-07 artifacts and the twelve REBOOT-01
artifacts. Confirmed: **0 modified tracked files, 0 staged changes.**

## 3. Historical LH-07 evidence preserved byte-for-byte

All eight LH-07 artifacts were re-hashed at entry and at exit. **Identical.**

| Artifact | SHA-256 (entry == exit) |
| --- | --- |
| `qualification/lh07-duty-corpus.json` | `45b5cac987f4e60f8a212c5d76b9be8125ee96029f404bf585373315864f01ba` |
| `qualification/lh07/00-entry-state.json` | `cb20feebf468983d3919393fd5378090cf79b0f5ebe32e372d1fd4ac5b1b02d2` |
| `qualification/lh07/01-candidate-discovery.json` | `2c7c0ca74d5aabe7ba11ce1d5954fa9badf39f0844c06970be9f426590c92005` |
| `qualification/lh07/02-auth-readiness.json` | `f1d71e496a310edd1f484b8213a6cb680f624eb4e3e7ee3f9e5d67dfeab35f4c` |
| `qualification/lh07/03-protocol-selection.json` | `2e09f7898e1da6eaace28f4cca7b017ae2e7b180135e714b8c5b6fbe2a1b2ba2` |
| `qualification/lh07/04-model-parity.json` | `cf288d14fd973a19975bc03ad5d9454c0c266977e33bf95b3b45e872d1caf0d9` |
| `qualification/lh07/05-duty-corpus-proposal.md` | `4232c5c5854d27b0667140ac703f1b2233c9a9f9238ae3c80d890dc7752cf4e1` |
| `qualification/lh07/06-campaign-disposition.json` | `6443fd5d5a2ebfa914ea79fa4cbf6a60c6f88ed418f57c110ce67ac61f6fd4e2` |

The LH-07 historical disposition remains `HALT_BUDGET`, unmodified.

## 4. Frozen substrates

Phase E and LH-02 … LH-06 guards were re-verified live during this ACT. All
returned exit 0. See `04-verification-log.md`.

## 5. Historical evidence vs. correction evidence

The REBOOT-01 records are **not** rewritten. This ACT adds a separate
`qualification/reboot-corr01/` directory. The two remain distinguishable:

- `qualification/reboot/` — what REBOOT-01 claimed, including the claim that
  is now known to have been wrong.
- `qualification/reboot-corr01/` — what the correction established.

This preserves the audit trail rather than silently overwriting history.
