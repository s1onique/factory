# REBOOT-01 — D01 Fixture Qualification Record

> Duty: LH-07 **D01**, `bounded defect repair`, promoted to **smoke fixture**.
> All results below were produced by execution in this ACT. Nothing is
> inherited from the historical digest.

---

## 1. Historical basis (verified, not assumed)

| Field | Value |
| --- | --- |
| base commit (pre-fix snapshot) | `09fc12c6fb051dce096252bf30c2e96debed962c` |
| historical fix commit | `5c51615f80aa7dfaec53ff0918c8688cfecb9a02` |
| historical fix subject | `fix(long-horizon): CORRECTION12 — disposition-to-code parity (REC-TMP01 + SOCK06E)` |
| defect-bearing file | `labs/long-horizon-harness/test/recovery/cp-crash.test.ts` |
| second defect-bearing file | `labs/long-horizon-harness/test/ledger-writer/ledger-writer-socket-probe.test.ts` |
| fixture tree size | 237 tracked files |

Both commits were confirmed present in the canonical repository's object
store (`git cat-file -e`).

## 2. The two historical defects

**Defect A — REC-TMP01 (fixture-construction failure).**
`fs.mkdtemp` does not create missing parents. The test anchored its hermetic
seam at `process.cwd()/.tmp-home/tmp01-`; on a clean worktree that parent does
not exist, so `mkdtemp` threw `ENOENT` and the test failed for
fixture-construction reasons instead of qualifying `tmpDir(base)`.

**Defect B — SOCK06 (non-portable pathname-absence assertion).**
The inline SOCK06 test asserted the Unix-domain-socket pathname was absent
after the helper close boundary. A socket left by a `SIGKILL`ed process may
persist, so that assertion is not a portable invariant.

The historical fix addressed both: Defect A by anchoring the seam under
`os.tmpdir()`, Defect B by replacing the `ENOENT` assertion with a
"no longer classifies as `live_writer_present`" check plus explicit cleanup.

## 3. Isolation mechanism (below Git, per GWT05)

Fixtures were materialized with `git archive <commit> | tar -x` into
`/tmp` directories. **No file in the canonical repository was reverted, and
no linked worktree was created.** The canonical working tree was never
mutated by the experiment.

## 4. Required qualification controls — results

### Control 1 — known-bad fixture reproduces the intended failure

```text
cd <base>/labs/long-horizon-harness
node --import tsx --test --test-reporter=spec test/recovery/cp-crash.test.ts
```

Observed:

```text
✖ REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent
  Error: ENOENT: no such file or directory, mkdtemp '.../.tmp-home/tmp01-Q82Ehb'
ℹ tests 14   ℹ pass 13   ℹ fail 1
```

**PASS.** The intended historical failure reproduces with the historical
error signature.

### Control 2 — historical fixed fixture passes the same oracle

```text
cd <fixed>/labs/long-horizon-harness
node --import tsx --test --test-reporter=tap \
    test/recovery/cp-crash.test.ts \
    test/ledger-writer/ledger-writer-socket-probe.test.ts
```

Observed: `ℹ pass 23   ℹ fail 0`, exit 0.

**PASS.**

### Control 3 — an unrelated or vacuous change cannot satisfy the oracle

Three independent vacuity attacks were run against the **fixed** fixture:

| Attack | Mutation | Gate result | Oracle result |
| --- | --- | --- | --- |
| A | delete the `REC-TMP01` test entirely | gate FAIL (SOCK06 still fails) | **FAIL** |
| B | replace the `REC-TMP01` body with `t.skip("vacuous")` | gate FAIL (SOCK06 still fails) | **FAIL** |
| C | delete `REC-TMP01` from the **fixed** fixture (so the gate fully passes) | gate **PASS** (22 ok) | **FAIL** — `D01_ORACLE_MUTATION_DETECTED=NO` |

Attack C is the decisive one. The raw gate alone reports PASS on a workspace
where the qualifying test has been removed — a textbook vacuous pass. The
oracle still rejects it, because the mutation control re-injects the known-bad
seam and confirms the gate catches it; when the seam cannot be injected
because the candidate deleted the test, the oracle fails closed.

