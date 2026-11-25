#!/bin/bash
# ml_06a_acceptance_oracle.sh — evaluator-owned acceptance oracle for the
# Model Lab production-code fixture ML-06A.
#
# WHAT IS DIFFERENT ABOUT ML-06A
# ------------------------------
# ML-SMOKE-01's oracle executed a Node test runner against a TypeScript
# test file and bound the verdict to the structured event stream. ML-06A
# needs neither: `validateJsonValue` is a PURE function, and its
# acceptance is ten assertions about its return value.
#
# The oracle therefore does the smallest sufficient thing:
#
#   1. establish the BASE identity (fail closed);
#   2. establish the REFERENCE identity against a SUPERVISOR-SUPPLIED
#      expected digest (never read from a file next to the reference);
#   3. enforce SCOPE against the evaluator-owned prepared reference;
#   4. REJECT an unauthorized patch BEFORE EXECUTING IT;
#   5. run the evaluator's OWN acceptance test in a FRESH evaluator
#      reconstruction built from the trusted fixture plus the candidate's
#      allowed file.
#
# The evaluator's acceptance test is COPIED into the reconstruction. It is
# never present in the candidate's workspace and the candidate has no
# authority over it.
#
# Usage:
#   bash labs/model-lab/ml_06a_acceptance_oracle.sh \
#        <repo_root> <base_commit> <workspace> <prepared_reference_dir> \
#        <expected_reference_digest>
#
# Output contract (deterministic, machine-readable):
#   ML_06A_BASE_IDENTITY=VALID|INVALID
#   ML_06A_REFERENCE_KIND=PREPARED_DIR
#   ML_06A_REFERENCE_IDENTITY=VALID|INVALID
#   ML_06A_REFERENCE_DIGEST=<sha256>
#   ML_06A_EXPECTED_REFERENCE_DIGEST=<sha256>
#   ML_06A_SCOPE_ERROR=<code>
#   ML_06A_SCOPE_VIOLATIONS=<n>
#   ML_06A_ALLOWED_PATH=<path>
#   ML_06A_ALLOWED_PATH_CHANGED=true|false
#   ML_06A_DEPENDENCY_TRUST=TRUSTED|EVALUATOR_SUPPLIED|UNTRUSTED
#   ML_06A_GATE_EXECUTED=YES|NO
#   ML_06A_GATE_EXIT=<n>
#   ML_06A_ACCEPTANCE_TEST_EXIT=<n>
#   ML_06A_ACCEPTANCE_TESTS_PASSED=<n>
#   ML_06A_ACCEPTANCE_TESTS_FAILED=<n>
#   ML_06A_ACCEPTANCE=PASS|FAIL
#   ML_06A_DISPOSITION=PASS|FAIL|HALT
#
# Exit code: 0 on PASS, 1 on FAIL, 2 on HALT.

set -uo pipefail

repo_root="${1:-}"
base_commit="${2:-}"
workspace="${3:-}"
prepared_dir="${4:-}"
expected_digest="${5:-}"

if [ -z "${repo_root}" ] || [ -z "${base_commit}" ] || [ -z "${workspace}" ]; then
    echo "usage: ml_06a_acceptance_oracle.sh <repo_root> <base_commit> <workspace> <prepared_reference_dir> <expected_reference_digest>" >&2
    exit 2
fi

repo_root="$(cd "${repo_root}" && pwd -P)"
workspace="$(cd "${workspace}" && pwd -P)"

if [ ! -d "${workspace}" ]; then
    echo "ML_06A_ERROR=workspace_not_found" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
if [ -z "${prepared_dir}" ] || [ ! -d "${prepared_dir}" ]; then
    echo "ML_06A_REFERENCE_IDENTITY=INVALID"
    echo "ML_06A_ERROR=prepared_reference_required" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
prepared_dir="$(cd "${prepared_dir}" && pwd -P)"

if [ -z "${expected_digest}" ]; then
    echo "ML_06A_REFERENCE_IDENTITY=INVALID"
    echo "ML_06A_ERROR=expected_reference_digest_not_supplied" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="${HERE}/ml_smoke_01_tool.mjs"
