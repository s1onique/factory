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

set -euo pipefail

# Resolve repository root from the script's own location.
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${repo_root}"

errors=0

echo "=== Factory authoritative verification gate ==="
echo ""

echo "--- 1/2 FACTORY_GIT_WORKTREE_POLICY ---"
if bash scripts/verify_worktree_policy.sh; then
    echo "  [OK]  worktree topology is canonical"
else
    echo "  [FAIL]  worktree topology is NOT canonical"
    errors=$((errors + 1))
fi
echo ""

echo "--- 2/2 documentation link sanity ---"
if bash scripts/check_links.sh; then
    echo "  [OK]  documentation links resolve"
else
    echo "  [FAIL]  documentation link check failed"
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
