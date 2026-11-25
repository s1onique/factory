# REBOOT-CORR01 — `codium-lab` Provisioning and Control-Path Discovery

> Work package B. **No task was started. No grant was armed. No model was
> switched. No inference was initiated. No existing instance was modified.**

---

## 1. Disposition

```text
CODIUM_LAB_DISPOSITION = CODING_LAB_PROVISIONING_BLOCKED
```

**The blocker is environmental, not conceptual.** The provisioning mechanism
was identified and every required component was located, but this session
cannot create the instance directory. Details in §5.

## 2. Existing provisioning mechanism (discovered)

The `codium-*` instances are provisioned by **directory convention plus two
CLI flags**. There is no dedicated provisioning script, no launchd agent, and
no wrapper: the operator launches VSCodium directly with an instance-specific
user-data directory and extensions directory.

Observed from the running processes:

```text
/Applications/VSCodium.app/Contents/MacOS/VSCodium \
    --user-data-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data \
    --extensions-dir /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions
```

The ClineMM data directory is selected by the environment variable
`CLINE_DATA_DIR`, which is set per instance:

```text
CLINE_DATA_DIR=/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data
```

Instance layout (`~/.vscodium-clinemm/`):

```text
cline-data/      ClineMM state: sessions, workspaces, db, control-seam, secrets
extensions/      VSCodium extensions (per-instance)
user-data/       VSCodium user data (per-instance)
workspaces/      workspace stubs
```

### The derived recipe for `codium-lab`

| Component | Required value |
| --- | --- |
| Instance root | `~/.vscodium-lab` |
| VSCodium user-data dir | `~/.vscodium-lab/user-data` |
| Extensions dir | `~/.vscodium-lab/extensions` |
| ClineMM data dir | `~/.vscodium-lab/cline-data` (via `CLINE_DATA_DIR`) |
| Workspace | a **disposable empty directory**, not the canonical Factory checkout |
| Control seam | `<cline-data>/control-seam/control.sock` + `token` (auto-created) |
| Extension build | `s1onique.clinemm` `4.1.26-821b20e7a` |

`--user-data-dir` is the instance-isolation primitive. A distinct
`CLINE_DATA_DIR` is what makes the control seam, the tokens, the session
store and the workspace registry distinct.

### Identity isolation is NOT containment

A distinct `--user-data-dir` gives distinct *identity*. It does not give a
sandbox: the instance shares the filesystem, the OS account and the extension
host model with the operator's other instances. This is recorded explicitly,
as the amendment required.

## 3. Existing MCP bridge discovery — the reviewer was right

REBOOT-01 concluded that "MCP is not the control transport". That conclusion
was **too broad**, and the reviewer's objection was correct. The ClineMM
source tree contains a complete embedded MCP control seam.

### What exists in source

```text
~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/
├── control-seam-proxy-main.ts     MCP stdio server entry point
├── control-seam-proxy.ts          McpServer + StdioServerTransport
├── control-seam-client.ts         transport-agnostic NDJSON client
├── control-seam-server.ts         AF_UNIX listener
├── control-seam-protocol.ts       operation registry + error codes
├── control-seam-authority.ts      session authority
├── control-seam-mutation.ts       mutation grant
├── control-seam-ownership.ts      owner exclusivity
├── control-seam-paths.ts          socket path + length guard
└── ... 12 test files
```

The proxy registers a **real MCP stdio server**:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer({ name: "clinemm-control-seam", version: "1" },
                              { capabilities: { tools: {} } });