REPORTER="${HERE}/ml_smoke_01_test_reporter.mjs"
ACCEPTANCE_TEST="${HERE}/ml_06a_acceptance.test.ts"
OBSERVATIONS_TEST="${HERE}/ml_06a_observations.test.ts"
FAILCLOSED="${HERE}/ml_failclosed.mjs"

if [ ! -f "${TOOL}" ] || [ ! -f "${ACCEPTANCE_TEST}" ] || [ ! -f "${OBSERVATIONS_TEST}" ] || [ ! -f "${REPORTER}" ] || [ ! -f "${FAILCLOSED}" ]; then
    echo "ML_06A_ERROR=oracle_components_missing" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi

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
    echo "ML_06A_ERROR=node_runtime_unavailable" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi

# The ONE file the candidate is allowed to change. The ENTIRE file stays
# editable: the fixture does not impose the historical patch's shape.
ALLOWED_PATH="labs/long-horizon-harness/src/subject/subject-json.ts"
DEPENDENCY_PATH="labs/long-horizon-harness/node_modules"
EVALUATOR_DEPS="${repo_root}/labs/long-horizon-harness/node_modules"

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

# ---------------------------------------------------------------------------
# Step 0 — base identity. Fail closed on anything unverifiable.
# ---------------------------------------------------------------------------

if ! git -C "${repo_root}" cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
    echo "ML_06A_BASE_IDENTITY=INVALID"
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
echo "ML_06A_BASE_IDENTITY=VALID"
echo "ML_06A_BASE_COMMIT=${base_commit}"
echo "ML_06A_REFERENCE_KIND=PREPARED_DIR"

# ---------------------------------------------------------------------------
# Step 1 — reference identity, against the SUPERVISOR'S expected digest.
# ---------------------------------------------------------------------------

"${NODE_BIN}" "${TOOL}" digest "${prepared_dir}" > "${work_dir}/reference.digest" 2>"${work_dir}/reference.digest.err"
reference_digest_status=$?
reference_digest="$(head -1 "${work_dir}/reference.digest" 2>/dev/null)"
if [ "${reference_digest_status}" -ne 0 ] || [ -z "${reference_digest}" ]; then
    # The digest computation FAILED. An empty digest must never reach the
    # comparison below: the empty string is not a valid digest, and a
    # comparison against it would be a comparison against nothing.
    echo "ML_06A_REFERENCE_IDENTITY=INVALID"
    echo "ML_06A_ERROR=reference_digest_uncomputable" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
echo "ML_06A_REFERENCE_DIGEST=${reference_digest}"
echo "ML_06A_EXPECTED_REFERENCE_DIGEST=${expected_digest}"
if [ "${reference_digest}" != "${expected_digest}" ]; then
    echo "ML_06A_REFERENCE_IDENTITY=INVALID"
    echo "ML_06A_ERROR=reference_digest_mismatch" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
echo "ML_06A_REFERENCE_IDENTITY=VALID"

# ---------------------------------------------------------------------------
# Step 2 — scope enforcement against the evaluator-owned reference.
# ---------------------------------------------------------------------------

# FAIL-CLOSED SCOPE INSPECTION.
#
# The scope-tool invocation MUST succeed, MUST produce a VALID STRUCTURED
# response, and MUST report a VALID NONNEGATIVE violation count. A missing,
# malformed or failed inspection result HALTs.
"${NODE_BIN}" "${FAILCLOSED}" scope "${TOOL}" "${prepared_dir}" "${workspace}" "${ALLOWED_PATH}" \
    > "${work_dir}/scope.fc" 2>"${work_dir}/scope.fc.err"
