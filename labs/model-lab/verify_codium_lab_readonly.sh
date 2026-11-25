#!/bin/bash
# verify_codium_lab_readonly.sh — READ-ONLY verification of the dedicated
# `codium-lab` instance and its native control seam.
#
# This script is READ-ONLY. It:
#   - inspects the instance's directories, modes and identities;
#   - performs an AUTHENTICATED capabilities probe and a get_run probe;
#   - exercises the EXISTING ClineMM MCP supervision proxy over stdio
#     against THIS instance only;
#   - records which MCP tool names the proxy advertises.
#
# It does NOT:
#   - start a task, send feedback, or cancel anything;
#   - write to, disable, or reconfigure the instance;
#   - probe or mutate any other instance;
#   - register an MCP server inside codium-lab.
#
# Credentials are recorded by PRESENCE ONLY. No token value is ever printed
# or written.
#
# Usage:
#   bash labs/model-lab/verify_codium_lab_readonly.sh [instance_dir]
#
#   instance_dir defaults to $HOME/.vscodium-lab
#
# Exit: 0 when every read-only check passes, 1 otherwise.

set -uo pipefail

INSTANCE_DIR="${1:-${HOME}/.vscodium-lab}"
INSTANCE_NAME="$(basename "${INSTANCE_DIR}")"
SEAM="${INSTANCE_DIR}/cline-data/control-seam"
CLINEMM_REPO="${CLINEMM_REPO:-${HOME}/Projects/SPbNIX/clinemm}"
PROXY_MAIN="${CLINEMM_REPO}/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts"

NODE_BIN="${NODE_BIN:-}"
if [ -z "${NODE_BIN}" ]; then
    for candidate_node in /opt/homebrew/bin/node "$(command -v node 2>/dev/null || true)"; do
        if [ -n "${candidate_node}" ] && [ -x "${candidate_node}" ]; then
            NODE_BIN="${candidate_node}"
            break
        fi
    done
fi
BUN_BIN="${BUN_BIN:-}"
if [ -z "${BUN_BIN}" ]; then
    for candidate_bun in /opt/homebrew/bin/bun "$(command -v bun 2>/dev/null || true)"; do
        if [ -n "${candidate_bun}" ] && [ -x "${candidate_bun}" ]; then
            BUN_BIN="${candidate_bun}"
            break
        fi
    done
fi

PASS_COUNT=0
FAIL_COUNT=0
ok()  { PASS_COUNT=$((PASS_COUNT + 1)); echo "  [PASS] $1"; }
bad() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "  [FAIL] $1"; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "=== codium-lab read-only verification (${INSTANCE_NAME}) ==="
echo ""

# ---------------------------------------------------------------------------
# 1. Distinct directories.
# ---------------------------------------------------------------------------

echo "--- 1 distinct instance directories ---"
for sub in user-data extensions cline-data workspaces; do
    if [ -d "${INSTANCE_DIR}/${sub}" ]; then
        ok "distinct ${sub} directory present: ${INSTANCE_DIR}/${sub}"
    else
        bad "distinct ${sub} directory MISSING: ${INSTANCE_DIR}/${sub}"
    fi
done
for other in factory clinemm; do
    other_dir="${HOME}/.vscodium-${other}"
    if [ -d "${other_dir}" ] && [ "${other_dir}" != "${INSTANCE_DIR}" ]; then
        ok "instance directory is distinct from .vscodium-${other}"
    fi
done
echo ""

# ---------------------------------------------------------------------------
# 2. Control-seam artifacts, modes and owner identity.
# ---------------------------------------------------------------------------

echo "--- 2 control-seam artifacts and owner identity ---"
if [ -d "${SEAM}" ]; then
    ok "control-seam directory present: ${SEAM}"
    seam_mode="$(/usr/bin/stat -f '%Lp' "${SEAM}")"
    if [ "${seam_mode}" = "700" ]; then
        ok "control-seam directory mode is 0700"
    else
        bad "control-seam directory mode is ${seam_mode}, expected 700"
    fi
else
    bad "control-seam directory MISSING: ${SEAM}"
fi
for f in control.sock enabled.json mutation.json owner.json token write-token; do
    if [ -e "${SEAM}/${f}" ]; then
        ok "seam artifact present: ${f} (mode $(/usr/bin/stat -f '%Lp' "${SEAM}/${f}" 2>/dev/null || echo '?'))"
    else
        bad "seam artifact MISSING: ${f}"
    fi
