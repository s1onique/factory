#!/bin/bash
# test_worktree_policy.sh — adversarial tests for the Git worktree
# policy verifier.
#
# Each porcelain-synthesis test feeds the verifier a synthetic payload
# via the environment variable FACTORY_WT_PORCELAIN (which the
# verifier, in test mode, reads instead of invoking `git worktree
# list --porcelain`). The remaining tests exercise read-only
# behaviour, LLM entrypoint coverage, and active-workflow surface.
#
# GWT-T01..T05 use synthetic porcelain payloads.
# GWT-T06..T08 exercise live repository state.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
verifier="${repo_root}/scripts/verify_worktree_policy.sh"

if [ ! -x "${verifier}" ]; then
    echo "FAIL: verifier not executable: ${verifier}"
    exit 1
fi

passes=0
failures=0

run_case() {
    local label="$1"
    local porcelain="$2"
    local expected_disposition="$3"
    local expected_worktree_count="$4"
    local expected_linked="$5"
    local expected_detached="$6"
    local expected_branch="$7"

    output="$(FACTORY_WT_PORCELAIN="${porcelain}" bash "${verifier}")" \
        && rc=0 || rc=$?

    got_disposition="$(echo "${output}" | awk -F= '/FACTORY_GIT_WORKTREE_POLICY_DISPOSITION/ {print $2}')"
    got_linked="$(echo "${output}" | awk -F= '/FACTORY_GIT_WORKTREE_POLICY_LINKED_COUNT/ {print $2}')"
    got_detached="$(echo "${output}" | awk -F= '/FACTORY_GIT_WORKTREE_POLICY_DETACHED_COUNT/ {print $2}')"
    got_worktree_count="$(echo "${output}" | awk -F= '/FACTORY_GIT_WORKTREE_POLICY_WORKTREE_COUNT/ {print $2}')"
    got_branch="$(echo "${output}" | awk -F= '/FACTORY_GIT_WORKTREE_POLICY_BRANCH/ {print $2}')"

    if [ "${expected_disposition}" = "OK" ]; then
        if [ "${rc}" -eq 0 ] \
            && [ "${got_disposition}" = "OK" ] \
            && [ "${got_worktree_count}" = "${expected_worktree_count}" ] \
            && [ "${got_linked}" = "${expected_linked}" ] \
            && [ "${got_detached}" = "${expected_detached}" ] \
            && [ "${got_branch}" = "${expected_branch}" ]; then
            echo "  PASS  ${label}  (wt=${got_worktree_count}, linked=${got_linked}, detached=${got_detached}, branch=${got_branch})"
            passes=$((passes + 1))
        else
            echo "  FAIL  ${label}  rc=${rc} got(wt=${got_worktree_count}, linked=${got_linked}, detached=${got_detached}, branch=${got_branch}, disp=${got_disposition})"
            failures=$((failures + 1))
        fi
    else
        if [ "${rc}" -ne 0 ] \
            && [ "${got_disposition}" = "FAIL" ] \
            && [ "${got_worktree_count}" = "${expected_worktree_count}" ] \
            && [ "${got_linked}" = "${expected_linked}" ] \
            && [ "${got_detached}" = "${expected_detached}" ] \
            && [ "${got_branch}" = "${expected_branch}" ]; then
            echo "  PASS  ${label}  (wt=${got_worktree_count}, linked=${got_linked}, detached=${got_detached}, branch=${got_branch})"
            passes=$((passes + 1))
        else
            echo "  FAIL  ${label}  rc=${rc} got(wt=${got_worktree_count}, linked=${got_linked}, detached=${got_detached}, branch=${got_branch}, disp=${got_disposition})"
            failures=$((failures + 1))
        fi
    fi
}

# GWT-T01 — canonical topology (single main worktree on refs/heads/main).
run_case "GWT-T01 canonical topology" \
    "$(printf 'worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n')" \
    "OK" "1" "0" "0" "refs/heads/main"

# GWT-T02 — detached linked worktree alongside the main one.
# Last parsed record is the detached one (no `branch` line), so
# last_parsed_branch in the evidence is empty.
run_case "GWT-T02 detached linked worktree" \
    "$(printf 'worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n\nworktree /repo-detached\nHEAD bbbb\ndetached\n')" \
    "FAIL" "2" "1" "1" ""

