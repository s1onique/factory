# REBOOT-CORR02 — codium-lab Read-Only Verification

> The operator provisioned and launched `codium-lab` outside the sandbox and
> explicitly enabled the mutation grant and content reading. That
> configuration was **not** disabled, overwritten, or modified.
>
> The verification script is `labs/model-lab/verify_codium_lab_readonly.sh`.
> It is READ-ONLY. It never starts a task, never sends feedback, never
> cancels a task, and never probes another instance.

---

## 1. Instance identity

| Property | Value | Source |
| --- | --- | --- |
| instance directory | `~/.vscodium-lab` | on disk |
| user-data | `~/.vscodium-lab/user-data` | on disk |
| extensions | `~/.vscodium-lab/extensions` | on disk |
| ClineMM data | `~/.vscodium-lab/cline-data` | on disk |
| workspaces | `~/.vscodium-lab/workspaces` (empty) | on disk |
| control seam | `~/.vscodium-lab/cline-data/control-seam/` | on disk |
| control-seam directory mode | `0700` | `/usr/bin/stat` |
| owner instanceId | `46678-0b97780b9d0df191cfa10d4668932285` | `owner.json` |
| owner pid | `46678` | `owner.json` |

The owning process `46678` is alive and its command line carries
`--user-data-dir=/Volumes/UserData/Users/chistyakov/.vscodium-lab/user-data`,
which binds the seam to **this** instance and to no other.

All four instance directories are distinct from `~/.vscodium-factory` and
`~/.vscodium-clinemm`. The instance carries **no inherited session state**
and **no workspace** has been opened in it.

## 2. Running extension identity

| Property | Value |
| --- | --- |
| extension directory | `~/.vscodium-lab/extensions/s1onique.clinemm-4.1.26-821b20e7a` |
| `extensionVersion` | `4.1.26-821b20e7a` |
| `sourceHead` | `821b20e7a68d5481ac535ca7a94ff51db0b72f5f` |
| `bundledExtensionSha256` | `f9c68389ad3a4b5e1e9673b7376a4964904caebba4e55b9cae14c9aaccb4248a` |
| recomputed `dist/extension.js` digest | **identical** |

The installed bundle matches its own recorded provenance digest. The
capabilities probe independently reported `extensionVersion:
4.1.26-821b20e7a`, so the running extension and the installed artifact are
the same build.

## 3. Credentials — presence only

| File | Present | Mode | Value |
| --- | --- | --- | --- |
| `token` | yes | 0600 | **not disclosed** |
| `write-token` | yes | 0600 | **not disclosed** |

No credential value was printed, logged, or written to any evidence file.

## 4. Native seam probes

Read credential:

```text
{"v":1,"ok":true,"result":{"protocolVersion":1,"readOnly":true,
 "host":{"extensionVersion":"4.1.26-821b20e7a","platform":"darwin"},
 "operations":[clinemm_capabilities, clinemm_get_run]}}
```

Write credential:

```text
{"v":1,"ok":true,"result":{"protocolVersion":1,"readOnly":false,
 "host":{"extensionVersion":"4.1.26-821b20e7a","platform":"darwin"},
 "operations":[clinemm_capabilities, clinemm_get_run, clinemm_start_act,
               clinemm_read_events, clinemm_send_feedback, clinemm_cancel_run]}}
```

Task state:

```text
{"v":1,"ok":false,"error":{"code":"control_seam_no_active_run","message":"no active run"}}
```

**A successful capabilities probe with `readOnly=false` does not establish
successful execution of a mutating operation.** No mutating operation was
attempted.

## 5. The existing MCP proxy

The proxy is **source-only** in the ClineMM repository:

```text
~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/
├── control-seam-proxy-main.ts   MCP stdio server entry point
├── control-seam-proxy.ts        McpServer + StdioServerTransport
├── control-seam-client.ts       transport-agnostic NDJSON client
├── control-seam-server.ts       AF_UNIX listener
└── control-seam-paths.ts        path resolution
```

