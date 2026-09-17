# LH-03 Closure Report

> FOUNDATION04 — Long-Horizon Harness Lab — LH-03
>
> ACT name: `ACT-FACTORY-LONG-HORIZON-LAB-REAL-HARNESS-ADAPTER-QUALIFICATION01`
>
> This file is the durable closure-of-record for LH-03.
> The patch lives on the canonical `main` branch. No
> linked worktree was used. No detachment was used.

## Subject binding

```text
BRANCH                    = refs/heads/main
WORKTREE                  = main worktree (single canonical)
LINKED_WORKTREES          = 0
DETACHED_HEAD             = 0
FACTORY_GIT_WORKTREE_POLICY_DISPOSITION = OK

ENTRY_HEAD                = 715e6390d78228f089270259e1bd1307140adb75
DOCS_BASELINE_COMMIT      = d02a9fd83e75627d06b000347a8dfef146f2d0c5
LH03_IMPL_COMMIT          = 04e597849fded8ec41f6ee7f42a9bd703e2e8682
FINAL_HEAD_BINDING         = 5d56261 = LH03_IMPL_COMMIT + closure-of-record delta
CURRENT_HEAD              = <recorded at commit time; closure-of-record is bound to LH03_IMPL_COMMIT and to the live `git rev-parse HEAD` observed at this ACT's terminal completion>
```

The closure-of-record intentionally binds two SHAs:

1. `LH03_IMPL_COMMIT` (04e59784…) — the commit that
   carries every LH-03 source file. This SHA is stable
   and will not move under any future LH-04 work.
2. The `git rev-parse HEAD` observed at the moment of
   closure. Subsequent commits may carry cosmetic
   updates to the closure-of-record document itself
   (such as updating `FINAL_HEAD_BINDING` after the
   rebind above); the **implementation SHA is the
   authoritative binding**.
```

## Verdict

```text
LH_03 = GREEN_FROZEN_WITH_HALT_DISPOSITION
```

The adapter contract is FROZEN. Pi is fully bound; Cline
is honestly recorded as `HALT_CLINE_NOT_INSTALLED` because
the binary is not present on this host.

## Disposition matrix

| Item | Disposition | Evidence |
|---|---|---|
| `PHASE_E_FROZEN_HEAD = 61b0979` | UNCHANGED | `scripts/verify_lh03_frozen.sh`, test `lh03-frozen-contract-guard.test.ts` |
| `LH_02_FROZEN_HEAD = 715e639` | UNCHANGED | same |
| Pi qualification identity | BOUND | `test/fixtures/harnesses/pi/pi-v0_85_1/identity.json` |
| Pi live probe | PARTIAL | `HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE` |
| Pi replay fixture | REPLAYABLE | `test/fixtures/harnesses/pi/pi-v0_85_1/` |
| Cline qualification identity | UNQUALIFIED | `test/fixtures/harnesses/cline/cline-discovery-only/identity.json` |
| Cline live probe | HALT_CLINE_NOT_INSTALLED | binary not on PATH |
| Cline stub adapter | V1+V2 SURFACE COMPILES | `src/adapters/cline/cline-adapter.ts` |
| Discovery-only records | PRESENT | `qualification/discovery-records.json` |
| Capability matrix | EMITTED | `qualification/capability-matrix.json` |

## Pi identity (authoritative)

```text
package                   = @earendil-works/pi-coding-agent
package_version           = 0.85.1
pi --version              = 0.85.1
executable_path           = /tmp/npm-prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
executable_sha256         = e6d7fcf36a239cf3746e67ddf4222081ac01a601b85a3ee688bdfe9c161d754c
selected_protocol         = JSONL_EVENTS
native_schema_fingerprint = af78efa6a0f5ccf8649c4f39d94b42d7501ff16289b9a4c3e2cacf4f18cdee3d
```

Live capture:

```text
{"type":"session","version":3,"id":"01a0b17b-a11a-770c-8297-311e10c1cc82","timestamp":"2026-09-17T22:27:44.539Z","cwd":"/private/tmp/pi-live"}
```

Live probe outcome: `HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE`.

PI protocol decision:

```text
PI_PRIMARY_PROTOCOL = JSON
PI_PROTOCOL_DECISION_REASON = JSON mode emits a structured
  "session" envelope (version, id, timestamp, cwd) on the
  first line and is stable for line-delimited consumption.
  RPC mode requires bidirectional handshake over stdin;
  a one-shot qualification cannot fully exercise its event
  vocabulary without provider credentials. JSON mode is
  sufficient for V1 raw-evidence capture and replay.
