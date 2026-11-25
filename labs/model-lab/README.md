# Model Lab

The Model Lab compares models performing **identical** engineering tasks, with
an independent, evaluator-owned acceptance oracle.

## What lives here today

| Path | Purpose |
| --- | --- |
| `ml_smoke_01_acceptance_oracle.sh` | The ML-SMOKE-01 acceptance oracle. Evaluator-owned, fail-closed. |
| `ml_smoke_01_lib.mjs` | The oracle's DECISION LOGIC: scope comparison, event classification, acceptance and mutation verdicts. |
| `ml_smoke_01_test_reporter.mjs` | A small STRUCTURED Node test reporter. One JSON object per test, carrying the test's identity, status and error-code chain. |
| `ml_smoke_01_tool.mjs` | The command-line surface of the decision logic. The bridge between the shell oracle and the library. |
| `prepare_ml_smoke_01.sh` | Materializes the ML-SMOKE-01 fixture with its recorded preparation overlay. Requires a FRESH output directory. |
| `ml_06a_acceptance_oracle.sh` | The ML-06A acceptance oracle — the FIRST SOLUTION-BLIND PRODUCTION-CODE fixture. |
| `ml_06a_acceptance.test.ts` | The evaluator-owned, IMMUTABLE acceptance test for ML-06A. Never enters the candidate's authority. |
| `ml_06a_observations.test.ts` | The evaluator-owned OBSERVATION file for ML-06A. Exercised and reported, but NOT bound to the verdict. |
| `prepare_ml_06a.sh` | Materializes the ML-06A fixture. NO overlay. Requires a FRESH output directory. |
| `verify_codium_lab_readonly.sh` | READ-ONLY verification of the dedicated `codium-lab` instance and its control seam. |
| `ml_02_client.mjs` | The NATIVE control-seam client (the ACTUAL NDJSON protocol over the AF_UNIX socket) and its SIMULATED counterpart. |
| `ml_02_runner.mjs` | The runner's decision logic: readiness, single-start authority, event collection, quiescence, independent evaluation. |
| `ml_02_cli.mjs` | The operator-facing CLI: `prepare`, `verify`, `execute`, `evaluate`, `inspect`. |

Regression controls live in `tests/model_lab/`:

| Path | Level | Runtime |
| --- | --- | --- |
| `test_ml_smoke_01_lib.mjs` | FAST — synthetic structured events and synthetic trees. No fixture execution. | ~1.4 s |
| `test_ml_02_runner.mjs` | FAST — the REAL client and the REAL runner against the SIMULATED native seam. | ~1.4 s |
| `test_ml_smoke_01_oracle.sh` | FULL QUALIFICATION — executes the real historical fixture end to end. | ~150 s |
| `test_ml_06a_qualification.sh` | FULL QUALIFICATION — qualifies the ML-06A production-code fixture and scans it for solution leakage. | ~25 s |

## The runner: ML-02

The runner is the smallest deterministic software that executes ONE
authorized experiment against ONE qualified fixture. It is deterministic
software, not an LLM-dependent orchestrator: every decision it makes is a
pure function over recorded observations, and every step is bounded.

### The five logical capabilities

| Capability | Command | What it does | Inference |
| --- | --- | --- | --- |
| Prepare | `prepare --out <dir>` | Materialize the fixture, freeze the experiment identity, record the manifest. | NO |
| Verify readiness | `verify --seam <dir>` | Establish the seam identity, the protocol version, the extension build identity, and the absence of a conflicting active run. | NO |
| Execute | `execute --manifest <m> --authorization <a> --seam <dir>` | Execute EXACTLY ONE explicitly authorized experiment. | YES |
| Evaluate | `evaluate --manifest <m> --seam <dir>` | Collect the deliverable and evaluate it independently. | NO |
| Inspect | `inspect --bundle <dir>` | Inspect the resulting run bundle. | NO |

### The authority hierarchy

1. The **oracle** (`ml_06a_acceptance_oracle.sh`) is the ONLY authority
   that may declare a candidate result correct.
2. The **runner** records observations and binds identities. It never
   re-implements a verdict.
