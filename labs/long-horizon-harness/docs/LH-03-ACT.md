# LH-03 ACT — Real-Harness Adapter Qualification

> FOUNDATION04 — Long-Horizon Harness Lab — LH-03
>
> ACT name: `ACT-FACTORY-LONG-HORIZON-LAB-REAL-HARNESS-ADAPTER-QUALIFICATION01`
>
> This ACT defines and qualifies the first
> candidate-neutral adapter boundary between real
> coding harnesses and the frozen LH-02 evidence model.
>
> Prerequisite:
>
> ```text
> PHASE_A = GREEN_FROZEN
> PHASE_D = GREEN_FROZEN
> PHASE_E = GREEN_FROZEN
> LH_02   = GREEN_FROZEN   @ 715e639
> ```

## Mission

Answer:

> How do we observe and drive heterogeneous real
> harnesses without allowing their
> implementation-specific lifecycle semantics to
> become Factory run semantics?

The data-flow the ACT establishes:

```text
HARNESS OUTPUT
    ↓
ADAPTER            (candidate-neutral, frozen contract)
    ↓
PHASE-E EVIDENCE
    ↓
PHASE-E PROJECTION
    ↓
LH-02 METRICS
```

The ACT explicitly forbids the inverse direction:

```text
HARNESS STATUS  →  FACTORY SUCCESS      (FORBIDDEN)
```

The lab remains authoritative. Harnesses are
experimental subjects and providers of observations,
nothing more.

## H0 — Non-goals

Do **not** yet:

- run comparative frozen-ACT campaigns;
- perform 30m–8h soak qualification;
- rank harnesses;
- select a strategic fork;
- normalize away meaningful harness differences;
- modify Phase-E semantics to accommodate a candidate;
- modify LH-02 metric semantics to accommodate a candidate;
- build a dashboard;
- implement every candidate harness.

LH-03 establishes and proves the adapter protocol.

## H1 — Adapter contract extension (anchored on existing D08)

The lab already ships a candidate-neutral
`HarnessAdapter` contract at
`labs/long-horizon-harness/src/protocol/harness-adapter.ts`
(Doctrine D08: no candidate-specific types in common
protocol). That contract exposes:

```text
HarnessAdapter
    start(input)
    events(handle)
    interrupt(handle)
    status(handle)
```

LH-03 EXTENDS, but does NOT rewrite, that contract.
New capabilities (added as opt-in methods; existing
four methods must remain stable so the scripted-fake
adapter and existing tests stay green):

```text
identity()
capabilities()
prepareRun()
requestCancel()
awaitExit()
collectArtifacts()
cleanup()
```

The interface MUST distinguish:

```text
COMMAND
OBSERVATION
CAPABILITY
LIFECYCLE RESULT
RAW ARTIFACT
```

Do not collapse them into a generic event bag.

## H2 — Adapter identity

Every adapter execution MUST bind the candidate-neutral
**HarnessQualificationIdentity** tuple. Two adapters
whose display versions match but whose identities differ
in any other component are NOT the same qualified
subject.

```text
HarnessQualificationIdentity =
    harness_name
  + package_name
  + package_version
  + executable_path
  + executable_sha256
  + reported_cli_version
  + protocol_mode
  + native_schema_fingerprint
```

Required invariant:

```text
SAME_DISPLAY_VERSION
    !=
SAME_QUALIFIED_HARNESS
```

unless the **complete** HarnessQualificationIdentity
agrees component-by-component.

Companion adapter-side identity (always recorded
separately, never folded into the harness tuple):

```text
harness_revision   (where available)
adapter_name
adapter_version
adapter_revision
```

Where executable identity can be captured:

```text
binary path
binary hash
package version
reported CLI version
```

capture it. Do NOT infer version from installation
path names.

Required invariant:

```text
RUN_WITH_UNKNOWN_HARNESS_IDENTITY
    !=
FULLY_QUALIFIED_RUN
```

Unknown fields may produce a
`qualified-with-limitations` state, but must never be
silently omitted.

## H3 — Capability discovery

Define an explicit capability document. Candidate
capabilities include:

```text
HEADLESS
STREAMING_EVENTS
FINAL_JSON
JSONL
RPC
SESSION_RESUME
SESSION_FORK
EXPLICIT_CWD
ISOLATED_DATA_DIR
MODEL_SELECTION
PROVIDER_SELECTION
TIMEOUT
CANCELLATION
AUTO_APPROVAL
TOOL_EVENT_VISIBILITY
TOKEN_USAGE
RESOURCE_USAGE
SESSION_ARTIFACTS
```

Capabilities are facts discovered/probed at adapter
qualification time. Do not encode
`supports_streaming = true` because the harness is
known to usually support it. Probe or derive from
pinned documentation/version.

## H4 — Raw evidence is preserved before normalization

