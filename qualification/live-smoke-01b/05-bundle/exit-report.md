# LIVE-SMOKE-01B — Exit Report

> ACT: `ACT-FACTORY-LIVE-SMOKE-01B`
> Continuation of `ACT-FACTORY-LIVE-SMOKE-01` (disposition `BLOCKED_PREFLIGHT`,
> preserved unchanged at `qualification/live-smoke-01/`).
> Date: 2026-11-25

---

## 1. Dispositions

Reported independently, as required:

```text
SMOKE_ORACLE_PREFLIGHT        = PASS
WORKSPACE_BINDING             = RESOLVED
MUTATION_AUTHORIZATION        = ESTABLISHED
CANDIDATE_EXECUTION           = COMPLETED
CANDIDATE_CORRECTNESS         = FAIL
LIVE_SMOKE_COMPLETE           = YES
ML06A_QUALIFICATION           = QUALIFIED
ML06A_SOLUTION_LEAKAGE_SCAN   = CLEAN
```

```text
CANDIDATE_PATCH_CORRECTNESS   = PASS  (the patch itself, evaluated independently)
CANDIDATE_AUTHORISATION       = FAIL  (the candidate created an unauthorised tree)
```

**The candidate's correctness is FAIL. The candidate's patch is
technically correct.** These are two different questions and the ACT
requires them to be answered separately.

- The candidate fixed the defect exactly as the prompt described: the seam
  is anchored under `os.tmpdir()`, the `node:os` import is added, and
  every original assertion is preserved byte for byte. Evaluated
  independently in a fresh evaluator reconstruction, the patch alone
  yields `DISPOSITION=PASS`, 23/23 gate tests passing, 11/11 required
  tests executed, and the mutation control correctly DETECTED.
- The candidate also ran `npm ci` inside its workspace, creating
  `labs/long-horizon-harness/node_modules` — a candidate-owned dependency
  tree. The oracle records that as a `FORBIDDEN_DEPENDENCY` scope
  violation, refuses to trust it, and **rejects the patch before
  executing any of it** (`GATE_EXECUTED=NO`, 0.68 s).

The oracle's verdict is the only verdict. It is `FAIL`. A candidate's own
statement of success — and the fact that its patch would have worked — is
an observation, never a verdict.

**This is a legitimate completed experimental outcome.** The full
lifecycle was observed: preflight, workspace binding, authorization, one
candidate execution, quiescence, independent evaluation.

## 2. The one authorized candidate execution

| Field | Value |
| --- | --- |
| `start_act` calls | **exactly 1** (request `live-smoke-01b-candidate-01`) |
| Outcome | `accepted` |
| Session id | `1795576254184_48ilz` |
| Run id | `run_mEKKq-sw` |
| Epoch | 2 |
| Wall clock | **77.58 s** (deadline 300 s) |
| Feedback messages | **0** |
| Retries | **0** |
| Alternate models | **0** |
| Paid probes | **0** |
| Terminal state | `running=false`, `phase=completed`, `stateVersion=439` |
| Model | `MiniMax-M3.1-Flash`, reasoning effort `low` |
| Provider | `minimax` |
| Usage | input 357246, output 2566, cache-read 308224, cost **$0.013842** |

The first authorized mutation attempt WAS the real task start. No
dummy task, no alternate workspace identity, no additional task start was
used to establish authorization.

**Provider usage is authoritative for this run.** The instance's own
session record establishes it. This is a difference from the predecessor:
the predecessor's probe was accepted and cancelled, and its actual
provider usage was UNKNOWN because no authoritative usage evidence
existed. Here the usage IS established. The predecessor's report is
PRESERVED and NOT rewritten.

### What the candidate did

44 native messages. It read the wrong path first (ENOENT), located the
file under `labs/long-horizon-harness/`, made two editor edits, discovered
`node` was not on `PATH`, located `/opt/homebrew/bin/node`, **ran
`npm ci` to obtain a dependency tree**, ran the REC-TMP tests itself,
type-checked with `tsc`, removed the `.tmp-home` residue it created, and
submitted.

### The patch

```diff
+import { tmpdir } from "node:os";
...
-  const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));
+  const tmpRoot = await fs.mkdtemp(join(tmpdir(), "cp-crash-rec-tmp01-"));
```

SHA-256 `446f1cf2a5db0c7dab49a2aa04bd54619e11c9ee7a4f7eca77f7403eab7847e2`.
One file changed, zero files added, zero files removed, and ONE
unauthorised change (the dependency tree).