3. The **candidate**'s own statement of success is an observation, never
   an acceptance.

### Execution authorization

`execute` REQUIRES an authorization file bound to the EXACT prepared
experiment: the file must carry the experiment's `runId` AND its
`identityDigest`. Without it, `execute` performs ZERO start calls.

Authorization is NOT inferred from an existing API credential, a previous
authorized experiment, a write token, a mutation-capability
advertisement, auto-approval, or a model configured in the UI.

### The single-start authority

The runner claims the experiment authorization with an atomic directory
creation BEFORE it sends the mutating request, and records the attempt
inside the claim. A second invocation, or a restart of the runner, is
REFUSED: an uncertain prior attempt stays uncertain until it is reconciled
through READ-ONLY observations.

### The control seam

The runner speaks the ACTUAL native protocol: NDJSON over the AF_UNIX
socket, `v: 1`, the read bearer token, the SEPARATE write token for
mutations, and the operation-specific payload. MCP remains the
interactive supervision channel; the runner uses the socket directly.

### The operator workflow for a later authorized execution

```bash
# 1. Prepare (no inference).
node labs/model-lab/ml_02_cli.mjs prepare --out /tmp/ml02/live-01 --run-id live-01

# 2. Verify readiness (no inference).
node labs/model-lab/ml_02_cli.mjs verify \
  --seam "$HOME/.vscodium-lab/cline-data/control-seam" \
  --workspace /tmp/ml02/live-01/workspace \
  --extension 4.1.26-821b20e7a

# 3. The operator writes the authorization, bound to the prepared run.
#    (The operator must open the candidate workspace in codium-lab first.)
cat > /tmp/ml02/live-01/authorization.json <<'JSON'
{ "runId": "live-01", "identityDigest": "<the digest printed by prepare>" }
JSON

# 4. Execute EXACTLY ONE authorized experiment.
node labs/model-lab/ml_02_cli.mjs execute \
  --manifest /tmp/ml02/live-01/experiment.json \
  --authorization /tmp/ml02/live-01/authorization.json \
  --seam "$HOME/.vscodium-lab/cline-data/control-seam"

# 5. Evaluate independently and inspect the bundle.
node labs/model-lab/ml_02_cli.mjs evaluate \
  --manifest /tmp/ml02/live-01/experiment.json \
  --seam "$HOME/.vscodium-lab/cline-data/control-seam"
node labs/model-lab/ml_02_cli.mjs inspect --bundle /tmp/ml02/live-01/bundle
```

## The fixture contract: ML-06A, V1

| Property | Value |
| --- | --- |
| Contract version | `ml-06a-contract/v1` |
| Base commit | `0bd72f4b97486b9b95cbb75e7e384586d03aa22f` |
| Known good | `5b7508fa09e6f10b6ec683e94a35758a15f9d827` (NOT disclosed to the candidate) |
| Overlay | none |
| Allowed production path | `labs/long-horizon-harness/src/subject/subject-json.ts` |
| Required acceptance tests | nine, evaluator-owned, immutable |
| Observations | one, non-binding, executed in its own process |

### Candidate dependency and scratch policy

- The candidate receives a **disposable dependency tree** compatible with
  the fixture's lockfile and toolchain, materialized BEFORE execution.
- The candidate's dependency tree is **independent** of the evaluator's.
  The evaluator's reconstruction always receives the evaluator's own tree.
- There are **no writable symlinks or hardlink aliases** to
  evaluator-owned dependency files: the evaluator materializes its own
  disposable COPY.
- The designated candidate scratch path is the harness's own
  `labs/long-horizon-harness/.tmp-home`. It is disposable candidate
  scratch state and does NOT enter the deliverable. It is NOT a blanket
  exemption for every directory named `node_modules`.
- **Network package installation is prohibited** for this initial
  experimental profile. The candidate-visible task says so explicitly.

### Qualification reuse conditions

A qualification identity may be reused ONLY when BOTH the oracle
implementation identity AND the applicable environment identity are
unchanged. A reuse must be EXPLICIT and identity-bound. Any reuse that is
not identity-bound is an undocumented bypass and is refused.

### Experimental limitations

