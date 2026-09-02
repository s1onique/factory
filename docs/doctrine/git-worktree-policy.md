# Doctrine — Git Worktree Policy

> Canonical Factory doctrine on Git working-tree topology.

This doctrine is **LLM-readable**. It defines a single authoritative Git
working tree for the Factory repository and forbids linked worktrees as
an isolation primitive for ACTs, reviews, qualification, or coding-agent
work.

This is a **Factory policy**, not a claim that Git worktrees are
inherently unsafe. Git explicitly defines a repository as having one
**main worktree** and optionally additional **linked worktrees**.
`git worktree add --detach` is a convenient throwaway checkout for
experimentation and testing. Factory intentionally chooses NOT to use
that mechanism for its authoritative workflows because Factory values
a single obvious subject identity over concurrent-checkout convenience.

## FACTORY_GIT_WORKTREE_POLICY

### GWT01 — One authoritative working tree

A Factory repository MUST have exactly one authoritative Git working
tree for normal ACT execution, implementation, review, testing,
evidence collection, and qualification.

The authoritative working tree is the repository's main worktree.

### GWT02 — No linked worktrees for Factory workflow isolation

Factory agents and operators MUST NOT use:

```bash
git worktree add ...
```

to create alternate linked worktrees for:

- ACT implementation
- correction chains
- qualification
- exact-SHA burns
- reviewer reproduction
- adversarial testing
- temporary coding-agent sandboxes
- detached-HEAD subjects
- parallel implementation streams

Do not solve runtime/test isolation by multiplying Git working trees.

### GWT03 — `main` is the canonical integration subject

Normal Factory implementation work lands on the canonical `main`
working tree. Before an ACT claims an implementation or qualification
subject:

```text
branch             == main
HEAD               == expected committed subject
worktree           == clean
linked worktree count == 0
```

A detached worktree commit MUST NOT be described as "current main",
"canonical HEAD", or an authoritative qualification subject.

### GWT04 — Exact-SHA binding remains mandatory

Eliminating linked worktrees does NOT weaken exact-subject
qualification. Qualification MUST still bind an externally supplied
expected SHA to the currently checked-out canonical `main` HEAD:

```text
EXPECTED_SHA supplied externally
        ==
git rev-parse HEAD
```

The qualifying program MUST NOT derive its expected subject from its
own HEAD and then prove equality to itself.

### GWT05 — Isolation belongs below Git

When an ACT needs isolation, prefer mechanisms appropriate to the
resource being isolated:

```text
temporary directories
unique run IDs
fixture-owned paths
process namespaces
containers
Kubernetes namespaces
network namespaces
ephemeral databases
temporary sockets
test-specific state directories
hermetic labs
```

Git checkout topology MUST NOT be used as a substitute for runtime
isolation.

### GWT06 — Cleanup is allowed

This policy forbids **creating/using linked worktrees as a Factory
workflow mechanism**.

It does NOT forbid administrative cleanup of historical linked-worktree
state. Commands such as:

```bash
git worktree list
git worktree remove ...
git worktree prune
```

are allowed when used to inspect or remove legacy/stale linked
worktrees.

`git worktree add` is forbidden unless a future ACT explicitly
authorizes a narrowly scoped Git-worktree experiment.

### GWT07 — Explicit exception only

A linked worktree may be created only when an ACT explicitly states
that Git worktree behavior itself is the object of the experiment.
The ACT MUST state:

```text
WORKTREE_POLICY_EXCEPTION = YES
reason       = <why Git worktree behavior itself must be exercised>
lifetime     = bounded
cleanup      = mandatory
authoritative_subject = still the main worktree
```

No implicit exceptions.

### GWT08 — Qualification fails closed

A Factory qualification or authoritative evidence run MUST fail closed
if linked worktrees exist. Expected invariant:

```text
main_worktrees   = 1
linked_worktrees = 0
```

Presence of any linked worktree means repository topology is not
canonical enough to mint authoritative qualification evidence.

### GWT09 — No hidden detached subject

A detached HEAD MUST NOT be used as the canonical Factory
implementation or qualification subject.

If useful work was produced elsewhere, integrate it into `main` first,
preferably by mechanically verified fast-forward when ancestry
permits. Do not qualify the detached copy and "merge it later."

### GWT10 — Canonical-subject principle

Factory doctrine:

> There should be one obvious answer to the question: "What exact
> repository state are we working on?"

For normal Factory development the answer is:

```text
the clean HEAD of the canonical main worktree
```

---

## Mechanical enforcement

This doctrine is enforced by:

```bash
scripts/verify_worktree_policy.sh
```

The verifier uses `git worktree list --porcelain` as the machine-
readable surface and emits:

```text
FACTORY_GIT_WORKTREE_POLICY_MAIN_COUNT=<n>
FACTORY_GIT_WORKTREE_POLICY_LINKED_COUNT=<n>
FACTORY_GIT_WORKTREE_POLICY_DETACHED_COUNT=<n>
FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK|FAIL
```

The verifier is integrated into the repository's authoritative gate
(`scripts/check_links.sh` and `scripts/verify_factory.sh`) so that
presence of any linked worktree makes authoritative verification fail
non-zero.

Adversarial tests live in `tests/worktree_policy/`.

---

## Final doctrinal statement

> **Factory uses one canonical Git working tree.**
>
> Linked worktrees are not an approved Factory isolation primitive
> for implementation, review, testing, or qualification. Runtime
> isolation belongs to runtime mechanisms. Exact-SHA qualification
> happens against the clean canonical `main` HEAD, with externally
> supplied subject binding.
>
> A linked worktree may exist only under an explicit, narrowly scoped
> ACT whose object of study is Git worktree behavior itself.