```

with prior Factory evidence at
`~/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01/`
verdict `PASS_STRUCTURAL_ONLY`. That ACT's transport decision explicitly
considered and **rejected** TCP, and recorded the AF_UNIX path-length
constraint that REBOOT-01 independently rediscovered through the SOCK test
skips.

### What exists in the INSTALLED build

| Component | In installed bundle? | Evidence |
| --- | --- | --- |
| Control seam (server + protocol) | **YES** | all six operation ids present in `dist/extension.js` |
| MCP proxy (`runControlSeamProxy`) | **NO** | `grep -c 'runControlSeamProxy' dist/extension.js` → `0` |
| `StreamableHTTPServerTransport` | NO | 0 occurrences |
| `contributes.mcp` | empty | the extension contributes no MCP server |

### The accurate conclusion

> The MCP bridge **exists in source and is not shipped in the installed
> build**. The native NDJSON control seam **is** installed and is reachable
> at the instance's AF_UNIX socket. REBOOT-01's transport conclusion was
> accidentally right about the installed build and wrong about the codebase.

### Consequence for the deterministic runner

The reviewer's transport preference is confirmed by this evidence:

| Consumer | Interface | Reason |
| --- | --- | --- |
| Human supervising `codium-lab` | Native UI | unchanged |
| Agent in `codium-factory` | The existing MCP proxy, **if** a build including it is used | source exists; not in the installed bundle |
| Deterministic Factory runner | **Native NDJSON control seam** | it is what is installed and reachable; no new dependency |
| Candidate model | none | unchanged |

There is no reason for the deterministic runner to depend on MCP, and no
reason to discard an existing bridge that could make interactive supervision
convenient. **No new MCP server was implemented in this ACT.**

## 4. Read-only control path — already verified against a live instance

The two read-only operations were exercised successfully against the running
`codium-clinemm` instance during REBOOT-01, and the implementation was read
in full during this ACT. The protocol is:

```json
{"v":1,"op":"clinemm_capabilities","token":"<control token>"}
{"v":1,"op":"clinemm_get_run","token":"<control token>"}
```

with responses `{"v":1,"ok":true,"result":{...}}` or
`{"v":1,"ok":false,"error":{"code":"control_seam_*","message":"..."}}`.

The six operations, with their mutating flags (from the extension source):

| Operation | Mutating | Write scope |
| --- | --- | --- |
| `clinemm_capabilities` | no | — |
| `clinemm_get_run` | no | — |
| `clinemm_start_act` | **yes** | `mutation` |
| `clinemm_read_events` | **yes** | `mutation` |
| `clinemm_send_feedback` | **yes** | `mutation` |
| `clinemm_cancel_run` | **yes** | `mutation` |

**The read-only control path is therefore already qualified in substance.**
What remains unproven is that it works for a *separate* `codium-lab`
instance, which requires the instance to exist.

## 5. The provisioning blocker (exact)

Attempting to create the instance:

```text
$ mkdir -p ~/.vscodium-lab/{user-data,extensions,cline-data,workspaces}
mkdir: cannot create directory '/Volumes/UserData/Users/chistyakov/.vscodium-lab': Operation not permitted
```

A systematic write probe:

| Path | Result |
| --- | --- |
| `~/.vscodium-lab` (create) | **DENIED** — `Operation not permitted` |
| `~` (create file) | **DENIED** |
| `~/Library` | **DENIED** |
| `~/Documents` | **DENIED** |
| `~/Projects` | **DENIED** |
| `~/.vscodium-clinemm` | **DENIED** |
| `~/.vscodium-clinemm/cline-data` | **DENIED** |
| `~/.vscodium-factory` | **DENIED** |
| `/Volumes/UserData` | **DENIED** |
| `/Volumes/UserData/Users` | **DENIED** |
| `/tmp` | **WRITABLE** |
| the repository working tree | **WRITABLE** |

**The sandbox permits writes only to the repository working tree and to
`/tmp`.** The whole `~` tree — including every existing `codium-*` instance —
is read-only in this session.

### Why this blocks B2 and B3

- **B2 (create the instance)** requires creating `~/.vscodium-lab`. DENIED.
- **B3 (start it and probe it)** requires the instance to exist. Not
  reachable.

There is no workaround that satisfies the amendment. The instance must live
outside the repository with its own `--user-data-dir`, its own extensions
directory and its own `CLINE_DATA_DIR`; putting it inside the repository would
(a) violate the instance-isolation intent, (b) risk committing IDE state into
the canonical tree, and (c) still not produce a `~/.vscodium-lab` that the
operator's other instances would not share.

### Exact blocker for the operator

```bash
# Run by the operator outside this sandbox:
mkdir -p ~/.vscodium-lab/{user-data,extensions,cline-data,workspaces}
cp -R ~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.26-821b20e7a \
      ~/.vscodium-lab/extensions/
```

Then launch it with a **disposable empty workspace** (not the Factory
checkout), `CLINE_DATA_DIR=~/.vscodium-lab/cline-data`, and
`--user-data-dir ~/.vscodium-lab/user-data`. The control seam and its token
are created automatically by the extension on startup.

### What was NOT done

- No instance was created.
- No existing instance was modified (all writes to `~` were denied, so this
  was structurally guaranteed).
- No mutation grant was armed; `mutation.json` was only **read**.
- No task was started, resumed, or cancelled.
- No model was switched; `providers.json` was only **read**, with credentials
  redacted.
- No inference was initiated.
- No MCP server was implemented.

## 6. Preserved artifacts

Read but not written:

- `~/.vscodium-clinemm/**` (including `control-seam/*`)
- `~/.vscodium-factory/**`
- `~/.clinemm/**`
- `~/Projects/SPbNIX/clinemm/**` (source, read-only)
- all Factory and ClineMM artifacts in this repository

No secret material was written into this record. The control-seam tokens were
never written to disk, and provider credentials were rendered redacted.
