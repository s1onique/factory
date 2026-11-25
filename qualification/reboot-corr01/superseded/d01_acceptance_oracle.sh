#!/bin/bash
# d01_acceptance_oracle.sh — SUPERSEDED by
# labs/model-lab/ml_smoke_01_acceptance_oracle.sh
#
# PRESERVED VERBATIM as the artifact that was independently reviewed.
# Do not use this script for any new evaluation: it produces demonstrated
# FALSE PASS results. See
# qualification/reboot-corr01/01-review-findings-reproduced.md.
#
# Known defects (both reproduced by execution on 2026-11-24):
#
#   P0.1  The known-bad mutation replaced only the PREFIX of the REC-TMP01
#         statement, leaving the original arguments behind. The result was a
#         SYNTAX ERROR, not the intended behavioral failure — yet any nonzero
#         mutant exit was accepted as "mutation detected".
#   P0.2  The gate counted every TAP line beginning with "ok " as a pass.
#         Node's TAP reporter emits "ok N - name # SKIP reason" for SKIPPED
#         tests. A fixture whose every test was skipped was accepted as PASS.
#
# Together these produced a demonstrated FALSE PASS.
#
# This file is retained ONLY so that the false PASS can be re-reproduced at
# will. It is not part of the Model Lab.

# d01_acceptance_oracle.sh — evaluator-owned acceptance oracle for the
# Model Lab D01 smoke fixture.
#
# Contract:
#   The oracle NEVER trusts the candidate. It owns the base snapshot, the
#   mutation control, the scope rules, and the pass/fail verdict.
#
#   Usage:
#     bash labs/model-lab/d01_acceptance_oracle.sh <repo_root> <base_commit> <workspace>
#
#   <workspace> is a materialized, candidate-visible fixture (a plain
#   directory tree extracted from <base_commit>). The oracle compares it
#   against <base_commit> using the canonical repository's object store,
#   so the workspace needs no .git directory of its own.
#
#   The workspace MUST be freshly materialized and free of ambient state
#   (see the `.tmp-home` masking defect recorded in
#   qualification/reboot/02-d01-fixture-qualification.md).
#
# Output contract (deterministic, machine-readable):
#   D01_ORACLE_SCOPE_VIOLATIONS=<n>
#   D01_ORACLE_MUTATION_DETECTED=YES|NO
#   D01_ORACLE_ACCEPTANCE=PASS|FAIL
#   D01_ORACLE_DISPOSITION=PASS|FAIL
#
# Exit code: 0 on PASS, 1 on FAIL.
#
# The oracle is read-only with respect to the canonical repository: it
# never modifies the workspace, the index, or Git topology.

set -uo pipefail

repo_root="${1:-}"
base_commit="${2:-}"
workspace="${3:-}"

if [ -z "${repo_root}" ] || [ -z "${base_commit}" ] || [ -z "${workspace}" ]; then
    echo "usage: d01_acceptance_oracle.sh <repo_root> <base_commit> <workspace>" >&2
    exit 2
fi

if [ ! -d "${workspace}" ]; then
    echo "D01_ORACLE_ERROR=workspace_not_found" >&2
    exit 2
fi

# ---------------------------------------------------------------------------
# Fixed policy.
# ---------------------------------------------------------------------------

# Files the candidate is allowed to modify.
ALLOWED_PATHS="labs/long-horizon-harness/test/recovery/cp-crash.test.ts
labs/long-horizon-harness/test/ledger-writer/ledger-writer-socket-probe.test.ts"

# Known-bad mutation: reintroduces the pre-fix REC-TMP01 seam exactly as it
# appeared in the base snapshot. If the oracle accepts a workspace carrying
# this mutation, the oracle is vacuous and MUST fail closed.
#
# The mutation is applied by rewriting the REC-TMP01 seam STATEMENT, not by
# matching a literal fix string: a valid fix may anchor the seam under
# os.tmpdir(), tmpdir(), or any other always-present parent. Rewriting the
# statement keeps the control valid for every legitimate fix shape.
#
# DEFECT P0.1: this is a PREFIX replacement, so the original arguments remain
# and the result is a syntax error.
MUTATION_ANCHOR='const tmpRoot = await fs.mkdtemp('
MUTATION_BAD='const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));'

# Short TMPDIR keeps the UDS-backed SOCK tests inside the 100-byte Unix
# domain socket path limit. Without it those tests silently SKIP and the
# regression half of the gate never executes.
ORACLE_TMPDIR="/tmp"

errors=0

# ---------------------------------------------------------------------------
# Step 1 — scope enforcement (evaluator-owned).
#
# Compare every tracked path of <base_commit> against the workspace using
# blob hashes. Report added, modified, and deleted paths.
# ---------------------------------------------------------------------------

changed_list="$(mktemp)"
gate_log="$(mktemp)"
mutant_log="$(mktemp)"
mutant_dir=""
trap 'rm -f "${changed_list}" "${gate_log}" "${mutant_log}"; [ -n "${mutant_dir}" ] && rm -rf "${mutant_dir}"' EXIT

while IFS= read -r entry; do
    path="${entry#*	}"
    base_blob="$(git -C "${repo_root}" rev-parse "${base_commit}:${path}" 2>/dev/null || echo MISSING)"
    if [ "${base_blob}" = "MISSING" ]; then
        continue
    fi
    if [ ! -f "${workspace}/${path}" ]; then
        echo "DELETED ${path}" >> "${changed_list}"
        continue
    fi
    work_blob="$(git -C "${repo_root}" hash-object -- "${workspace}/${path}" 2>/dev/null || echo MISSING)"
    if [ "${work_blob}" != "${base_blob}" ]; then
        echo "MODIFIED ${path}" >> "${changed_list}"
    fi
