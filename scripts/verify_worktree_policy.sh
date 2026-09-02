#!/bin/bash
# verify_worktree_policy.sh
#
# Mechanical enforcement of FACTORY_GIT_WORKTREE_POLICY.
#
# Contract:
#   git worktree list --porcelain  MUST describe exactly one worktree,
#   and that worktree MUST be the main repository working tree.
#
# Detection (any one of these => FAIL):
#   - linked worktree exists (more than one worktree entry)
#   - detached linked worktree exists (worktree entry with no `branch`)
#   - multiple branch-backed worktrees exist
#
# Output contract (deterministic, machine-readable):
#   FACTORY_GIT_WORKTREE_POLICY_MAIN_COUNT=<n>
#   FACTORY_GIT_WORKTREE_POLICY_LINKED_COUNT=<n>
#   FACTORY_GIT_WORKTREE_POLICY_DETACHED_COUNT=<n>
#   FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK|FAIL
#
# Exit code: 0 on OK, 1 on FAIL.
#
# The verifier is read-only: it never modifies files, the index, or
# Git topology.

set -euo pipefail

# Determine the main worktree directory without depending on human-
# facing display prose.
main_dir="$(git rev-parse --show-toplevel)"

# Use the machine-readable porcelain surface.
# Test mode: when FACTORY_WT_PORCELAIN is set in the environment, the
# verifier parses that synthetic payload instead of calling `git`. This
# is the only way the adversarial tests can drive the parser without
# modifying Git topology. It is not used by any production path.
if [ -n "${FACTORY_WT_PORCELAIN:-}" ]; then
    porcelain="${FACTORY_WT_PORCELAIN}"
else
    porcelain="$(git worktree list --porcelain)"
fi

# Parse records. Porcelain format is a sequence of blank-line-separated
# records. The first record is the main worktree; each record begins
# with `worktree <path>`.
worktree_count=0
detached_count=0
last_parsed_path=""

# Walk line-by-line and group into records.
current_kind=""
current_path=""

flush_record() {
    if [ -n "${current_path}" ]; then
        worktree_count=$((worktree_count + 1))
        last_parsed_path="${current_path}"
        if [ "${current_kind}" = "detached" ]; then
            detached_count=$((detached_count + 1))
        fi
    fi
    current_kind=""
    current_path=""
}

while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
        "")
            flush_record
            ;;
        "worktree "*)
            # Finish any prior record before starting a new one.
            flush_record
            current_path="${line#worktree }"
            current_kind="detached"   # default; corrected if a branch line appears
            ;;
        "HEAD "*)
            # HEAD line is informational only.
            ;;
        "branch "*)
            current_kind="branch"
            ;;
        "detached")
            current_kind="detached"
            ;;
        *)
            # Future-proofing: ignore unknown keys silently.
            ;;
    esac
done <<EOF
${porcelain}
EOF

# Final flush: the last record may not be terminated by a blank line.
flush_record

linked_count=$((worktree_count - 1))

# Emit the machine-readable evidence.
echo "FACTORY_GIT_WORKTREE_POLICY_MAIN_COUNT=${worktree_count}"
echo "FACTORY_GIT_WORKTREE_POLICY_LINKED_COUNT=${linked_count}"
echo "FACTORY_GIT_WORKTREE_POLICY_DETACHED_COUNT=${detached_count}"

# Fail-closed classification.
if [ "${worktree_count}" -ne 1 ] || [ "${linked_count}" -ne 0 ] || [ "${detached_count}" -ne 0 ]; then
    echo "FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=FAIL"
    exit 1
fi

# Sanity: the single remaining worktree must actually be the main
# worktree. The porcelain ordering guarantees record 1 is the main
# worktree, and we already require exactly one record, so this passes
# by construction. We still re-validate defensively by comparing the
# parsed path against `git rev-parse --show-toplevel`.
# In test mode (FACTORY_WT_PORCELAIN set), the synthetic payload
# carries a fake path, so we skip the path-equality re-check; only
# the count/class invariants matter for adversarial fixtures.
if [ -z "${FACTORY_WT_PORCELAIN:-}" ]; then
    if [ "${last_parsed_path}" != "${main_dir}" ]; then
        echo "FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=FAIL"
        exit 1
    fi
fi

echo "FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK"
exit 0

