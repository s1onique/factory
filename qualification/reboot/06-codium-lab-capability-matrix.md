# REBOOT-01 — `codium-lab` Candidate-Control Capability Matrix

> Amendment A discovery. **Read-only.** No task was started, resumed, or
> cancelled; no MCP configuration was modified; no model was switched; no
> inference was initiated; no mutation grant was armed.
>
> All interfaces below were read from the installed extension's implementation
> and, where noted, confirmed by an actual read-only probe.

---

## 1. Headline finding

**`codium-lab` does not exist on this host.** The instance directory
`~/.vscodium-lab` is absent. The existing instances are `codium-factory`
(`~/.vscodium-factory`) and `codium-clinemm` (`~/.vscodium-clinemm`), plus
~30 other project instances.

**The control transport ClineMM actually implements is a local Unix-domain
socket "control seam", not an MCP server.** The extension contains zero
`StreamableHTTPServerTransport` occurrences; its MCP surface is a *client*
(`McpGatewayService` consuming external MCP servers, plus plugin
`registerMcpServer` contributions). The `clinemm_mcp_settings.json` files
configure **outbound** MCP servers.

This is a factual discovery result, not a rejection of the operator's
direction. The control seam exposes exactly the six operations the Model Lab
needs, and HAR-02 should qualify it.

## 2. Authority separation (as directed)

| Role | Holder | Established how |
| --- | --- | --- |
| Human | experiment and budget authorization | operator decisions in `01-operator-decision.md` |
| `codium-factory` | engineering operator | `~/.vscodium-factory` instance, VSCodium pid 81851 |
| `codium-lab` | candidate execution | **NOT YET CREATED** — `~/.vscodium-lab` absent |
| Factory deterministic runner | experiment lifecycle | `labs/long-horizon-harness/src/process/`, `src/run/` |
| Factory evaluator | independent acceptance authority | `labs/model-lab/d01_acceptance_oracle.sh` |

Candidate completion statements and MCP terminal status are **observations**,
not correctness verdicts. The only verdict authority is the evaluator-owned
oracle.

## 3. Observed control-seam interface

### 3.1 Endpoint

```text
socket:  ~/.vscodium-clinemm/cline-data/control-seam/control.sock   (AF_UNIX, SOCK_STREAM)
token:   ~/.vscodium-clinemm/cline-data/control-seam/token          (64 hex chars + newline)
write:   ~/.vscodium-clinemm/cline-data/control-seam/write-token    (64 hex chars)
enable:  ~/.vscodium-clinemm/cline-data/control-seam/enabled.json  {"enabled":true}
mutate:  ~/.vscodium-clinemm/cline-data/control-seam/mutation.json  {"v":1,"enabled":true,"allowContentRead":false}
owner:   ~/.vscodium-clinemm/cline-data/control-seam/owner.json
```

Note the directory permissions: `drwx------` (0700). The socket and tokens are
mode 0600.

### 3.2 Wire protocol

Newline-delimited JSON over the Unix socket. One request per line; one
response per line. Responses may arrive out of order — the extension assigns a
monotonic sequence number per request and reorders them before responding.