**PASS.** The oracle is not vacuous.

### Control 4 — protected files remain unchanged

The oracle diffs every tracked path of the base commit against the workspace
using blob hashes and reports `ADDED` / `MODIFIED` / `DELETED`. Any path
outside the allowed set is counted as a scope violation and fails the verdict.

Observed on the historical fixed fixture: `D01_ORACLE_SCOPE_VIOLATIONS=0`.

**PASS.**

### Control 5 — candidate-visible fixture identity is captured

The oracle takes the base commit as an argument and compares the workspace
against that commit in the canonical repository's object store. The base
commit `09fc12c…` is therefore the fixture identity, and every workspace
diff is expressed relative to it.

**PASS.**

### Control 6 — dependency and toolchain prerequisites are recorded

| Prerequisite | Value |
| --- | --- |
| Node.js | `v26.0.0` (`/opt/homebrew/bin/node`; **not** on the default `PATH`) |
| npm | `11.12.1` |
| harness package | `@factory/long-horizon-harness-lab` (`type: module`, `engines.node >= 20`) |
| dependencies | `tsx`, `typescript`, `@types/node` — already installed in `labs/long-horizon-harness/node_modules` |
| fixture must copy | `node_modules` into the materialized workspace, or the gate cannot run |
| `TMPDIR` | **must be pinned to a short path** (see §5) |

**PASS**, with two environment constraints recorded as mandatory prerequisites.

## 5. Two environment defects that silently defeat the gate

These were discovered by execution and are the reason the oracle owns its own
sanitized environment.

### 5.1 Ambient `.tmp-home` masks the defect

The REC-TMP01 defect only reproduces when `.tmp-home` is **absent**:

```text
with .tmp-home PRESENT:  ok 1 - REC-TMP01 ...   # pass 14  fail 0
with .tmp-home ABSENT:   not ok 1 - REC-TMP01 ... # pass 13  fail 1
```

A developer workspace or a previous run leaves `.tmp-home` behind, so the
defect disappears and the gate reports a false PASS. The oracle therefore
**removes** `<workspace>/labs/long-horizon-harness/.tmp-home` before running the
gate. This is precisely the "fixture-precondition law" the historical corpus
documented but did not enforce.

### 5.2 A long `TMPDIR` silently skips the regression half of the gate

The SOCK tests are guarded by `detectSpawnableBind()`, which skips them when
the Unix-domain-socket path would exceed 100 bytes. On this host the ambient
`TMPDIR` is 84 characters:

```text
/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/clinemm-sandbox-temp-AJELMr
```

With that ambient `TMPDIR`, five SOCK tests **silently skipped** — including
SOCK06, the one carrying Defect B — and the gate exited 0 on the *known-bad*
fixture. The regression half of the gate never ran.

With `TMPDIR=/tmp`, the same fixture produces:

```text
✖ SOCK06 malformed WHO → unknown_socket (B0-CORR06)
  AssertionError: Missing expected rejection: SOCK06E: pathname ... MUST be absent
ℹ pass 4   ℹ fail 1   ℹ skipped 5
```

The oracle therefore **pins `TMPDIR=/tmp`**. A skipped test is not a passed
test; the oracle refuses to let the environment decide whether the gate is
meaningful.

## 6. The acceptance oracle

`labs/model-lab/d01_acceptance_oracle.sh` — evaluator-owned, deterministic,
read-only with respect to the canonical repository.

```text
bash labs/model-lab/d01_acceptance_oracle.sh \
     <repo_root> <base_commit> <workspace>
```

Three independent steps, fail-closed:

1. **Scope enforcement** — blob-hash diff of every tracked base path against
   the workspace; violations outside the allowed set fail the verdict.
2. **Acceptance gate** — runs the two historical test files in a sanitized
   environment (no `.tmp-home`, short `TMPDIR`). `ok`/`not ok` counts are
   parsed from the TAP stream.
