# REBOOT-CORR01 — Verification Log

> Every command was executed in this ACT. Nothing is inherited.

---

## 1. Repository baseline

| # | Command | Exit | Elapsed | Outcome |
| --- | --- | --- | --- | --- |
| 1.1 | `git rev-parse HEAD` | 0 | — | `df77c61a8daa15dadfc1424054b3edb37436cb40` (unchanged) |
| 1.2 | `git rev-parse --abbrev-ref HEAD` | 0 | — | `main` |
| 1.3 | `git worktree list --porcelain` | 0 | — | 1 worktree, `refs/heads/main` |
| 1.4 | `git status --porcelain` | 0 | — | only untracked artifacts; **0 modified tracked files** |
| 1.5 | `git diff --stat` | 0 | — | empty — no tracked file modified |
| 1.6 | `git diff --cached --stat` | 0 | — | empty — nothing staged |
| 1.7 | `bash scripts/verify_worktree_policy.sh` | **0** | <1 s | `DISPOSITION=OK` (1 worktree, 0 linked, 0 detached) |
| 1.8 | `bash scripts/check_links.sh` | **0** | <1 s | `All checks passed` |
| 1.9 | `bash scripts/verify_factory.sh` | **0** | 1.35 s *(before step 7 was added)* | `FACTORY_VERIFY_DISPOSITION=OK` |

## 2. Frozen substrates (all re-verified live)

| # | Command | Exit | Disposition |
| --- | --- | --- | --- |
| 2.1 | `bash scripts/verify_lh03_frozen.sh` | **0** | `FACTORY_LH03_FROZEN_DISPOSITION=OK` |
| 2.2 | `bash scripts/verify_lh04_frozen.sh` | **0** | `FACTORY_LH04_FROZEN_DISPOSITION=OK` |
| 2.3 | `bash scripts/verify_lh05_frozen.sh` | **0** | `FACTORY_LH05_VERIFY_DISPOSITION=OK` |
| 2.4 | `bash scripts/verify_lh06_frozen.sh` | **0** | `FACTORY_LH06_VERIFY_DISPOSITION=OK` |

## 3. Adversarial tests

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 3.1 | `bash tests/worktree_policy/test_worktree_policy.sh` | **0** | `PASS=9  FAIL=0` |
| 3.2 | `bash tests/lh06-frozen/test_lh06_frozen.sh` | **0** | `PASS=16  FAIL=0` |

## 4. Reproduced review findings (against the actual REBOOT-01 oracle)

| # | Reproduction | Result |
| --- | --- | --- |
| 4.1 | apply the REBOOT-01 mutation to the historical fixed statement | `const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));join(tmpdir(), "factory-rec-tmp01-"));` — **syntax error** (`Expected ";" but found ")"`) |
| 4.2 | run the mutant | `not ok 1 - test/recovery/cp-crash.test.ts` — the file never loaded; REC-TMP01 never executed |
| 4.3 | synthetic fixture, every test skipped | TAP `pass 0 / skipped 2`; oracle `GATE_PASSED=2` |
| 4.4 | complete counterexample (skipped required test + passing helper + syntax-error mutation) | `SCOPE_VIOLATIONS=0`, `ACCEPTANCE=PASS`, `MUTATION_DETECTED=YES`, **`DISPOSITION=PASS`** — a demonstrated false PASS |
| 4.5 | the same counterexample against the **preserved** copy | reproduces the false PASS — the evidence is faithful and re-checkable |

## 5. Model Lab oracle regression controls

```text
bash tests/model_lab/test_ml_smoke_01_oracle.sh
PASS=20  FAIL=0
```

Controls C01–C11 are listed in
`04-failure-identity-discipline.md` §5. The run takes roughly **4 minutes**,
because each control runs the full harness gate twice (once for the
workspace, once for the mutant).

### A concurrency finding (recorded, because it caused a false FAIL)

An intermediate gate run reported:

```text
[FAIL]  Model Lab oracle regression controls detected a defect
FACTORY_VERIFY_DISPOSITION=FAIL (1 verifier(s) failed)
```

with C01, C02, C04, C07 and C08 reported as failing. **This was not a code
defect.** The cause was two `verify_factory.sh` invocations running
concurrently (one from an earlier command that had not yet returned, one
explicitly started), so two suites materialized fixtures and ran the same
harness tests at the same time in the same working tree.

Evidence:

- The same controls pass **20/20** when the suite runs alone (elapsed
  249 s).
- A single control run in isolation reports the correct values
  (`GATE_PASSED=22`, `GATE_FAILED=1`, `DISPOSITION=FAIL`).

**Consequence for the gate:** the suite is **not concurrency-safe** and the
repository gate must not be run twice concurrently. This is recorded as a
known operational constraint, not as a defect in the oracle. ML-02 must
serialize its own runs.

## 6. The gate now includes the regression controls

`scripts/verify_factory.sh` was extended from 6 to 7 steps; step 7 runs the
Model Lab oracle regression controls. This makes the failure-identity
discipline permanently enforced by the authoritative gate, so a future
regression of the oracle's semantics fails the repository gate rather than
being discovered by hand.

## 7. `codium-lab` provisioning attempts

| # | Action | Result |
| --- | --- | --- |
| 7.1 | `mkdir -p ~/.vscodium-lab/{user-data,extensions,cline-data,workspaces}` | **`Operation not permitted`** |
| 7.2 | write probe on `~`, `~/Library`, `~/Documents`, `~/Projects` | all **DENIED** |
| 7.3 | write probe on `~/.vscodium-clinemm`, `~/.vscodium-clinemm/cline-data`, `~/.vscodium-factory` | all **DENIED** |
| 7.4 | write probe on `/Volumes/UserData`, `/Volumes/UserData/Users` | all **DENIED** |
| 7.5 | write probe on `/tmp` and the repository tree | **WRITABLE** |

No instance was created; no existing instance was modified.

## 8. ClineMM source and installed-bundle discovery (read-only)

| # | Check | Result |
| --- | --- | --- |
| 8.1 | `find ~/Projects/SPbNIX/clinemm -iname '*control*seam*'` | 20 hits, including `apps/vscode/src/sdk/control-seam/` with 14 source files and 12 test files |
| 8.2 | `control-seam-proxy.ts` imports | `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk` — a **real MCP stdio server** |
| 8.3 | prior Factory evidence | `ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01` → `PASS_STRUCTURAL_ONLY`; its transport decision rejected TCP and recorded the AF_UNIX path-length constraint |
| 8.4 | `grep -c 'runControlSeamProxy' <installed>/dist/extension.js` | **0** — the MCP proxy is **not** in the installed build |
| 8.5 | `grep -oE 'clinemm_(capabilities\|get_run\|start_act\|read_events\|send_feedback\|cancel_run)' <installed>/…` | all six present — the native seam **is** installed |
| 8.6 | `grep -c 'StreamableHTTPServerTransport' <installed>/…` | 0 |

## 9. Checks that were NOT run (truthfully recorded)

| Check | Why not |
| --- | --- |
| Any `codium-lab` launch or probe | the instance could not be created |
| Any task start / feedback / cancellation | not authorized |
| Any mutation grant activation | not authorized |
| Any paid candidate inference | not authorized |
| Full `npm test` for the long-horizon harness | out of scope; the harness substrate is frozen and its guards passed |
| Token-level leakage scan over the fixture tree | not implemented; structural leakage properties verified only |

## 10. Exit fingerprint re-verification

All eight LH-07 artifacts were re-hashed at exit and are byte-for-byte
identical to the entry fingerprints.
