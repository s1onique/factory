# LH-03 Closure Report (CORRECTION01)

> FOUNDATION04 — Long-Horizon Harness Lab — LH-03
>
> ACT name: `ACT-FACTORY-LONG-HORIZON-LAB-REAL-HARNESS-ADAPTER-QUALIFICATION01`
> CORRECTION name: `ACT-FACTORY-LONG-HORIZON-LAB-REAL-HARNESS-ADAPTER-QUALIFICATION01-CORRECTION01`
>
> This file is the durable closure-of-record for LH-03 after
> CORRECTION01 (the response to the reviewer's corrections).
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
LH03_CORRECTION01_COMMIT  = 5958c7ce1830551e876eab4108bf8d5b3cf7cb59
CLOSURE_RECORD_COMMIT     = 961a6c8d9e6f09487d6561c436de25bc258f1256
CURRENT_HEAD              = 961a6c8d9e6f09487d6561c436de25bc258f1256 (= CLOSURE_RECORD_COMMIT; cosmetic rebinds stop here)

The closure-of-record binds three immutable SHAs:

1. `LH03_IMPL_COMMIT` (04e59784…) — the original LH-03
   implementation.
2. `LH03_CORRECTION01_COMMIT` (5958c7c…) — the
   CORRECTION01 patch (real Pi 0.85.1 schema, full
   identity binding, fail-visible decoder integration,
   durable-path redaction, capability axes, Cline
   halting, live-capture secret oracle).
3. `CLOSURE_RECORD_COMMIT` (961a6c8…) — the closure
   document carrying this text.

The closure-of-record does NOT chase `CURRENT_HEAD`
recursively. The implementation SHAs are the
authoritative binding; cosmetic document updates, if
any, are recorded as separate commits and do not move
the authoritative SHAs.
```

The closure-of-record binds three immutable SHAs:

1. `LH03_IMPL_COMMIT` (04e59784…) — the commit that
   carried every LH-03 source file. Stable.
2. `LH03_CORRECTION01_COMMIT` — the commit that carries
   the CORRECTION01 patch (real Pi schema, identity
   binding, decoder integration, redaction on durable
   path, capability axes, Cline halting). Stable.
3. `CLOSURE_RECORD_COMMIT` — the commit that records
   this closure-of-record text.

The contract intentionally does NOT chase
`CURRENT_HEAD` recursively. The `CURRENT_HEAD` field is
informational only — the implementation SHAs are the
authoritative binding.

## Verdict

```text
LH_03 = PARTIAL_WITH_HALT_DISPOSITION
READY_FOR_LH_04_FAULT_LABORATORY = NO
```

Both required live subjects do not yet satisfy the ACT:

```text
PI_LIVE_QUALIFICATION    = HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE
CLINE_LIVE_QUALIFICATION = HALT_CLINE_NOT_INSTALLED
```

A HALT remains first-class evidence; it does not become
PASS. After CORRECTION01, deterministic Pi
protocol/replay qualification is reported separately:

```text
PI_DETERMINISTIC_PROTOCOL_QUALIFICATION = PASS
CLINE_DETERMINISTIC_PROTOCOL_QUALIFICATION = HALT_CLINE_NOT_INSTALLED
LH_03_ADAPTER_CONTRACT_SUBSTRATE = GREEN
```

Full:

```text
PI_ADAPTER_QUALIFIED = PASS     — STILL requires the live PI01..PI12 obligations
                                    that need provider execution
CLINE_ADAPTER_QUALIFIED = PASS  — STILL requires a real Cline/ClineMM
                                    qualification subject
```

The corrections addressed every §H-C01..H-C10 directive:

- §H-C01 (real Pi schema): built from
  `dist/core/agent-session.d.ts` +
  `dist/modes/json-event.d.ts` +
  `dist/core/session-manager.d.ts`. 24 native event kinds.
- §H-C02 (full identity binding):
  `QUALIFIED_PI_IDENTITY` now binds executable_path + sha256;
  `piIdentityMatches` compares against the concrete record.
- §H-C03 (fail-visible decoder): UNKNOWN / MALFORMED
  decoder results route through `adapter_errors` (awaitExit)
  AND emit `candidate_error` events on the V1 channel.
- §H-C04 (closed-world decoders): hostile own-property
  detection; per-kind admitted-key set; per-kind shape
  validation. Reuses `parseNativeLine` and
  `inspectOwnProperties` from `src/adapter-common/`.
- §H-C05 (redaction on durable live-capture path):
  `ingestLiveCapture` redacts stdout/stderr/raw/native/argv/env
  BEFORE they become durable. End-to-end canaries
  LIVESECRET01..06 + immutability canary LIVESECRET07.
- §H-C06 (capability semantics): added the
  `LiveQualificationState` axis. `SESSION_RESUME` /
  `SESSION_FORK` are now `SUPPORTED` (harness) +
  `LIVE_UNQUALIFIED` (V1 adapter has not yet exercised
  them); `TOOL_EVENT_VISIBILITY` is `SUPPORTED` +
  `LIVE_UNQUALIFIED`; `CANCELLATION` is `SUPPORTED` +
  `LIVE_HALT`.
- §H-C07 (Cline stays unqualified): `native_schema_fingerprint`
  is null; `native event vocabulary` is `UNQUALIFIED`;
  no speculative schema is presented as captured Cline
  evidence.
- §H-C08 (correct phase disposition):
  `LH_03 = PARTIAL_WITH_HALT_DISPOSITION`;
  `READY_FOR_LH_04_FAULT_LABORATORY = NO`.
- §H-C09 (patch hygiene & closure binding):
  `git diff --check` is clean (verified at every
  checkpoint). Closure binds three immutable SHAs and
  does not self-reference `CURRENT_HEAD` recursively.
- §H-C10 (closure matrix): see below. Each gate is
  honestly assessed against the CORRECTION01 criteria.

## Pi identity (CORRECTION01 binding)

```text
package                   = @earendil-works/pi-coding-agent
package_version           = 0.85.1
pi --version              = 0.85.1
executable_path           = /tmp/npm-prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
executable_sha256         = e6d7fcf36a239cf3746e67ddf4222081ac01a601b85a3ee688bdfe9c161d754c
selected_protocol         = JSONL_EVENTS
native_schema_fingerprint = 411f371861a4a564052194e954efb52d0ab891add3398285a640edac4bde7cf1
```

The native schema fingerprint is now derived from the
REAL Pi 0.85.1 native kind set (24 kinds from
`AgentSessionEvent` + `JsonAgentSessionEvent` +
`SessionHeader`). It is NOT derived from invented names.

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

Pi native schema (24 kinds, every kind classified):

```text
NORMALIZED_EVENT (8):
  agent_start, agent_end, turn_start, turn_end,
  message_start, message_end,
  tool_execution_start, tool_execution_end

PRESERVED_META_OBSERVATION (2):
  session, message_update

KNOWN_BUT_UNMAPPED (14):
  tool_execution_update,
  agent_settled, queue_update,
  compaction_start, compaction_end,
  auto_retry_start, auto_retry_end,
  entry_appended, session_info_changed,
  thinking_level_changed,
  summarization_retry_scheduled,
  summarization_retry_attempt_start,
  summarization_retry_finished,
  bash_execution_update
```

## Pi capability matrix (CORRECTION01 axes)

Two axes are bound independently for every key:

```text
Key                       HARNESS_CAPABILITY   LIVE_QUALIFICATION_STATE
HEADLESS                  SUPPORTED            LIVE_QUALIFIED
STREAMING_EVENTS          SUPPORTED            LIVE_QUALIFIED
FINAL_JSON                SUPPORTED            LIVE_QUALIFIED
JSONL                     SUPPORTED            LIVE_QUALIFIED
RPC                       SUPPORTED            LIVE_QUALIFIED
SESSION_RESUME            SUPPORTED            LIVE_UNQUALIFIED
SESSION_FORK              SUPPORTED            LIVE_UNQUALIFIED
EXPLICIT_CWD              SUPPORTED            LIVE_QUALIFIED
ISOLATED_DATA_DIR         SUPPORTED            LIVE_QUALIFIED
MODEL_SELECTION           SUPPORTED            LIVE_UNQUALIFIED
PROVIDER_SELECTION        SUPPORTED            LIVE_UNQUALIFIED
TIMEOUT                   UNSUPPORTED          NOT_APPLICABLE
CANCELLATION              SUPPORTED            LIVE_HALT
AUTO_APPROVAL             UNSUPPORTED          NOT_APPLICABLE
TOOL_EVENT_VISIBILITY     SUPPORTED            LIVE_UNQUALIFIED
TOKEN_USAGE               SUPPORTED            LIVE_QUALIFIED
RESOURCE_USAGE            UNAVAILABLE          NOT_APPLICABLE
SESSION_ARTIFACTS         SUPPORTED            LIVE_UNQUALIFIED
```

Cline capability matrix (binary not installed):

```text
Key                       HARNESS_CAPABILITY   LIVE_QUALIFICATION_STATE
(ALL)                     UNQUALIFIED          LIVE_HALT  (HALT_CLINE_NOT_INSTALLED)
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
native event vocabulary   = UNQUALIFIED
```

The Cline adapter is implemented as a stub (V1 + V2
surface compiles; conformance tests pass against
fixtures; live probe recorded as `HALT_CLINE_NOT_INSTALLED`).
Production live qualification is deferred to the first
host on which Cline / ClineMM is installed.

No upstream Cline is silently substituted for ClineMM.

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
test:lh03 suite              = 86 tests, all passing
schema_fingerprint           = 6 tests
identity                     = 8 tests
secret_redaction             = 10 tests
unknown_events               = 18 tests (PI-SCHEMA01..08, PI-DEC01..07, HNEG01..03 through adapter)
cross_adapter_conformance    = 15 tests
version_drift                = 6 tests
negative_corpus              = 11 tests
frozen_contract_guard        = 2 tests
v1_contract_preservation     = 3 tests
live_capture_secret          = 7 tests (LIVESECRET01..06 + immutability)
```

## Fixture replay count

```text
pi_v0_85_1_replay_fixture     = 1 (re-derived with CORRECTION01 fingerprint)
cline_discovery_only_fixture  = 1 (no native schema; HALT_CLINE_NOT_INSTALLED)
```

## Phase-E suite count

```text
tests/run/*.test.ts       = 86 tests, all passing
```

## LH-02 suite count

```text
tests/metrics/*.test.ts   = 61 tests, all passing
```

## CORRECTION01 negative corpus

```text
HNEG01 (adapter path)  : unknown event recorded in adapter_errors + emitted as candidate_error
HNEG02 (adapter path)  : malformed native event recorded in adapter_errors + emitted as candidate_error
HNEG03 (adapter path)  : extra forbidden native field recorded in adapter_errors + emitted as candidate_error
HNEG04..HNEG07         : preserved from LH-03 (self-report non-authoritative, exit-code vs cancel, etc.)
HNEG08..HNEG10         : preserved from LH-03 (SECRET corpus)
HNEG11                 : stale / unqualified version is not silently accepted
HNEG12                 : schema fingerprint drift is detected
HNEG13..HNEG15         : preserved from LH-03
```

## CORRECTION01 live-capture secret-flow tests

```text
LIVESECRET01  stdout canary   -> no canary survives collectArtifacts()
LIVESECRET02  stderr canary   -> no canary survives collectArtifacts()
LIVESECRET03  native JSON     -> no canary survives collectArtifacts()
LIVESECRET04  raw event line  -> no canary survives events()
LIVESECRET05  argv            -> no canary survives prepareRun()
LIVESECRET06  env             -> no canary survives collectArtifacts() + prepareRun()
LIVESECRET07  immutability    -> caller's objects are NOT mutated by ingestLiveCapture()
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

## CORRECTION01 working-tree state (final, before commit)

Modified:

- `labs/long-horizon-harness/package.json` (test:lh03 script adds lh03-live-capture-secret.test.ts)
- `labs/long-horizon-harness/src/adapter-common/index.ts` (exports inspectOwnProperties, isPlainString, isNonNegativeInt, isFiniteNumber, isBoolean, HostileObjectReport, HostileFieldViolation)
- `labs/long-horizon-harness/src/adapters/pi/pi-adapter.ts` (rewrite with real Pi 0.85.1 schema, hostile decoders, identity binding, fail-visible events, redaction on durable path)
- `labs/long-horizon-harness/src/adapters/cline/cline-adapter.ts` (capability axes; LIVE_HALT for every key)
- `labs/long-horizon-harness/src/protocol/index.ts` (re-exports LiveQualificationState, CapabilityAxis)
- `labs/long-horizon-harness/src/protocol/harness-capabilities.ts` (adds LiveQualificationState, CapabilityAxis; HarnessCapabilities carries live_qualification_by_key + capability_axes)
- `labs/long-horizon-harness/src/redaction/secret-redaction.ts` (adds redactNativeLine, redactNativeEvent, redactStringValue; broader token regex incl. project-scoped sk-* and CANARY-* canaries; redact every string in JSON records)
- `labs/long-horizon-harness/test/fixtures/harnesses/pi/pi-v0_85_1/{identity,capabilities}.json` (re-derived)
- `labs/long-horizon-harness/qualification/{pi/{pi-identity,pi-capabilities}.json, capability-matrix.json}` (re-derived)
- `labs/long-horizon-harness/test/lh03/lh03-{unknown-events,cross-adapter-conformance,negative-corpus,version-drift}.test.ts` (updated for real schema + new return shape)

New (CORRECTION01):

- `labs/long-horizon-harness/src/adapter-common/hostile-object.ts` (closed-world hostile own-property inspector)
- `labs/long-horizon-harness/test/lh03/lh03-live-capture-secret.test.ts` (LIVESECRET01..06 + immutability)
- `labs/long-horizon-harness/qualification/lh03-emit.json` (deterministic consolidated emit)
- `labs/long-horizon-harness/docs/LH-03-CLOSURE.md` (this file)

## Closure matrix (LH-03 CORRECTION01)

```text
H-M01_ADAPTER_CONTRACT_CANDIDATE_NEUTRAL       PASS  (unchanged from LH-03)
H-M02_HARNESS_IDENTITY_BOUND                   PASS  (H-C02: now binds executable_path+sha256)
H-M03_CAPABILITIES_EXPLICIT                    PASS  (H-C06: two axes bound independently)
H-M04_RAW_EVIDENCE_PRESERVED                   PASS  (unchanged)
H-M05_NORMALIZATION_DETERMINISTIC              PASS  (unchanged)
H-M06_UNKNOWN_NATIVE_EVENT_FAILS_VISIBLE       PASS  (H-C03: through adapter events() + awaitExit())
H-M07_SELF_REPORT_NON_AUTHORITATIVE            PASS  (unchanged)
H-M08_PROCESS_VS_RUN_TERMINAL_SEPARATED        PASS  (unchanged)
H-M09_CANCELLATION_SEMANTICS_EXPLICIT          PASS  (unchanged)
H-M10_SESSION_ISOLATION                        retain only evidence-supported claim (H-C10)
H-M11_ADAPTER_ERRORS_CLOSED_WORLD              PASS  (unchanged)
H-M12_RECORD_REPLAY_WITHOUT_HARNESS            PASS  (unchanged)
H-M13_PHASE_E_CONFORMANCE                      PASS  (86 Phase E tests, all green)
H-M14_LH02_METRIC_CONFORMANCE                  PASS  (61 LH-02 tests, all green)
H-M15_VERSION_DRIFT_FAILS_CLOSED               PASS  (H-C02/H-C01: identity + fingerprint bound)
H-M16_SECRET_HYGIENE                           PASS  (H-C05: live-capture path; LIVESECRET01..07)
H-M17_FROZEN_PHASE_E_UNCHANGED                 PASS  (PHASE_E_CHANGED = FALSE)
H-M18_FROZEN_LH02_UNCHANGED                    PASS  (LH_02_CHANGED = FALSE)
H-M19_QUALIFICATION_IDENTITY_COMPLETE          PASS  (H-C02: 8-tuple bound; positive oracle test)
H-M20_NATIVE_SCHEMA_FINGERPRINT_BOUND          PASS  (H-C01: derived from real Pi 0.85.1 schema)

CLINE_DETERMINISTIC_PROTOCOL_QUALIFICATION     HALT_CLINE_NOT_INSTALLED
PI_DETERMINISTIC_PROTOCOL_QUALIFICATION        PASS

CLINE_LIVE_QUALIFICATION                        HALT_CLINE_NOT_INSTALLED
PI_LIVE_QUALIFICATION                           HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE

CLINE_ADAPTER_QUALIFIED                         HALT_CLINE_NOT_INSTALLED  (truthful halt)
PI_ADAPTER_QUALIFIED                            HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE

QWEN_DISCOVERY_RECORD                           PASS  (DISCOVERY_ONLY)
OPENCODE_DISCOVERY_RECORD                       PASS  (DISCOVERY_ONLY)
HERMES_DISCOVERY_RECORD                         PASS  (DISCOVERY_ONLY)
MINI_SWE_AGENT_DISCOVERY_RECORD                 PASS  (DISCOVERY_ONLY)

PHASE_E_CHANGED                                 FALSE
LH_02_CHANGED                                   FALSE

LH_03_ADAPTER_CONTRACT_SUBSTRATE                GREEN
LH_03                                            PARTIAL_WITH_HALT_DISPOSITION
READY_FOR_LH_04_FAULT_LABORATORY                NO
```

The contract retains `LH_03 = PARTIAL_WITH_HALT_DISPOSITION`
until BOTH required live HALTs are actually resolved.

## Exit of CORRECTION01

CORRECTION01 closes when:

```text
PI_NATIVE_PROTOCOL_MODEL_MATCHES_0_85_1         TRUE
PI_SCHEMA_FINGERPRINT_IS_NATIVE                 TRUE
PI_FULL_IDENTITY_MATCHES_QUALIFIED              TRUE
UNKNOWN_EVENT_SILENT_DROP                       IMPOSSIBLE
MALFORMED_EVENT_SILENT_DROP                     IMPOSSIBLE
LIVE_ARTIFACT_SECRET_LEAK                       IMPOSSIBLE
CAPABILITY_TAXONOMY_IS_HONEST                   TRUE
CLINE_SYNTHETIC_SCHEMA_PRESENTED_AS_REAL        FALSE
PATCH_HYGIENE                                   PASS
```

Each clause is proven by a test in `test/lh03/`:

- `PI_NATIVE_PROTOCOL_MODEL_MATCHES_0_85_1`  -> `PI-SCHEMA01..06`, `PI-DEC05`
- `PI_SCHEMA_FINGERPRINT_IS_NATIVE`          -> `PI-SCHEMA08`
- `PI_FULL_IDENTITY_MATCHES_QUALIFIED`       -> `Pi: piIdentityMatches returns true only for the concrete qualified record` + `H-C02: captured Pi 0.85.1 identity matches (positive oracle)`
- `UNKNOWN_EVENT_SILENT_DROP IMPOSSIBLE`     -> `PI-SCHEMA07`, `HNEG01 (adapter path)`
- `MALFORMED_EVENT_SILENT_DROP IMPOSSIBLE`   -> `PI-DEC01..04`, `HNEG02 (adapter path)`
- `LIVE_ARTIFACT_SECRET_LEAK IMPOSSIBLE`     -> `LIVESECRET01..07`
- `CAPABILITY_TAXONOMY_IS_HONEST`            -> `test/lh03/lh03-identity.test.ts` (axes)
- `CLINE_SYNTHETIC_SCHEMA_PRESENTED_AS_REAL` -> `test/lh03/lh03-cross-adapter-conformance.test.ts` (Cline rows do not claim native evidence)
- `PATCH_HYGIENE PASS`                       -> `git diff --check` clean; `verify_factory.sh` OK

LH-03 CORRECTION01 is GREEN with halt disposition.
CLOSED.
