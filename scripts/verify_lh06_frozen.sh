#!/bin/bash
# verify_lh06_frozen.sh — LH-06 deterministic-soak frozen guard.
#
# Verifies that the LH-06 GREEN freeze record exists, is byte-faithful,
# and that the bound QUALIFICATION02 evidence packet is internally
# consistent and externally re-verifiable.
#
# Run from the Factory repo root.
#
# This script is the single deterministic freeze guard for LH-06. It
# does NOT rely on grep-for-PASS shortcuts: every numeric, semantic,
# and binding invariant is independently recomputed from the on-disk
# bytes. The script also verifies the QUALIFICATION01 RED packet still
# exists, so GREEN_FREEZE_WITHOUT_PRESERVED_RED_HISTORY is impossible.
#
# Per ACT §45 source-size discipline:
#   shell = orchestration
#   TypeScript = structured semantic authority
# JSON-structured checks are delegated to:
#   scripts/verify_lh06_frozen_data.ts
#
# Required checks (per ACT §24..§28):
#   - freeze record exists, schema correct, state == GREEN_FROZEN
#   - subject_commit equals the bound repo_commit in result.substrate
#   - result exists, result SHA matches freeze record
#   - result schema + contract_version + profile + verdict + failure
#   - duration >= 3,600,000 ; epochs >= 500
#   - substrate_complete == true ; all six substrate identifiers non-null
#   - semantic drift == 0 ; fault escape == 0 ; lifecycle drift == 0
#   - predecessor dependency == 0 ; multiple semantics == 0
#   - lifecycle_drift_by_scenario == {}
#   - resource_balance_failures == 0 ; workspace_leaks == 0
#   - heap verdict pass == true ; latency verdict pass == true
#   - frozen_tree.changed == false ; frozen_tree.status.ok == true
#   - semantic_repeatability == true
#   - publication_durability == CRASH_DURABLE
#   - witness exists, schema correct, result_sha256 recomputed & matched,
#     run_id, supervisor_run_id, profile, verdict, durability match
#   - telemetry SHA + bytes + line count three-way agree
#   - QUALIFICATION01 RED packet still present and SHA256SUMS verifies
#   - prior_red_qualification_preserved == true in freeze record

set -u

# Make sure node is on PATH (verifier may be invoked from a
# minimal environment without /opt/homebrew/bin).
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${repo_root}"

# Test-mode hook (used only by the LH06-FREEZE-NEG* corpus):
# if FACTORY_LH06_PACKET_ROOT is set, the evidence-packet paths are
# resolved under that sandbox root instead of the canonical lab path.
# The freeze record path is also resolved under the sandbox.
# RED packet paths are anchored at FACTORY_LH06_RED_ROOT (default
# ${repo_root}) so the RED-history guard can be exercised in tests
# without touching the canonical RED packet on disk.
packet_root="${FACTORY_LH06_PACKET_ROOT:-${repo_root}}"
red_root="${FACTORY_LH06_RED_ROOT:-${repo_root}}"
freeze_root="${packet_root}"

errors=0

echo "=== LH-06 deterministic-soak frozen guard ==="
echo ""

# ---------------------------------------------------------------------------
# Paths (closed-world). The freeze record is at the Factory root
# qualification/ directory; the evidence packet is in the lab.
# ---------------------------------------------------------------------------
freeze_record="${freeze_root}/qualification/lh06-frozen.json"
result_path_rel="labs/long-horizon-harness/qualification/lh06-qualification02/result.json"
witness_path_rel="labs/long-horizon-harness/qualification/lh06-qualification02/result.commit.json"
telemetry_path_rel="labs/long-horizon-harness/qualification/lh06-qualification02/telemetry.jsonl"
sha256sums_rel="labs/long-horizon-harness/qualification/lh06-qualification02/SHA256SUMS"