- A separate VSCodium profile is **not a sandbox**. The candidate and
  the evaluator run as the SAME OS USER on the SAME host. Absence of
  registered supervisory MCP tools does NOT establish OS-level
  inaccessibility of the supervisory socket.
- The initial runner is for **cooperative engineering experiments under a
  disclosed same-user limitation**. It makes NO claim of adversarially
  trustworthy evaluation.
- The 300-second candidate deadline is a **wall-clock** bound enforced
  by the runner. No provider-enforceable token or financial cap was
  available; that limitation is recorded explicitly.
- Provider protocol fidelity is **NOT** established by this ACT. No
  comparative eligibility is published.


## The two gate levels

The ordinary Factory gate and the authoritative qualification gate are
different commands. They establish different levels of assurance.

| Command | Level | What it establishes |
| --- | --- | --- |
| `bash scripts/verify_factory.sh` | ORDINARY | The worktree topology, the documentation links, the four frozen-contract guards, and the oracle's DECISION LOGIC. Fast enough for everyday feedback. |
| `bash scripts/verify_factory_fast.sh` | ORDINARY | The same set, as a standalone entry point. |
| `bash scripts/verify_factory_qualification.sh` | AUTHORITATIVE | The ordinary gate PLUS the controls that execute the real historical fixture. **Mandatory when the oracle's authority changes**, and before any Model Lab candidate result is minted. |
| `bash tests/model_lab/test_ml_smoke_01_oracle.sh` | AUTHORITATIVE | The real-fixture controls alone. |

**The acceptance criteria were not weakened to recover the runtime.** The real
controls were moved to their own level, and they remain mandatory.

### Measured runtimes on this host

| Gate | Before | After |
| --- | --- | --- |
| Ordinary (`scripts/verify_factory.sh`) | 225.81 s | **1.39 - 1.69 s** |
| Authoritative (`scripts/verify_factory_qualification.sh`) | — | **232.112 s** (the real-fixture controls) |

## What does not live here yet

The runner exists but has **NOT** been executed against a model through
the live native transport. ML-02 delivered the deterministic runner, its
simulated-seam controls and the corrected oracle authority. The next
milestone is ONE authorized live ML-06A execution through this runner,
followed by repeated baseline experiments once provider fidelity and live
lifecycle qualification are established.

The historical scope proposal `qualification/reboot/08-ml02-scope.md` is
**SUPERSEDED** by this ACT's implementation. The proposal described the
D01 smoke fixture, a candidate-transport STUB and a "no commit" rule; it
never described ML-06A, the live native transport, or the commit-per-ACT
evidence-locality discipline. The proposal is preserved verbatim as the
historical record of what was believed at that time.

## The fixture: ML-SMOKE-01

One task, one defect, one allowed file.

| Property | Value |
| --- | --- |
| Base commit | `09fc12c6fb051dce096252bf30c2e96debed962c` |
| Preparation overlay | the SOCK06 correction only, from `5c51615` |
| Defect under test | `REC-TMP01` — `fs.mkdtemp` does not create missing parents |
| Allowed path | `labs/long-horizon-harness/test/recovery/cp-crash.test.ts` |
| Allowed change | the fixture-construction seam and the imports it needs |
| Required test | `REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent` |
| Required regression test | `REC-TMP02: tmpDir() returns a unique dir per call` |

The historical LH-07 D01 definition is **unchanged**; ML-SMOKE-01 is a
separate, Model-Lab-specific fixture. Its preparation overlay is
**evaluator-owned** and its identity is recorded in `identity.txt`.

Prepare it:

```bash
bash labs/model-lab/prepare_ml_smoke_01.sh <repo_root> 09fc12c... <out_dir>
```

The preparation requires an output directory that **does not exist**. A
collision is REFUSED, not recycled: there is no ownership marker, no
destructive reuse, and no stale-lock reclamation.

## The oracle

```bash
bash labs/model-lab/ml_smoke_01_acceptance_oracle.sh \
     <repo_root> <base_commit> <workspace> <prepared_reference_dir> \
     <expected_reference_digest>
```