# GWT-T03 — branch-backed linked worktree.
run_case "GWT-T03 branch-backed linked worktree" \
    "$(printf 'worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD cccc\nbranch refs/heads/feature/x\n')" \
    "FAIL" "2" "1" "0" "refs/heads/feature/x"

# GWT-T04 — multiple linked worktrees (2 linked + 1 main).
run_case "GWT-T04 multiple linked worktrees" \
    "$(printf 'worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n\nworktree /repo-detached\nHEAD bbbb\ndetached\n\nworktree /repo-feature\nHEAD cccc\nbranch refs/heads/feature/y\n')" \
    "FAIL" "3" "2" "1" "refs/heads/feature/y"

# GWT-T05 — parser uses porcelain semantics. Extra unknown keys
# (such as `locked` / `prunable`) are accepted without changing the
# classification. Classification depends only on `worktree` / `branch`
# / `detached` keys.
run_case "GWT-T05 extra unknown keys tolerated" \
    "$(printf 'worktree /repo\nHEAD aaaa\nbranch refs/heads/main\nlocked\nprunable gitdir-file\n')" \
    "OK" "1" "0" "0" "refs/heads/main"

# GWT-T09 — sole non-main branch worktree. This is the P1 regression
# test for the canonical-main-branch enforcement: a single worktree
# on a non-main branch MUST be rejected (GWT03).
run_case "GWT-T09 sole non-main branch worktree" \
    "$(printf 'worktree /repo\nHEAD deadbeef\nbranch refs/heads/feature/not-main\n')" \
    "FAIL" "1" "0" "0" "refs/heads/feature/not-main"

# GWT-T06 — verifier is read-only. Run on the live repository and
# verify that Git state and worktree topology are unchanged.
#
# Source of truth for "nothing changed":
#   - `git status --porcelain`          (index + worktree clean?)
#   - `git worktree list --porcelain`   (topology unchanged?)
#   - `git rev-parse HEAD`              (HEAD unchanged,)
#
# We deliberately do NOT use `stat -f` because macOS stat emits
# platform-specific debug lines that vary across runs; that would
# produce a spurious flake. Git's porcelain output is stable and
# sufficient to detect any read-only violation.
echo ""
echo "--- GWT-T06 verifier is read-only ---"
before_wt="$(cd "${repo_root}" && git worktree list --porcelain)"
before_status="$(cd "${repo_root}" && git status --porcelain)"
before_head="$(cd "${repo_root}" && git rev-parse HEAD)"
bash "${verifier}" >/dev/null
after_wt="$(cd "${repo_root}" && git worktree list --porcelain)"
after_status="$(cd "${repo_root}" && git status --porcelain)"
after_head="$(cd "${repo_root}" && git rev-parse HEAD)"

if [ "${before_wt}" = "${after_wt}" ] \
    && [ "${before_status}" = "${after_status}" ] \
    && [ "${before_head}" = "${after_head}" ]; then
    echo "  PASS  GWT-T06 verifier is read-only"
    passes=$((passes + 1))
else
    echo "  FAIL  GWT-T06 verifier is read-only"
    if [ "${before_wt}" != "${after_wt}" ]; then
        echo "    worktree topology changed"
    fi
    if [ "${before_status}" != "${after_status}" ]; then
        echo "    git status changed"
    fi
    if [ "${before_head}" != "${after_head}" ]; then
        echo "    HEAD changed"
    fi
    failures=$((failures + 1))
fi

# GWT-T07 — LLM/coding-agent entrypoint coverage.
#
# Required coverage:
#   - AGENTS.md                            (canonical LLM entrypoint)
#   - .clinerules/00-agents.md             (Cline compatibility shim)
#   - docs/doctrine/README.md              (doctrine index)
#   - docs/doctrine/git-worktree-policy.md (canonical doctrine)
#
# Per-file requirements:
#   - AGENTS.md                  must reference FACTORY_GIT_WORKTREE_POLICY
#   - .clinerules/00-agents.md   must reference AGENTS.md
#                                must NOT restate GWT01..GWT10
#   - docs/doctrine/README.md    must reference FACTORY_GIT_WORKTREE_POLICY
#   - docs/doctrine/git-worktree-policy.md
#                                must reference FACTORY_GIT_WORKTREE_POLICY
#
# AGENTS.md must also NOT restate the GWT0x laws.
echo ""
echo "--- GWT-T07 LLM entrypoint coverage ---"
coverage_fail=0

