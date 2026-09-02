#!/bin/bash
# verify_worktree_policy.sh
#
# Mechanical enforcement of FACTORY_GIT_WORKTREE_POLICY.
#
# Contract (GWT01..GWT10 — see docs/doctrine/git-worktree-policy.md):
#   `git worktree list --porcelain` MUST describe exactly one worktree,
#   that worktree MUST be the main repository working tree, and it
#   MUST be on branch `refs/heads/main`.
#
# Detection (any one of these => FAIL):
#   - zero or more than one worktree entries exist
#   - any detached worktree exists (including the main one)
#   - the sole worktree is not on branch `refs/heads/main`
#
# Output contract (deterministic, machine-readable):
#   FACTORY_GIT_WORKTREE_POLICY_WORKTREE_COUNT=<n>
#   FACTORY_GIT_WORKTREE_POLICY_LINKED_COUNT=<n>
#   FACTORY_GIT_WORKTREE_POLICY_DETACHED_COUNT=<n>
#   FACTORY_GIT_WORKTREE_POLICY_BRANCH=<refs/heads/main|...>
#   FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK|FAIL
#
# `WORKTREE_COUNT` reports what was *observed* (number of porcelain
# worktree records). Canonicality is derived conjunctively in
# classification and reflected in DISPOSITION, not in the metric name.
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
last_parsed_branch=""

# Walk line-by-line and group into records.
current_kind=""
current_path=""
current_branch=""

flush_record() {
    if [ -n "${current_path}" ]; then
        worktree_count=$((worktree_count + 1))
        last_parsed_path="${current_path}"
        last_parsed_branch="${current_branch}"
        if [ "${current_kind}" = "detached" ]; then
            detached_count=$((detached_count + 1))
        fi
    fi
    current_kind=""
    current_path=""
    current_branch=""
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
            current_branch="${line#branch }"
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
echo "FACTORY_GIT_WORKTREE_POLICY_WORKTREE_COUNT=${worktree_count}"
echo "FACTORY_GIT_WORKTREE_POLICY_LINKED_COUNT=${linked_count}"
echo "FACTORY_GIT_WORKTREE_POLICY_DETACHED_COUNT=${detached_count}"
echo "FACTORY_GIT_WORKTREE_POLICY_BRANCH=${last_parsed_branch}"

# Fail-closed classification: every conjunct must hold.
fail_reason=""
if [ "${worktree_count}" -ne 1 ]; then
    fail_reason="worktree_count=${worktree_count} (expected 1)"
elif [ "${linked_count}" -ne 0 ]; then
    fail_reason="linked_count=${linked_count} (expected 0)"
elif [ "${detached_count}" -ne 0 ]; then
    fail_reason="detached_count=${detached_count} (expected 0)"
elif [ "${last_parsed_branch}" != "refs/heads/main" ]; then
    fail_reason="branch=${last_parsed_branch:-<none>} (expected refs/heads/main)"
elif [ -z "${FACTORY_WT_PORCELAIN:-}" ]; then
    # Sanity: in production mode, the sole remaining worktree must be
    # the actual main worktree (path equality with --show-toplevel).
    # Skipped in test mode because synthetic payloads carry fake paths.
    if [ "${last_parsed_path}" != "${main_dir}" ]; then
        fail_reason="worktree path=${last_parsed_path} != main_dir=${main_dir}"
    fi
fi

if [ -n "${fail_reason}" ]; then
    echo "FACTORY_GIT_WORKTREE_POLICY_FAIL_REASON=${fail_reason}"
    echo "FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=FAIL"
    exit 1
fi

echo "FACTORY_GIT_WORKTREE_POLICY_DISPOSITION=OK"
exit 0
