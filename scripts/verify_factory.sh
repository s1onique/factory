#!/bin/bash
# verify_factory.sh — top-level Factory verification gate (ORDINARY level).
#
# Runs every small deterministic verifier that the Factory repository
# exposes, in order. Any verifier returning non-zero makes the gate
# non-zero. The script is read-only: it never modifies files, the
# index, or Git topology.
#
# This gate is the ORDINARY development feedback. It is deliberately FAST:
# the Model Lab step runs the DECISION-LOGIC controls, which use synthetic
# structured events and synthetic trees. It does NOT execute the real
# historical fixture.
#
# The FULL, authoritative gate — which DOES execute the real fixtures — is:
#
#   bash scripts/verify_factory_qualification.sh
#
# It is MANDATORY whenever the oracle's authority changes and before any
# Model Lab candidate result is minted.
#
# Verifiers invoked (each is a small cohesive script):
#   1. scripts/verify_worktree_policy.sh   — FACTORY_GIT_WORKTREE_POLICY
#   2. scripts/check_links.sh              — documentation link sanity
#   3. scripts/verify_lh03_frozen.sh       — LH-03 frozen-contract guard
#                                             (Phase E @ 61b0979 / LH-02 @ 715e639)
#   4. scripts/verify_lh04_frozen.sh       — LH-04 frozen-contract guard
#                                             (fault lab @ d50f6d8)
#   5. scripts/verify_lh05_frozen.sh       — LH-05 frozen-contract guard
#                                             (adversarial lifecycle corpus)
#   6. scripts/verify_lh06_frozen.sh       — LH-06 frozen-contract guard
#                                             (deterministic-soak QUALIFICATION02)
#   7. tests/model_lab/test_ml_smoke_01_lib.mjs
#                                           — Model Lab DECISION-LOGIC
#                                             regression controls
#                                             (failure-identity discipline)
#
# The split from a single step to two levels exists because of a MEASURED
# regression: this gate went from 1.35 s to 225.81 s when the real-fixture
# controls were wired in as one step. The acceptance criteria were not
# weakened to recover the time — the real controls were MOVED to their own
# mandatory qualification level.

set -euo pipefail

# Resolve repository root from the script's own location.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${repo_root}"

errors=0

echo "=== Factory verification gate (ordinary level) ==="
echo ""

echo "--- 1/7 FACTORY_GIT_WORKTREE_POLICY ---"
if bash scripts/verify_worktree_policy.sh; then
    echo "  [OK]  worktree topology is canonical"
else
    echo "  [FAIL]  worktree topology is NOT canonical"
    errors=$((errors + 1))
fi
echo ""

echo "--- 2/7 documentation link sanity ---"
if bash scripts/check_links.sh; then
    echo "  [OK]  documentation links resolve"
else
    echo "  [FAIL]  documentation link check failed"
    errors=$((errors + 1))
fi
echo ""

echo "--- 3/7 LH-03 frozen-contract guard ---"
if bash scripts/verify_lh03_frozen.sh; then
    echo "  [OK]  LH-03 frozen-contract guard (Phase E + LH-02 unchanged)"
else
    echo "  [FAIL]  LH-03 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 4/7 LH-04 frozen-contract guard ---"
if bash scripts/verify_lh04_frozen.sh; then
    echo "  [OK]  LH-04 frozen-contract guard (fault laboratory unchanged)"
else
    echo "  [FAIL]  LH-04 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 5/7 LH-05 frozen-contract guard ---"
if bash scripts/verify_lh05_frozen.sh; then
    echo "  [OK]  LH-05 frozen-contract guard (adversarial lifecycle corpus intact)"
else
    echo "  [FAIL]  LH-05 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 6/7 LH-06 frozen-contract guard ---"
if bash scripts/verify_lh06_frozen.sh; then
    echo "  [OK]  LH-06 frozen-contract guard (deterministic-soak QUALIFICATION02 frozen)"
else
    echo "  [FAIL]  LH-06 frozen-contract guard detected an issue"
    errors=$((errors + 1))
fi
echo ""

echo "--- 7/7 Model Lab decision-logic regression controls ---"
NODE_BIN="${NODE_BIN:-}"
if [ -z "${NODE_BIN}" ]; then
    for candidate_node in /opt/homebrew/bin/node "$(command -v node 2>/dev/null || true)"; do
        if [ -n "${candidate_node}" ] && [ -x "${candidate_node}" ]; then
            NODE_BIN="${candidate_node}"
            break
        fi
    done
fi
if [ -z "${NODE_BIN}" ]; then
    echo "  [FAIL] node runtime unavailable — cannot run the decision-logic controls"
    errors=$((errors + 1))
elif "${NODE_BIN}" tests/model_lab/test_ml_smoke_01_lib.mjs; then
    echo "  [OK]  Model Lab decision-logic regression controls (failure-identity discipline)"
else
    echo "  [FAIL]  Model Lab decision-logic regression controls detected a defect"
    errors=$((errors + 1))
fi
echo ""

echo "=== Factory gate complete ==="
if [ "${errors}" -gt 0 ]; then
    echo "FACTORY_VERIFY_DISPOSITION=FAIL (${errors} verifier(s) failed)"
    exit 1
fi

echo "FACTORY_VERIFY_DISPOSITION=OK"
echo ""
echo "NOTE: this is the ORDINARY gate. The authoritative gate that also"
echo "      executes the real historical fixtures is:"
echo "        bash scripts/verify_factory_qualification.sh"
exit 0