For every harness run preserve raw streams:

```text
stdout
stderr
exit code
signal / termination cause
startup metadata
harness-native event stream
session/log files selected by adapter contract
```

Raw evidence MUST be retained independently of
normalized Phase-E events.

Required relation:

```text
RAW HARNESS EVIDENCE
    -> deterministic adapter normalization
    -> Phase-E events
```

Never discard raw evidence merely because
normalization succeeded. Commit/sanitize fixtures for
H20.

## H5 — Adapter normalization is deterministic

Given:

```text
same adapter revision
same raw harness evidence
same frozen normalization contract
```

the resulting normalized Phase-E evidence MUST be
identical. Required oracle:

```text
NORMALIZE(raw)  ==  NORMALIZE(raw)
```

byte/structurally equivalent. Forbidden inside replay
normalization:

```text
Date.now()
random IDs
ambient filesystem reads
network lookup
current harness documentation
```

Any timestamps / IDs needed in normalized evidence
must come from raw evidence or deterministic
derivation.

## H6 — Unknown native events fail visibly

Real harnesses evolve. Unknown upstream event kinds
MUST NOT silently disappear. Choose one explicit
policy:

```text
HALT_UNKNOWN_HARNESS_EVENT
```

or:

```text
preserve as opaque raw observation
+ mark normalization incomplete
```

But never `default: ignore`. A harness upgrade that
changes its event schema must become observable
immediately.

## H7 — Adapter cannot authorize success

Adapter code MUST NOT emit terminal `SUCCESS` because:

```text
process exit code == 0
harness says "done"
final assistant text looks positive
native status == complete
```

These may emit observations. Phase E remains
responsible for terminal authority based on external
evidence. Required negative oracle:

```text
HARNESS_EXIT_0
+ NO AUTHORITATIVE GATE EVIDENCE
= NOT SUCCESS
```

The existing scripted fake adapter (D08) already
honours this: even the script's
`candidate_reported_completion` event is an
observation, not authority.

## H8 — Command / process lifecycle mapping

Freeze normalization rules for at least:

```text
adapter process started
adapter process exited
harness/session started
harness/session stopped
tool/action started
tool/action finished
timeout
cancel request
abort/crash
```

Explicitly distinguish:

```text
HARNESS_PROCESS_EXIT   !=   RUN_TERMINAL_OUTCOME
```

They are not equivalent.

## H9 — Tool / action mapping

For candidates exposing native tool events, map them
to Phase-E `ACTION_*` only when semantics are strong
enough. Do NOT infer an action from ordinary assistant
prose. For candidates that do not expose tool
lifecycle reliably:

```text
ACTION_VISIBILITY = UNAVAILABLE
```

rather than reconstructing it heuristically from text.
LH-02 metric availability must reflect this
limitation.

## H10 — Gate evidence remains external

Harness-native tests/tool calls may produce potential
gate inputs, but the adapter itself must not declare a
gate authoritative merely because the harness reports
test outcomes. Define a separate externally executed
lab gate path where appropriate. The harness may
request/run the command; the lab captures/verifies
its result. Required invariant:

```text
HARNESS_REPORTED_TEST_PASS   !=   FACTORY_GATE_PASS
```

## H11 — Cancellation semantics

Qualification MUST test:

```text
cooperative cancellation
timeout
process termination
harness-native abort
```

Adapter result must preserve which path occurred. No
mapping `SIGTERM == CANCELLED` without contractually
proving why it occurred. Capture before mapping to
Phase-E observations:

```text
requested cancellation?
timeout initiated?
external kill?
native abort?
exit signal?
exit code?
```

## H12 — Session isolation

Every qualification run MUST use an isolated harness
state area where the harness permits it. Examples may
include:

```text
Cline --data-dir
Pi --no-session / isolated session-dir
OpenCode explicit session/server context
```

Do not let one experimental repetition inherit opaque
mutable state from another unless persistence is the
property being tested. Required oracle:

```text
RUN_N_STATE  DOES_NOT_AFFECT  RUN_N+1
```

for fresh-session qualification.

## H13 — Environment capture

Capture enough environment identity for
replay/diagnosis:

```text
cwd
repository HEAD
dirty-state status
OS / platform
architecture
Node/Python/runtime version as applicable
harness executable identity
adapter revision
model/provider configuration identifier
```

Do not put secrets or raw API keys into evidence.
Introduce explicit redaction rules before storing
environment variables or command lines.

## H14 — Adapter error taxonomy

Define closed adapter-level errors distinct from
Phase-E terminal semantics. At minimum:

```text
HARNESS_NOT_FOUND
UNSUPPORTED_VERSION
CAPABILITY_MISSING
START_FAILED
PROTOCOL_ERROR
MALFORMED_NATIVE_EVENT
UNKNOWN_NATIVE_EVENT
PROCESS_CRASH
ADAPTER_TIMEOUT
CANCEL_FAILED
ARTIFACT_COLLECTION_FAILED
NORMALIZATION_FAILED
```