done < <(git -C "${repo_root}" ls-tree -r "${base_commit}")

# Files present in the workspace but absent from the base snapshot.
while IFS= read -r path; do
    if git -C "${repo_root}" cat-file -e "${base_commit}:${path}" 2>/dev/null; then
        continue
    fi
    case "${path}" in
        node_modules/*|*/node_modules/*) continue ;;
    esac
    echo "ADDED ${path}" >> "${changed_list}"
done < <(cd "${workspace}" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)

scope_violations=0
while IFS= read -r line; do
    [ -z "${line}" ] && continue
    kind="${line%% *}"
    path="${line#* }"
    allowed=0
    while IFS= read -r ap; do
        [ -z "${ap}" ] && continue
        if [ "${path}" = "${ap}" ]; then allowed=1; break; fi
    done <<< "${ALLOWED_PATHS}"
    if [ "${allowed}" -eq 0 ]; then
        echo "SCOPE_VIOLATION ${kind} ${path}"
        scope_violations=$((scope_violations + 1))
    fi
done < "${changed_list}"

echo "D01_ORACLE_SCOPE_VIOLATIONS=${scope_violations}"

# ---------------------------------------------------------------------------
# Step 2 — acceptance gate execution (evaluator-owned).
#
# The gate runs in a sanitized environment: ambient `.tmp-home` state is
# removed so the REC-TMP01 defect cannot be masked, and TMPDIR is pinned
# short so the SOCK tests actually execute instead of skipping.
# ---------------------------------------------------------------------------

run_gate() {
    # $1 = directory to run the gate in
    local dir="$1"
    rm -rf "${dir}/labs/long-horizon-harness/.tmp-home" 2>/dev/null || true
    (
        cd "${dir}/labs/long-horizon-harness" || exit 2
        TMPDIR="${ORACLE_TMPDIR}" timeout 600 node --import tsx --test --test-reporter=tap \
            test/recovery/cp-crash.test.ts \
            test/ledger-writer/ledger-writer-socket-probe.test.ts
    )
}

run_gate "${workspace}" > "${gate_log}" 2>&1
gate_exit=$?

# DEFECT P0.2: every "ok " line counts as a pass, including "# SKIP" lines.
gate_pass="$(grep -a -c '^ok ' "${gate_log}" || true)"
gate_fail="$(grep -a -c '^not ok ' "${gate_log}" || true)"

echo "D01_ORACLE_GATE_EXIT=${gate_exit}"
echo "D01_ORACLE_GATE_PASSED=${gate_pass}"
echo "D01_ORACLE_GATE_FAILED=${gate_fail}"

acceptance="FAIL"
if [ "${gate_exit}" -eq 0 ] && [ "${gate_fail}" -eq 0 ] && [ "${gate_pass}" -gt 0 ]; then
    acceptance="PASS"
fi
echo "D01_ORACLE_ACCEPTANCE=${acceptance}"

# ---------------------------------------------------------------------------
# Step 3 — mutation control (known-bad mutation MUST fail).
#
# The oracle applies the known-bad REC-TMP01 seam to a throwaway copy of
# the workspace and re-runs the gate. A PASS there means the oracle cannot
# distinguish a real fix from a no-op, which is itself a failure.
# ---------------------------------------------------------------------------

mutation_detected="NO"
mutant_dir="$(mktemp -d)"
if cp -R "${workspace}/." "${mutant_dir}/" 2>/dev/null; then
    target="${mutant_dir}/labs/long-horizon-harness/test/recovery/cp-crash.test.ts"
    if [ -f "${target}" ]; then
        if python3 - "${target}" "${MUTATION_ANCHOR}" "${MUTATION_BAD}" <<'PYEOF'
import sys
path, anchor, bad = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as fh:
    text = fh.read()
if anchor not in text:
    sys.exit(3)
with open(path, "w", encoding="utf-8") as fh:
    fh.write(text.replace(anchor, bad, 1))
PYEOF
        then
            run_gate "${mutant_dir}" > "${mutant_log}" 2>&1
            mutant_exit=$?
            mutant_fail="$(grep -a -c '^not ok ' "${mutant_log}" || true)"
            # DEFECT P0.1: ANY nonzero exit counts as detection, including a
            # parse error that prevents the test from running at all.
            if [ "${mutant_exit}" -ne 0 ] || [ "${mutant_fail}" -gt 0 ]; then
                mutation_detected="YES"
            fi
        else
            echo "D01_ORACLE_MUTATION_NOTE=known_bad_seam_absent_mutation_not_applied"
        fi
    fi
else
    echo "D01_ORACLE_MUTATION_NOTE=mutant_copy_failed"
fi

echo "D01_ORACLE_MUTATION_DETECTED=${mutation_detected}"

# ---------------------------------------------------------------------------
# Verdict — fail closed.
# ---------------------------------------------------------------------------

disposition="PASS"
if [ "${scope_violations}" -ne 0 ]; then
    disposition="FAIL"
    errors=$((errors + 1))
fi
if [ "${acceptance}" != "PASS" ]; then
    disposition="FAIL"
    errors=$((errors + 1))
fi
if [ "${mutation_detected}" != "YES" ]; then
    disposition="FAIL"
    errors=$((errors + 1))
fi

echo "D01_ORACLE_DISPOSITION=${disposition}"

if [ "${disposition}" = "PASS" ]; then
    exit 0
fi
exit 1
