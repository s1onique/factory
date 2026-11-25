# ML-02 — Entry state

> ACT: `ACT-FACTORY-ML-02-MINIMAL-RUNNER-01`.
>
> The provisional commit was supplied by the operator. Its SHA was NOT
> supplied and was DISCOVERED from the actual repository.

## Entry identity

| Property | Value |
| --- | --- |
| ENTRY_HEAD | `016816625601fcde1eae3c140c7e7d7b2fb33fd2` |
| Branch | `main` |
| Parent commit | `df77c61a8daa15dadfc1424054b3edb37436cb40` |
| Entry commit subject | `LIVE-SMOKE-01B provisional commit` |
| Tracked state at entry | clean (no modified tracked files) |
| Untracked state at entry | clean (no untracked files) |
| Staged state at entry | empty |
| Worktree topology | `main_worktrees=1`, `linked_worktrees=0`, `detached_count=0` |
| Stashes | none (`git stash list` was empty) |
| Linked worktrees | none created by this ACT |

## The relationship to the historical pre-reboot HEAD

The historical pre-reboot HEAD was
`df77c61a8daa15dadfc1424054b3edb37436cb40`
(`factory: clean LH-06 freeze residue`).

`df77c61` is the DIRECT PARENT of `0168166`. The relationship is a
single linear fast-forward: `df77c61` → `0168166`. The provisional
commit was NOT a rewrite, a squash, a rebase or an amend of the
historical HEAD; it is a descendant of it.

```
df77c61  factory: clean LH-06 freeze residue
   |
0168166  LIVE-SMOKE-01B provisional commit   <- ENTRY_HEAD
```

## The supplied diff

The operator supplied the full commit diff as `digest(20261125-033518).txt`
(73 changed files). The diff was NOT committed into the repository and is
NOT reproduced here. The entry commit's own file list was read from the
actual repository and matched the operator's count:

```
73 files changed, 13076 insertions(+), 8 deletions(-)
```

## The historical verdict that is preserved

The LIVE-SMOKE-01B authoritative verdict on the ML-SMOKE-01 candidate
remains **FAIL**. This ACT does NOT rerun ML-SMOKE-01 against a model, does
NOT retrospectively change that verdict, and does NOT touch the historical
qualification records under `qualification/live-smoke-01*/`.

The historical records under `qualification/live-smoke-01b/06-ml06a/` are
PRESERVED VERBATIM.

## The 19 recorded identities

The independent review reconstructed the relevant files from the full diff
and verified 19 recorded hashes: 10 LIVE-SMOKE-01B bundle artifact hashes,
5 ML-06A evaluator/control hashes and 4 ML-SMOKE-01 evaluator
implementation hashes. All 19 matched.

The 5 ML-06A evaluator/control hashes and the 4 ML-SMOKE-01 evaluator
implementation hashes were RE-VERIFIED against the actual local files at
entry. See `01-review-counterexamples.md` for the per-file table.

## What this ACT preserves

- Every historical qualification record.
- Every historical verdict.
- Every frozen long-horizon substrate (`scripts/verify_lh0*_frozen.sh`
  remain green; see the ordinary gate).
- The historical `qualification/reboot/08-ml02-scope.md` proposal, which
  is MARKED SUPERSEDED but NOT rewritten.