Adapter errors become evidence/input to Phase E; they
do not invent new terminal authority.

## H15 — First qualification pair

Implement exactly two adapters initially.

### Candidate A — Cline

Why:

```text
headless mode
NDJSON output via --json
explicit cwd
isolated data-dir
provider/model flags
timeout
auto-approval
```

Current upstream documents `--json` as
newline-delimited JSON and headless automation as a
first-class mode. Qualification MUST pin an exact
Cline version/revision before implementation.

### Candidate B — Pi

Why:

```text
JSON event mode
RPC mode
explicit process-integration surface
session controls
SDK available
```

Use the subprocess JSON/RPC surface first. Do NOT
embed the SDK in V1; process isolation is
experimentally cleaner. Pin exact Pi revision/version
before implementation.

These two intentionally exercise different upstream
architectures. Do not add Qwen / OpenCode / Hermes /
mini-swe-agent yet.

## H16 — Control/reference discovery records

Create discovery-only candidate records for:

```text
Qwen Code
OpenCode
Hermes
mini-swe-agent
```

Capture per record:

```text
current version / revision
machine-readable interface available?
streaming interface?
session model?
cancellation?
isolation?
known raw artifact surface?
```

No production adapters yet. This prevents
architectural assumptions from going stale while
keeping the first ACT bounded.

## H17 — Cline qualification probes

At minimum:

```text
CLINE01 version/identity capture
CLINE02 trivial successful invocation
CLINE03 --json event capture
CLINE04 stderr separated from JSON stream
CLINE05 non-zero process exit
CLINE06 timeout
CLINE07 cancellation
CLINE08 isolated --data-dir
CLINE09 unknown/malformed event fail-closed
CLINE10 replay raw stream -> identical Phase-E normalization
CLINE11 "done" text without gate cannot authorize success
CLINE12 repeated fresh runs do not share unintended state
```

Pin any discovered schema variants.

## H18 — Pi qualification probes

At minimum:

```text
PI01 version/identity capture
PI02 JSON mode capture
PI03 RPC startup and handshake
PI04 prompt execution
PI05 tool-event observation
PI06 normal process exit
PI07 abort/cancel
PI08 malformed RPC/native event handling
PI09 --no-session isolation
PI10 replay raw stream -> identical Phase-E normalization
PI11 native completion cannot authorize Factory success
PI12 repeated fresh runs do not share unintended state
```

Choose either JSON mode or RPC as the primary V1
adapter surface after probes. Record why.

## H19 — Cross-adapter conformance suite

Both adapters MUST satisfy the same candidate-neutral
conformance suite. At minimum:

```text
ADAPTER01 exact identity exposed
ADAPTER02 capabilities explicit
ADAPTER03 raw stdout preserved
ADAPTER04 raw stderr preserved
ADAPTER05 process result preserved
ADAPTER06 normalization deterministic
ADAPTER07 unknown native event visible
ADAPTER08 harness self-report non-authoritative
ADAPTER09 cancellation distinguished
ADAPTER10 timeout distinguished
ADAPTER11 isolated state
ADAPTER12 replay without harness executable
ADAPTER13 malformed raw input fails closed
ADAPTER14 Phase-E events pass Phase-E decode/project
ADAPTER15 LH-02 metrics compute from normalized evidence
```

The same assertions MUST run against Cline and Pi
fixtures where capability permits. Capability absence
is `UNAVAILABLE`, not test omission.

## H20 — Record / replay fixtures

Qualification must produce committed/sanitized raw
fixtures. Required fixture layers:

```text
native raw stream
native stderr
process result
adapter identity
capability document
expected normalized Phase-E stream
expected Phase-E projection
expected LH-02 metric report
```

Replay tests MUST run without:

```text
network
model API
actual harness executable
```

Real harness execution discovers behavior. Fixtures
make qualification deterministic.

## H21 — No candidate-specific semantics in Phase E / LH-02

Hard gates binding immutable domains to accepted bases:

```text
PHASE_E_FROZEN_HEAD = 61b0979
LH_02_FROZEN_HEAD   = 715e639
```

These bases are accepted immutable bases for THIS
repository's canonical main. The implementation MUST
preserve:

```text
labs/long-horizon-harness/src/run/**
labs/long-horizon-harness/test/run/**
```

relative to `61b0979`, and:

```text
labs/long-horizon-harness/src/metrics/**
labs/long-horizon-harness/test/metrics/**
```

relative to `715e639`.

Hard gates (machine-checked; not derived from working
tree dirt):

```text
git diff --exit-code \
    61b0979 -- \
    labs/long-horizon-harness/src/run \
    labs/long-horizon-harness/test/run

git diff --exit-code \
    715e639 -- \
    labs/long-horizon-harness/src/metrics \
    labs/long-horizon-harness/test/metrics
```

