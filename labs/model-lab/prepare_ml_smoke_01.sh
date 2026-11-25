#!/bin/bash
# prepare_ml_smoke_01.sh — materialize the ML-SMOKE-01 fixture.
#
# ML-SMOKE-01 is derived from LH-07 D01 but contains exactly ONE defect.
#
# The historical D01 base commit (09fc12c) carries TWO independent defects:
#   - REC-TMP01 (cp-crash.test.ts): a fixture-construction failure caused by
#     fs.mkdtemp not creating missing parents.
#   - SOCK06 (ledger-writer-socket-probe.test.ts): a non-portable assertion
#     that the UDS pathname is absent after the helper close boundary.
#
# The historical D01 task prompt asks only for the REC-TMP01 repair and allows
# only cp-crash.test.ts to change. The REBOOT-01 oracle nevertheless required
# BOTH repairs and allowed BOTH files. That mismatch made the first
# experiment unfair: a candidate that followed the prompt perfectly could
# fail the gate for an undisclosed defect.
#
# This script therefore applies a PREPARATION OVERLAY that pre-applies the
# independent SOCK06 correction, leaving REC-TMP01 as the single defect under
# test. The overlay is evaluator-owned and its identity is recorded as part
# of the fixture identity.
#
# Usage:
#   bash labs/model-lab/prepare_ml_smoke_01.sh <repo_root> <base_commit> <out_dir>
#
#   --check-only   verify the INPUTS only, and stop before the fixture is
#                  materialised. The fast regression controls use it,
#                  because the base commit, the historical fix commit and
#                  the fresh-output-directory rule are what they test;
#                  materialising the fixture would cost them a
#                  `git archive` they do not need.
#
# Outputs:
#   <out_dir>/workspace/            the candidate-visible fixture
#   <out_dir>/overlay.patch         the preparation overlay (unified diff)
#   <out_dir>/overlay.sha256        the overlay's SHA-256
#   <out_dir>/fixture.sha256        a digest over the prepared workspace
#   <out_dir>/identity.txt          the recorded fixture identity
#
# The overlay is applied as a PATCH derived from the historical fix commit,
# restricted to the SOCK06 file only. The historical REC-TMP01 fix is NOT
# applied: it must remain reproducible.
#
# FRESH OUTPUT DIRECTORY (corrected in ACT-FACTORY-LIVE-SMOKE-01):
# the previous revision RECYCLED an output directory it had created before,
# deleting its contents and re-materialising the fixture into it. A fresh
# preparation now REQUIRES an output directory that does not exist. A
# collision is REFUSED, never recycled: there is no ownership marker, no
# destructive reuse, and no stale-lock reclamation.

set -euo pipefail

repo_root="${1:-}"
base_commit="${2:-}"
out_dir="${3:-}"
CHECK_ONLY=0
if [ "${4:-}" = "--check-only" ]; then
    CHECK_ONLY=1
fi

if [ -z "${repo_root}" ] || [ -z "${base_commit}" ] || [ -z "${out_dir}" ]; then
    echo "usage: prepare_ml_smoke_01.sh <repo_root> <base_commit> <out_dir> [--check-only]" >&2
    exit 2
fi

SOCK_FILE="labs/long-horizon-harness/test/ledger-writer/ledger-writer-socket-probe.test.ts"
HISTORICAL_FIX="5c51615f80aa7dfaec53ff0918c8688cfecb9a02"

if ! git -C "${repo_root}" cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
    echo "PREPARE_ERROR=invalid_base_commit" >&2
    exit 2
fi
if ! git -C "${repo_root}" cat-file -e "${HISTORICAL_FIX}^{commit}" 2>/dev/null; then
    echo "PREPARE_ERROR=historical_fix_commit_unavailable" >&2
    exit 2
fi