### The delivered prompt

The prompt was compared against the frozen original AFTER the execution,
read from the candidate session's own first message record.

| | Value |
| --- | --- |
| Frozen prompt | 513 bytes, SHA-256 `f8c5a0aa…ad9216` |
| Delivered prompt | 512 bytes, SHA-256 `95de5917…a2fd6fe` |
| Difference | **EXACTLY the trailing newline.** The delivered prompt is byte-identical to the frozen prompt except that its final `\n` is absent. |
| Cause | the control seam's user-input envelope strips the trailing newline from the prompt text. |
| Significance | **none for the task's semantics.** The prompt is a single terminated instruction whose final newline carries no instruction. The delivered bytes ARE the frozen bytes. |

This is recorded rather than glossed: the digests differ, and the
difference is stated precisely.

## 3. The two verdicts, in full

### 3.1 The candidate AS EXECUTED — FAIL

```text
SCOPE_VIOLATION FORBIDDEN_DEPENDENCY labs/long-horizon-harness/node_modules
ML_SMOKE_01_DEPENDENCY_TRUST=UNTRUSTED
ML_SMOKE_01_SCOPE_VIOLATIONS=2
ML_SMOKE_01_ALLOWED_REGION=true
ML_SMOKE_01_ALLOWED_REGION_VIOLATION=0
ML_SMOKE_01_GATE_EXECUTED=NO
ML_SMOKE_01_ERROR=unauthorized_patch_rejected_before_execution
ML_SMOKE_01_DISPOSITION=FAIL
```

The gate was NOT executed. The candidate's own bytes never reached a
process. The rejection took **0.68 s** instead of the ~120 s a full
execution costs.

### 3.2 The patch ALONE, evaluated independently — PASS

The candidate's allowed-file patch was applied to a FRESH evaluator
reconstruction built from the evaluator-owned trusted fixture with the
evaluator's own dependency tree. The candidate's workspace and its
candidate-owned dependency tree were NOT used.

```text
ML_SMOKE_01_SCOPE_VIOLATIONS=0
ML_SMOKE_01_DEPENDENCY_TRUST=EVALUATOR_SUPPLIED
ML_SMOKE_01_GATE_EXECUTED=YES
ML_SMOKE_01_GATE_EXIT=0
ML_SMOKE_01_GATE_PASSED=23
ML_SMOKE_01_GATE_FAILED=0
ML_SMOKE_01_REQUIRED_TESTS_EXECUTED=11/11
ML_SMOKE_01_ACCEPTANCE=PASS
ML_SMOKE_01_MUTATION_STATUS=DETECTED
ML_SMOKE_01_MUTATION_DETECTED=YES
ML_SMOKE_01_DISPOSITION=PASS
```

**What this establishes, and what it does not.** It establishes that the
candidate's *reasoning* about the defect was correct and that its *edit*
was correct. It does NOT overturn the oracle's verdict on the candidate
as executed: an unauthorised candidate is not a correct candidate. It is
the right evidence for diagnosing WHY the candidate failed, and it is the
right evidence for the next fixture.

## 4. The workspace binding and the mutation authorization

The predecessor was BLOCKED because the `codium-lab` instance had no
folder open, so the control seam's mutation grant was bound to the SDK's
no-workspace chat fallback.

The operator opened `/tmp/mlsmoke/live/candidate` in `codium-lab` and the
window was reloaded. The extension host restarted at
`2026-11-25T03:10:54Z` and re-captured its grant against the now-open
folder. The binding is established by four independent facts:

1. the instance's `User/workspaceStorage/2d255f31.../workspace.json` names
   `file:///private/tmp/mlsmoke/live/candidate`;
2. the Cline per-workspace storage directory is `505276ae`, which is the
   SDK's own hash of `/private/tmp/mlsmoke/live/candidate`;
3. the candidate session's OWN record reports `cwd` = `workspace_root` =
   `/private/tmp/mlsmoke/live/candidate`;
4. the `start_act` asserting `/private/tmp/mlsmoke/live/candidate` was
   `accepted`.

**The previous chat-fallback probe is inactive and cannot be resumed
accidentally.** The seam reports `control_seam_no_active_run`; the probe
session's own record shows `status=idle`, `exit_code=null`, and its last
message is its own `submit_and_exit`. Its cwd was the chat fallback
directory, never the candidate workspace. The probe session was NOT
continued, and the fresh candidate session is a DIFFERENT session.

### Candidate-side permissions

