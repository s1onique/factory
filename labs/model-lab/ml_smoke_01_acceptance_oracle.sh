#!/bin/bash
# ml_smoke_01_acceptance_oracle.sh — evaluator-owned acceptance oracle for
# Model Lab smoke fixture ML-SMOKE-01.
#
# CORRECTION (ACT-FACTORY-REBOOT-CORR02-HAR02). The CORR01 oracle still had
# five authority defects, each reproduced by execution before the fix:
#
#   D1  FAILURE IDENTITY CONTAMINATION. The mutant verdict was decided by
#       searching the WHOLE mutant log for the string "ENOENT". An unrelated
#       test that emitted an ENOENT diagnostic satisfied the rule and the
#       oracle reported DETECTED. The negative evidence is now bound to the
#       EXACT test identity and to the ERROR CODE CHAIN of that test's own
#       failure, read from a structured Node test reporter.
#
#   D2  OPTIONAL REFERENCE. Without a prepared reference the oracle compared
#       the candidate against ITSELF and reported zero scope violations for
#       any unauthorised change. The prepared reference is now REQUIRED and
#       is bound to its recorded fixture identity.
#
#   D3  DEPENDENCY TRUST. Any `node_modules` directory whose path resolved
#       was classified TRUSTED, so a candidate-owned dependency tree was
#       trusted. The dependency tree must now resolve to the EVALUATOR's own
#       tree, and a candidate-created dependency directory is a violation.
#
#   D4  SYMLINK SUBSTITUTION. A protected regular file replaced with a
#       symlink to identical content produced ZERO scope violations.
#       Unsupported object types and unauthorised mode changes are now
#       rejected, and enumeration errors fail closed.
#
#   D5  DESTRUCTIVE OUTPUT REUSE. The fixture preparation recursively
#       deleted the caller-supplied out_dir without establishing ownership.
#       It now refuses a directory it does not own.
#
# The decision logic lives in `ml_smoke_01_lib.mjs` and the structured event
# vocabulary in `ml_smoke_01_test_reporter.mjs`. Both are exercised directly,
# and cheaply, by `tests/model_lab/test_ml_smoke_01_lib.mjs`.
#
# Usage:
#   bash labs/model-lab/ml_smoke_01_acceptance_oracle.sh \
#        <repo_root> <base_commit> <workspace> <prepared_reference_dir>
#
#   <base_commit>            the historical base snapshot (09fc12c...).
#   <workspace>              the candidate-visible fixture directory.
#   <prepared_reference_dir> the EVALUATOR-OWNED prepared reference. It is
#                            REQUIRED. It is bound to the fixture digest
#                            recorded in its `identity.txt`.
#
# The candidate-controlled workspace is NEVER used as the reference, the
# evaluator's dependency tree is NEVER taken from the candidate, and the
# gate runs in a FRESH evaluator reconstruction built from the trusted
# fixture plus the validated allowed patch.
#
# Output contract (deterministic, machine-readable):
#   ML_SMOKE_01_BASE_IDENTITY=VALID|INVALID
#   ML_SMOKE_01_REFERENCE_KIND=PREPARED_DIR
#   ML_SMOKE_01_REFERENCE_IDENTITY=VALID|INVALID
#   ML_SMOKE_01_REFERENCE_DIGEST=<sha256>
#   ML_SMOKE_01_EXPECTED_REFERENCE_DIGEST=<sha256>
#   ML_SMOKE_01_SCOPE_VIOLATIONS=<n>
#   ML_SMOKE_01_DEPENDENCY_TRUST=TRUSTED|UNTRUSTED|ABSENT
#   ML_SMOKE_01_GATE_PASSED=<n>
#   ML_SMOKE_01_GATE_FAILED=<n>
#   ML_SMOKE_01_GATE_SKIPPED=<n>
#   ML_SMOKE_01_GATE_TODO=<n>
#   ML_SMOKE_01_GATE_CANCELLED=<n>
#   ML_SMOKE_01_GATE_UNAVAILABLE=0|1
#   ML_SMOKE_01_REQUIRED_TESTS_PRESENT=YES|NO
#   ML_SMOKE_01_REQUIRED_TESTS_EXECUTED=<n>/<n>
#   ML_SMOKE_01_ACCEPTANCE=PASS|FAIL
#   ML_SMOKE_01_MUTATION_STATUS=DETECTED|INVALID_MUTATION|WRONG_FAILURE|EXECUTION_FAILURE|MUTATION_SURVIVED|NOT_APPLIED
#   ML_SMOKE_01_MUTATION_DETECTED=YES|NO
#   ML_SMOKE_01_DISPOSITION=PASS|FAIL|HALT
#
# Exit code: 0 on PASS, 1 on FAIL, 2 on HALT.