done
# Credentials are recorded by presence only. Their VALUES are never printed.
if [ -s "${SEAM}/token" ]; then
    ok "read credential present (value not disclosed)"
else
    bad "read credential absent or empty"
fi
if [ -s "${SEAM}/write-token" ]; then
    ok "write credential present (value not disclosed)"
else
    bad "write credential absent or empty"
fi

if [ -f "${SEAM}/owner.json" ]; then
    owner_instance="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('instanceId',''))" "${SEAM}/owner.json" 2>/dev/null)"
    owner_pid="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('pid',''))" "${SEAM}/owner.json" 2>/dev/null)"
    echo "  owner instanceId=${owner_instance}"
    echo "  owner pid=${owner_pid}"
    owner_cmd="$(ps -ax -o pid=,command= 2>/dev/null | grep -E "^[[:space:]]*${owner_pid}[[:space:]]" | head -1)"
    if [ -n "${owner_pid}" ] && [ -n "${owner_cmd}" ]; then
        ok "the owning extension host process ${owner_pid} is ALIVE"
        owner_cmd="$(printf '%s' "${owner_cmd}" | tr '\n' ' ')"
        case "${owner_cmd}" in
            *"${INSTANCE_DIR}"*)
                ok "the owning process belongs to ${INSTANCE_NAME} (its --user-data-dir matches)"
                ;;
            *)
                bad "the owning process does NOT reference ${INSTANCE_DIR}"
                ;;
        esac
    else
        bad "the owning extension host process ${owner_pid} is NOT alive"
    fi
fi
echo ""


# ---------------------------------------------------------------------------
# 3. Running extension build identity.
# ---------------------------------------------------------------------------

