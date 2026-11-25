# REBOOT-CORR02 — MCP Client Configuration Fragment

> The MCP server was verified live against `codium-lab`. **Registering it in
> the MCP client** requires a write to the client's durable configuration,
> which the sandbox denies. This document supplies the exact minimal
> fragment and the exact operator command.
>
> **No raw credential appears here.** The proxy reads the credentials from
> the instance's own private files at runtime.

---

## 1. Why a write is required

The MCP client (`codium-factory`) reads its server registry from:

```text
~/.vscodium-factory/cline-data/settings/cline_mcp_settings.json
```

The current content is:

```json
{
  "mcpServers": {}
}
```

The path is resolved by the ClineMM SDK as
`<clineDataDir>/settings/cline_mcp_settings.json`
(`apps/vscode/src/sdk/legacy-state-reader.ts:49`,
`apps/vscode/src/core/storage/disk.ts:22`).

The sandbox denies writes outside the repository tree and `/tmp`:

```text
$ cp /tmp/probe-mcp.json ~/.vscodium-factory/cline-data/settings/.factory-write-probe.json
cp: cannot create regular file '.../.factory-write-probe.json': Operation not permitted
```

The sandbox was **not** bypassed. No `--allow-write` flag was used, and no
host-level privilege was escalated.

## 2. The exact minimal configuration fragment

Merge this under the top-level `mcpServers` object of
`~/.vscodium-factory/cline-data/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "factory-lab": {
      "command": "/opt/homebrew/bin/bun",
      "args": [
        "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts"
      ],
      "env": {
        "CLINE_DATA_DIR": "/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data"
      }
    }
  }
}
```

### Why each part is there

| Field | Value | Why |
| --- | --- | --- |
| `mcpServers.factory-lab` | the intended registration name | the ACT fixes this name |
| `command` | `/opt/homebrew/bin/bun` | the proxy is a TypeScript entry point run from source; `bun` executes it directly. `bun` is not on the default `PATH` on this host, so the absolute path is used. |
| `args[0]` | the proxy entry point | `control-seam-proxy-main.ts` is the process entry point. It contains no logging: the MCP stdio transport owns stdout, and a stray write would corrupt the protocol stream. |
| `env.CLINE_DATA_DIR` | the lab's data directory | **this is what restricts the proxy to `codium-lab`.** `resolveControlSeamDataDir()` prefers an explicit `CLINE_DATA_DIR`; the socket and token paths are derived from it. Point it at `codium-factory` or `codium-clinemm` and the proxy would talk to that instance instead. |

### The complete file, after the merge

```json
{
  "mcpServers": {
    "factory-lab": {
      "command": "/opt/homebrew/bin/bun",
      "args": [
        "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts"
      ],
      "env": {
        "CLINE_DATA_DIR": "/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data"
      }
    }
  }
}
```

## 3. The exact operator command

Run **outside** the sandbox:

```bash
cat > ~/.vscodium-factory/cline-data/settings/cline_mcp_settings.json <<'JSON'
{
  "mcpServers": {
    "factory-lab": {
      "command": "/opt/homebrew/bin/bun",
      "args": [
        "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts"
      ],
      "env": {
        "CLINE_DATA_DIR": "/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data"
      }
    }
  }
}
JSON

chmod 600 ~/.vscodium-factory/cline-data/settings/cline_mcp_settings.json
```

Then reload the `codium-factory` window so the extension re-reads the
registry.

## 4. What is deliberately NOT in the fragment

- **No token.** The proxy reads the bearer token from
  `~/.vscodium-lab/cline-data/control-seam/token` at runtime. Embedding it
  would put a live credential in a durable configuration file.
- **No write token.** The proxy reads the separate write credential from
  `write-token` in the same directory, and only when that file exists. The
  operator has enabled the mutation grant on `codium-lab`; that is the
  operator's configuration and it is left alone.
- **No registration inside `codium-lab`.** The supervisory server is a
  **local client-side process**. Registering it in the lab itself would
  make the lab supervise itself, which is not the design and was not done.

## 5. Pinning the proxy's identity

The proxy is a source entry point, so it is pinned by content hash. Record
these in the receipt:

```bash
shasum -a 256 \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-proxy.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-client.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-protocol.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-paths.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-server.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-ownership.ts \
  ~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/control-seam-enablement.ts
```

## 6. After registration

The MCP client will expose the six tools the proxy advertises. The read-only
ones (`clinemm_capabilities`, `clinemm_get_run`) are the ones the Model Lab
runner may use. The mutating ones are advertised because the operator
enabled the grant; **the runner does not call them.**

`MCP_CLIENT_CONFIGURED` remains `BLOCKED` until the operator runs §3.