set -uo pipefail

repo_root="${1:-}"
base_commit="${2:-}"
workspace="${3:-}"
prepared_dir="${4:-}"

if [ -z "${repo_root}" ] || [ -z "${base_commit}" ] || [ -z "${workspace}" ]; then
    echo "usage: ml_smoke_01_acceptance_oracle.sh <repo_root> <base_commit> <workspace> <prepared_reference_dir> [expected_reference_digest]" >&2
    exit 2
fi

# Every path the oracle uses is resolved to an ABSOLUTE path BEFORE it is
# used. The gate runs in a reconstruction under a different working
# directory, so a RELATIVE evaluator dependency path would resolve
# against the reconstruction instead of against the repository, and the
# gate would fail to load its test files for a reason that has nothing
# to do with the candidate.
repo_root="$(cd "${repo_root}" && pwd -P)"
workspace="$(cd "${workspace}" && pwd -P)"

if [ -z "${prepared_dir}" ]; then
    # D2: the prepared reference is REQUIRED. There is no self-comparison
    # fallback: without an independent reference no scope verdict can be
    # trusted.
    echo "ML_SMOKE_01_REFERENCE_IDENTITY=INVALID"
    echo "ML_SMOKE_01_ERROR=prepared_reference_required" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

if [ ! -d "${workspace}" ]; then
    echo "ML_SMOKE_01_ERROR=workspace_not_found" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

if [ -d "${prepared_dir}" ]; then
    prepared_dir="$(cd "${prepared_dir}" && pwd -P)"
fi

if [ ! -d "${prepared_dir}" ]; then
    # D2: the prepared reference is REQUIRED. There is no self-comparison
    # fallback: without an independent reference no scope verdict can be
    # trusted.
    echo "ML_SMOKE_01_REFERENCE_IDENTITY=INVALID"
    echo "ML_SMOKE_01_ERROR=prepared_reference_required" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="${HERE}/ml_smoke_01_lib.mjs"
TOOL="${HERE}/ml_smoke_01_tool.mjs"
REPORTER="${HERE}/ml_smoke_01_test_reporter.mjs"

if [ ! -f "${LIB}" ] || [ ! -f "${REPORTER}" ] || [ ! -f "${TOOL}" ]; then
    echo "ML_SMOKE_01_ERROR=oracle_components_missing" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

# Node is not on the default PATH on this host. The oracle resolves it
# explicitly and fails closed when it cannot.
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
    echo "ML_SMOKE_01_ERROR=node_runtime_unavailable" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

# ---------------------------------------------------------------------------
# Fixed policy.
# ---------------------------------------------------------------------------

# The single defect under test. One task, one defect, one allowed file.
ALLOWED_PATHS="labs/long-horizon-harness/test/recovery/cp-crash.test.ts"

# The REQUIRED test. It must be present, it must EXECUTE, and it must PASS.
REQUIRED_TEST="REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent"
REGRESSION_TEST="REC-TMP02: tmpDir() returns a unique dir per call"
REQUIRED_TEST_FILE="labs/long-horizon-harness/test/recovery/cp-crash.test.ts"