| Surface | State |
| --- | --- |
| Supervisory MCP interface | **NOT reachable.** The `factory-lab` registration exists ONLY in the supervisor's instance; the lab instance's own `cline_mcp_settings.json` is `{"mcpServers": {}}`. |
| Command execution | ENABLED (`executeAllCommands=true`) — the candidate ran `npm ci`. |
| File editing | ENABLED (`editFiles=true`) — the candidate edited the allowed file. |
| File reading | ENABLED (`readFiles=true`, `readFilesExternally=true`) |
| Browser | ENABLED (`useBrowser=true`) — not exercised. |

**No containment is claimed.** The candidate and the evaluator run as the
SAME OS USER on the SAME host. The lab instance provides IDENTITY
separation and a distinct data directory, not a security sandbox. A
candidate that explores the host can read the evaluator's own reference
tree and dependency tree. The candidate demonstrated this in practice:
it created a dependency tree inside its workspace, which the oracle
correctly refused to trust.

## 5. What was closed before the execution

Eleven counterexamples were reproduced against the ACTUAL implementation
and corrected. Full detail:
`qualification/live-smoke-01b/00-entry/counterexamples-reproduced.md`.

| Defect | Correction | Control |
| --- | --- | --- |
| `decideMutation` accepted exits 0 and 137 | the EXPECTED MUTANT TEST-FAILURE EXIT is required | L24 |
| `classifyEvents` accepted null counts | a completion record with no counts is not completion evidence | L25 |
| `classifyEvents` accepted an inconsistent total | the runner's per-status counts must sum to its total | L25 |
| `classifyEvents` accepted contradictory status counts | every per-status count must equal the observed count | L25 |
| the oracle executed candidate code before rejecting scope violations | an unauthorised patch is REJECTED BEFORE EXECUTION | C18, M04 |
| reconstruction and patch-copy statuses unchecked | both are checked; a failure is a HALT | (oracle) |
| `compareTrees` missed protected directory modes | every directory in both trees must carry the same mode | L26, C19 |
| `describeRootOverlap` missed `..nested` | the first PATH SEGMENT decides | L27 |
| the fixture preparation was not atomic | a single `mkdir` IS the refusal | L28 |
| the reporter counted a SUITE as a test | a suite has its own kind | L29 |
| the ML-06A oracle read counts from free text | the verdict is bound to the exact test identities | M01–M10 |

### The gates

| Command | Elapsed | Exit | Level | Result |
| --- | --- | --- | --- | --- |
| `bash scripts/verify_factory.sh` | **1.94 s** | 0 | ORDINARY | `PASS=135 FAIL=0` |
| `bash tests/model_lab/test_ml_smoke_01_oracle.sh` | 184.0 s | 0 | AUTHORITATIVE | `PASS=47 FAIL=0` |
| `bash tests/model_lab/test_ml_06a_qualification.sh` | 9.89 s | 0 | AUTHORITATIVE | `PASS=51 FAIL=0` |
| `bash scripts/verify_factory_qualification.sh` | **162.08 s** | 0 | AUTHORITATIVE | `PASS` |

The authoritative qualification gate is the **AUTHORITATIVE** level. It was
run **three** times in this ACT, and the ACT asked for it to be run **once**.
The three runs are disclosed in full rather than summarized as one. Every timing is read
from the gate log's own `time` output:

| # | Finished (local) | Result | Role |
| --- | --- | --- | --- |
| 1 | 06:01:18 | **FAIL** — 38 controls passed, 9 failed, 61.50 s | The FIRST attempt. Its failure is what exposed the over-broad fail-closed rejection described below. It drove a correction. |
| 2 | 06:09:59 | **PASS** — 135 + 47 + 51, exit 0, 162.08 s | The single green gate run **against the corrected implementation, before the candidate was started**. This is the run that established the oracle's authority for the candidate result. |
| 3 | 06:19:41 | **PASS** — 135 + 47 + 51, exit 0, 161.90 s | A FINAL STATE VERIFICATION after the candidate execution, confirming the repository was still green in the state that was handed over. |

The candidate task started at 06:10:54 — between runs 2 and 3. The run
that established the oracle's authority **preceded** the candidate, and
the run that followed confirmed the final state. Runs 1 and 3 are
additions to the ACT's "once", made because run 1 failed and because the
final state needed confirming; neither replaced run 2.

