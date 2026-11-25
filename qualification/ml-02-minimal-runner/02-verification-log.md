# ML-02 — Verification log

> ACT: `ACT-FACTORY-ML-02-MINIMAL-RUNNER-01`.
>
> Every ATTEMPTED verification run is recorded here with its purpose and
> its exit code. A run whose implementation and applicable environment
> identities had NOT changed was NOT repeated.

## The measured cost of each step (this host)

| Step | Measured elapsed |
| --- | --- |
| `scripts/verify_worktree_policy.sh` | 0.02 – 0.04 s |
| `scripts/check_links.sh` | 0.09 – 0.26 s |
| `scripts/verify_lh03_frozen.sh` | 0.07 s |
| `scripts/verify_lh04_frozen.sh` | 0.06 s |
| `scripts/verify_lh05_frozen.sh` | 0.16 s |
| `scripts/verify_lh06_frozen.sh` | 1.20 – 3.20 s (load-dependent) |
| `tests/model_lab/test_ml_smoke_01_lib.mjs` | 1.16 s |
| `tests/model_lab/test_ml_02_runner.mjs` | 0.85 s |
| **ORDINARY gate total** | **3.02 s** (quiet host); 3.87 s measured mid-run |

## The attempted runs

| # | Command | Purpose | Exit | Elapsed |
| --- | --- | --- | --- | --- |
| 1 | `node tests/model_lab/test_ml_smoke_01_lib.mjs` | Establish the state of the decision-logic controls after the A/B/C corrections. | 0 | 1.2 s |
| 2 | `bash tests/model_lab/test_ml_smoke_01_oracle.sh` | Establish the state of the REAL-fixture controls after the D/E corrections (the fail-closed orchestration and the authoritative/behavioural split). | 0 | 148.6 s |
| 3 | `bash tests/model_lab/test_ml_06a_qualification.sh` | Establish the state of the ML-06A fixture controls after the B/D/F corrections and the M01/M09 strengthening. | 0 | 33.4 s |
| 4 | `bash scripts/verify_factory.sh` | Measure the ordinary gate after wiring the runner controls in. | 0 | 3.87 s |
| 5 | `bash scripts/verify_factory_qualification.sh` | AUTHORITATIVE qualification against the corrected implementation. | 0 | 340.8 s |
| 6 | `node tests/model_lab/test_ml_smoke_01_lib.mjs` | After adding the L30/L31/L32/L33 regression controls. | 0 | 1.2 s |
| 7 | `node tests/model_lab/test_ml_02_runner.mjs` | After adding the L32 type-substitution correction in `compareTrees()`. | 0 | 0.9 s |
| 8 | `bash scripts/verify_factory.sh` | Re-measure the ordinary gate on a quiet host. | 0 | 3.02 s |
| 9 | `bash scripts/verify_factory_qualification.sh` | FINAL AUTHORITATIVE qualification against the final implementation identity. | 0 | see below |

## The failed attempts and their corrections

| Attempt | Failure | Correction |
| --- | --- | --- |
| 1 | The ML-06A M01 control reported `counts.failed = 0` and `counts.passed = 0`. The probe merged the runner's STDERR into the NDJSON stream, so the stream was not well-formed. | The probe's STDERR was separated from its STDOUT (`2> "${WORK}/m01-probe.err"`), and the counts were read from the structured stream. |
| 2 | The first ML-06A oracle invocation reported `ML_06A_EXPECTED_REFERENCE_DIGEST` twice (the expected-digest echo was duplicated by the correction). | The duplicate echo was removed. |
| 3 | The runner's controls failed with `ENOENT` when materializing the fixture: the production file's parent directory did not exist. | The parent directory is created before the file is written. |
| 4 | The simulated seam could not listen: `listen EINVAL` on the AF_UNIX socket. The pathname exceeded the 104-byte limit under macOS's per-user temporary directory. | The socket path was shortened to `/tmp/ml02-<pid>-<n>.sock`. |
| 5 | The runner's R17 control reported a HALT instead of a FAIL. The evaluator's expected reference digest was computed with the VERSIONED digest while the oracle compares the HISTORICAL `v1` digest. | The control now uses the historical digest, and the runner's own reference check uses the historical digest too. |
| 6 | The runner's R17 control reported `scopeViolations = 0` although the candidate-owned dependency tree WAS a violation. The oracle reports its scope violations on a line the runner did not read. | The runner now rejects an unauthorized scope ITSELF, before the evaluator is constructed: the candidate's tree never enters an evaluator reconstruction. |
| 7 | The L32 control reported no `TYPE_SUBSTITUTED` violation for a protected file replaced by a directory. `compareTrees()` compared only NON-DIRECTORY entries, so the substitution appeared as a plain DELETION. | `compareTrees()` now distinguishes a type substitution from a deletion. |

## Checks NOT executed

- **NO live candidate execution.** No model was executed against ML-06A
  or any other fixture in this ACT. `LIVE_EXECUTION = NOT_EXECUTED`.
- **NO provider-fidelity probe.** No wire-level capture, no TTFT, no
  throughput measurement, no provider billable-token counter. The
  separate ClineMM reasoning-round-trip investigation remains
  independent, and its outcome was NOT assumed.
- **NO container or VM provisioning.** Out of scope for ML-02.
- **NO skill A/B experiment.** DL-02 is PREPARED, not built.
- **NO `pstack` installation.**
- **NO long-horizon execution and NO 24-hour campaign.**
- **NO push.** The commit is LOCAL only.
- **NO change to the frozen long-horizon substrates.** The LH-03/LH-04/
  LH-05/LH-06 frozen guards are green.
- **NO modification of the ClineMM implementation.**
- **NO new MCP server.**
- **NO change to the historical ML-SMOKE-01B verdict.** The historical
  verdict remains FAIL.

## The new qualification identity

The oracle implementation AND the runner implementation both changed in
this ACT. The previous LIVE-SMOKE-01B qualification identity therefore
does NOT apply. This ACT issues a NEW qualification identity, bound to
the final committed implementation. See `05-changed-file-manifest.md`
for the per-file SHA-256 identities.

Reuse of a qualification identity is permitted ONLY when BOTH the
oracle implementation identity AND the applicable environment identity
are unchanged, and the reuse must be EXPLICIT and identity-bound. An
undocumented bypass is refused.