# The underlying error code the intended failure must carry. The chain is
# read from the failing test's OWN error, never from the whole log.
INTENDED_FAILURE_CODE="ENOENT"

# Short TMPDIR keeps the UDS-backed SOCK tests inside the 100-byte Unix
# domain socket path limit. Without it those tests silently SKIP and the
# regression half of the gate never executes.
ORACLE_TMPDIR="/tmp"

# The evaluator's OWN dependency tree. It is the authority. A candidate
# dependency tree is never consulted for this path.
EVALUATOR_DEPS="${repo_root}/labs/long-horizon-harness/node_modules"
DEPENDENCY_PATH="labs/long-horizon-harness/node_modules"

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

# ---------------------------------------------------------------------------
# Step 0 — base identity. Fail closed on anything unverifiable.
# ---------------------------------------------------------------------------

if ! git -C "${repo_root}" cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
    echo "ML_SMOKE_01_BASE_IDENTITY=INVALID"
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
echo "ML_SMOKE_01_BASE_IDENTITY=VALID"
echo "ML_SMOKE_01_BASE_COMMIT=${base_commit}"
echo "ML_SMOKE_01_REFERENCE_KIND=PREPARED_DIR"

# ---------------------------------------------------------------------------
# Step 1 — reference identity.
#
# The prepared reference is bound to the fixture digest recorded when it was
# prepared. A reference that does not match its own recorded identity is not
# a reference: it is a HALT.
# ---------------------------------------------------------------------------

reference_digest="$("${NODE_BIN}" "${TOOL}" digest "${prepared_dir}" 2>/dev/null | head -1)"
if [ -z "${reference_digest}" ]; then
    echo "ML_SMOKE_01_REFERENCE_IDENTITY=INVALID"
    echo "ML_SMOKE_01_ERROR=reference_digest_uncomputable" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
echo "ML_SMOKE_01_REFERENCE_DIGEST=${reference_digest}"

# The EXPECTED reference digest is supplied BY THE SUPERVISOR, from the
# experiment state it recorded BEFORE the candidate was executed. It is
# NOT read from an adjacent identity file: that file sits next to the
# reference tree, is mutable, and would be authority over itself.
#
# The supervisor passes it as the fifth argument. When it is absent the
# oracle HALTs: without an externally supplied expected digest there is
# no reference authority.
expected_digest="${5:-}"
if [ -z "${expected_digest}" ]; then
    echo "ML_SMOKE_01_REFERENCE_IDENTITY=INVALID"
    echo "ML_SMOKE_01_ERROR=expected_reference_digest_not_supplied" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
echo "ML_SMOKE_01_EXPECTED_REFERENCE_DIGEST=${expected_digest}"
if [ "${reference_digest}" != "${expected_digest}" ]; then
    echo "ML_SMOKE_01_REFERENCE_IDENTITY=INVALID"
    echo "ML_SMOKE_01_ERROR=reference_digest_mismatch" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
echo "ML_SMOKE_01_REFERENCE_IDENTITY=VALID"

# ---------------------------------------------------------------------------
# Step 2 — scope enforcement (evaluator-owned).
#
# The candidate is compared against the evaluator-owned prepared reference.
# Enumeration failures are propagated, not swallowed. Missing reference
# entries, unsupported filesystem object types and unauthorised mode
# changes are recorded as scope violations rather than silently skipped.
# ---------------------------------------------------------------------------

scope_report="$("${NODE_BIN}" "${TOOL}" scope "${prepared_dir}" "${workspace}" "${ALLOWED_PATHS}" 2>/dev/null)"
scope_error="$("${NODE_BIN}" "${TOOL}" scope-error "${scope_report}" 2>/dev/null)"
if [ -n "${scope_error}" ]; then
    echo "ML_SMOKE_01_SCOPE_ERROR=${scope_error}"
    # A self-comparison or an overlapping root is not a scope verdict at
    # all: it is an unusable comparison. It HALTs; it never PASSes.
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
scope_violations="$(printf '%s' "${scope_report}" | "${NODE_BIN}" "${TOOL}" scope-violations 2>/dev/null)"
printf '%s' "${scope_report}" | "${NODE_BIN}" "${TOOL}" scope-lines 2>/dev/null