# Expected canonical SHA-256 of result.json (frozen invariant).
EXPECTED_RESULT_SHA="b55ba6179ef1533b85499c083142604d869549e4fd9b0300b730854a62f6464b"
EXPECTED_TELEMETRY_SHA="fb17967cd3c9375a938937db50447c4a8c2002ed3f5374cfaea8245fbc1538dd"
EXPECTED_TELEMETRY_LINES=31531
EXPECTED_TELEMETRY_BYTES=4357011
EXPECTED_SUBJECT_COMMIT="5d4c9d258446cba1b018ab689433bafe162feefb"
EXPECTED_RUN_ID="9abce4954edbdb34"
EXPECTED_SUPERVISOR_RUN_ID="f7f4b208772caa8b"
EXPECTED_PROFILE="QUALIFICATION"
EXPECTED_VERDICT="PASS_DETERMINISTIC_SOAK"
EXPECTED_DURABILITY="CRASH_DURABLE"
EXPECTED_CONTRACT="lh06.soak.contract.v1"

# ---------------------------------------------------------------------------
# Locate the TS semantic-authority helper.
# ---------------------------------------------------------------------------
tsx_runner=""
for cand in \
  "${repo_root}/node_modules/.bin/tsx" \
  "${repo_root}/labs/long-horizon-harness/node_modules/.bin/tsx"; do
  if [ -x "${cand}" ]; then
    tsx_runner="${cand}"
    break
  fi
done
ts_data="${repo_root}/scripts/verify_lh06_frozen_data.ts"
if [ ! -f "${ts_data}" ]; then
  echo "  [FAIL] missing TS semantic-authority helper: ${ts_data}"
  echo "FACTORY_LH06_VERIFY_DISPOSITION=FAIL"
  exit 1
fi

run_ts() {
  if [ -n "${tsx_runner}" ]; then
    "${tsx_runner}" "${ts_data}" "$@"
  else
    node --import tsx "${ts_data}" "$@"
  fi
}

# ---------------------------------------------------------------------------
# 1. Freeze record must exist.
# ---------------------------------------------------------------------------
if [ ! -f "${freeze_record}" ]; then
  echo "  [FAIL] ${freeze_record} does not exist"
  echo "FACTORY_LH06_VERIFY_DISPOSITION=FAIL"
  exit 1
fi
echo "  [OK]  freeze record ${freeze_record} exists"

# ---------------------------------------------------------------------------
# 2. Freeze record semantic structure (delegated to TS).
# ---------------------------------------------------------------------------
run_ts freeze-record "${freeze_record}" || errors=$((errors + 1))

# ---------------------------------------------------------------------------
# 3. Recompute SHA-256 of result.json, witness, telemetry three-way agree.
# ---------------------------------------------------------------------------
result_abs="${packet_root}/${result_path_rel}"
witness_abs="${packet_root}/${witness_path_rel}"
telemetry_abs="${packet_root}/${telemetry_path_rel}"

if [ ! -f "${result_abs}" ]; then
  echo "  [FAIL] result not found: ${result_path_rel}"
  errors=$((errors + 1))
fi
if [ ! -f "${witness_abs}" ]; then
  echo "  [FAIL] witness not found: ${witness_path_rel}"
  errors=$((errors + 1))
fi
if [ ! -f "${telemetry_abs}" ]; then
  echo "  [FAIL] telemetry not found: ${telemetry_path_rel}"
  errors=$((errors + 1))
fi

actual_result_sha="$(shasum -a 256 "${result_abs}" 2>/dev/null | awk '{print $1}')"
if [ "${actual_result_sha}" = "${EXPECTED_RESULT_SHA}" ]; then
  echo "  [OK]  result.json SHA = ${actual_result_sha}"
else
  echo "  [FAIL] result.json SHA = ${actual_result_sha} (expected ${EXPECTED_RESULT_SHA})"
  errors=$((errors + 1))
fi

# ---------------------------------------------------------------------------
# 4. Result semantic structure (delegated to TS).
# ---------------------------------------------------------------------------
run_ts result-semantic \
  "${result_abs}" "${witness_abs}" \
  "${EXPECTED_RESULT_SHA}" \
  "${EXPECTED_SUBJECT_COMMIT}" \
  "${EXPECTED_CONTRACT}" \
  "${EXPECTED_PROFILE}" \
  "${EXPECTED_VERDICT}" \
  "${EXPECTED_DURABILITY}" || errors=$((errors + 1))