Request envelope (validated by the extension's `Jgl` parser):

```json
{"v":1,"op":"<operation>","token":"<control token>","writeToken":"<optional>","sessionId":"<optional>","payload":{...}}
```

Response envelope:

```json
{"v":1,"ok":true,"result":{...}}
{"v":1,"ok":false,"error":{"code":"control_seam_<reason>","message":"..."}}
```

Observed error codes (from the extension's `jy` table):

```text
control_seam_bad_request          control_seam_unauthorized
control_seam_unknown_operation    control_seam_no_active_run
control_seam_internal              control_seam_foreign_session
control_seam_payload_too_large    control_seam_mutation_not_authorized
control_seam_rejected             control_seam_superseded
control_seam_unknown_outcome      control_seam_cursor_expired
```

Bounds observed: request buffer 65536 bytes; prompt ≤ 32000 chars;
`requestId` ≤ 200 chars; `limit` ≤ 100; default event limit 20.

### 3.3 The six operations (exact ids from the extension)

| Operation id | Mutating | Write scope | Purpose (extension's own description) |
| --- | --- | --- | --- |
| `clinemm_capabilities` | no | — | List the read-only operations this control seam exposes |
| `clinemm_get_run` | no | — | Read the active run's session identity and authoritative status |
| `clinemm_start_act` | **yes** | `mutation` | Start one task in the installed extension's workspace through the existing ClineMM task lifecycle |
| `clinemm_read_events` | **yes** | `mutation` | Read a bounded, ordered slice of the owned task's real emitted events |
| `clinemm_send_feedback` | **yes** | `mutation` | Send one ordinary text feedback message to the task this client owns, through the extension's existing follow-up authority |
| `clinemm_cancel_run` | **yes** | `mutation` | Cancel the task this client owns through the extension's existing cancellation lifecycle |

### 3.4 `clinemm_start_act` payload (from the extension's validator)

```json
{"op":"clinemm_start_act",
 "input":{"requestId":"<<=200 chars>",
          "prompt":"<<=32000 chars>",
          "expectedWorkspace":"<absolute path>"}}
```

### 3.5 `clinemm_read_events` payload

```json
{"op":"clinemm_read_events",
 "input":{"sessionId":"<owned session>","afterCursor":"<optional>","limit":"<optional 1..100>"}}
```

## 4. Read-only probes actually executed

Two read-only probes were sent to the **existing `codium-clinemm`** instance's
control seam. Both were `ok:true`. Neither started, resumed, or cancelled any
task, and neither wrote anything.

### Probe 1 — `clinemm_capabilities`

```json
{"v":1,"ok":true,"result":{
  "protocolVersion":1,
  "operations":[
    {"id":"clinemm_capabilities","description":"List the read-only operations this control seam exposes."},
    {"id":"clinemm_get_run","description":"Read the active run's session identity and authoritative status."}],
  "readOnly":true,
  "host":{"extensionVersion":"4.1.26-821b20e7a","platform":"darwin"}}}
```

**Critical observation:** only the two **read-only** operations are listed.
The four mutating operations are advertised *only* to a client that
presents a valid `writeToken`. The operation table is filtered by
`mutating === false` when unauthorized.

### Probe 2 — `clinemm_get_run`

```json
{"v":1,"ok":true,"result":{
  "sessionId":"1795536822522_4y8az",
  "running":true,
  "queuedPromptCount":0,
  "taskId":"1795536822522_4y8az",
  "runtimeStatus":"running",
  "runId":"run__WHtGcdX",
  "taskState":{"phase":"streaming","source":"shadow","seq":19353,
               "epoch":10,"stateVersion":24117,"label":"Working"}}}
```

This confirms the seam exposes a **live** session with a rich authoritative
status projection (phase, epoch, stateVersion, seq).

## 5. Extension build and MCP protocol identity

| Property | Observed value |
| --- | --- |
| Extension id | `s1onique.clinemm` |
| Version / build | `4.1.26-821b20e7a` (also `4.1.26-a493eff07` present in `~/.vscodium-clinemm/extensions`) |
| Extension path | `~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.26-821b20e7a` |
| `contributes.mcp` | **absent** (empty) — the extension exposes **no** MCP server contribution |
| `contributes` keys | `icons, walkthroughs, viewsContainers, views, commands, keybindings, menus, configuration` |
| `contributes.configuration.properties` | **empty** |
| Inbound MCP server | **NOT AVAILABLE** — zero `StreamableHTTPServerTransport` in the bundle |
| Outbound MCP client | **AVAILABLE** — `McpGatewayService`; `cline_mcp_settings.json` |
| Host helper socket | `~/.clinemm/host-helper.sock` (separate from the control seam) |
| Control-seam protocol version | `1` (newline-delimited JSON over AF_UNIX) |
| Control-seam protocol identity | **NOT MCP** — a proprietary local protocol |

### Extension commands relevant to supervision

```text
cline.plusButtonClicked                 New Task
cline.abortGitCommitMessage             Generate Commit Message with Cline - Stop
cline.debug.dumpModelBehaviorTrace      Dump Model Behavior Trace
cline.debug.dumpCancelLivenessDiagnostic
cline.debug.dumpLifecycleClear
cline.debug.dumpCompletionIncidentBundle
cline.reportTaskProblem
```

The `cline.debug.*` family is the highest-value observation surface for
HAR-01/HAR-02: it is the extension's own instrumentation of model behaviour,
cancel liveness, lifecycle, and completion authority.

## 6. Workspace identity

| Property | Observed value |
| --- | --- |
| Workspace root of the `codium-clinemm` instance | resolved at runtime via `authority.readWorkspaceRoot()`; the seam compares it against `expectedWorkspace` on `clinemm_start_act` |
| Workspace registry | `~/.vscodium-clinemm/cline-data/workspaces/` — 14 hashed workspace dirs (`19e40b9`, `1ba822ae`, `2c55a121`, `2f`, `320f73e9`, `3ddd059f`, `3fc45041`, `427dc471`, `4dbfd62b`, `6c6440f8`, `6f2cc4d5`, `a755796`, `chat`) |
| VSCodium workspace storage | `~/Library/Application Support/VSCodium/User/workspaceStorage/` |
| Profiles | `~/.vscodium-clinemm/cline-data/profiles.json` → `{"version":1,"profiles":{}}` (no named profiles) |
| Per-instance `workspaces/` dir | `~/.vscodium-clinemm/workspaces/` (empty) |

**Isolation mechanism:** a distinct `--user-data-dir` gives a distinct
`cline-data` directory (via `CLINE_DATA_DIR` or `CLINE_DIR`, else
`~/.cline`), which in turn gives a distinct control seam, distinct tokens,
and a distinct workspace registry. That is the mechanism a `codium-lab`
instance must use.

**A separate VSCodium profile is NOT a security sandbox.** The profile shares
the same filesystem, the same credentials store, the same extension host
model, and the same OS account. The amendment's caution is recorded and
observed: profile separation is *identity* separation, not *containment*.

## 7. Model and provider configuration

From `~/.vscodium-clinemm/cline-data/settings/providers.json` and
`globalState.json` (secrets redacted):

| Provider | Model | Notes |
| --- | --- | --- |
| `minimax` | `MiniMax-M3` | `lastUsedProvider`; `reasoning.enabled=false`, `effort="none"`; API key present in the local secrets store |
| `openai-compatible` | `qwen3.8-flash-next-iq3_s` | `baseUrl=http://192.168.50.111:8080/v1` (local Basalt-style endpoint); `contextWindow=131072` |
| `sapaicore` | `anthropic--claude-3.5-sonnet` | `useOrchestrationMode=true` |

Active mode: `actModeApiProvider=minimax`, `actModeApiModelId=MiniMax-M3`,
`planModeApiProvider=minimax`, `planModeApiModelId=MiniMax-M3`.

`models.json` registers ~29 model ids under provider `openai-compatible`, most
with `contextWindow=384000`; only `qwen3.8-flash-next-iq3_s` has `131072`.

**Note:** the local Basalt endpoint `http://192.168.50.111:8080/v1` is already
configured in this instance. ML-05 (Qwen/Basalt qualification) is therefore
closer to ready than assumed — but reachability was **not** tested in this
ACT, because that would initiate inference.

## 8. Authorization model for mutation

The mutation grant is **fail-closed** and is resolved at seam start:

```text
resolveMutationGrant():
  read mutation.json  ->  {v:1, enabled:true, allowContentRead:bool}
  if (grant === undefined || forceMutationEnabled === false) -> NO GRANT
  grant = { writeToken, instanceId, workspace: readWorkspaceRoot(),
            allowContentRead }
```

Authorization check for every mutating operation (`uqe`):

```text
if grant is undefined          -> unauthorized, reason "mutation-disabled"
if writeToken absent           -> unauthorized, reason "missing-credential"
if writeToken != grant token   -> unauthorized, reason "invalid-credential"
if expectedWorkspace != grant.workspace
                                 -> unauthorized, reason "workspace-mismatch"
```

Token comparison is a constant-time XOR fold (`JDr`).

`clinemm_start_act` additionally requires
`authority.readWorkspaceRoot() === grant.workspace`, rejects when another task
owner is active (`active-task-owner-exists`), rejects concurrent starts
(`start-already-in-flight`), and is idempotent per `requestId` via a
payload-fingerprinted ledger (the same `requestId` with a different payload
yields `request-id-conflict`).

`allowContentRead:false` in the current `mutation.json` means
`clinemm_read_events` **strips event text** and returns metadata only. The
Model Lab will need `allowContentRead:true` to observe content — that is a
configuration change requiring separate authorization.

## 9. Session reset and isolation

| Mechanism | Status |
| --- | --- |
| `clinemm_cancel_run` | **AVAILABLE** — cancels the owned task through the extension's cancellation lifecycle |
| `clinemm_send_feedback` | **AVAILABLE** — follow-up message to the owned task |
| Fresh-session isolation | **AVAILABLE_UNQUALIFIED** — a fresh `--user-data-dir` yields a fresh `cline-data`, fresh tokens, fresh workspace registry, and an empty session store (`sessions/` is per-instance) |
| Active-task guard | **AVAILABLE_VERIFIED (read)** — `active-task-owner-exists` is enforced on start |
| `epoch` / `stateVersion` | **AVAILABLE_VERIFIED (read)** — observed in `clinemm_get_run` output (`epoch:10`, `stateVersion:24117`); a new session resets these |
| Owner lifecycle | `owner.json` carries `instanceId`, `pid`, `startedAt`, `tokenFingerprint`; on startup the extension reclaims a stale seam |

## 10. Capability matrix

Legend: **AVAILABLE_VERIFIED** — implemented and confirmed by execution in this
ACT; **AVAILABLE_UNQUALIFIED** — implemented in the extension, not exercised
here; **AUTHORIZATION_REQUIRED** — implemented but gated behind a grant or
configuration change this ACT is not authorized to make;
**NOT_AVAILABLE** — not implemented; **NOT_TESTED** — cannot be classified
without an action this ACT is not authorized to perform.

| Capability | Classification | Evidence |
| --- | --- | --- |
| Unique instance identity | AVAILABLE_VERIFIED | `--user-data-dir` → distinct `cline-data`; `owner.json.instanceId` + `tokenFingerprint` observed |
| Control-seam endpoint discovery | AVAILABLE_VERIFIED | `control.sock` observed; `clinemm_capabilities` probe succeeded |
| Control-seam protocol | AVAILABLE_VERIFIED | newline-delimited JSON, `v:1`; two probes answered `ok:true` |
| Read-only capability listing | AVAILABLE_VERIFIED | `clinemm_capabilities` → 2 read-only ops |
| Active-run status projection | AVAILABLE_VERIFIED | `clinemm_get_run` → phase/epoch/stateVersion/seq |
| Mutating operation set | AUTHORIZATION_REQUIRED | 4 ops exist but are filtered out without a valid `writeToken` |
| Starting a candidate task | AUTHORIZATION_REQUIRED | needs `mutation.json` grant + `writeToken` + matching `expectedWorkspace` |
| Event observation (metadata) | AVAILABLE_UNQUALIFIED | `clinemm_read_events` implemented; not exercised |
| Event observation (content) | AUTHORIZATION_REQUIRED | `allowContentRead` is `false`; needs a config change |
| Native usage/token collection | AVAILABLE_UNQUALIFIED | the extension emits `cline.api.*`, `cline.cost.total`, `cline.api.ttft.seconds`, `cline.api.throughput.tokens_per_second` metrics; not yet extracted |
| Task cancellation | AVAILABLE_UNQUALIFIED | `clinemm_cancel_run` implemented; not exercised |
| Follow-up feedback | AVAILABLE_UNQUALIFIED | `clinemm_send_feedback` implemented; not exercised |
| Fresh-session isolation | AVAILABLE_UNQUALIFIED | per-instance `cline-data`, tokens, workspaces, sessions; not exercised |
| Programmatic model selection | AUTHORIZATION_REQUIRED | `globalState.json` holds `actModeApiProvider`/`actModeApiModelId`; changing them is a model switch, not authorized |
| MCP server transport | **NOT_AVAILABLE** | zero inbound MCP server in the extension; MCP is client-side only |
| Inbound MCP tool names | **NOT_AVAILABLE** | the extension contributes no MCP server and no MCP tools |
| Headless / CLI execution of codium-lab | NOT_TESTED | `codium --help` lists `--user-data-dir`, `--profile`, `--agents`; no headless agent-execution flag was verified |
| Parallel candidate execution | NOT_TESTED | would require multiple instances; not attempted |
| `codium-lab` instance itself | **NOT_AVAILABLE** | `~/.vscodium-lab` does not exist |
| Candidate completion verdict authority | **NOT_AVAILABLE** | by design — the evaluator owns it |

### Discovery-observed `codium --help` surface (relevant subset)

```text
--user-data-dir <dir>    Specifies the directory where user data is kept in.
                         Can be used to open multiple distinct instances of Code.
--profile <profileName>  Opens the provided folder or workspace with the given profile.
--agents                 Opens the agents window.
--list-extensions        List the installed extensions.
--install-extension      Installs or updates an extension.
```

`--user-data-dir` is the instance-isolation primitive.

## 11. Smallest next ACT to qualify one bounded `codium-lab` execution

**Recommendation: `ACT-FACTORY-HAR-01-02` — create `codium-lab` and qualify the
control path, read-only.**

Scope:

1. Create `~/.vscodium-lab` with a distinct `--user-data-dir` and a distinct
   `CLINE_DATA_DIR`; install the same `s1onique.clinemm` extension build
   (`4.1.26-821b20e7a`) into it. **No** mutation grant is armed.
2. Start `codium-lab` on a disposable fixture workspace.
3. Run `clinemm_capabilities` and `clinemm_get_run` against it and prove:
   - the seam answers on its own socket with its own token;
   - its `owner.json.instanceId` differs from `codium-factory`'s and
     `codium-clinemm`'s;
   - its `cline-data` is a distinct directory tree;
   - it does **not** answer on, or mutate, `codium-factory`'s seam.
4. Record the extension build, control-seam protocol version, workspace root,
   effective provider/model, and the `owner.json` identity.
5. Prove that no task was started and that no inference was consumed.

**Explicitly out of scope for that ACT:** arming `mutation.json`, starting a
task, reading events, cancelling, switching the model, and any paid
inference. Those require separate authorization.

**Why this is the smallest sufficient next step:** HAR-01 and HAR-02 are the
prerequisites for everything else in the harness track. A separate instance
whose identity is provably distinct is a precondition for every later
measurement, and it can be established entirely without paid inference.

### Then, in order

- **HAR-03** — fresh-session isolation: prove a second `codium-lab` session
  starts with `epoch`/`stateVersion` reset and no inherited session state.
- **HAR-04** — the minimal deterministic Factory-to-control-seam adapter.
  Extend `src/adapters/cline/cline-adapter.ts`; do **not** create a second
  adapter. HAR-04 is explicitly **not** in REBOOT-01's scope, per the
  amendment.
- **HAR-05** — programmatic model selection: needs the authorization this ACT
  does not have.
- **HAR-06 / HAR-07** — headless backend and parallel execution: NOT_TESTED
  and deferred.

## 12. Preserved artifacts

Nothing was modified. The following were read but **not** written:

- `~/.vscodium-clinemm/**` (including `control-seam/*`)
- `~/.vscodium-factory/**`
- `~/.clinemm/**`
- `~/.clinemm/bin/clinemm-host-helper`
- all Factory and ClineMM artifacts in this repository

No secret material was read into this record: `providers.json` and
`globalState.json` were rendered with credential fields redacted, and the
control-seam tokens were never written to disk.

```text
CODIUM_LAB_DISCOVERY_DISPOSITION = COMPLETE
CODIUM_LAB_INSTANCE_EXISTS      = false
MCP_SERVER_TRANSPORT_AVAILABLE   = false
CONTROL_SEAM_TRANSPORT_AVAILABLE = true
```