**A first attempt at the authoritative gate FAILED (9 controls), and the
failure was informative.** The first fail-closed implementation treated an
allowed-region violation as a pre-execution rejection too, which made the
in-region diagnostics unreachable and broke controls C03–C08 and C11. The
correction separates the two violation classes: an out-of-region change is
rejected before execution; a content change inside the one allowed file
is caught by the allowed-region verdict, which contributes to the final
FAIL. The correction was established BY EXECUTION, not by assumption.

## 6. ML-06A

**QUALIFIED.** Full record:
`qualification/live-smoke-01b/06-ml06a/ml-06a-qualification.json`.

| Property | Value |
| --- | --- |
| Base (known-bad) | `0bd72f4b97486b9b95cbb75e7e384586d03aa22f` |
| Known-good | `5b7508fa09e6f10b6ec683e94a35758a15f9d827` |
| Overlay | **none** |
| Allowed path | `labs/long-horizon-harness/src/subject/subject-json.ts` (entirely editable) |
| Fixture digest | `62d3e75a2ba415b2049e7735e8eca08461b9bd4e42191bc8a4f28c0ff5906787` |
| Prompt digest | `a61875c5b4f7a54643927de5f8548b94cf4045d5e132afddae8c2b0cd3f7a5c5` |

Both identities were confirmed against the ACTUAL history: the known-good
is a real commit and an ancestor of HEAD; the known-bad is its ancestor.

**The known-bad revision FAILS for the intended behavioral reason.** The
shared-substructure assertions (ML06A-02, -03, -04) fail; the ordinary
tree, the three cycle rejections and the invalid-value behaviour all
PASS. The failure is the DEFECT, not a broken harness.

**The known-good revision PASSES** (9/9 required tests present and
executed, 0 failed).

**The historical patch's shape is NOT required.** A differently-shaped fix
— a recursion-path ARRAY, pushed on entry and popped on exit, with an
extracted helper function — is accepted. The entire allowed file stays
editable and no implementation shape is imposed.

### One hidden requirement was found and NOT imposed

The base revision also violates its OWN documented "NEVER throws" contract
on hostile Proxy input; the known-good revision adds a boundary guard for
it. The task prompt does not state that requirement, so requiring it would
impose a **hidden requirement** — exactly what a solution-blind fixture
must not do. It is therefore an **OBSERVATION** (`ML06A-OBS-01`): it is
exercised and reported, in its OWN evaluator-owned file and its OWN
process, so a failing observation cannot change the acceptance verdict.

### The solution-leakage scan: CLEAN

Full record: `qualification/live-smoke-01b/06-ml06a/ml-06a-leakage-scan.json`.

The candidate-visible fixture contains **no** historical-solution
identifier, **no** future Git history, **no** evaluator-only test, and
**no** correction evidence. Its allowed file is byte-identical to the
known-bad revision and differs from the known-good revision.

Three incidental base-commit occurrences (`try/finally` in an unrelated
harness test, `ACT-FACTORY` in the harness README, `correction` in nine
harness sources) are RECORDED rather than removed: removing them would
require an overlay, which the ACT forbids unless demonstrated necessary,
and an overlay would itself introduce new content into the candidate-visible
tree. None of them describes the ML-06A defect or the fix.

## 7. Explicit non-claims

- **No containment is claimed.** Same-user, same-host, no security sandbox.
- **No model ranking is claimed.** One execution of one model on one
  solution-bearing smoke fixture establishes nothing about comparative
  ability.
- **ML-SMOKE-01 remains solution-bearing.** Its prompt states the remedy.
  It is a smoke fixture only.
- **ML-06A has NOT been executed against any model.** It is qualified, not
  executed.
- **The failure-identity discipline remains PROVISIONAL.**
- **The LH-07 historical disposition remains `HALT_BUDGET`, unmodified.**
- **No candidate result is a correctness result.** The oracle's `FAIL` is
  the only verdict; the independent evaluation of the patch is a
  diagnostic, not a second verdict.
- **No provider-enforceable token or monetary cap was available.** The
  300 s deadline is a supervisor-enforced wall-clock bound. The operator
  acknowledged this.
- No new MCP server, no generalized runner, no model switching, no pstack
  installation, no long-horizon campaign, no frozen-substrate
  modification, no automatic commit, no push.

## 8. Next ACT

**ML-02**, minimal deterministic execution of a qualified production-code
fixture. ML-06A is now qualified and ready to be executed through it.

The ML-SMOKE-01 result also carries a lesson for the fixture design: a
candidate that cannot verify its own work will install its own
dependencies. ML-06A's subject is a PURE function with no dependency
requirement at all, which removes that pressure.
