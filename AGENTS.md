# AGENTS.md

> Canonical entrypoint for any LLM-based or coding-agent operator
> working inside the Factory repository. Read this before doing
> implementation, review, qualification, or evidence work.

Factory treats this file as the authoritative, machine-readable pointer
to the doctrine that an automated agent must obey. The doctrine itself
lives in `docs/doctrine/`. Do **not** restate doctrine here; **read
and obey** the canonical sources.

---

## Required reading

Before starting any Factory ACT, burn, review, qualification, or
correction work, read these in order:

1. `docs/concepts/factory.md` — vocabulary and core loop.
2. `docs/doctrine/README.md` — index of current Factory doctrine.
3. The canonical doctrine files it points to (see "Active doctrine"
   below).

---

## Active doctrine

The currently enforced Factory doctrine includes:

### Git topology — `FACTORY_GIT_WORKTREE_POLICY`

Read the canonical source at:

```text
docs/doctrine/git-worktree-policy.md
```

**Pointer (do not paraphrase — read the doctrine):**

> Git topology: obey `FACTORY_GIT_WORKTREE_POLICY`.
> Do not create linked worktrees for ACT, review, or qualification
> isolation. Use the canonical main worktree only.

Key enforcement invariants:

```text
main_worktrees   = 1
linked_worktrees = 0
detached_count   = 0
```

Verified by `scripts/verify_worktree_policy.sh` and wired into
`scripts/check_links.sh` and `scripts/verify_factory.sh`.

---

## Authoritative commands

- **Repository health gate:** `scripts/verify_factory.sh`
- **Link sanity check:** `scripts/check_links.sh`
- **Worktree topology verifier:** `scripts/verify_worktree_policy.sh`
- **Adversarial tests for the policy:** `tests/worktree_policy/test_worktree_policy.sh`

Any of these returning non-zero means the repository is **not** in a
canonical state for Factory-authoritative evidence.

---

## Subject binding

Factory qualification binds an **externally supplied** expected SHA to
the canonical `main` HEAD. Never derive an expected subject from the
qualifying program's own `HEAD` and then prove equality to itself.

---

## Stop conditions

An LLM/coding-agent MUST stop and report (not silently fix) when:

- `git worktree list --porcelain` reports more than one worktree.
- The current HEAD is detached, or the branch is not `main`.
- The expected-SHA binding fails for any Factory qualification.
- An active Factory workflow contains an unapproved `git worktree add`.