# ---------------------------------------------------------------------------
# Step 3 — dependency trust.
#
# The dependency tree is evaluator-owned and is NEVER taken from the
# candidate. The gate runs in an evaluator reconstruction that the oracle
# builds itself, and the oracle links the evaluator's OWN tree into it.
#
# Two things must therefore hold:
#
#   1. the workspace must NOT own a dependency tree. If it does, the
#      candidate supplied its own dependencies and they are untrusted;
#   2. the evaluator's own tree must be present and usable.
#
# A workspace that has NO dependency tree at all is CORRECT: the
# dependencies are the evaluator's, and the oracle supplies them.
# ---------------------------------------------------------------------------

dependency_trust="ABSENT"
ws_deps="${workspace}/${DEPENDENCY_PATH}"
eval_deps_real=""
if [ -d "${EVALUATOR_DEPS}" ]; then
    eval_deps_real="$(cd "${EVALUATOR_DEPS}" 2>/dev/null && pwd -P || echo "")"
fi
if [ -e "${ws_deps}" ]; then
    ws_deps_real="$(cd "${ws_deps}" 2>/dev/null && pwd -P || echo "UNRESOLVABLE")"
    if [ "${ws_deps_real}" = "UNRESOLVABLE" ] || [ -z "${ws_deps_real}" ]; then
        dependency_trust="UNTRUSTED"
    elif [ -z "${eval_deps_real}" ] || [ "${ws_deps_real}" != "${eval_deps_real}" ]; then
        # A candidate-owned dependency tree that merely RESOLVES is not
        # trusted. It must be the evaluator's own tree.
        dependency_trust="UNTRUSTED"
    else
        dependency_trust="TRUSTED"
    fi
elif [ -z "${eval_deps_real}" ]; then
    # Neither the workspace nor the evaluator has a dependency tree. The
    # evaluator cannot run the gate at all, so this is untrusted.
    dependency_trust="UNTRUSTED"
else
    # The workspace owns no dependency tree. The evaluator supplies its own.
    dependency_trust="EVALUATOR_SUPPLIED"
fi
echo "ML_SMOKE_01_DEPENDENCY_TRUST=${dependency_trust}"
if [ "${dependency_trust}" = "UNTRUSTED" ]; then
    echo "SCOPE_VIOLATION FORBIDDEN_DEPENDENCY ${DEPENDENCY_PATH}"
    scope_violations=$((scope_violations + 1))
fi
echo "ML_SMOKE_01_SCOPE_VIOLATIONS=${scope_violations}"

# ---------------------------------------------------------------------------
# Step 4 — allowed-region validation.
#
# The candidate may change the fixture-construction seam and add the imports
# it needs. Nothing else in the allowed file may change. This is what keeps
# the original test assertions intact.
# ---------------------------------------------------------------------------

allowed_region="$("${NODE_BIN}" "${TOOL}" validate-allowed "${prepared_dir}/${REQUIRED_TEST_FILE}" "${workspace}/${REQUIRED_TEST_FILE}" 2>/dev/null)"
if [ -z "${allowed_region}" ]; then
    echo "ML_SMOKE_01_ALLOWED_REGION=INVALID"
    echo "ML_SMOKE_01_ERROR=allowed_region_unreadable" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
echo "ML_SMOKE_01_ALLOWED_REGION=$("${NODE_BIN}" "${TOOL}" field "${allowed_region}" ok)"
allowed_region_violation=0
if ! "${NODE_BIN}" "${TOOL}" has "${allowed_region}" ok; then
    echo "ML_SMOKE_01_ALLOWED_REGION_REASON=$("${NODE_BIN}" "${TOOL}" field "${allowed_region}" reason)"
    echo "SCOPE_VIOLATION CONTENT_OUTSIDE_ALLOWED_REGION ${REQUIRED_TEST_FILE}"
    allowed_region_violation=1
