# REBOOT-CORR02 — Changed-File Manifest

> ACT: `ACT-FACTORY-REBOOT-CORR02-HAR02`
> Date: 2026-11-25
>
> **No commit and no push.** The operator had not committed the reviewed
> artifacts at entry, and this ACT does not commit.

---

## 1. Added

| Path | Purpose |
| --- | --- |
| `labs/model-lab/ml_smoke_01_lib.mjs` | The oracle's DECISION LOGIC: the tree comparison, the event classifier, the acceptance verdict, the mutation verdict, the seam locator, the allowed-region validator. Pure functions over synthetic inputs, so they can be exercised cheaply. |
| `labs/model-lab/ml_smoke_01_test_reporter.mjs` | A small STRUCTURED Node test reporter. One JSON object per test, carrying the test's exact name, its status, and the chain of error codes its own failure produced. |
| `labs/model-lab/ml_smoke_01_tool.mjs` | The command-line surface of the decision logic. The bridge between the shell oracle and the library; it removes the need to embed JavaScript in shell. |
| `labs/model-lab/verify_codium_lab_readonly.sh` | The READ-ONLY verification of the dedicated `codium-lab` instance, its native control seam, and the existing ClineMM MCP supervision proxy. |
| `scripts/verify_factory_fast.sh` | The ordinary gate as a standalone entry point. |
| `scripts/verify_factory_qualification.sh` | The authoritative gate: the fast gate plus the real-fixture controls. |
| `tests/model_lab/test_ml_smoke_01_lib.mjs` | The 44 FAST deterministic controls. Synthetic structured events and synthetic trees. No fixture execution. |
| `qualification/reboot-corr02/00-entry-state.md` | Entry state, dirty state, and what was preserved. |
| `qualification/reboot-corr02/01-counterexamples-reproduced.md` | The seven reproduced counterexamples and their corrections. |
| `qualification/reboot-corr02/02-verification-performance.md` | The measurement, the three-level separation, and the concurrency investigation. |
| `qualification/reboot-corr02/03-codium-lab-readonly.md` | The `codium-lab` read-only verification and the MCP proxy discovery. |
| `qualification/reboot-corr02/04-mcp-client-configuration.md` | The exact minimal MCP configuration fragment and the operator command. |
| `qualification/reboot-corr02/05-changed-file-manifest.md` | This manifest. |
| `qualification/reboot-corr02/06-exit-report.md` | The exit report. |

## 2. Modified

| Path | Change | Why |
| --- | --- | --- |
| `labs/model-lab/ml_smoke_01_acceptance_oracle.sh` | Replaced by the CORR02 oracle. The prepared reference became REQUIRED and identity-bound; the self-comparison fallback was removed; the dependency trust became identity-bound and a candidate-owned tree became a violation; object types and modes are compared; enumeration errors fail closed; the gate runs in a fresh evaluator reconstruction; the negative evidence is bound to the required test's own error-code chain. | Close D1, D2, D3, D4. |
| `labs/model-lab/prepare_ml_smoke_01.sh` | The destructive `rm -rf` was replaced by an ownership check; an exclusive lock keyed by the output directory path was added; the dependency tree was removed from the fixture; the digest is computed by the shared library so the reference identity cannot drift. | Close D5 and D6. |
| `labs/model-lab/README.md` | The two gate levels, the new components, the new dispositions, the measured runtimes, and the reference-identity and allowed-region rules. | Correct the stale documentation. |
| `scripts/verify_factory.sh` | Step 7 now runs the FAST decision-logic controls. The gate is the ORDINARY level and names the AUTHORITATIVE one. | Restore the ordinary gate to its original cost without weakening any acceptance criterion. |
| `tests/model_lab/test_ml_smoke_01_oracle.sh` | Rewritten as the real-fixture qualification level: seventeen controls, with the corrected C01 and C11 and the new C12..C17. | Close D7 and give each remaining defect a real-fixture control. |

## 3. Unchanged — and explicitly preserved

| Path | Why it is unchanged |
| --- | --- |
| `qualification/lh07/**` | The LH-07 campaign evidence. Historical. The LH-07 disposition remains `HALT_BUDGET`. |
| `qualification/lh07-duty-corpus.json` | The historical LH-07 duty corpus. |
| `qualification/reboot/**` | The REBOOT-01 evidence. Historical. It is kept distinguishable from this correction. |
| `qualification/reboot-corr01/**` | The REBOOT-CORR01 evidence. Historical. It is kept distinguishable from this correction. |
| `qualification/reboot-corr01/superseded/d01_acceptance_oracle.sh` | The REBOOT-01 oracle, preserved **verbatim**, so its demonstrated false PASS stays reproducible and reviewable. |
| `scripts/verify_lh0{3,4,5,6}_frozen.sh`, `scripts/verify_lh06_frozen_data.ts` | The frozen long-horizon substrates. |
| `scripts/verify_worktree_policy.sh`, `scripts/check_links.sh` | The canonical topology and link guards. |

No historical artifact was rewritten. No frozen substrate was modified. No
destructive reconciliation was performed.

## 4. Git topology at exit

```text
worktree /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/factory
HEAD     df77c61a8daa15dadfc1424054b3edb37436cb40
branch   refs/heads/main
```

One worktree, `main`, not detached. `FACTORY_GIT_WORKTREE_POLICY` holds:
`main_worktrees = 1`, `linked_worktrees = 0`, `detached_count = 0`.