scope_fc_status=$?
scope_fc_state="$(grep -a '^FC_STATUS=' "${work_dir}/scope.fc" 2>/dev/null | tail -1 | cut -d= -f2-)"
scope_fc_error="$(grep -a '^FC_ERROR=' "${work_dir}/scope.fc" 2>/dev/null | tail -1 | cut -d= -f2-)"
scope_error="$(grep -a '^FC_ERROR_CODE=' "${work_dir}/scope.fc" 2>/dev/null | tail -1 | cut -d= -f2-)"
if [ "${scope_fc_status}" -ne 0 ] || [ "${scope_fc_state}" != "OK" ]; then
    echo "ML_06A_SCOPE_ERROR=${scope_error:-scope_inspection_failed}"
    echo "ML_06A_SCOPE_INSPECTION=${scope_fc_state:-FAILED}"
    echo "ML_06A_SCOPE_INSPECTION_ERROR=${scope_fc_error:-unknown}"
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
scope_violations="$(grep -a '^FC_VIOLATIONS=' "${work_dir}/scope.fc" | tail -1 | cut -d= -f2-)"
scope_report="$(grep -a '^FC_OUTPUT=' "${work_dir}/scope.fc" | tail -1 | cut -d= -f2-)"
if ! printf '%s' "${scope_violations}" | grep -aqE '^[0-9]+$'; then
    echo "ML_06A_SCOPE_ERROR=scope_violation_count_invalid"
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
printf '%s' "${scope_report}" | "${NODE_BIN}" "${TOOL}" scope-lines 2>/dev/null

# Did the candidate actually change the allowed file?
allowed_changed="false"
if ! cmp -s "${prepared_dir}/${ALLOWED_PATH}" "${workspace}/${ALLOWED_PATH}" 2>/dev/null; then
    allowed_changed="true"
fi
echo "ML_06A_ALLOWED_PATH=${ALLOWED_PATH}"
echo "ML_06A_ALLOWED_PATH_CHANGED=${allowed_changed}"

# ---------------------------------------------------------------------------
# Step 3 — dependency trust.
#
# The dependency tree is evaluator-owned. The workspace must NOT own one.
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
        dependency_trust="UNTRUSTED"
    else
        dependency_trust="TRUSTED"
    fi
elif [ -z "${eval_deps_real}" ]; then
    dependency_trust="UNTRUSTED"
else
    dependency_trust="EVALUATOR_SUPPLIED"
fi
echo "ML_06A_DEPENDENCY_TRUST=${dependency_trust}"
if [ "${dependency_trust}" = "UNTRUSTED" ]; then
    echo "SCOPE_VIOLATION FORBIDDEN_DEPENDENCY ${DEPENDENCY_PATH}"
    scope_violations=$((scope_violations + 1))
fi
echo "ML_06A_SCOPE_VIOLATIONS=${scope_violations}"

# ---------------------------------------------------------------------------
# Step 4 — FAIL-CLOSED ORCHESTRATION.
#
# An unauthorized patch is REJECTED BEFORE IT IS EXECUTED. The candidate's
# bytes never reach a process while the scope verdict is not clean.
# ---------------------------------------------------------------------------

if [ "${scope_violations}" -ne 0 ]; then
    echo "ML_06A_GATE_EXECUTED=NO"
    echo "ML_06A_ERROR=unauthorized_patch_rejected_before_execution" >&2
    echo "ML_06A_DISPOSITION=FAIL"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 5 — the acceptance gate in a FRESH evaluator reconstruction.
#
# The reconstruction is built from the TRUSTED fixture. The candidate's
# allowed file is copied in, and the evaluator's OWN acceptance test is
# copied in. The candidate's dependency tree is never consulted.
# ---------------------------------------------------------------------------

build_reconstruction() {
    local dest="$1"
    rm -rf "${dest}"
    mkdir -p "${dest}" || return 1
    ( cd "${prepared_dir}" && COPYFILE_DISABLE=1 tar --no-xattrs -cf - . ) | ( cd "${dest}" && COPYFILE_DISABLE=1 tar --no-xattrs -xf - 2>/dev/null ) || return 1
    rm -rf "${dest}/${DEPENDENCY_PATH}"
    cp -R "${EVALUATOR_DEPS}" "${dest}/${DEPENDENCY_PATH}" || return 1
    if [ ! -d "${dest}/${DEPENDENCY_PATH}" ]; then
        echo "ML_06A_ERROR=evaluator_dependencies_not_supplied" >&2
        return 1
    fi
    return 0
}

apply_allowed_patch() {
    local dest="$1"
    cp "${workspace}/${ALLOWED_PATH}" "${dest}/${ALLOWED_PATH}" || return 1
    if [ ! -s "${dest}/${ALLOWED_PATH}" ]; then
        echo "ML_06A_ERROR=allowed_patch_not_copied" >&2
        return 1
    fi
    return 0
}

