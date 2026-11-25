# LH-07 Production-Duty Corpus — Six Historical Engineering Duties

> Frozen proposal before any production duty is run. Each duty is a **real
> historical** Factory Long-Horizon Lab defect/feature/refactor, replayed
> against a **pre-fix** snapshot of the Factory repo. The harness receives
> only a natural-language task prompt; the historical patch is NEVER
> placed in the harness-visible workspace.

## Frozen-substrate invariants (ACT §1)

```text
PHASE_E_CHANGED = FALSE
LH_02_CHANGED   = FALSE
LH_03_CHANGED   = FALSE
LH_04_CHANGED   = FALSE
LH_05_CHANGED   = FALSE
LH_06_CHANGED   = FALSE
```

Re-verified at `scripts/verify_lh03_frozen.sh`, `scripts/verify_lh04_frozen.sh`,
`scripts/verify_lh05_frozen.sh`, `scripts/verify_lh06_frozen.sh`.

## Six proposed duties

| ID  | Class                              | Historical fix | Base commit | Gate command (Factory-owned) |
|-----|------------------------------------|----------------|-------------|-------------------------------|
| D01 | bounded defect repair              | `5c51615` CORRECTION12 | `09fc12c` | cp-crash + ledger-writer-socket-probe |
| D02 | regression-test strengthening      | `4193bee` CORRECTION10 | `a46fc44` | lh06-canary + leak-injection + resource-ledger |
| D03 | behavior-preserving refactor       | `09fc12c` MICROFIX    | `9394c20` | witness-start-unit + bootstrap-observability |
| D04 | small feature implementation       | `d50f6d8` LH-04 freeze | `a8caa82` | `bash scripts/verify_lh04_frozen.sh` |
| D05 | trust-boundary / evidence-integrity repair | `c898f05` LH-05 CORRECTION02 | `63c3809` | lh05-segment-binding + lh05-phase-e-oracles |
| D06 | continuation/resume (>1 execution) | `a46fc44` LH-05 CORRECTION03 | `c898f05` | `bash scripts/verify_lh05_frozen.sh` |

(Exact gate-command strings are recorded in the frozen manifest at
`qualification/lh07-duty-corpus.json`.)

## Common substrate for all six duties

```text
source_repository = SPbNIX/factory (canonical git history)
subject_commit    = df77c61a8daa15dadfc1424054b3edb37436cb40 (current HEAD)
network_policy    = NO general web; model/provider endpoint only.
                   GitHub remote removed; historical future commits
                   unreachable from the workspace.
allowed_paths     = per-duty (see manifest)
forbidden_paths   = scripts/verify_*, qualification/, labs/long-horizon-harness/qualification/,
                   labs/long-horizon-harness/lifecycle-corpus/catalog-scenarios/lc*.ts
                   (the harness must NOT touch the gate command, the
                   fixture hash, or the historical catalog entries)
setup_command     = (none; workspace IS the pre-fix snapshot)
authoritative_gate_command = per-duty (above)
timeout_ms        = 2700000   (45 minutes per duty run)
continuation_required = D06 only (one Factory RunId, two harness executions)
expected_artifact_set   = patch.diff + modified source files within allowed_paths
fixture_hash      = SHA-256 of the base-commit tree, captured at freeze time
```

## Leakage-scan plan (per ACT §13)

For each duty, before freeze, the harness-visible workspace is grep'd
for the following forbidden tokens (substring match, case-insensitive):

```text
historical patch bytes      : (the .diff content of <historical_fix_commit>)
ACT correction closure docs : "CORRECTION", "fix(long-horizon)",
                               "REVIEW REQUIRED", "CORRECTION_REQUIRED",
                               "red witness", "FREEZE OF"
issue-tracker / changelog   : "## Changelog", "## Releases"
hidden expected output      : ".expected_outcome =", "expected_outcome:",
                               "expected_action_status:", "assertEqual(expected"
```

A grep returning any hit means `DUTY_LEAKAGE_SCAN = FAIL` for that duty,
the duty is excluded, and a halt disposition is filed.

## Golden-patch blindness oracle (per ACT §48)

Before candidate execution per duty:

```text
git -C <workspace> cat-file -e <historical_fix_commit>     → NOT RESOLVED
git -C <workspace> log --all --oneline | grep <fix_sha>    → EMPTY
git -C <workspace> branch -a | grep -v 'HEAD'              → NO branches past base
grep -rE 'fix|long-horizon' <workspace>/docs              → SCOPED (no fix details)
```

Required `GOLDEN_PATCH_VISIBLE_TO_HARNESS = FALSE` for every duty.

## Why these six duties

- All real. Every duty points at a real commit on `main` with a
  multi-paragraph author-described purpose, frozen-substrate verification
  record, and reproducible test file.
- All bounded. Each fix touches <= ~200 production LOC; the largest
  (D05) touches the LH-05 segment-binding validator (~342 insertions,
  ~101 deletions) and has an explicit deterministic test gate.
- All externally-gated. Each gate command runs against the post-harness
  workspace from a Factory-owned process; the harness never runs the gate
  as authority. The gate emits PASS/FAIL deterministically.
- All class-mapped. D01 defect, D02 test, D03 refactor, D04 feature,
  D05 trust-boundary, D06 continuation. The six classes required by ACT §10.
- All reproducible. Each fix has a frozen base commit; the historical
  fix SHA is recorded but not placed in the harness-visible workspace.

## Estimated live-run count

```text
D01..D06         × 2 harnesses (PI, CLINEMM) × 2 repetitions = 24 runs
+ 2 preflight probes (PI live preflight, CLINEMM live preflight)
+ 1 cancellation probe per candidate                       = 26 invocations
+ 1 timeout probe                                         = 27 invocations
+ 1 secret canary live-capture                             = 28 invocations
```

`LH07_MAX_RUNS = 24` (production-duty campaign only), as the ACT ceiling.

## What this corpus does NOT claim

- The harness must PASS every duty. It may FAIL any duty; a truthful FAIL
  is useful evidence and is preserved.
- The harness's patch must match the historical patch byte-for-byte. The
  historical patch is a corpus authoring tool, not the success oracle.
- The harness's chosen implementation must equal a canonical Factory
  implementation. Multiple valid implementations are accepted; the
  external gate is the only authority.

