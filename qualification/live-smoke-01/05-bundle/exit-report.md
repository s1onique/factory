# LIVE-SMOKE-01 — Exit Report

> ACT: `ACT-FACTORY-LIVE-SMOKE-01`
> Date: 2026-11-25

---

## 1. Dispositions

Reported independently, as required:

```text
ORACLE_PREFLIGHT      = PASS
FACTORY_ORDINARY_GATE = PASS
ORACLE_QUALIFICATION  = PASS
CODIUM_LAB_IDENTITY   = VERIFIED
WORKSPACE_BINDING     = BLOCKED
MCP_CLIENT            = VERIFIED
MUTATION_EXECUTION    = REJECTED
CANDIDATE_EXECUTION   = NOT_STARTED
PATCH_COLLECTION      = NOT_APPLICABLE
EVALUATOR             = NOT_EXECUTED
```

```text
LIVE_SMOKE_COMPLETE = NO
PARTIAL_LIVE_SMOKE = NO
BLOCKED_PREFLIGHT  = YES
```

**BLOCKED_PREFLIGHT.** The complete lifecycle was NOT observed and no
independent candidate verdict was obtained. The execution never started
because a prerequisite was absent: the `codium-lab` instance has no folder
open, so the control seam's mutation grant is bound to the SDK's
no-workspace chat fallback instead of the candidate workspace.

**Experiment completion and candidate correctness are separate questions.**
Neither was established here. No statement is made about any model's
ability.

## 2. Why the execution did not start

The candidate task was never started. The workspace binding is a hard
prerequisite: the seam refuses any `start_act` whose `expectedWorkspace`
does not match the workspace its grant was captured against.

| Assertion | Result |
| --- | --- |
| `/tmp/mlsmoke/live/candidate` | `control_seam_mutation_not_authorized` |
| the SDK chat fallback | `accepted` — this was the workspace-binding PROBE, immediately cancelled |

The lab instance carries no folder:

```text
backupWorkspaces: {"workspaces": [], "folders": [], "emptyWindows": [{"backupFolder": "1795561843043"}]}
```

The four instance-specific CLI mechanisms (`--folder-uri -r`, `-r`, `-a`,
`-n`) did not bind a folder to the RUNNING lab instance, and the sandbox
cannot launch a new GUI instance. This is an environment limit, not a
conceptual one.

### The exact operator action required

Open the folder in the `codium-lab` window, then reload so the control seam
re-captures its mutation grant against it:

```bash
# Either, in the running codium-lab window:
#   File > Open Folder... -> /tmp/mlsmoke/live/candidate
#   then: Developer: Reload Window
#
# Or, relaunch the instance with the folder:
CLINE_DATA_DIR=/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data \
  /Applications/VSCodium.app/Contents/MacOS/VSCodium \
    --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-lab/user-data \
    --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-lab/extensions \
    /tmp/mlsmoke/live/candidate
```

After the reload, re-establish control-seam authorization and VERIFY it with
a `start_act` assertion against `/tmp/mlsmoke/live/candidate` BEFORE
starting the real candidate task. A `control_seam_mutation_not_authorized`
refusal means the grant is still bound to the old workspace.

**The candidate task was not started, no feedback was sent, and no
alternative task was started.**

## 3. The one task that WAS started, disclosed in full

While probing the grant's workspace, a `start_act` asserting the SDK chat
fallback was ACCEPTED and began running. It was cancelled immediately.

| Field | Value |
| --- | --- |
| Session id | `1795572934352_z1xru` |
| Run id | `run_05P-MTdU` |
| Cancellation | `accepted` (request `cancel-probe-01`) |
| Terminal state | `running=false`, `phase=resumable`, epoch 3 |
| Workspace | the SDK chat fallback — **not** the candidate workspace |
| Candidate workspace digest after | `cd269fa5…ecf677` — **unchanged** |
| Files touched in the candidate workspace | none |

This was a **workspace-binding probe**, not a candidate run. It is not
reported as one. No provider usage is attributed to the candidate budget.

## 4. Spend authorization

The ACT requires an explicit human authorization for the single candidate
execution and the associated provider usage. **No such authorization was
recorded.** Credentials, read/write grants and auto-approval were present,
but none of them is spend authorization, and none was treated as such.

No inference was initiated. No tokens were spent. No provider-enforceable
token or monetary cap was available; the recorded limitation is explicit.

## 5. What the preflight DID establish

### 5.1 The CORR02 acceptance defects are closed

All four reproduced defects were fixed and all are covered by cheap
regression controls. Full detail:
`qualification/live-smoke-01/00-entry/counterexamples-reproduced.md`.