It is **not** in the installed bundle (`grep -c runControlSeamProxy
apps/vscode/dist/extension.js` → `0`). That is the CORR01 observation, and
it remains true. **But the absence of the function name in `dist/extension.js`
does not establish the absence of a separately packaged stdio executable** —
and indeed there is none: the proxy has never been packaged as a separate
artifact. It is a TypeScript entry point that is RUN FROM SOURCE.

### How it is invoked

```bash
CLINE_DATA_DIR=<instance>/cline-data \
bun ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts
```

### How it selects the target instance

Through `CLINE_DATA_DIR`. `resolveControlSeamDataDir()` prefers an explicit
`CLINE_DATA_DIR`, else `CLINE_DIR`, else `~/.cline`. The socket and token
paths are derived from it. **Setting `CLINE_DATA_DIR` to the lab's data
directory is therefore what restricts the proxy to `codium-lab`** — and
nothing else.

### How it acquires credentials

It reads the bearer token from the private `token` file and the SEPARATE
`write-token` file, both next to the socket, mode 0600 inside a 0700
directory. A read call works without the write credential; a write call
without it is refused by the extension host.

### Protocol version

`CONTROL_SEAM_PROTOCOL_VERSION = 1` in the source; the installed extension
answered `protocolVersion: 1`. The proxy and the installed extension are
compatible.

## 6. MCP read-only interaction — EXECUTED

The proxy was launched as a child process over stdio with
`CLINE_DATA_DIR=~/.vscodium-lab/cline-data`, and driven with a real MCP
handshake: `initialize`, `notifications/initialized`, `tools/list`,
`tools/call clinemm_capabilities`, `tools/call clinemm_get_run`.

```text
serverInfo: {"name": "clinemm-control-seam", "version": "1"}
advertised tools: clinemm_capabilities, clinemm_get_run, clinemm_start_act,
                  clinemm_read_events, clinemm_send_feedback, clinemm_cancel_run
capabilities: readOnly=False protocolVersion=1
              extensionVersion=4.1.26-821b20e7a
              ops=clinemm_capabilities,clinemm_get_run,clinemm_start_act,
                  clinemm_read_events,clinemm_send_feedback,clinemm_cancel_run
get_run: control_seam_no_active_run (isError=True)
```

**Provenance.** The responses originate from `codium-lab`:

- the server is the ClineMM supervision proxy, resolved from the ClineMM
  repository;
- the proxy resolved its socket and token through `CLINE_DATA_DIR`, which
  pointed at the lab;
- the reported `extensionVersion` is the lab's own
  `4.1.26-821b20e7a`;
- `~/.vscodium-factory` and `~/.vscodium-clinemm` were **not** probed.

`codium-factory` has no control seam of its own
(`~/.vscodium-factory/cline-data/control-seam/` does not exist), so it could
not have produced these responses.

The supervisory MCP server was **not** registered inside `codium-lab`. It was
launched as a separate local process that talks to the lab over the lab's
own socket.

## 7. MCP client configuration — NOT WRITTEN

Registering the server as `factory-lab` in the MCP client requires writing
to the client's durable configuration. The sandbox denies writes outside the
repository tree and `/tmp`:

```text
$ cp /tmp/probe-mcp.json ~/.vscodium-factory/cline-data/settings/.factory-write-probe.json
cp: cannot create regular file '.../.factory-write-probe.json': Operation not permitted
```

The sandbox was **not** bypassed. The exact minimal configuration fragment
and the operator command are in `04-mcp-client-configuration.md`.

## 8. Dispositions

| Disposition | Value |
| --- | --- |
| `CODIUM_LAB_IDENTITY_VERIFIED` | **YES** |
| `CONTROL_SEAM_READONLY_VERIFIED` | **YES** |
| `CONTROL_SEAM_RW_ADVERTISED` | **YES** |
| `MCP_PROXY_ARTIFACT_AVAILABLE` | **YES** — runnable from source; not packaged into the installed bundle |
| `MCP_PROXY_LIVE_VERIFIED` | **YES** — real MCP handshake against `codium-lab` |
| `MCP_CLIENT_CONFIGURED` | **BLOCKED** — the sandbox denies the write; the fragment is supplied |
| `MUTATION_EXECUTION_VERIFIED` | **NOT_TESTED** — no mutating operation was attempted |