The `expected_reference_digest` is REQUIRED. It is the digest the
supervisor recorded BEFORE the candidate executed. Without it the oracle
HALTs: an adjacent identity file next to the reference tree is not an
authority over itself.

The oracle is the **only** authority that may declare a candidate result
correct. A candidate's own statement of success is an observation, never a
verdict.

It performs five independent, fail-closed steps:

1. **Base identity** — an unverifiable base commit is a `HALT`, never a `PASS`.
2. **Reference identity** — the prepared reference is **REQUIRED** and is
   bound to the fixture digest recorded when it was prepared. A reference that
   does not match its own recorded identity is a `HALT`. There is **no
   self-comparison fallback**: without an independent reference no scope
   verdict can be trusted.
3. **Scope enforcement** — the workspace is compared against the
   evaluator-owned prepared reference. Enumeration failures, missing
   reference entries, unsupported filesystem object types (symlinks, other
   object types) and unauthorised mode changes are all recorded as
   violations. A candidate-created dependency directory is a
   `FORBIDDEN_DEPENDENCY` violation.
4. **Allowed-region validation** — inside the one allowed file, only the
   fixture-construction seam and the imports it needs may change. Every
   original assertion must be preserved byte for byte.
5. **Acceptance gate and mutation control** — the gate runs in a **fresh
   evaluator reconstruction** built from the trusted fixture, the evaluator's
   own dependency tree and the validated allowed patch. Candidate-controlled
   dependencies never become evaluator dependencies.

### FAILURE IDENTITY

The gate results are read from a **structured** Node test reporter. Each
record carries the test's exact name, its EXACT relative source file, its
status, and the chain of error codes its own failure produced. The negative
evidence is bound to that exact test identity and that exact error chain —
never to an arbitrary log substring.

### THE REAL NODE EVENT CONTRACT

The reporter is corrected against the ACTUAL Node test-runner events, because
the previous revision mis-read three of them and thereby produced a FALSE
ACCEPTANCE:

| Node event | Previous revision | Corrected revision |
| --- | --- | --- |
| `t.skip()` / `{ skip: true }` — `data.skip` is a BOOLEAN | reported as `pass` | reported as `skip` |
| `{ todo: true }` — `data.todo` is a BOOLEAN | reported as `pass` | reported as `todo` |
| a cancelled test — a `test:fail` with no `code`, no `cause`, an `AbortError` stack | reported as `fail` | reported as `cancel` |

The stream is **newline-delimited JSON** terminated by an explicit
completion record. A stream that is truncated, malformed, or that lost
records is REJECTED — a permissive brace scanner cannot express any of
those guarantees.

### IDENTITY AND AUTHORITY

- A required test is bound to its EXACT (file, name) identity. A test with
  the right name in the wrong file is NOT the required test.
- A duplicate terminal observation is AMBIGUOUS, and is a FAIL.
- Acceptance is bound to a successful **process exit** and to a **complete**
  event stream.
- Mutation detection is bound to the intended test's OWN file and OWN error
  chain. A timeout, a parser failure or an unrelated execution failure is
  NOT a detection.
- The expected reference digest is supplied by the **SUPERVISOR**, from
  state recorded BEFORE candidate execution. It is never read from a
  mutable file adjacent to the reference tree.
- The reference and the workspace must be DISTINCT, DISJOINT trees. A
  self-comparison or an overlapping root is a HALT, never a PASS.
- The evaluator's dependency tree is supplied as a disposable COPY in the
  evaluator's own reconstruction. There is no candidate-accessible symlink
  to evaluator-owned dependencies.