accept_dir="${work_dir}/accept"
if ! build_reconstruction "${accept_dir}"; then
    echo "ML_06A_ERROR=evaluator_reconstruction_failed" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
if ! apply_allowed_patch "${accept_dir}"; then
    echo "ML_06A_ERROR=allowed_patch_not_applied" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi

# The evaluator's acceptance test enters the reconstruction as the
# evaluator's own file. It is placed where its relative import resolves.
acceptance_dest="${accept_dir}/labs/long-horizon-harness/test/subject/ml-06a-acceptance.test.ts"
mkdir -p "$(dirname "${acceptance_dest}")"
cp "${ACCEPTANCE_TEST}" "${acceptance_dest}" || {
    echo "ML_06A_ERROR=acceptance_test_not_copied" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
}

# The evaluator's OBSERVATION file enters the same way, as a SEPARATE
# file executed in a SEPARATE process.
observations_dest="${accept_dir}/labs/long-horizon-harness/test/subject/ml-06a-observations.test.ts"
cp "${OBSERVATIONS_TEST}" "${observations_dest}" || {
    echo "ML_06A_ERROR=observations_test_not_copied" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
}

echo "ML_06A_GATE_EXECUTED=YES"
(
    cd "${accept_dir}/labs/long-horizon-harness" || exit 2
    TMPDIR=/tmp timeout 120 "${NODE_BIN}" \
        --import "${EVALUATOR_DEPS}/tsx/dist/loader.mjs" \
        --test \
        --test-reporter="${REPORTER}" \
        test/subject/ml-06a-acceptance.test.ts
) > "${work_dir}/gate.jsonl" 2> "${work_dir}/gate.err"
gate_exit=$?
echo "ML_06A_GATE_EXIT=${gate_exit}"
echo "ML_06A_ACCEPTANCE_TEST_EXIT=${gate_exit}"

# The OBSERVATIONS run in their OWN PROCESS.
#
# An observation records a behaviour the task prompt does not state. If it
# shared the acceptance process, a failing observation would change that
# process's exit status and therefore the acceptance verdict — which is
# precisely the hidden requirement this separation exists to prevent.
(
    cd "${accept_dir}/labs/long-horizon-harness" || exit 2
    TMPDIR=/tmp timeout 120 "${NODE_BIN}" \
        --import "${EVALUATOR_DEPS}/tsx/dist/loader.mjs" \
        --test \
        --test-reporter="${REPORTER}" \
        test/subject/ml-06a-observations.test.ts
) > "${work_dir}/observe.jsonl" 2> "${work_dir}/observe.err"
observe_exit=$?
echo "ML_06A_OBSERVATION_PROCESS_EXIT=${observe_exit}"

# The verdict is read from the STRUCTURED event stream, not from free text.
#
# The previous revision read the counts from the `spec` reporter's summary
# lines. That is a TEXT contract, and it had two failure modes: the
# summary lines are ANSI-coloured (so a plain-text grep does not match
# them), and a run whose test file could not be found produced NO summary
# at all — which the revision read as "zero passed, zero failed", and
# then accepted because the process exit was 0.
#
# The structured reporter terminates the stream with an explicit
# completion record, and the classifier RECONCILES it against the
# observed records. A missing test file, a truncated stream and a
# contradictory completion record are all rejected.
classify_report="$("${NODE_BIN}" "${FAILCLOSED}" json "${TOOL}" classify-json "${work_dir}/gate.jsonl" 2>/dev/null)"
classify_status=$?
if [ "${classify_status}" -ne 0 ]; then
    # The CLASSIFICATION FAILED. The evaluator cannot classify the gate's
    # own event stream: this is an EVALUATOR-side failure, not a
    # candidate verdict.
    echo "ML_06A_ERROR=gate_classification_failed" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
