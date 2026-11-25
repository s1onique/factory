#!/bin/bash
# verify_factory_fast.sh — the ORDINARY Factory development gate.
#
# This is the gate that must stay fast enough to be useful as everyday
# feedback. It runs the checks that are DETERMINISTIC and INEXPENSIVE:
#
#   1. FACTORY_GIT_WORKTREE_POLICY  (git worktree topology)
#   2. documentation link sanity
#   3. LH-03 / LH-04 / LH-05 / LH-06 frozen-contract guards
#   4. Model Lab DECISION-LOGIC regression controls (synthetic structured
#      events and synthetic trees; no fixture execution)
#
# It deliberately does NOT run the real historical fixture. The controls
# that DO execute it live in `scripts/verify_factory_qualification.sh` and
# in `tests/model_lab/test_ml_smoke_01_oracle.sh`.
#
# The split exists because of a measured regression: the single-step gate
# went from 1.35 s to 225.81 s when the Model Lab controls were wired in
# as one step, because each control executes the real harness twice. The
# acceptance criteria were NOT weakened to get the time back — the real
# controls were moved to their own, mandatory qualification level.
#
# Run from the Factory repo root.

set -euo pipefail

errors=0

echo "=== Factory FAST verification gate (ordinary development feedback) ==="
echo ""

echo "--- 1/6 FACTORY_GIT_WORKTREE_POLICY ---"
if bash scripts/verify_worktree_policy.sh; then
    echo "  [OK]  worktree topology is canonical"
else
    echo "  [FAIL] worktree topology is NOT canonical"
    errors=$((errors + 1))
fi
echo ""

echo "--- 2/6 documentation link sanity ---"
if bash scripts/check_links.sh; then
    echo "  [OK]  documentation links resolve"
else
    echo "  [FAIL] documentation links do not resolve"
    errors=$((errors + 1))
fi
echo ""

echo "--- 3/6 LH-03 frozen-contract guard ---"
if bash scripts/verify_lh03_frozen.sh; then
    echo "  [OK]  LH-03 frozen-contract guard (Phase E + LH-02 unchanged)"
else
    echo "  [FAIL] LH-03 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 4/6 LH-04 frozen-contract guard ---"
if bash scripts/verify_lh04_frozen.sh; then
    echo "  [OK]  LH-04 frozen-contract guard (fault laboratory unchanged)"
else
    echo "  [FAIL] LH-04 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 5/6 LH-05 / LH-06 frozen-contract guards ---"
lh05=0
lh06=0
bash scripts/verify_lh05_frozen.sh || lh05=1
bash scripts/verify_lh06_frozen.sh || lh06=1
if [ "${lh05}" -eq 0 ]; then
    echo "  [OK]  LH-05 frozen-contract guard (adversarial lifecycle corpus intact)"
else
    echo "  [FAIL] LH-05 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
if [ "${lh06}" -eq 0 ]; then
    echo "  [OK]  LH-06 frozen-contract guard (deterministic-soak QUALIFICATION02 frozen)"
else
    echo "  [FAIL] LH-06 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 6/6 Model Lab decision-logic regression controls ---"
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

echo "=== Factory FAST gate complete ==="
if [ "${errors}" -gt 0 ]; then
    echo "FACTORY_VERIFY_FAST_DISPOSITION=FAIL (${errors} verifier(s) failed)"
    exit 1
fi
echo "FACTORY_VERIFY_FAST_DISPOSITION=PASS"
exit 0