# ---------------------------------------------------------------------------
# 5. Telemetry three-way agreement (delegated to TS).
# ---------------------------------------------------------------------------
run_ts telemetry \
  "${telemetry_abs}" "${result_abs}" \
  "${EXPECTED_TELEMETRY_SHA}" \
  "${EXPECTED_TELEMETRY_BYTES}" \
  "${EXPECTED_TELEMETRY_LINES}" || errors=$((errors + 1))

# ---------------------------------------------------------------------------
# 6. Witness binding (delegated to TS).
# ---------------------------------------------------------------------------
run_ts witness \
  "${witness_abs}" "${result_abs}" \
  "${EXPECTED_RUN_ID}" \
  "${EXPECTED_SUPERVISOR_RUN_ID}" \
  "${EXPECTED_PROFILE}" \
  "${EXPECTED_VERDICT}" \
  "${EXPECTED_DURABILITY}" || errors=$((errors + 1))

# ---------------------------------------------------------------------------
# 7. SHA256SUMS verifies.
# ---------------------------------------------------------------------------
sha256sums_abs="${packet_root}/${sha256sums_rel}"
if [ -f "${sha256sums_abs}" ]; then
  if (cd "$(dirname "${sha256sums_abs}")" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1); then
    echo "  [OK]  SHA256SUMS verifies (all OK)"
  else
    echo "  [FAIL] SHA256SUMS does not verify"
    errors=$((errors + 1))
  fi
else
  echo "  [FAIL] SHA256SUMS missing at ${sha256sums_rel}"
  errors=$((errors + 1))
fi

# ---------------------------------------------------------------------------
# 8. QUALIFICATION01 RED packet still present (RED-history guard).
# ---------------------------------------------------------------------------
red_in_lab="${red_root}/labs/long-horizon-harness/qualification/lh06-red-2026-09-21/worker-result.json"
red_root_sh="${red_root}/qualification/lh06-red-qualification01/SHA256SUMS"
red_root_worker="${red_root}/qualification/lh06-red-qualification01/worker-result.json"

if [ ! -f "${red_in_lab}" ]; then
  echo "  [FAIL] QUALIFICATION01 RED in-lab copy missing: ${red_in_lab}"
  errors=$((errors + 1))
else
  echo "  [OK]  QUALIFICATION01 RED in-lab copy present"
fi
if [ ! -f "${red_root_sh}" ] || [ ! -f "${red_root_worker}" ]; then
  echo "  [FAIL] QUALIFICATION01 RED factory-root copy missing"
  errors=$((errors + 1))
else
  if (cd "${red_root}" && shasum -a 256 -c qualification/lh06-red-qualification01/SHA256SUMS >/dev/null 2>&1); then
    echo "  [OK]  QUALIFICATION01 RED factory-root SHA256SUMS verifies"
  else
    echo "  [FAIL] QUALIFICATION01 RED factory-root SHA256SUMS does not verify"
    errors=$((errors + 1))
  fi
  red_verdict="$(run_ts witness-verdict "${red_root_worker}" 2>/dev/null || echo "")"
  if [ "${red_verdict}" = "FAIL_SEMANTIC_DRIFT" ]; then
    echo "  [OK]  QUALIFICATION01 worker verdict preserved = ${red_verdict}"
  else
    echo "  [FAIL] QUALIFICATION01 worker verdict drifted = ${red_verdict}"
    errors=$((errors + 1))
  fi
fi

echo "  [OK]  RSS observation recorded as non-authoritative (per ACT §14, §37)"

echo ""
if [ "${errors}" -gt 0 ]; then
  echo "  [FAIL]  LH-06 frozen-contract guard detected ${errors} issue(s)"
  echo "FACTORY_LH06_VERIFY_DISPOSITION=FAIL"
  exit 1
fi

echo "  [OK]  LH-06 deterministic-soak frozen-contract guard"
echo "FACTORY_LH06_VERIFY_DISPOSITION=OK"
exit 0
