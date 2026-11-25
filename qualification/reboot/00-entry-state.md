# REBOOT-01 — Entry State and Preservation Record

> ACT: `ACT-FACTORY-REBOOT-01`
> Captured: 2026-11-24
> Purpose: establish the pre-change baseline, verify that the historical LH-07
> artifacts are preserved byte-for-byte, and record what this ACT changed.

---

## 1. Git topology (observed, not assumed)

| Field | Observed value | Expected | Match |
| --- | --- | --- | --- |
| `HEAD` | `df77c61a8daa15dadfc1424054b3edb37436cb40` | `df77c61a8daa15dadfc1424054b3edb37436cb40` (from LH-07 digest) | YES |
| branch | `main` | `main` | YES |
| worktree count | 1 | 1 | YES |
| linked worktrees | 0 | 0 | YES |
| detached HEADs | 0 | 0 | YES |

Verified by `scripts/verify_worktree_policy.sh` (exit 0,
`FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK`) and `git worktree list --porcelain`.

No linked worktree was created during this ACT. Isolation used plain temporary
directories and `git archive` extraction, which is the GWT05 "isolation belongs
below Git" mechanism.

## 2. Tracked-file cleanliness

```text
git status --porcelain
?? labs/model-lab/                          <- created by THIS ACT
?? qualification/lh07-duty-corpus.json      <- pre-existing, untouched
?? qualification/lh07/                      <- pre-existing, untouched
```

- Modified tracked files: **0**
- Staged changes: **0**
- Deleted tracked files: **0**

The only dirty state at entry was the eight untracked LH-07 artifacts. That
matches the historical digest exactly.

## 3. LH-07 artifact fingerprints (before and after this ACT)

All eight artifacts were hashed at entry and re-hashed at exit. **Every
fingerprint is unchanged.**

| Artifact | SHA-256 |
| --- | --- |
| `qualification/lh07-duty-corpus.json` | `45b5cac987f4e60f8a212c5d76b9be8125ee96029f404bf585373315864f01ba` |
| `qualification/lh07/00-entry-state.json` | `cb20feebf468983d3919393fd5378090cf79b0f5ebe32e372d1fd4ac5b1b02d2` |
| `qualification/lh07/01-candidate-discovery.json` | `2c7c0ca74d5aabe7ba11ce1d5954fa9badf39f0844c06970be9f426590c92005` |
| `qualification/lh07/02-auth-readiness.json` | `f1d71e496a310edd1f484b8213a6cb680f624eb4e3e7ee3f9e5d67dfeab35f4c` |
| `qualification/lh07/03-protocol-selection.json` | `2e09f7898e1da6eaace28f4cca7b017ae2e7b180135e714b8c5b6fbe2a1b2ba2` |
| `qualification/lh07/04-model-parity.json` | `cf288d14fd973a19975bc03ad5d9454c0c266977e33bf95b3b45e872d1caf0d9` |
| `qualification/lh07/05-duty-corpus-proposal.md` | `4232c5c5854d27b0667140ac703f1b2233c9a9f9238ae3c80d890dc7752cf4e1` |
| `qualification/lh07/06-campaign-disposition.json` | `6443fd5d5a2ebfa914ea79fa4cbf6a60c6f88ed418f57c110ce67ac61f6fd4e2` |

Nothing was overwritten, deleted, stashed, staged, or reinterpreted.

## 4. Sensitive-information inspection of the LH-07 artifacts

Read in full before proposing any archival treatment.

- No API key, bearer token, credential, or secret value is present.
- `qualification/lh07/02-auth-readiness.json` records *that* a key exists in the
  local secrets store and *how it was probed*, but not the key material.
- The three canary strings (`LH07_SECRET_CANARY_A/B/C`) are synthetic
  identifiers declared in the corpus, not live secrets.
- `qualification/lh07/06-campaign-disposition.json` mentions "the single
  MiniMax API key present in the local secrets store" — a description, not a
  value.

**Result: the eight artifacts contain no secret material.** They are safe to
commit in an archival commit without redaction.

## 5. Historical disposition preserved

The LH-07 historical disposition remains `HALT_BUDGET` exactly as recorded in
`qualification/lh07/06-campaign-disposition.json`. This ACT did **not** rewrite,
supersede, or reinterpret it.

The new operator decision to defer the campaign is recorded *separately* in
`qualification/reboot/01-operator-decision.md`, so that historical evidence
and current intent remain separable.

## 6. Frozen substrates

| Substrate | Frozen commit | Changed |
| --- | --- | --- |
| Phase E | `61b0979ebba52e391e1408561fb2c20a79d28af7` | NO |
| LH-02 | `715e6390d78228f089270259e1bd1307140adb75` | NO |
| LH-03 | `7be31164b939f327c557847eb9a8b0c4ffd16b87` | NO |
| LH-04 | `a8caa82655ca6036bc40a43be5000bdda5bb84bf` | NO |
| LH-05 | `c898f05ccb1966c5074f6483bad106b3d093b169` | NO |
| LH-06 | `5d4c9d258446cba1b018ab689433bafe162feefb` | NO |

All six frozen-substrate guards were executed live during this ACT
(`scripts/verify_lh03_frozen.sh` … `scripts/verify_lh06_frozen.sh`), not
inherited from the historical digest. See `05-verification-log.md`.

## 7. Entry-state difference from the historical digest

The historical digest (`qualification/lh07/00-entry-state.json`) recorded
`status_short: ""` — a clean tree at the time LH-07 was captured. Today the
tree is dirty with the eight LH-07 artifacts plus this ACT's new files.

**This difference is expected and benign.** It is not a state conflict: no
tracked file differs from `df77c61`, no substrate changed, and no linked
worktree exists. No destructive reconciliation was performed or needed.

## 8. Files created by this ACT

| Path | Purpose |
| --- | --- |
| `labs/model-lab/d01_acceptance_oracle.sh` | Evaluator-owned D01 acceptance oracle |
| `qualification/reboot/00-entry-state.md` | This record |
| `qualification/reboot/01-operator-decision.md` | New operator decisions (separate from history) |
| `qualification/reboot/02-d01-fixture-qualification.md` | D01 fixture qualification record |
| `qualification/reboot/03-machinery-inventory.md` | Existing machinery inventory |
| `qualification/reboot/04-pstack-discipline-crosswalk.md` | pstack → Factory crosswalk |
| `qualification/reboot/05-verification-log.md` | Commands, exit codes, elapsed times |
| `qualification/reboot/06-codium-lab-capability-matrix.md` | Amendment A discovery result |
| `qualification/reboot/07-epic-board.md` | Updated epic board |
| `qualification/reboot/08-ml02-scope.md` | Proposed exact scope for ML-02 |
| `qualification/reboot/09-exit-report.md` | Exit disposition and recommended commit boundaries |
