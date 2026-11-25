# REBOOT-CORR02 — Exit Report

> ACT: `ACT-FACTORY-REBOOT-CORR02-HAR02`
> Date: 2026-11-25

---

## 1. Dispositions

Reported independently, as required:

```text
ORACLE_AUTHORITY_ESTABLISHED = YES
FAST_GATE_RESTORED            = YES
CODIUM_LAB_READONLY_READY     = YES
```

```text
CODIUM_LAB_IDENTITY_VERIFIED = YES
CONTROL_SEAM_READONLY_VERIFIED = YES
CONTROL_SEAM_RW_ADVERTISED   = YES
MCP_PROXY_ARTIFACT_AVAILABLE = YES
MCP_PROXY_LIVE_VERIFIED      = YES
MCP_CLIENT_CONFIGURED        = BLOCKED
MUTATION_EXECUTION_VERIFIED  = NOT_TESTED
```

`MUTATION_EXECUTION_VERIFIED` remains `NOT_TESTED`. The operator's
authorization to enable read/write access is **not** authorization to initiate
paid candidate inference. No task was started, no feedback was sent, and no
task was cancelled.

## 2. Identity at exit

| Field | Entry | Exit |
| --- | --- | --- |
| `HEAD` | `df77c61a8daa15dadfc1424054b3edb37436cb40` | `df77c61a8daa15dadfc1424054b3edb37436cb40` (unchanged) |
| branch | `main` | `main` |
| worktrees | 1 main, 0 linked, 0 detached | identical |
| modified tracked files | 1 (`scripts/verify_factory.sh`) | 1 (`scripts/verify_factory.sh`) |

**No commit and no push.** The operator had not committed the reviewed
artifacts.

## 3. The authority defects, and what closed them

All seven were reproduced against the actual CORR01 oracle or the actual
CORR01 control before the fix. Full detail and the counterexample
transcripts are in `01-counterexamples-reproduced.md`.

| ID | Defect | Correction | Fast control | Full control |
| --- | --- | --- | --- | --- |
| D1 | failure identity contamination | structured reporter; verdict bound to the required test's own error-code chain | L01, L01b | C07 |
| D2 | optional reference; self-comparison | reference REQUIRED and bound to its recorded fixture digest | L02 | C12 |
| D3 | dependency trust by path resolution | identity-bound trust; a candidate-owned tree is a violation | L03 | C13 |
| D4 | symlink substitution; invisible mode changes; swallowed enumeration errors | object type and mode compared; enumeration fails closed | L04, L05, L06 | C14, C15 |
| D5 | destructive output-directory reuse | ownership check; never deletes a foreign directory | L11 | — |
| D6 | concurrent preparation interference | exclusive per-output-directory lock; per-run gate reconstruction | L14 | C17 |
| D7 | C01 and C11 did not establish their stated mechanisms | the controls now assert the mechanism itself | — | C01, C11 |

**No universal test-mutation framework was built.** For this smoke fixture
the original test assertions are preserved and only the intended
temporary-directory setup repair and the necessary imports are permitted
(control C16 proves a changed assertion is a violation).

## 4. Control results

### Fast deterministic level

```text
$ /opt/homebrew/bin/node tests/model_lab/test_ml_smoke_01_lib.mjs
=== Summary ===
PASS=44  FAIL=0
```

### Real historical fixture level

```text
$ bash tests/model_lab/test_ml_smoke_01_oracle.sh
=== Summary ===
PASS=37  FAIL=0
```

### codium-lab read-only level

```text
$ bash labs/model-lab/verify_codium_lab_readonly.sh
=== Summary ===
PASS=29  FAIL=0
```

## 5. Verification commands and elapsed times

Measured on the same host with `time` around the whole command.

| Command | Elapsed | Exit | Level |
| --- | --- | --- | --- |
| `bash scripts/verify_factory.sh` | **1.39 - 1.69 s** (5 runs) | 0 | ORDINARY |
| `bash scripts/verify_factory_fast.sh` | **1.45 - 1.66 s** (3 runs) | 0 | ORDINARY |
| `/opt/homebrew/bin/node tests/model_lab/test_ml_smoke_01_lib.mjs` | **0.32 s** | 0 | FAST |
| `bash scripts/verify_factory_qualification.sh` | **232.112 s** | 0 | AUTHORITATIVE |
| `bash tests/model_lab/test_ml_smoke_01_oracle.sh` | ~3 min | 0 | AUTHORITATIVE |
| `bash labs/model-lab/verify_codium_lab_readonly.sh` | ~6 s | 0 | READ-ONLY |

```text
$ bash scripts/verify_factory_qualification.sh
...
PASS=41  FAIL=0
  [OK]  Model Lab real-fixture qualification controls

=== Factory QUALIFICATION gate complete ===
FACTORY_VERIFY_QUALIFICATION_DISPOSITION=PASS

bash scripts/verify_factory_qualification.sh  150.61s user 38.64s system 81% cpu 3:52.09 total
```

### Before / after

| Gate | Before | After |
| --- | --- | --- |
| Ordinary (`scripts/verify_factory.sh`) | 225.81 s (CORR01 report) / 84.87 s (re-measured on the CORR01 tree) | **1.39 - 1.69 s** |

Five consecutive wall-clock runs: `1.59, 1.43, 1.39, 1.42, 1.69` seconds.

The target of **five seconds or less** is met, with a ~3.5x margin. The
ordinary gate is back to its pre-regression cost (1.35 s).

**The acceptance criteria were not weakened.** The real-fixture controls were
MOVED to their own mandatory level; they were not deleted, relaxed, or
skipped. Full qualification remains mandatory whenever the oracle's
authority changes.

