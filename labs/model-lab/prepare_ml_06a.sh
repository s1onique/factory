#!/bin/bash
# prepare_ml_06a.sh — materialize the ML-06A fixture.
#
# ML-06A is the FIRST SOLUTION-BLIND PRODUCTION-CODE fixture of the Model
# Lab. The candidate edits PRODUCTION source; the evaluator owns an
# immutable acceptance test that never enters the candidate's authority.
#
# The defect
# ----------
# `labs/long-horizon-harness/src/subject/subject-json.ts` implements
# `validateJsonValue(value, path)`. The known-bad revision (`0bd72f4`)
# implemented its cycle guard with a single `WeakSet` that recorded
# EVERY object ever visited, rather than the objects on the CURRENT
# recursion path. The consequence is a FALSE REJECTION of a perfectly
# legal manifest whose two branches share the same child object.
#
#   { left: shared, right: shared }   ->  known-bad: ok:false ("cyclic")
#                                      known-good: ok:true
#
# The known-good revision is `5b7508f`.
#
# NO OVERLAY
# ---------
# The base commit already carries the defect, so no preparation overlay is
# applied. The fixture is the base commit's tree, verbatim.
#
# Usage:
#   bash labs/model-lab/prepare_ml_06a.sh <repo_root> <base_commit> <out_dir>
#
# Outputs:
#   <out_dir>/workspace/            the candidate-visible fixture
#   <out_dir>/fixture.sha256        a digest over the prepared workspace
#   <out_dir>/identity.txt          the recorded fixture identity
#
# FRESH OUTPUT DIRECTORY
# ----------------------
# Every preparation requires an output directory that does NOT exist. A
# collision is REFUSED, never recycled. The creation is ATOMIC: a single
# `mkdir`, whose failure IS the refusal. There is no ownership marker, no
# lock, no destructive reuse and no stale-lock reclamation.

set -euo pipefail

repo_root="${1:-}"
base_commit="${2:-}"
out_dir="${3:-}"
CHECK_ONLY=0
if [ "${4:-}" = "--check-only" ]; then
    CHECK_ONLY=1
fi

if [ -z "${repo_root}" ] || [ -z "${base_commit}" ] || [ -z "${out_dir}" ]; then
    echo "usage: prepare_ml_06a.sh <repo_root> <base_commit> <out_dir> [--check-only]" >&2
    exit 2
fi

KNOWN_GOOD_COMMIT="5b7508fa09e6f10b6ec683e94a35758a15f9d827"
ALLOWED_PATH="labs/long-horizon-harness/src/subject/subject-json.ts"

if ! git -C "${repo_root}" cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
    echo "PREPARE_ERROR=invalid_base_commit" >&2
    exit 2
fi
if ! git -C "${repo_root}" cat-file -e "${KNOWN_GOOD_COMMIT}^{commit}" 2>/dev/null; then
    echo "PREPARE_ERROR=known_good_commit_unavailable" >&2
    exit 2
fi

# ATOMIC FRESH-DIRECTORY CREATION.
#
# `mkdir` (not `mkdir -p`) fails when the path exists, so the existence
# check and the creation are ONE atomic operation. The parent of the
# output directory must already exist.
if [ -e "${out_dir}" ]; then
    echo "PREPARE_ERROR=output_directory_already_exists" >&2
    echo "PREPARE_HINT=every preparation uses a fresh output directory; collisions are refused, not recycled" >&2
    exit 2
fi
if ! mkdir "${out_dir}" 2>/dev/null; then
    if [ -e "${out_dir}" ]; then
        echo "PREPARE_ERROR=output_directory_already_exists" >&2
        echo "PREPARE_HINT=every preparation uses a fresh output directory; collisions are refused, not recycled" >&2
    else
        echo "PREPARE_ERROR=output_directory_not_creatable" >&2
    fi
    exit 2
fi

if ! mkdir "${out_dir}/workspace"; then
    echo "PREPARE_ERROR=workspace_directory_not_creatable" >&2
    exit 2
fi

if [ "${CHECK_ONLY}" -eq 1 ]; then
    echo "ML_06A_PREPARE_CHECK_ONLY=YES"
    exit 0
fi

# 1. Materialize the base snapshot. NO overlay is applied.
git -C "${repo_root}" archive "${base_commit}" | tar -x -C "${out_dir}/workspace"

# 2. Prove the fixture carries the DEFECT under test.
#
# The known-bad revision records EVERY visited object in a single set, so
# a shared child is reported as a cycle. The defect is proven by the
# evaluator's own acceptance test, not by a text match: the text match
# below only proves the fixture was materialized at all.
if [ ! -f "${out_dir}/workspace/${ALLOWED_PATH}" ]; then
    echo "PREPARE_ERROR=allowed_path_absent_from_fixture" >&2
    exit 2
fi

# 3. Record identities.
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
    echo "PREPARE_ERROR=node_runtime_unavailable" >&2
    exit 2
fi
fixture_sha256="$("${NODE_BIN}" "$(cd "$(dirname "$0")" && pwd)/ml_smoke_01_tool.mjs" digest "${out_dir}/workspace")"
if [ -z "${fixture_sha256}" ]; then
    echo "PREPARE_ERROR=fixture_digest_uncomputable" >&2
    exit 2
fi
printf '%s\n' "${fixture_sha256}" > "${out_dir}/fixture.sha256"

# 4. Trusted dependencies are NOT part of the fixture. The evaluator
#    supplies its own tree.

{
    echo "ML_06A_BASE_COMMIT=${base_commit}"
    echo "ML_06A_KNOWN_GOOD_COMMIT=${KNOWN_GOOD_COMMIT}"
    echo "ML_06A_OVERLAY=none"
    echo "ML_06A_FIXTURE_SHA256=${fixture_sha256}"
    echo "ML_06A_SINGLE_DEFECT=path_cycle_guard_confuses_shared_substructure_with_a_cycle"
    echo "ML_06A_ALLOWED_PATH=${ALLOWED_PATH}"
} > "${out_dir}/identity.txt"

echo "ML_06A_PREPARED=YES"
cat "${out_dir}/identity.txt"