classify_payload="$(printf '%s' "${classify_report}" | grep -a '^FC_OUTPUT=' | tail -1 | cut -d= -f2-)"
classify_value() {
    "${NODE_BIN}" "${TOOL}" field "${classify_payload}" "$1"
}
echo "ML_06A_ACCEPTANCE_TESTS_PASSED=$(classify_value counts.passed)"
echo "ML_06A_ACCEPTANCE_TESTS_FAILED=$(classify_value counts.failed)"
echo "ML_06A_ACCEPTANCE_TESTS_SKIPPED=$(classify_value counts.skipped)"
echo "ML_06A_ACCEPTANCE_TESTS_TODO=$(classify_value counts.todo)"
echo "ML_06A_ACCEPTANCE_TESTS_CANCELLED=$(classify_value counts.cancelled)"
echo "ML_06A_GATE_STREAM_COMPLETE=$(classify_value complete)"
echo "ML_06A_GATE_STREAM_ERROR=$(classify_value error)"
echo "ML_06A_GATE_STREAM_COMPLETE_REASONS=$(classify_value completeReasons)"

# The acceptance decision is bound to the EXACT identity of every
# required test: all nine must be PRESENT, EXECUTED and PASSING.
#
# The OBSERVATIONS are exercised and reported, but they are NOT bound to
# the verdict: each one describes a behaviour the task prompt never
# states, and requiring it would impose a hidden requirement.
accept_report="$("${NODE_BIN}" "${FAILCLOSED}" json "${TOOL}" accept-ml06a "${work_dir}/gate.jsonl" "${gate_exit}" 2>/dev/null)"
accept_status=$?
if [ "${accept_status}" -ne 0 ]; then
    echo "ML_06A_ERROR=acceptance_classification_failed" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
accept_payload="$(printf '%s' "${accept_report}" | grep -a '^FC_OUTPUT=' | tail -1 | cut -d= -f2-)"
required_present="$("${NODE_BIN}" "${TOOL}" field "${accept_payload}" present)"
required_executed="$("${NODE_BIN}" "${TOOL}" field "${accept_payload}" executed)"
acceptance="$("${NODE_BIN}" "${TOOL}" field "${accept_payload}" acceptance)"
printf '%s' "${accept_payload}" | "${NODE_BIN}" "${TOOL}" reasons 2>/dev/null | sed 's/^/ML_06A_REQUIRED_/'
echo "ML_06A_REQUIRED_TESTS_PRESENT=$( [ "${required_present}" = "true" ] && echo YES || echo NO )"
echo "ML_06A_REQUIRED_TESTS_EXECUTED=${required_executed}/9"

# The OBSERVATIONS' own outcomes.
observe_report="$("${NODE_BIN}" "${FAILCLOSED}" json "${TOOL}" observe-ml06a "${work_dir}/observe.jsonl" 2>/dev/null)"
observe_status=$?
if [ "${observe_status}" -ne 0 ]; then
    echo "ML_06A_ERROR=observation_classification_failed" >&2
    echo "ML_06A_DISPOSITION=HALT"
    exit 2
fi
observe_payload="$(printf '%s' "${observe_report}" | grep -a '^FC_OUTPUT=' | tail -1 | cut -d= -f2-)"
printf '%s' "${observe_payload}" | "${NODE_BIN}" "${TOOL}" reasons 2>/dev/null | sed 's/^/ML_06A_OBSERVATION_/'
for label in ML06A-OBS-01; do
    status="$("${NODE_BIN}" "${TOOL}" observation-status "${observe_payload}" "${label}" 2>/dev/null)"
    echo "ML_06A_OBSERVATION_${label}=${status:-ABSENT}"
done
echo "ML_06A_ACCEPTANCE=${acceptance}"

# The candidate must have ACTUALLY changed the allowed file. An unchanged
# file cannot fix the defect, so it can never be an acceptance.
if [ "${allowed_changed}" != "true" ]; then
    echo "ML_06A_ERROR=allowed_path_unchanged" >&2
    acceptance="FAIL"
    echo "ML_06A_ACCEPTANCE=${acceptance}"
fi

disposition="PASS"
if [ "${acceptance}" != "PASS" ]; then
    disposition="FAIL"
fi
echo "ML_06A_DISPOSITION=${disposition}"
if [ "${disposition}" = "PASS" ]; then
    exit 0
fi
exit 1