## 6. Concurrent-gate interference

Investigated and fixed by **subtraction**, not by a documented requirement:

- the gate now runs in a fresh evaluator reconstruction per run, so two
  concurrent oracle runs against the same workspace are independent by
  construction — verified by control **C17** and by an ad-hoc reproduction;
- the fixture preparation takes an exclusive lock keyed by the absolute
  output directory path — verified by control **L14**, which also proves a
  stale lock does not block forever.

## 7. codium-lab

Full detail in `03-codium-lab-readonly.md` and
`04-mcp-client-configuration.md`.

- Identity verified: distinct user-data, extensions and ClineMM data
  directories; running extension build `4.1.26-821b20e7a` with a bundle
  digest matching its own provenance record; the owning extension host
  process is alive and bound to this instance's `--user-data-dir`; no
  inherited session; no active task; no workspace opened.
- Native seam: read credential yields `readOnly=true` and two operations;
  the write credential yields `readOnly=false` and six operations;
  `get_run` reports `control_seam_no_active_run`.
- MCP proxy: the **existing** ClineMM supervision proxy
  (`apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts`) is
  runnable from source. It is **not** in the installed bundle — and the
  absence of the function name in `dist/extension.js` was **not** used to
  infer that, the source and the package configuration were inspected
  directly.
- MCP live verification: a real `initialize` / `tools/list` / `tools/call`
  handshake against `codium-lab` only. The responses carry the lab's own
  extension version and its six-operation surface. `codium-factory` and
  `codium-clinemm` were not probed; `codium-factory` has no control seam of
  its own.
- MCP client registration is **BLOCKED** by the sandbox's write restriction.
  The exact minimal fragment and the operator command are supplied. No raw
  credential appears in the fragment.

## 8. Changed-file manifest

### Added

| Path | Purpose |
| --- | --- |
| `labs/model-lab/ml_smoke_01_lib.mjs` | The oracle's decision logic: scope comparison, event classification, acceptance and mutation verdicts. |
| `labs/model-lab/ml_smoke_01_test_reporter.mjs` | The structured Node test reporter. |
| `labs/model-lab/ml_smoke_01_tool.mjs` | The command-line surface of the decision logic. |
| `labs/model-lab/verify_codium_lab_readonly.sh` | The read-only `codium-lab` verification. |
| `scripts/verify_factory_fast.sh` | The ordinary gate as a standalone entry point. |
| `scripts/verify_factory_qualification.sh` | The authoritative gate: the fast gate plus the real-fixture controls. |
| `tests/model_lab/test_ml_smoke_01_lib.mjs` | The 44 fast deterministic controls. |
| `qualification/reboot-corr02/00-entry-state.md` | Entry state and preservation. |
| `qualification/reboot-corr02/01-counterexamples-reproduced.md` | The reproduced counterexamples and their corrections. |
| `qualification/reboot-corr02/02-verification-performance.md` | The measurement, the separation and the concurrency investigation. |
| `qualification/reboot-corr02/03-codium-lab-readonly.md` | The `codium-lab` read-only verification and the MCP proxy discovery. |
| `qualification/reboot-corr02/04-mcp-client-configuration.md` | The exact minimal MCP configuration fragment and operator command. |
| `qualification/reboot-corr02/05-changed-file-manifest.md` | The manifest. |
| `qualification/reboot-corr02/06-exit-report.md` | This report. |

### Modified

| Path | Change |
| --- | --- |
| `labs/model-lab/ml_smoke_01_acceptance_oracle.sh` | The CORR01 oracle, replaced by the CORR02 oracle: structured reporter, required and identity-bound reference, identity-bound dependency trust, object-type and mode comparison, per-run evaluator reconstruction. |
| `labs/model-lab/prepare_ml_smoke_01.sh` | Ownership check, exclusive per-output-directory lock, the dependency tree removed from the fixture, the digest computed by the shared library. |
| `labs/model-lab/README.md` | The two gate levels, the new components, the new dispositions, the measured runtimes. |
| `scripts/verify_factory.sh` | Step 7 now runs the FAST decision-logic controls; the gate is the ordinary level and names the authoritative one. |
| `tests/model_lab/test_ml_smoke_01_oracle.sh` | Rewritten: seventeen controls, including the corrected C01 and C11 and the new C12..C17. |

### Unchanged

`qualification/lh07/`, `qualification/lh07-duty-corpus.json`,
`qualification/reboot/`, `qualification/reboot-corr01/` (including the
verbatim preserved defective oracle), `qualification/reboot-corr01/superseded/`,
and every frozen long-horizon substrate.

## 9. Explicit non-claims

- No Model Lab runner was built.
- No frozen long-horizon machinery was modified.
- No paid inference was initiated. No task was started, no feedback was
  sent, no task was cancelled.
- No model, harness, or skill has been comparatively qualified.
- `MUTATION_EXECUTION_VERIFIED` is `NOT_TESTED`. A successful capabilities
  probe with `readOnly=false` does not establish successful execution of a
  mutating operation.
- The MCP client registration is not done; the fragment is supplied.
- The failure-identity discipline remains **PROVISIONAL** until independently
  reviewed. It is not doctrine, and no skill or framework was created for it.
- The LH-07 historical disposition remains `HALT_BUDGET`, unmodified.

## 10. Next milestone

1. **One authorized real candidate execution** against ML-SMOKE-01, with the
   corrected oracle as the sole verdict authority.
2. **The first solution-blind production-code fixture** — without which the
   Model Lab cannot rank models.

The qualification campaign was not expanded beyond what is necessary to
reach that milestone.