fi

# ---------------------------------------------------------------------------
# Step 4b — FAIL-CLOSED ORCHESTRATION.
#
# An UNAUTHORISED candidate patch must be REJECTED BEFORE IT IS EXECUTED.
#
# The previous revision computed the scope verdict and then went on to run
# the gate on the candidate's code anyway. The candidate's own bytes were
# therefore executed even when the candidate had demonstrably exceeded its
# authority — and the executed code could reach the evaluator's own
# reconstruction, its dependency tree and its process, before the verdict
# was computed.
#
# The rejection is now the FIRST thing that happens after the OUT-OF-REGION
# scope verdict is known. Nothing of the candidate's is executed when the
# candidate has touched anything outside the one file it was authorised to
# change.
#
# WHY THE ALLOWED FILE IS NOT IN THIS SET
# ---------------------------------------
# The one allowed file IS the file the fixture is about: the evaluator
# deliberately runs it, and the allowed-region rule is a CONTENT check on
# it, not a statement that its bytes are untrusted. A candidate that
# tampers with the assertions inside it is caught by the allowed-region
# verdict, which is computed from the evaluator's own reference and which
# contributes to the final FAIL. An unauthorised patch — one that changes
# a PROTECTED file, adds a file, changes a mode, or supplies its own
# dependency tree — is rejected here, before any of it is executed.
#
# The rejection is a FAIL (the candidate is unauthorised), never a HALT:
# the oracle's own authorities — base identity, reference identity, scope
# comparison, allowed-region validation — were all established.
# ---------------------------------------------------------------------------

echo "ML_SMOKE_01_SCOPE_VIOLATIONS=${scope_violations}"
echo "ML_SMOKE_01_ALLOWED_REGION_VIOLATION=${allowed_region_violation}"
if [ "${scope_violations}" -ne 0 ]; then
    echo "ML_SMOKE_01_GATE_EXECUTED=NO"
    echo "ML_SMOKE_01_ERROR=unauthorized_patch_rejected_before_execution" >&2
    echo "ML_SMOKE_01_DISPOSITION=FAIL"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 5 — acceptance gate in a FRESH evaluator reconstruction.
#
# The gate does NOT run in the candidate's workspace. It runs in a directory
# the evaluator builds FROM the trusted fixture, with the evaluator's own
# dependency tree and the VALIDATED allowed patch. Candidate-controlled
# dependencies never become evaluator dependencies, and no other candidate
# file can influence the run.
# ---------------------------------------------------------------------------

build_reconstruction() {
    # $1 = destination directory
    local dest="$1"
    rm -rf "${dest}"
    mkdir -p "${dest}" || return 1
    # Copy the trusted fixture. Symlinks are copied as symlinks; the
    # reference itself contains none. macOS extended attributes are not
    # copied: they are ambient state, not fixture content, and the
    # evaluator's sandbox may refuse to read them.
    ( cd "${prepared_dir}" && COPYFILE_DISABLE=1 tar --no-xattrs -cf - . ) | ( cd "${dest}" && COPYFILE_DISABLE=1 tar --no-xattrs -xf - 2>/dev/null ) || return 1
    # Independently supplied dependencies: the evaluator's own tree, as a
    # DISPOSABLE COPY in the evaluator's own reconstruction.
    #
    # The previous revision symlinked the evaluator's dependency tree
    # INTO the reconstruction. That is a candidate-accessible path to
    # evaluator-owned dependencies whenever the reconstruction is
    # reachable, and it makes the dependency tree writable-through. A
    # copy costs a few hundred milliseconds and removes the link.
    #
    # The reconstruction is the EVALUATOR's directory. It is never handed
    # to the candidate, so the copy is not a candidate-owned tree.
    rm -rf "${dest}/labs/long-horizon-harness/node_modules"
    cp -R "${EVALUATOR_DEPS}" "${dest}/labs/long-horizon-harness/node_modules" || return 1
    if [ ! -d "${dest}/labs/long-horizon-harness/node_modules" ]; then
        echo "ML_SMOKE_01_ERROR=evaluator_dependencies_not_supplied" >&2
        return 1
    fi
    return 0
}