echo "--- 3 running extension build identity ---"
EXT_DIR=""
for candidate in "${INSTANCE_DIR}"/extensions/*clinemm*; do
    if [ -d "${candidate}" ]; then EXT_DIR="${candidate}"; break; fi
done
if [ -n "${EXT_DIR}" ]; then
    ok "installed extension directory: ${EXT_DIR}"
    if [ -f "${EXT_DIR}/build-provenance.json" ]; then
        prov_version="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('extensionVersion',''))" "${EXT_DIR}/build-provenance.json" 2>/dev/null)"
        prov_head="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('sourceHead',''))" "${EXT_DIR}/build-provenance.json" 2>/dev/null)"
        prov_bundle="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('bundledExtensionSha256',''))" "${EXT_DIR}/build-provenance.json" 2>/dev/null)"
        echo "  extensionVersion=${prov_version}"
        echo "  sourceHead=${prov_head}"
        echo "  bundledExtensionSha256=${prov_bundle}"
        actual_bundle="$(shasum -a 256 "${EXT_DIR}/dist/extension.js" 2>/dev/null | awk '{print $1}')"
        if [ "${actual_bundle}" = "${prov_bundle}" ]; then
            ok "the installed bundle matches its recorded provenance digest"
        else
            bad "the installed bundle does NOT match its recorded provenance digest"
        fi
    else
        bad "build-provenance.json MISSING for ${EXT_DIR}"
    fi
else
    bad "no ClineMM extension directory under ${INSTANCE_DIR}/extensions"
fi
echo ""

# ---------------------------------------------------------------------------
# 4. Workspace identity and absence of inherited sessions / active tasks.
# ---------------------------------------------------------------------------

echo "--- 4 workspace identity and task state ---"
WS_DIR="${INSTANCE_DIR}/workspaces"
if [ -d "${WS_DIR}" ] && [ -z "$(ls -A "${WS_DIR}" 2>/dev/null)" ]; then
    ok "no inherited workspace was opened in ${WS_DIR}"
else
    echo "  workspaces dir contents: $(ls -A "${WS_DIR}" 2>/dev/null | tr '\n' ' ')"
    bad "the instance has workspace state that is not an empty dedicated workspace"
fi
SESSIONS_DIR="${INSTANCE_DIR}/cline-data/sessions"
if [ -d "${SESSIONS_DIR}" ] && [ -n "$(ls -A "${SESSIONS_DIR}" 2>/dev/null)" ]; then
    bad "the instance carries inherited session state"
else
    ok "the instance carries no inherited session state"
fi
echo ""


# ---------------------------------------------------------------------------
# 5. Authenticated read-only probe of the NATIVE seam.
# ---------------------------------------------------------------------------

echo "--- 5 authenticated native seam probe (read-only) ---"
if [ -z "${NODE_BIN}" ]; then
    bad "node runtime unavailable — cannot probe the native seam"
else
    cat > "${WORK}/probe.mjs" <<'EOF'
import net from "node:net"
import fs from "node:fs"

const seam = process.argv[2]
const token = fs.readFileSync(`${seam}/token`, "utf8").trim()
const writeTokenPath = `${seam}/write-token`
const writeToken = fs.existsSync(writeTokenPath) ? fs.readFileSync(writeTokenPath, "utf8").trim() : undefined

function request(envelope) {
	return new Promise((resolve) => {
		const socket = net.createConnection(`${seam}/control.sock`)
		let buffer = ""
		socket.on("connect", () => socket.write(`${JSON.stringify(envelope)}\n`))
		socket.on("data", (chunk) => {
			buffer += chunk.toString()
			socket.destroy()
			resolve(buffer.trim())
		})
		socket.on("error", (error) => resolve(`ERROR ${error.message}`))
	})
}

const readOnly = await request({ v: 1, op: "clinemm_capabilities", token })
const withWrite = writeToken
	? await request({ v: 1, op: "clinemm_capabilities", token, writeToken })
	: "NO_WRITE_TOKEN"
const run = await request({ v: 1, op: "clinemm_get_run", token })
fs.writeFileSync(process.argv[3], JSON.stringify({ readOnly, withWrite, run }, null, 2))
EOF
    if "${NODE_BIN}" "${WORK}/probe.mjs" "${SEAM}" "${WORK}/probe.json" 2>"${WORK}/probe.err"; then
        ok "the native seam answered the authenticated capabilities probe"
        python3 - "${WORK}/probe.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
ro = json.loads(d["readOnly"])
ww = json.loads(d["withWrite"]) if d["withWrite"].startswith("{") else None
print("  read-token capabilities: readOnly=%s protocolVersion=%s extensionVersion=%s ops=%d" % (
    ro["result"]["readOnly"], ro["result"]["protocolVersion"],
    ro["result"]["host"]["extensionVersion"], len(ro["result"]["operations"])))
if ww:
    print("  write-token capabilities: readOnly=%s ops=%d" % (
        ww["result"]["readOnly"], len(ww["result"]["operations"])))
print("  get_run: %s" % d["run"])
PYEOF
        if python3 - "${WORK}/probe.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
ro = json.loads(d["readOnly"])
assert ro["ok"] is True
assert ro["result"]["protocolVersion"] == 1
PYEOF
        then
            ok "the read-token capabilities probe succeeded with protocolVersion=1"
        else
            bad "the read-token capabilities probe did not satisfy its invariants"
        fi
        if python3 - "${WORK}/probe.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
ro = json.loads(d["readOnly"])
ww = json.loads(d["withWrite"]) if d["withWrite"].startswith("{") else None
assert ww is not None, "no write token was presented"
assert ww["result"]["readOnly"] is False
assert len(ww["result"]["operations"]) > len(ro["result"]["operations"])
PYEOF
        then
            ok "the mutation grant is ADVERTISED (readOnly=false, widened operation set)"
        else
            bad "the mutation grant is NOT advertised"
        fi
        if python3 - "${WORK}/probe.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
run = json.loads(d["run"])
assert run["ok"] is False
assert run["error"]["code"] == "control_seam_no_active_run"
PYEOF
        then
            ok "no active task is present (get_run reports control_seam_no_active_run)"
        else
            bad "get_run did not report the expected inactive state"
        fi
    else
        bad "the native seam did not answer the probe"
        cat "${WORK}/probe.err" >&2 || true
    fi
fi
echo ""


# ---------------------------------------------------------------------------
# 6. The EXISTING MCP supervision proxy, exercised over stdio.
# ---------------------------------------------------------------------------

echo "--- 6 existing ClineMM MCP supervision proxy (stdio, this instance only) ---"
if [ ! -f "${PROXY_MAIN}" ]; then
    bad "the MCP proxy entry point is MISSING: ${PROXY_MAIN}"
elif [ -z "${BUN_BIN}" ]; then
    bad "bun runtime unavailable — cannot launch the MCP proxy"
else
    ok "the MCP proxy entry point exists: ${PROXY_MAIN}"
    cat > "${WORK}/mcp-client.mjs" <<'EOF'
import { spawn } from "node:child_process"

const [proxyPath, dataDir] = process.argv.slice(2)
const child = spawn(process.env.BUN_BIN, [proxyPath], {
	env: { ...process.env, CLINE_DATA_DIR: dataDir },
	stdio: ["pipe", "pipe", "pipe"],
})

let buffer = ""
const pending = new Map()
child.stdout.on("data", (chunk) => {
	buffer += chunk.toString()
	let index
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index)
		buffer = buffer.slice(index + 1)
		if (!line.trim()) continue
		let message
		try {
			message = JSON.parse(line)
		} catch {
			continue
		}
		if (message.id !== undefined && pending.has(message.id)) {
			pending.get(message.id)(message)
			pending.delete(message.id)
		}
	}
})
child.stderr.on("data", () => {})

let nextId = 0
const send = (method, params) =>
	new Promise((resolve) => {
		const id = ++nextId
		pending.set(id, resolve)
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
	})
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const out = {}
await wait(1500)
out.initialize = await send("initialize", {
	protocolVersion: "2024-11-05",
	capabilities: {},
	clientInfo: { name: "factory-lab-readonly-probe", version: "1" },
})
await wait(800)
await send("notifications/initialized", {})
await wait(300)
const tools = await send("tools/list", {})
await wait(800)
out.tools = (tools.result?.tools ?? []).map((t) => t.name)
const capabilities = await send("tools/call", { name: "clinemm_capabilities", arguments: {} })
await wait(1500)
out.capabilities = capabilities.result?.content?.[0]?.text ?? null
const getRun = await send("tools/call", { name: "clinemm_get_run", arguments: {} })
await wait(1500)
out.getRun = getRun.result?.content?.[0]?.text ?? null
out.getRunIsError = getRun.result?.isError === true
child.kill()
process.stdout.write(JSON.stringify(out))
process.exit(0)
EOF
    BUN_BIN="${BUN_BIN}" "${NODE_BIN}" "${WORK}/mcp-client.mjs" "${PROXY_MAIN}" "${INSTANCE_DIR}/cline-data" > "${WORK}/mcp.json" 2>"${WORK}/mcp.err"
    if [ -s "${WORK}/mcp.json" ]; then
        ok "the MCP proxy answered over stdio"
        python3 - "${WORK}/mcp.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
print("  serverInfo: %s" % json.dumps(d["initialize"]["result"]["serverInfo"]))
print("  advertised tools: %s" % ", ".join(d["tools"]))
cap = json.loads(d["capabilities"])
print("  capabilities: readOnly=%s protocolVersion=%s extensionVersion=%s ops=%s" % (
    cap["readOnly"], cap["protocolVersion"], cap["host"]["extensionVersion"],
    ",".join(op["id"] for op in cap["operations"])))
print("  get_run: %s (isError=%s)" % (d["getRun"], d["getRunIsError"]))
PYEOF
        if python3 - "${WORK}/mcp.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["initialize"]["result"]["serverInfo"]["name"] == "clinemm-control-seam"
assert "clinemm_capabilities" in d["tools"]
assert "clinemm_get_run" in d["tools"]
cap = json.loads(d["capabilities"])
assert cap["protocolVersion"] == 1
assert cap["host"]["extensionVersion"].startswith("4.1.26-821b20e7a"), cap["host"]["extensionVersion"]
assert len(cap["operations"]) == 6, "the write-enabled surface must advertise six operations"
assert cap["readOnly"] is False, "the mutation grant must be advertised"
assert d["getRunIsError"] is True, "get_run must report the inactive state as an error"
PYEOF
        then
            ok "the MCP proxy reached THIS instance (extension identity 4.1.26-821b20e7a, protocolVersion 1, six operations)"
        else
            bad "the MCP proxy's responses did not match this instance's identity"
        fi
    else
        bad "the MCP proxy produced no response over stdio"
        cat "${WORK}/mcp.err" >&2 || true
    fi
fi
echo ""

echo "=== Summary ==="
echo "PASS=${PASS_COUNT}  FAIL=${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -gt 0 ]; then
    exit 1
fi
exit 0