A mutation counts as detected **only** if all four conditions hold:

   | # | Condition |
   | --- | --- |
   | 1 | the mutation was applied to the intended statement |
   | 2 | the mutated source is still syntactically valid (checked with the harness's own esbuild loader) |
   | 3 | the required test EXECUTES in the mutant |
   | 4 | it fails with the intended error code (`ENOENT`) **in that test's own error chain** |

   A syntax error, a skipped test, an unrelated failure, a timeout or a
   missing dependency is **classified**, never counted as detection.

### Output

```text
ML_SMOKE_01_BASE_IDENTITY=VALID|INVALID
ML_SMOKE_01_REFERENCE_KIND=PREPARED_DIR
ML_SMOKE_01_REFERENCE_IDENTITY=VALID|INVALID
ML_SMOKE_01_REFERENCE_DIGEST=<sha256>
ML_SMOKE_01_EXPECTED_REFERENCE_DIGEST=<sha256>
ML_SMOKE_01_SCOPE_ERROR=<code>          (a self-comparison or an overlapping root -> HALT)
ML_SMOKE_01_SCOPE_VIOLATIONS=<n>
ML_SMOKE_01_DEPENDENCY_TRUST=TRUSTED|EVALUATOR_SUPPLIED|UNTRUSTED
ML_SMOKE_01_ALLOWED_REGION=true|false
ML_SMOKE_01_ALLOWED_REGION_REASON=<reason>
ML_SMOKE_01_GATE_EXIT=<n>
ML_SMOKE_01_GATE_PASSED=<n>
ML_SMOKE_01_GATE_FAILED=<n>
ML_SMOKE_01_GATE_SKIPPED=<n>
ML_SMOKE_01_GATE_TODO=<n>
ML_SMOKE_01_GATE_CANCELLED=<n>
ML_SMOKE_01_GATE_UNAVAILABLE=0|1
ML_SMOKE_01_GATE_STREAM_ERROR=<code>   (malformed | truncated | records_after_completion)
ML_SMOKE_01_GATE_STREAM_COMPLETE=0|1
ML_SMOKE_01_REQUIRED_TESTS_PRESENT=YES|NO
ML_SMOKE_01_REQUIRED_TESTS_EXECUTED=<n>/11
ML_SMOKE_01_ACCEPTANCE=PASS|FAIL
ML_SMOKE_01_MUTATION_STATUS=DETECTED|INVALID_MUTATION|WRONG_FAILURE|EXECUTION_FAILURE|MUTATION_SURVIVED|NOT_APPLIED
ML_SMOKE_01_MUTATION_DETECTED=YES|NO
ML_SMOKE_01_DISPOSITION=PASS|FAIL|HALT
```

Exit code 0 on `PASS`, 1 on `FAIL`, 2 on `HALT`.

## Environment prerequisites

| Prerequisite | Value |
| --- | --- |
| Node.js | `>= 20`; on this host `v26.0.0` at `/opt/homebrew/bin/node`, **not** on the default `PATH`. The oracle resolves it explicitly and fails closed when it cannot. |
| Harness dependencies | supplied by the evaluator from `labs/long-horizon-harness/node_modules`; never copied from a candidate workspace |
| `TMPDIR` | pinned to `/tmp` by the oracle — a long `TMPDIR` silently skips the UDS-backed SOCK tests |

## Isolation

The oracle reads the canonical repository but never writes to it. It runs the
gate in its own disposable reconstruction, built from the trusted fixture.
Candidate workspaces live in disposable temporary directories, materialized
with `git archive`. No linked Git worktree is used, per
`FACTORY_GIT_WORKTREE_POLICY` (GWT05).

Because each gate run has its own reconstruction, **two concurrent oracle
runs against the same workspace are independent** and reach the same verdict
(control C17).

## Status

```text
ML_SMOKE_01_FIXTURE_QUALIFICATION = PASS
ML_SMOKE_01_ROLE                   = SMOKE_FIXTURE_ONLY
```

ML-SMOKE-01 is a **smoke fixture**. Its task prompt describes the remedy, so
it cannot rank models and has a ceiling effect for skill-effectiveness
experiments. See `qualification/reboot-corr01/02-ml-smoke-01-fixture.md`.

## Superseded

The REBOOT-01 oracle (`d01_acceptance_oracle.sh`) produced a demonstrated
false PASS and was removed. It is preserved verbatim at
`qualification/reboot-corr01/superseded/d01_acceptance_oracle.sh` so the
defect stays reproducible and reviewable.

The CORR01 oracle is superseded by this revision. Its five remaining
authority defects and their counterexamples are recorded in
`qualification/reboot-corr02/01-counterexamples-reproduced.md`.