3. **Mutation control** — re-injects the known-bad REC-TMP01 seam into a
   throwaway copy of the workspace and re-runs the gate. The mutation must be
   **detected**.

Machine-readable output:

```text
D01_ORACLE_SCOPE_VIOLATIONS=<n>
D01_ORACLE_GATE_EXIT=<n>
D01_ORACLE_GATE_PASSED=<n>
D01_ORACLE_GATE_FAILED=<n>
D01_ORACLE_ACCEPTANCE=PASS|FAIL
D01_ORACLE_MUTATION_DETECTED=YES|NO
D01_ORACLE_DISPOSITION=PASS|FAIL
```

### Control results against the oracle

| # | Workspace | Expected | Observed | Verdict |
| --- | --- | --- | --- | --- |
| 1 | base (`09fc12c`) | FAIL | `ACCEPTANCE=FAIL`, `DISPOSITION=FAIL`, exit 1 | CORRECT |
| 2 | historical fixed (`5c51615`) | PASS | `ACCEPTANCE=PASS`, `MUTATION_DETECTED=YES`, `DISPOSITION=PASS`, exit 0 | CORRECT |
| 3 | fixed minus `REC-TMP01` | FAIL | `ACCEPTANCE=PASS` but `MUTATION_DETECTED=NO`, `DISPOSITION=FAIL`, exit 1 | CORRECT |

### A note on the mutation design

The mutation rewrites the **statement**, not a literal fix string:

```text
const tmpRoot = await fs.mkdtemp(   ->   const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));
```

An earlier version matched the literal `join(os.tmpdir(), "tmp01-")` and was
**wrong**: the historical fix actually uses `join(tmpdir(), "factory-rec-tmp01-")`.
The literal-matching control would have silently reported
`MUTATION_NOTE=known_bad_seam_absent` and failed closed against a legitimate
fix. Statement-level rewriting keeps the control valid for every legitimate
fix shape.

## 7. Leakage assessment

The candidate-visible fixture is a plain directory tree extracted from the
base commit. It contains:

- no `.git` directory, hence no future Git objects and no reachable
  `historical_fix_commit`;
- no `qualification/` directory, hence no LH-07 corpus or oracle;
- no acceptance test that the candidate could satisfy by writing it;
- no previous run outputs;
- no credentials.

The historical `leakage_scan_disposition` was `PENDING_RUN`; this ACT records
the *structural* leakage properties that were actually verified. A
token-level leakage scan over the full tree is **not** yet run and remains
outstanding for ML-01 completion.

## 8. Limitations (stated plainly)

1. **D01 is a smoke fixture.** It discriminates "the pipeline works" from "the
   pipeline is broken". It does not rank models.
2. **The task prompt still leaks the solution.** The historical prompt names
   `fs.mkdtemp`, the missing-parent behaviour, and the `os.tmpdir()` remedy.
   A candidate that simply applies the described change passes. D01 must not be
   used to compare model competence.
3. **The oracle's scope rule is path-based.** It does not yet detect a
   semantically-equivalent but differently-located edit, nor a change to
   `node_modules`.
4. **The fixture depends on the ambient toolchain.** Node must be on `PATH`
   and `node_modules` must be copied into the workspace. A runner that forgets
   either produces a *false FAIL*, not a false PASS — the safe direction.
5. **The gate is host-sensitive.** SOCK tests are skipped on hosts with long
   `TMPDIR`; the oracle pins `TMPDIR` for that reason, but other hosts may
   have other environment blockers.
6. **Only one duty was qualified.** D02–D06 remain unqualified, and the
   corpus-level defects listed in `01-operator-decision.md` remain open.

## 9. Disposition

```text
D01_FIXTURE_QUALIFICATION = PASS
D01_ROLE                   = SMOKE_FIXTURE_ONLY
D01_EVIDENCE_CLASS         = INDEPENDENT_ORACLE
D01_COMPARATIVE_CLAIM      = NONE
```

The fixture is qualified for use as a smoke fixture with an evaluator-owned
acceptance oracle. It is **not** qualified as evidence of model competence, and
no comparative claim about any model is made or implied.
