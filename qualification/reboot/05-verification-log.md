# REBOOT-01 — Verification Log

> Every command below was **executed in this ACT** on this host. No result is
> inherited from a historical digest.
>
> Host: darwin (macOS), Node `v26.0.0` at `/opt/homebrew/bin/node`
> (**not** on the default `PATH` — `PATH=/opt/homebrew/bin:$PATH` was set for
> the Node-dependent commands).

---

## 1. Repository baseline

| # | Command | Exit | Elapsed | Outcome |
| --- | --- | --- | --- | --- |
| 1.1 | `git rev-parse HEAD` | 0 | — | `df77c61a8daa15dadfc1424054b3edb37436cb40` |
| 1.2 | `git rev-parse --abbrev-ref HEAD` | 0 | — | `main` |
| 1.3 | `git worktree list --porcelain` | 0 | — | 1 worktree, `refs/heads/main` |
| 1.4 | `git status --porcelain` | 0 | — | only the 8 LH-07 artifacts + this ACT's new files |
| 1.5 | `bash scripts/verify_worktree_policy.sh` | **0** | <1 s | `FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK` (count=1, linked=0, detached=0) |
| 1.6 | `bash scripts/check_links.sh` | **0** | <1 s | `All checks passed` |
| 1.7 | `bash scripts/verify_factory.sh` | **0** | **2.98 s** | `FACTORY_VERIFY_DISPOSITION=OK` |

## 2. Frozen substrates (all six re-verified live)

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

## 4. D01 fixture controls (raw gate)

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 4.1 | base: `node --import tsx --test --test-reporter=spec test/recovery/cp-crash.test.ts` | 1 | `✖ REC-TMP01` — `ENOENT … mkdtemp '.tmp-home/tmp01-Q82Ehb'`; `pass 13 / fail 1` |
| 4.2 | fixed: `node --import tsx --test --test-reporter=tap test/recovery/cp-crash.test.ts test/ledger-writer/ledger-writer-socket-probe.test.ts` | 0 | `pass 23 / fail 0` |
| 4.3 | base + ambient `TMPDIR` (84 chars) | 0 | 5 SOCK tests **silently skipped**; false PASS — the reason the oracle pins `TMPDIR=/tmp` |
| 4.4 | base + `TMPDIR=/tmp` | 1 | `✖ SOCK06` — `Missing expected rejection: SOCK06E: pathname … MUST be absent` |
| 4.5 | base, `.tmp-home` PRESENT | 0 | `REC-TMP01` **passes** — the ambient-masking defect |
| 4.6 | base, `.tmp-home` ABSENT | 1 | `REC-TMP01` **fails** — the intended reproduction |

## 5. D01 acceptance oracle — three controls, re-run at exit

```text
bash labs/model-lab/d01_acceptance_oracle.sh \
     <repo_root> 09fc12c6fb051dce096252bf30c2e96debed962c <workspace>
```

| # | Workspace | Expected | Observed | Exit | Elapsed |
| --- | --- | --- | --- | --- | --- |
| 5.1 | base `09fc12c` | FAIL | `SCOPE_VIOLATIONS=0`, `GATE_EXIT=1`, `GATE_PASSED=21`, `GATE_FAILED=2`, `ACCEPTANCE=FAIL`, `MUTATION_DETECTED=YES`, `DISPOSITION=FAIL` | 1 | 21.48 s |
| 5.2 | historical fixed `5c51615` | PASS | `SCOPE_VIOLATIONS=0`, `GATE_EXIT=0`, `GATE_PASSED=23`, `GATE_FAILED=0`, `ACCEPTANCE=PASS`, `MUTATION_DETECTED=YES`, `DISPOSITION=PASS` | 0 | 21.91 s |
| 5.3 | fixed − `REC-TMP01` (vacuous) | FAIL | `SCOPE_VIOLATIONS=0`, `GATE_EXIT=0`, `GATE_PASSED=22`, `ACCEPTANCE=PASS`, `MUTATION_NOTE=known_bad_seam_absent_mutation_not_applied`, `MUTATION_DETECTED=NO`, `DISPOSITION=FAIL` | 1 | 17.13 s |

**Control 5.3 is the anti-vacuity proof:** the raw gate reports PASS, but the
oracle reports FAIL.

## 6. ClineMM / `codium-lab` discovery (read-only)

| # | Action | Result |
| --- | --- | --- |
| 6.1 | `ls -d ~/.vscodium-lab` | **does not exist** — the instance has not been created |
| 6.2 | `codium --help` (VSCodium 1.143.17232) | `--user-data-dir`, `--profile`, `--agents` confirmed as the instance-isolation primitives |
| 6.3 | Read `s1onique.clinemm` extension `package.json` | `contributes.mcp` **empty**; no MCP server contribution |
| 6.4 | grep `StreamableHTTPServerTransport` in the extension bundle | **0 occurrences** — no inbound MCP server |
| 6.5 | Read `cline_mcp_settings.json` (factory / clinemm) | factory: `{"mcpServers":{}}`; clinemm: one outbound server `myc` |
| 6.6 | Control-seam `clinemm_capabilities` probe | `ok:true`, `protocolVersion:1`, 2 read-only ops, `extensionVersion 4.1.26-821b20e7a`, `platform darwin` |
| 6.7 | Control-seam `clinemm_get_run` probe | `ok:true`, live session with `phase/epoch/stateVersion/seq` projection |
| 6.8 | Read `mutation.json`, `owner.json`, `enabled.json` | grant enabled, `allowContentRead:false`; `instanceId 89949-5b46069ec3bd38656e67a10f3313ebd9` |
| 6.9 | Read `providers.json` / `globalState.json` (credentials redacted) | `minimax/MiniMax-M3` active; `openai-compatible` → `http://192.168.50.111:8080/v1`; `sapaicore` |
| 6.10 | pstack upstream commit resolution | `9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc` (2026-11-24T00:41:29Z), MIT |

**Nothing was written outside the repository.** No task was started, resumed,
or cancelled; no grant was armed; no model was switched; no inference was
initiated.

## 7. Checks that were NOT run (truthfully recorded)

| Check | Why not |
| --- | --- |
| Full `npm test` for the long-horizon harness | Out of scope for REBOOT-01; the harness substrate is frozen and its guards passed. The known sandbox-`EPERM` failures recorded in the historical `5c51615` commit message were **not** re-investigated. |
| The LH-07 live campaign (24 runs) | Deferred by operator decision; historical `HALT_BUDGET` preserved |
| Any paid candidate inference | Not authorized |
| Any `codium-lab` instance start / task start | Not authorized |
| Token-level leakage scan over the D01 tree | Not implemented; structural leakage properties verified only |
| `npm run typecheck` for the harness | Not required — no harness source was modified by this ACT |

## 8. Exit fingerprint re-verification

All eight LH-07 artifacts were re-hashed at exit and compared with the entry
fingerprints in `00-entry-state.md`. **All eight are byte-for-byte identical.**