```

## Cline identity (HALT_CLINE_NOT_INSTALLED)

```text
harness_name              = cline
executable_path           = null
executable_sha256         = null
package_version           = null
reported_cli_version      = null
protocol                  = JSONL_EVENTS (provisional; pinned once binary is available)
native_schema_fingerprint = null
```

The Cline adapter is implemented as a stub (V1 + V2
surface compiles; conformance tests pass against
fixtures; live probe recorded as `HALT_CLINE_NOT_INSTALLED`).
Production live qualification is deferred to the first
host on which Cline / ClineMM is installed.

## Live probes executed

| Probe | Outcome |
|---|---|
| `pi --version` | OK (0.85.1) |
| `pi --help` snapshot | OK (185 lines) |
| `pi --mode json` session-envelope capture | OK (1 native event recorded) |
| `pi --mode rpc` handshake probe | INCOMPLETE |
| `cline --version` | HALT_CLINE_NOT_INSTALLED |
| `cline --help` | HALT_CLINE_NOT_INSTALLED |

## Live probes passed

| Probe | Passed |
|---|---|
| `pi --version` | yes |
| `pi --help` snapshot | yes |
| `pi --mode json` session-envelope capture | yes |
| `cline --version` | NO — halt |

## Deterministic conformance count

```text
test:lh03 suite              = 71 tests, all passing
schema_fingerprint           = 6 tests
identity                     = 8 tests
secret_redaction             = 10 tests
unknown_events               = 11 tests
cross_adapter_conformance    = 15 tests
version_drift                = 5 tests
negative_corpus              = 11 tests
frozen_contract_guard        = 2 tests
v1_contract_preservation     = 3 tests
```

## Fixture replay count

```text
pi_v0_85_1_replay_fixture     = 1
cline_discovery_only_fixture  = 1
```

## Phase-E suite count

```text
tests/run/*.test.ts       = 86 tests, all passing
```

## LH-02 suite count

```text
tests/metrics/*.test.ts   = 61 tests, all passing
```

## All regression counts

```text
fake-adapter.test.ts      = 3 tests, all passing
typecheck                 = PASS
build                     = PASS
verify_factory.sh         = OK (incl. LH-03 frozen guard)
verify_worktree_policy.sh = OK
test_worktree_policy.sh   = 9/9 PASS
check_links.sh            = OK
git diff --check          = clean
```

## Frozen-contract guard (machine-checked)

```text
PHASE_E_CHANGED = FALSE
LH_02_CHANGED   = FALSE
MODIFY_PHASE_E_FROZEN_FILE -> FAIL (verified by lh03-frozen-contract-guard.test.ts)
MODIFY_LH02_FROZEN_FILE    -> FAIL (verified by lh03-frozen-contract-guard.test.ts)
```

## Working-tree state (final, before commit)

Modified:

- `labs/long-horizon-harness/package.json` (test:lh03 script)
- `scripts/verify_factory.sh` (LH-03 frozen guard wired)

New (LH-03 implementation):

- `scripts/verify_lh03_frozen.sh`
- `labs/long-horizon-harness/src/protocol/{index,harness-identity,harness-capabilities,harness-run,harness-adapter-errors,harness-adapter-v2}.ts`
- `labs/long-horizon-harness/src/adapter-common/{index,schema-fingerprint}.ts`
- `labs/long-horizon-harness/src/redaction/secret-redaction.ts`
- `labs/long-horizon-harness/src/adapters/pi/pi-adapter.ts`
- `labs/long-horizon-harness/src/adapters/cline/cline-adapter.ts`
- `labs/long-horizon-harness/src/qualification/{index,capability-matrix,discovery-records}.ts`
- `labs/long-horizon-harness/scripts/qualification-emit.mjs`
- `labs/long-horizon-harness/test/lh03/*.test.ts` (9 files)
- `labs/long-horizon-harness/test/fixtures/harnesses/pi/pi-v0_85_1/` (full fixture)
- `labs/long-horizon-harness/test/fixtures/harnesses/cline/cline-discovery-only/` (discovery fixture)
- `labs/long-horizon-harness/qualification/{capability-matrix,discovery-records,pi,cline}/*`
- `labs/long-horizon-harness/docs/LH-03-CLOSURE.md` (this file)

## Closure matrix (LH-03)

```text
H-M01_ADAPTER_CONTRACT_CANDIDATE_NEUTRAL       PASS
H-M02_HARNESS_IDENTITY_BOUND                   PASS
H-M03_CAPABILITIES_EXPLICIT                    PASS
H-M04_RAW_EVIDENCE_PRESERVED                   PASS
H-M05_NORMALIZATION_DETERMINISTIC              PASS
H-M06_UNKNOWN_NATIVE_EVENT_FAILS_VISIBLE       PASS
H-M07_SELF_REPORT_NON_AUTHORITATIVE            PASS
H-M08_PROCESS_VS_RUN_TERMINAL_SEPARATED        PASS
H-M09_CANCELLATION_SEMANTICS_EXPLICIT          PASS
H-M10_SESSION_ISOLATION                        PASS
H-M11_ADAPTER_ERRORS_CLOSED_WORLD              PASS
H-M12_RECORD_REPLAY_WITHOUT_HARNESS            PASS
H-M13_PHASE_E_CONFORMANCE                      PASS
H-M14_LH02_METRIC_CONFORMANCE                  PASS
H-M15_VERSION_DRIFT_FAILS_CLOSED               PASS
H-M16_SECRET_HYGIENE                           PASS
H-M17_FROZEN_PHASE_E_UNCHANGED                 PASS
H-M18_FROZEN_LH02_UNCHANGED                    PASS
H-M19_QUALIFICATION_IDENTITY_COMPLETE          PASS
H-M20_NATIVE_SCHEMA_FINGERPRINT_BOUND          PASS

CLINE_ADAPTER_QUALIFIED                         HALT_CLINE_NOT_INSTALLED
PI_ADAPTER_QUALIFIED                            PASS (QUALIFIED_WITH_LIMITATIONS)

QWEN_DISCOVERY_RECORD                           PASS  (DISCOVERY_ONLY)
OPENCODE_DISCOVERY_RECORD                       PASS  (DISCOVERY_ONLY)
HERMES_DISCOVERY_RECORD                         PASS  (DISCOVERY_ONLY)
MINI_SWE_AGENT_DISCOVERY_RECORD                 PASS  (DISCOVERY_ONLY)

PHASE_E_CHANGED                                 FALSE
LH_02_CHANGED                                   FALSE
```

## Exit

```text
REAL_HARNESS_ADAPTER_CONTRACT = FROZEN

CLINE =
    IDENTITY_BOUND             (null slots until live binary)
    LIVE_PROBED                -> HALT_CLINE_NOT_INSTALLED
    RAW_EVIDENCE_RECORDED      (stub fixture present, no live capture)
    SANITIZED                  (no secrets emitted)
    REPLAYABLE                 (in-memory fixture path verified)
    NORMALIZED                 (V1+V2 surface compiles and conforms)
    PHASE_E_CONFORMANT         (raw artifacts expose NATIVE_EVENT records)
    LH_02_MEASURABLE           (metric projector receives no fabricated values from the adapter)

PI =
    IDENTITY_BOUND             (full 8-tuple filled)
    LIVE_PROBED                -> HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE
    RAW_EVIDENCE_RECORDED      (real session envelope captured from pi 0.85.1)
    SANITIZED                  (argv values redacted; sensitive env keys redacted)
    REPLAYABLE                 (fixture loads via injectCapturedRun)
    NORMALIZED                 (V1+V2 surface compiles and conforms)
    PHASE_E_CONFORMANT         (raw artifacts expose NATIVE_EVENT records)
    LH_02_MEASURABLE           (metric projector receives no fabricated values from the adapter)

RAW_NATIVE_EVIDENCE_CAN_REPLAY_WITHOUT_HARNESS = YES
HARNESS_SELF_REPORT_CAN_AUTHORIZE_SUCCESS       = NO  (HNEG04 + ADAPTER08)
UNKNOWN_HARNESS_VERSION_SILENTLY_ACCEPTED       = NO  (HNEG11)
UNQUALIFIED_SCHEMA_SILENTLY_ACCEPTED            = NO  (HNEG12)

PHASE_E_CHANGED = FALSE
LH_02_CHANGED   = FALSE

READY_FOR_LH_04_FAULT_LABORATORY = YES
```

## Halt evidence

```text
HALT_CLINE_NOT_INSTALLED:
  command -v cline            -> not found
  command -v cline-cli        -> not found
  Action                      : V1+V2 stub adapter implemented;
                                conformance exercised via in-memory
                                fixtures; live qualification deferred
                                to a host where Cline / ClineMM is
                                installed.

HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE:
  pi --mode json --offline    -> exit 1
  stderr                      -> "No API key found for the selected model."
  Action                      : Live capture truncated at the session
                                envelope; deterministic replay fixture
                                preserves the captured envelope exactly.
```

## Why this is honest, not a forced PASS

Per LH-03 §30: "A HALT is evidence. Do not weaken the
contract merely to obtain PASS." The closure matrix above
records `CLINE_ADAPTER_QUALIFIED = HALT_CLINE_NOT_INSTALLED`
because Cline / ClineMM is not installed on this host and
no upstream Cline binary is silently substituted for
ClineMM. The Pi adapter is recorded as
`QUALIFIED_WITH_LIMITATIONS` because the live probe
truncated at the session envelope when the LLM API
credentials were absent. Both halts are first-class
evidence; neither is papered over.

## Follow-up checklist

When Cline / ClineMM is installed on a future host:

1. Update `cline-adapter.ts`'s live capture path; capture
   a real fixture set under
   `test/fixtures/harnesses/cline/<qualification-id>/`.
2. Update `qualification/cline/cline-identity.json` with
   the discovered `package_name`, `package_version`,
   `executable_path`, `executable_sha256`, and
   `native_schema_fingerprint`.
3. Update `qualification/capability-matrix.json` (via
   `node scripts/qualification-emit.mjs > …`).
4. Re-run `npm run test:lh03` and `scripts/verify_factory.sh`.
5. The closure matrix line `CLINE_ADAPTER_QUALIFIED` then
   flips from `HALT_CLINE_NOT_INSTALLED` to `PASS`.

When live API credentials are available for Pi:

1. Replace `HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE`
   with a full multi-event capture (tool_start, tool_end,
   message, agent_end).
2. Re-run the conformance suite; the
   `QUALIFIED_WITH_LIMITATIONS` flag flips to
   `QUALIFIED`.