Expected: empty.

Required negative oracles:

```text
MODIFY_PHASE_E_FROZEN_FILE -> FAIL
MODIFY_LH02_FROZEN_FILE    -> FAIL
```

If a real harness cannot map cleanly:

```text
HALT_ADAPTER_CONTRACT_INSUFFICIENT
```

Do NOT patch Phase E or LH-02 opportunistically inside
adapter implementation. Any necessary
evidence-contract extension becomes a separately
reviewed ACT. Documentation may reference frozen
contracts without changing their implementation.

## H22 — Version drift qualification

Adapters must detect unsupported or unqualified
versions against the **complete**
`HarnessQualificationIdentity` tuple (see H2), not
against a single `harness_version` field. V1 may use:

```text
exact version allowlist
```

or:

```text
version-range + schema fingerprint
```

but behavior MUST be fail-closed. Required probes:

```text
qualified HarnessQualificationIdentity  -> PASS
different package_name                 -> UNQUALIFIED
different package_version              -> UNSUPPORTED_VERSION
different executable_sha256             -> UNQUALIFIED
different protocol_mode                -> UNQUALIFIED
different native_schema_fingerprint    -> UNSUPPORTED_VERSION / HALT_NATIVE_SCHEMA_DRIFT
```

The display version alone is insufficient. Required
negative oracle:

```text
SAME_DISPLAY_VERSION  +  ANY_OTHER_TUPLE_FIELD_DIFFERS
    -> NOT_THE_SAME_QUALIFIED_HARNESS
```

unless Y has been independently qualified. Do not
assume semver compatibility for event schemas.

## H23 — Candidate capability matrix

Produce a machine-readable matrix:

```text
candidate
version
protocol
headless
streaming
json
rpc
session_isolation
cancellation
tool_visibility
resource_visibility
replay_fixture
qualification_status
```

No ranking or winner column. This is factual
qualification evidence, not selection.

## H24 — Security / secret hygiene

Ensure raw artifacts and fixtures exclude:

```text
API keys
bearer tokens
provider secrets
authorization headers
private credential files
```

Redaction MUST happen before fixtures become durable
repository artifacts. Redaction itself must preserve
enough structural evidence to replay parsing. Add
secret-canary tests.

## H25 — Acceptance

Required preservation:

```text
Phase E suite remains frozen/green
LH-02 suite remains green
Phase D remains green
Phase A regressions remain green

typecheck
build
domain purity
trust boundary
EOF
Factory verify (scripts/verify_factory.sh)
worktree policy (scripts/verify_worktree_policy.sh)
git diff --check
```

New adapter qualification tests MUST separate:

```text
deterministic fixture conformance
```

from:

```text
live qualification
```

Live harness / model / API availability MUST NOT make
deterministic repository verification flaky.

## H26 — Closure matrix

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

CLINE_ADAPTER_QUALIFIED                         PASS
PI_ADAPTER_QUALIFIED                            PASS
QWEN_DISCOVERY_RECORD                           PASS
OPENCODE_DISCOVERY_RECORD                       PASS
HERMES_DISCOVERY_RECORD                         PASS
MINI_SWE_AGENT_DISCOVERY_RECORD                 PASS

PHASE_E_CHANGED                                 FALSE
LH_02_CHANGED                                   FALSE
```

## Exit

LH-03 closes when:

```text
REAL_HARNESS_ADAPTER_CONTRACT = FROZEN

CLINE =
    LIVE_PROBED
    RECORDED
    REPLAYABLE
    NORMALIZED
    PHASE_E_CONFORMANT
    LH_02_MEASURABLE

PI =
    LIVE_PROBED
    RECORDED
    REPLAYABLE
    NORMALIZED
    PHASE_E_CONFORMANT
    LH_02_MEASURABLE

RAW_NATIVE_EVIDENCE_CAN_REPLAY_WITHOUT_HARNESS = YES
HARNESS_SELF_REPORT_CAN_AUTHORIZE_SUCCESS       = NO
UNKNOWN_HARNESS_VERSION_SILENTLY_ACCEPTED       = NO
```

Then:

```text
READY_FOR_LH_04_FAULT_LABORATORY = YES
```

## Why Cline + Pi first

Cline gives us a realistic, feature-rich production
harness with headless + NDJSON + isolated data-dir.

Pi gives us a particularly clean process-integration
/ event surface (JSON event mode, RPC mode,
subprocess integration).

That pair stress-tests the adapter abstraction much
harder than two CLI-only wrappers while still keeping
the first implementation bounded.

The other candidates — Qwen, OpenCode, Hermes,
mini-swe-agent — are recorded in H16 as
discovery-only entries so V1 does not pay the cost
of five adapters.