apply_allowed_patch() {
    # $1 = destination directory
    #
    # The copy must be VERIFIABLE: the evaluator does not execute a patch
    # it could not read back. The previous revision ignored the copy's
    # status entirely, so a failed copy left the RECONSTRUCTION's own
    # (pristine, known-bad) copy of the file in place, and the gate then
    # ran the TRUSTED FIXTURE instead of the candidate's patch — a verdict
    # about the wrong bytes.
    local dest="$1"
    cp "${workspace}/${REQUIRED_TEST_FILE}" "${dest}/${REQUIRED_TEST_FILE}" || return 1
    if [ ! -s "${dest}/${REQUIRED_TEST_FILE}" ]; then
        echo "ML_SMOKE_01_ERROR=allowed_patch_not_copied" >&2
        return 1
    fi
    return 0
}

run_gate() {
    # $1 = directory to run the gate in
    local dir="$1"
    rm -rf "${dir}/labs/long-horizon-harness/.tmp-home" 2>/dev/null || true
    (
        cd "${dir}/labs/long-horizon-harness" || exit 2
        # The TypeScript loader is named by its ABSOLUTE path inside the
        # evaluator's own dependency tree. Naming it by package name
        # ("tsx") would require the reconstruction to own a resolvable
        # dependency tree, and would make the loader's identity depend on
        # the tree under test.
        TMPDIR="${ORACLE_TMPDIR}" timeout 600 "${NODE_BIN}" \
            --import "${EVALUATOR_DEPS}/tsx/dist/loader.mjs" \
            --test \
            --test-reporter="${REPORTER}" \
            test/recovery/cp-crash.test.ts \
            test/ledger-writer/ledger-writer-socket-probe.test.ts
    )
}

accept_dir="${work_dir}/accept"
if ! build_reconstruction "${accept_dir}"; then
    echo "ML_SMOKE_01_ERROR=evaluator_reconstruction_failed" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
if ! apply_allowed_patch "${accept_dir}"; then
    echo "ML_SMOKE_01_ERROR=allowed_patch_not_applied" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

echo "ML_SMOKE_01_GATE_EXECUTED=YES"
run_gate "${accept_dir}" > "${work_dir}/gate.jsonl" 2> "${work_dir}/gate.err"
gate_exit=$?

classify_gate() {
    # $1 = structured event log path; prints the counts, one per line.
    "${NODE_BIN}" "${TOOL}" classify "$1"
}

echo "ML_SMOKE_01_GATE_EXIT=${gate_exit}"
gate_counts="$(classify_gate "${work_dir}/gate.jsonl")"
for kv in ${gate_counts}; do
    echo "ML_SMOKE_01_GATE_${kv}"
done

# Required tests: present, executed, passing.
acceptance_report="$("${NODE_BIN}" "${TOOL}" accept "${work_dir}/gate.jsonl" "${gate_exit}" "with-sock" 2>/dev/null)"
required_present="$("${NODE_BIN}" "${TOOL}" field "${acceptance_report}" present)"
required_executed="$("${NODE_BIN}" "${TOOL}" field "${acceptance_report}" executed)"
acceptance="$("${NODE_BIN}" "${TOOL}" field "${acceptance_report}" acceptance)"
printf '%s' "${acceptance_report}" | "${NODE_BIN}" "${TOOL}" reasons 2>/dev/null | sed 's/^/ML_SMOKE_01_REQUIRED_/'
echo "ML_SMOKE_01_REQUIRED_TESTS_PRESENT=$( [ "${required_present}" = "true" ] && echo YES || echo NO )"
echo "ML_SMOKE_01_REQUIRED_TESTS_EXECUTED=${required_executed}/11"
echo "ML_SMOKE_01_ACCEPTANCE=${acceptance}"