# AGENTS.md must exist and reference the canonical doctrine name.
if [ -f "${repo_root}/AGENTS.md" ]; then
    if grep -q "FACTORY_GIT_WORKTREE_POLICY" "${repo_root}/AGENTS.md"; then
        echo "  PASS  AGENTS.md references FACTORY_GIT_WORKTREE_POLICY"
    else
        echo "  FAIL  AGENTS.md does NOT reference FACTORY_GIT_WORKTREE_POLICY"
        coverage_fail=1
    fi
else
    echo "  FAIL  AGENTS.md is missing"
    coverage_fail=1
fi

# .clinerules/00-agents.md must exist, reference AGENTS.md, and NOT
# restate the GWT0x laws.
cline_entrypoint="${repo_root}/.clinerules/00-agents.md"
if [ -f "${cline_entrypoint}" ]; then
    if grep -q "AGENTS\.md" "${cline_entrypoint}"; then
        echo "  PASS  .clinerules/00-agents.md references AGENTS.md"
    else
        echo "  FAIL  .clinerules/00-agents.md does NOT reference AGENTS.md"
        coverage_fail=1
    fi
    if ! grep -q "GWT0[1-9]" "${cline_entrypoint}" 2>/dev/null; then
        echo "  PASS  .clinerules/00-agents.md does NOT restate GWT0x laws"
    else
        echo "  FAIL  .clinerules/00-agents.md appears to restate GWT0x laws"
        coverage_fail=1
    fi
else
    echo "  FAIL  .clinerules/00-agents.md is missing"
    coverage_fail=1
fi

# Doctrine-index pointer.
for f in "docs/doctrine/README.md" "docs/doctrine/git-worktree-policy.md"; do
    if [ -f "${repo_root}/${f}" ]; then
        if grep -q "FACTORY_GIT_WORKTREE_POLICY" "${repo_root}/${f}"; then
            echo "  PASS  ${f} references FACTORY_GIT_WORKTREE_POLICY"
        else
            echo "  FAIL  ${f} does NOT reference FACTORY_GIT_WORKTREE_POLICY"
            coverage_fail=1
        fi
    else
        echo "  FAIL  ${f} is missing"
        coverage_fail=1
    fi
done

# AGENTS.md must NOT restate the GWT0x laws (negative check).
if ! grep -q "GWT0[1-9]" "${repo_root}/AGENTS.md" 2>/dev/null; then
    echo "  PASS  AGENTS.md does NOT restate GWT0x laws"
else
    echo "  FAIL  AGENTS.md appears to restate GWT0x laws"
    coverage_fail=1
fi

# Emit the disposition evidence required by the MICROFIX contract.
echo ""
echo "  CLINE_ENTRYPOINT_EXISTS=$( [ -f "${cline_entrypoint}" ] && echo yes || echo no )"
echo "  CLINE_ENTRYPOINT_TARGET=AGENTS.md"
echo "  CLINE_DOCTRINE_DUPLICATION=$( grep -q "GWT0[1-9]" "${cline_entrypoint}" 2>/dev/null && echo yes || echo no )"

if [ "${coverage_fail}" -eq 0 ]; then
    passes=$((passes + 1))
else
    failures=$((failures + 1))
fi

# GWT-T08 — no active Factory automation creates worktrees.
echo ""
echo "--- GWT-T08 active workflow worktree-add guard ---"
# Active surface: scripts/automation tracked and used by Factory
# workflows. We allow the worktree verifier itself to mention
# `git worktree ...` only for list/remove/prune documentation,
# never for `add`. No current automation should ever invoke
# `git worktree add`.
active_surface_scripts="$(
    find "${repo_root}/scripts" "${repo_root}/.github/workflows" \
        -type f \( -name '*.sh' -o -name '*.py' -o -name '*.mjs' -o -name '*.yml' -o -name '*.yaml' \) 2>/dev/null \
    | sort
)"

violations="$(echo "${active_surface_scripts}" | xargs grep -HnE 'git[[:space:]]+worktree[[:space:]]+add' 2>/dev/null || true)"

if [ -z "${violations}" ]; then
    echo "  PASS  no active Factory workflow invokes 'git worktree add'"
    passes=$((passes + 1))
else
    echo "  FAIL  active Factory workflow contains unapproved 'git worktree add':"
    echo "${violations}"
    failures=$((failures + 1))
fi

echo ""
echo "=== test_worktree_policy.sh summary ==="
echo "PASS=${passes}  FAIL=${failures}"

if [ "${failures}" -gt 0 ]; then
    exit 1
fi
exit 0