# Every preparation uses a FRESH output directory.
#
# The previous revision REUSED an output directory it had created before,
# deleting its contents and re-materialising the fixture into it. That
# reused a directory that a previous run's evidence, patch or residue
# could still be referenced from, and it made the "is this directory
# mine?" question the only thing standing between a fresh fixture and a
# stale one.
#
# The rule is now simple: the output directory MUST NOT EXIST. A
# collision is REFUSED, not recycled. There is no ownership marker, no
# destructive reuse and no stale-lock reclamation.
#
# ATOMIC CREATION. The previous revision tested for existence and then
# created the directory with a separate `mkdir -p`, so two concurrent
# preparations could both pass the existence test and both write into the
# same directory. The directory is now created with a single `mkdir`
# (which fails if it exists) and the failure is mapped to the same
# refusal. There is no lock and no directory recycling: the atomicity
# comes from `mkdir` itself.

if [ -e "${out_dir}" ]; then
    echo "PREPARE_ERROR=output_directory_already_exists" >&2
    echo "PREPARE_HINT=every preparation uses a fresh output directory; collisions are refused, not recycled" >&2
    exit 2
fi

# ATOMIC FRESH-DIRECTORY CREATION.
#
# `mkdir` (not `mkdir -p`) fails when the path exists, so the existence
# check and the creation are ONE atomic operation. The parent of the
# output directory must already exist; the preparation never creates a
# parent tree it was not asked for.
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
    echo "ML_SMOKE_01_PREPARE_CHECK_ONLY=YES"
    exit 0
fi

# 1. Materialize the base snapshot.
git -C "${repo_root}" archive "${base_commit}" | tar -x -C "${out_dir}/workspace"

# 2. Build the preparation overlay: the SOCK06 correction only.
overlay="${out_dir}/overlay.patch"
git -C "${repo_root}" diff "${base_commit}" "${HISTORICAL_FIX}" -- "${SOCK_FILE}" > "${overlay}"

if [ ! -s "${overlay}" ]; then
    echo "PREPARE_ERROR=empty_overlay" >&2
    exit 2
fi

# 3. Apply the overlay to the workspace.
patch -p1 -s -d "${out_dir}/workspace" < "${overlay}"

# 4. Prove the overlay corrected SOCK06 but NOT REC-TMP01.
#    REC-TMP01 must still carry the pre-fix seam.
if ! grep -q 'fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"))' \
        "${out_dir}/workspace/labs/long-horizon-harness/test/recovery/cp-crash.test.ts"; then
    echo "PREPARE_ERROR=rec_tmp01_not_left_intact" >&2
    exit 2
fi
#    The SOCK06 ENOENT assertion must be gone.
if grep -q 'MUST be absent after helper close boundary' "${out_dir}/workspace/${SOCK_FILE}"; then
    echo "PREPARE_ERROR=sock06_not_corrected" >&2
    exit 2
fi

# 5. Record identities.
#
# The fixture digest is computed by the SAME function the oracle uses
# (`ml_smoke_01_lib.mjs`), so the reference identity can never drift from
# the oracle's view of the reference.
( cd "${out_dir}" && shasum -a 256 overlay.patch | awk '{print $1}' > overlay.sha256 )
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

# 6. Trusted dependencies are NOT part of the fixture.
#
#    The dependency tree is evaluator-owned and is supplied INDEPENDENTLY by
#    the evaluator when it reconstructs the tree it runs the gate in. It is
#    never copied from the candidate, and it is never part of the reference
#    tree: a reference that contained a dependency tree could not be
#    compared against a candidate that legitimately has none.

{
    echo "ML_SMOKE_01_BASE_COMMIT=${base_commit}"
    echo "ML_SMOKE_01_OVERLAY_SOURCE=${HISTORICAL_FIX}"
    echo "ML_SMOKE_01_OVERLAY_SCOPE=${SOCK_FILE}"
    echo "ML_SMOKE_01_OVERLAY_SHA256=$(cat "${out_dir}/overlay.sha256")"
    echo "ML_SMOKE_01_FIXTURE_SHA256=$(cat "${out_dir}/fixture.sha256")"
    echo "ML_SMOKE_01_SINGLE_DEFECT=REC-TMP01"
    echo "ML_SMOKE_01_ALLOWED_PATH=labs/long-horizon-harness/test/recovery/cp-crash.test.ts"
} > "${out_dir}/identity.txt"

echo "ML_SMOKE_01_PREPARED=YES"
cat "${out_dir}/identity.txt"