# ---------------------------------------------------------------------------
# Step 6 — mutation control with FAILURE IDENTITY.
#
# The mutation must establish the SPECIFIED negative outcome through the
# SPECIFIED mechanism. Four conditions must all hold:
#   1. the mutation was applied to the intended statement;
#   2. the mutated source remains syntactically valid;
#   3. the required test EXECUTES (it is not skipped, not missing);
#   4. it fails with the intended error code, in THAT test's own error
#       chain.
# Anything else is classified, not counted as detection.
# ---------------------------------------------------------------------------

mutation_status="NOT_APPLIED"
mutation_detected="NO"

mutant_dir="${work_dir}/mutant"
if ! build_reconstruction "${mutant_dir}"; then
    echo "ML_SMOKE_01_ERROR=mutant_reconstruction_failed" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi
if ! apply_allowed_patch "${mutant_dir}"; then
    echo "ML_SMOKE_01_ERROR=mutant_patch_not_applied" >&2
    echo "ML_SMOKE_01_DISPOSITION=HALT"
    exit 2
fi

mutant_target="${mutant_dir}/${REQUIRED_TEST_FILE}"
mutation_result="$("${NODE_BIN}" "${TOOL}" apply-mutation "${mutant_target}" 2>/dev/null)"

if ! "${NODE_BIN}" "${TOOL}" has "${mutation_result}" applied; then
    mutation_status="NOT_APPLIED"
    echo "ML_SMOKE_01_MUTATION_NOTE=mutation_target_statement_not_found"
else
    # Condition 2: the mutated source must remain syntactically valid. The
    # check uses the SAME loader the harness actually uses (esbuild's
    # TypeScript transform). `node --check` does not parse TypeScript.
    if ! "${NODE_BIN}" -e '
        const esbuild = require(process.argv[1]);
        const fs = require("node:fs");
        esbuild.transform(fs.readFileSync(process.argv[2], "utf8"), { loader: "ts" })
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    ' "${EVALUATOR_DEPS}/esbuild" "${mutant_target}" > /dev/null 2>&1; then
        mutation_status="INVALID_MUTATION"
        echo "ML_SMOKE_01_MUTATION_NOTE=mutant_source_invalid_syntax"
    else
        run_gate "${mutant_dir}" > "${work_dir}/mutant.jsonl" 2> "${work_dir}/mutant.err"
        mutant_exit=$?
        mutation_decision="$("${NODE_BIN}" "${TOOL}" mutate-decide "${work_dir}/mutant.jsonl" "${REQUIRED_TEST}" "${INTENDED_FAILURE_CODE}" "${mutant_exit}" 2>/dev/null)"
        mutation_status="$("${NODE_BIN}" "${TOOL}" field "${mutation_decision}" status)"
        if "${NODE_BIN}" "${TOOL}" has "${mutation_decision}" detected; then
            mutation_detected="YES"
        fi
        echo "ML_SMOKE_01_MUTATION_NOTE=$("${NODE_BIN}" "${TOOL}" field "${mutation_decision}" note)"
    fi
fi

echo "ML_SMOKE_01_MUTATION_STATUS=${mutation_status}"
echo "ML_SMOKE_01_MUTATION_DETECTED=${mutation_detected}"

# ---------------------------------------------------------------------------
# Verdict — fail closed.
# ---------------------------------------------------------------------------

disposition="PASS"
if [ "${scope_violations}" -ne 0 ]; then
    disposition="FAIL"
fi
if [ "${allowed_region_violation}" -ne 0 ]; then
    disposition="FAIL"
fi
if [ "${acceptance}" != "PASS" ]; then
    disposition="FAIL"
fi
if [ "${mutation_detected}" != "YES" ]; then
    disposition="FAIL"
fi

echo "ML_SMOKE_01_DISPOSITION=${disposition}"

if [ "${disposition}" = "PASS" ]; then
    exit 0
fi
exit 1
