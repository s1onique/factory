#!/bin/bash
# verify_factory.sh — top-level authoritative Factory verification gate.
#
# Runs every small deterministic verifier that the Factory repository
# exposes, in order. Any verifier returning non-zero makes the gate
# non-zero. The script is read-only: it never modifies files, the
# index, or Git topology.
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

set -euo pipefail

# Resolve repository root from the script's own location.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${repo_root}"

errors=0

echo "=== Factory authoritative verification gate ==="
echo ""

echo "--- 1/6 FACTORY_GIT_WORKTREE_POLICY ---"
if bash scripts/verify_worktree_policy.sh; then
    echo "  [OK]  worktree topology is canonical"
else
    echo "  [FAIL]  worktree topology is NOT canonical"
    errors=$((errors + 1))
fi
echo ""

echo "--- 2/6 documentation link sanity ---"
if bash scripts/check_links.sh; then
    echo "  [OK]  documentation links resolve"
else
    echo "  [FAIL]  documentation link check failed"
    errors=$((errors + 1))
fi
echo ""

echo "--- 3/6 LH-03 frozen-contract guard ---"
if bash scripts/verify_lh03_frozen.sh; then
    echo "  [OK]  LH-03 frozen-contract guard (Phase E + LH-02 unchanged)"
else
    echo "  [FAIL]  LH-03 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 4/6 LH-04 frozen-contract guard ---"
if bash scripts/verify_lh04_frozen.sh; then
    echo "  [OK]  LH-04 frozen-contract guard (fault laboratory unchanged)"
else
    echo "  [FAIL]  LH-04 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 5/6 LH-05 frozen-contract guard ---"
if bash scripts/verify_lh05_frozen.sh; then
    echo "  [OK]  LH-05 frozen-contract guard (adversarial lifecycle corpus intact)"
else
    echo "  [FAIL]  LH-05 frozen-contract guard detected a change"
    errors=$((errors + 1))
fi
echo ""

echo "--- 6/6 LH-06 frozen-contract guard ---"
if bash scripts/verify_lh06_frozen.sh; then
    echo "  [OK]  LH-06 frozen-contract guard (deterministic-soak QUALIFICATION02 frozen)"
else
    echo "  [FAIL]  LH-06 frozen-contract guard detected an issue"
    errors=$((errors + 1))
fi
echo ""

echo "=== Factory gate complete ==="
if [ "${errors}" -gt 0 ]; then
    echo "FACTORY_VERIFY_DISPOSITION=FAIL (${errors} verifier(s) failed)"
    exit 1
fi

echo "FACTORY_VERIFY_DISPOSITION=OK"
exit 0