| Defect | Correction | Control |
| --- | --- | --- |
| boolean skip reported as PASS | the reporter honours `skip`/`todo` in ANY form | L15, L23 |
| boolean todo reported as PASS | as above | L15, L23 |
| required test not bound to its file | identity is (file, name); missing/ambiguous/invalid are distinct FAILs | L16, L17 |
| truncated stream indistinguishable | NDJSON + explicit completion record + record-count cross-check | L18 |
| acceptance not bound to process exit | `processExit` is part of the decision | L19 |
| mutation not bound to file/mechanism | file-bound; timeout, parser failure and unrelated failure are not detections | L20 |
| `compareTrees(".",".")` returned zero | identity and overlap are refused on resolved paths | L22 |
| reference authority was a mutable adjacent file | the expected digest is supervisor-supplied | (oracle) |
| assertion import could be replaced | imports are compared strictly; only `node:os` may be added | L21 |
| stale directory recycling | a fresh output directory is required; collisions are refused | L11, L14 |
| evaluator deps were a candidate-accessible symlink | a disposable COPY is supplied independently | (oracle) |

### 5.2 The gates

| Command | Elapsed | Exit | Level |
| --- | --- | --- | --- |
| `bash scripts/verify_factory.sh` | **1.721 s** | 0 | ORDINARY |
| `/opt/homebrew/bin/node tests/model_lab/test_ml_smoke_01_lib.mjs` | ~0.9 s | 0 | FAST (`PASS=99 FAIL=0`) |
| `bash scripts/verify_factory_qualification.sh` | **238.44 s** | 0 | AUTHORITATIVE (`PASS=41 FAIL=0`) |
| `bash labs/model-lab/verify_codium_lab_readonly.sh` | ~6 s | 0 | READ-ONLY (`PASS=29 FAIL=0`) |

The ordinary gate is **1.721 s**, well inside the ≤5 s target.

The authoritative qualification gate was run **once**, against the
corrected implementation, before any live candidate result could be minted.
No candidate result was minted.

### 5.3 The fixture and the codium-lab instance

The ML-SMOKE-01 fixture was materialized from the qualified historical base
with its preparation overlay, and its identity recorded in the supervisor's
experiment state BEFORE any candidate execution:

```text
base_commit            = 09fc12c6fb051dce096252bf30c2e96debed962c
overlay_source         = 5c51615f80aa7dfaec53ff0918c8688cfecb9a02
overlay_sha256         = eb59a9eab4d341c429f94934ffc982fb877402083b433fdcfd57ece0be4506c5
reference_digest       = cd269fa584b1a547aeb165b5e19cbd509fe3df6cd47a9f4547a92a6031ecf677
candidate_initial      = cd269fa584b1a547aeb165b5e19cbd509fe3df6cd47a9f4547a92a6031ecf677
task_prompt_sha256     = f8c5a0aa737a6ffbb0e572e8a97318bed93ba546d6948fc9af5bdd2634ad9216
```

The `codium-lab` identity is verified: extension `4.1.26-821b20e7a` with a
bundle digest matching its own provenance record, the native seam answering
an authenticated capabilities probe with a six-operation surface, the
existing MCP proxy reaching THIS instance over stdio, and the `factory-lab`
client registration present. Credentials are recorded by PRESENCE ONLY.

Model selection, reasoning mode, auto-approval and fresh-session state were
read from the instance's own state. **Advertised capabilities were not
treated as evidence of successful mutation authorization** — and the
workspace-binding probe proved that distinction real: the grant was
ADVERTISED (`readOnly=false`, six operations) yet a correctly-asserted
workspace was still refused.

## 6. Explicit non-claims

- No candidate task was started. No inference was initiated. No tokens were
  spent. No feedback was sent. No alternative task was started.
- No candidate result exists. The evaluator was **NOT_EXECUTED** because
  there was no patch to evaluate.
- No model, harness or skill has been comparatively qualified.
- No solution-blindness claim is made about ML-SMOKE-01: its prompt is
  solution-bearing and it remains a smoke fixture only.
- No adversarial isolation is claimed against same-user temporary
  directories.
- The `codium-lab` instance provides IDENTITY separation, not containment.
- The failure-identity discipline remains **PROVISIONAL**.
- The LH-07 historical disposition remains `HALT_BUDGET`, unmodified.

## 7. Next milestone

**ML-06A**, the first meaningful solution-blind production-code fixture.
Proposal: `qualification/live-smoke-01/05-bundle/ml-06a-fixture-proposal.md`.

It targets the pure `validateJsonValue` path-cycle defect in
`src/subject/subject-json.ts` — known-bad `0bd72f4`, known-good `5b7508f` —
whose false rejection of a legal shared-substructure DAG was reproduced on
this host. It was NOT qualified and NOT executed in this ACT.

**DL-02**, the first verification skill, is restored to the active backlog.
