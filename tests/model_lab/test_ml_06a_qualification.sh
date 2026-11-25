#!/bin/bash
# test_ml_06a_qualification.sh — QUALIFICATION controls for the ML-06A
# fixture.
#
# ML-06A is the FIRST SOLUTION-BLIND PRODUCTION-CODE fixture of the Model
# Lab: the candidate edits PRODUCTION source, and the evaluator owns an
# immutable acceptance test that never enters the candidate's authority.
#
# These controls are INEXPENSIVE. The subject is a PURE function: every
# control is a handful of function calls in one Node process. No fixture
# execution, no subprocess per case, no clock, no randomness.
#
# The controls are:
#   M01  the KNOWN-BAD revision FAILS for the INTENDED BEHAVIORAL reason
#   M02  the KNOWN-GOOD revision PASSES
#   M03  the known-bad revision fails ONLY on the shared-substructure
#        assertion, not on a broken harness
#   M04  an unauthorized patch is REJECTED BEFORE EXECUTION
#   M05  an unchanged allowed file is NOT an acceptance
#   M06  no prepared reference -> HALT
#   M07  a wrong expected reference digest -> HALT
#   M08  an invalid base commit -> HALT
#   M09  the candidate-visible fixture contains NO historical solution,
#        NO future Git history, NO evaluator-only test and NO correction
#        evidence
#   M10  the fixture preparation uses a FRESH output directory
#
# Exit: 0 when every control behaves as specified, 1 otherwise.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ORACLE="${REPO_ROOT}/labs/model-lab/ml_06a_acceptance_oracle.sh"
PREPARE="${REPO_ROOT}/labs/model-lab/prepare_ml_06a.sh"
BASE_COMMIT="0bd72f4b97486b9b95cbb75e7e384586d03aa22f"
KNOWN_GOOD="5b7508fa09e6f10b6ec683e94a35758a15f9d827"
ALLOWED_PATH="labs/long-horizon-harness/src/subject/subject-json.ts"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ml-06a-qual-XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT

# The Node runtime is resolved EXPLICITLY. The interactive shell's PATH is
# not assumed to match the extension host's PATH.
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
    echo "node runtime unavailable" >&2
    exit 1
fi
echo "  node runtime: ${NODE_BIN} ($("${NODE_BIN}" --version))"

PASS_COUNT=0
FAIL_COUNT=0

ok()  { PASS_COUNT=$((PASS_COUNT + 1)); echo "  [PASS] $1"; }
bad() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "  [FAIL] $1"; }
assert() { if [ "$1" -eq 0 ]; then ok "$2"; else bad "$2"; fi; }
assert_has() { if grep -aq "$2" "$3"; then ok "$1"; else bad "$1"; fi; }
assert_not_has() { if grep -aq "$2" "$3"; then bad "$1"; else ok "$1"; fi; }

assert_disposition() {
    local label="$1" expected="$2" expected_exit="$3" out="$4" actual_exit="$5"
    local actual
    actual="$(grep -a '^ML_06A_DISPOSITION=' "${out}" | tail -1 | cut -d= -f2)"
    if [ "${actual}" != "${expected}" ]; then
        bad "${label}: expected DISPOSITION=${expected}, got ${actual}"
        return
    fi
    if [ "${expected_exit}" != "-" ] && [ "${actual_exit}" != "${expected_exit}" ]; then
        bad "${label}: expected exit ${expected_exit}, got ${actual_exit}"
        return
    fi
    ok "${label}: DISPOSITION=${actual} (exit ${actual_exit})"
}

echo "=== ML-06A qualification controls ==="
echo ""

if [ ! -f "${ORACLE}" ]; then echo "oracle not found: ${ORACLE}" >&2; exit 1; fi

echo "--- preparing fixture ---"
if ! bash "${PREPARE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${WORK}/prep" > "${WORK}/prep.log" 2>&1; then
    echo "preparation FAILED" >&2; cat "${WORK}/prep.log" >&2; exit 1
fi
echo "  prepared OK"

# The supervisor's INDEPENDENT record of the reference identity, taken
# BEFORE any candidate code runs.
REFERENCE_DIGEST="$(cat "${WORK}/prep/fixture.sha256")"
if [ -z "${REFERENCE_DIGEST}" ]; then
    echo "preparation did not record a fixture digest" >&2; exit 1
fi
echo "  reference digest recorded by the supervisor: ${REFERENCE_DIGEST}"

run_oracle() {
    # run_oracle <workspace> <outfile> [reference] [expected_digest]
    local ws="$1" out="$2" ref="${3:-${WORK}/prep/workspace}" expected="${4:-${REFERENCE_DIGEST}}"
    bash "${ORACLE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${ws}" "${ref}" "${expected}" > "${out}" 2>&1
    echo "$?"
}

# ---------------------------------------------------------------------------
# M01 — the KNOWN-BAD revision must FAIL, for the INTENDED reason.
# ---------------------------------------------------------------------------

echo ""
echo "--- M01 known-bad revision -> FAIL on the shared-substructure assertion ---"
rm -rf "${WORK}/m01"; cp -R "${WORK}/prep/workspace" "${WORK}/m01"
rc="$(run_oracle "${WORK}/m01" "${WORK}/m01.out")"
assert_disposition "M01 known-bad" "FAIL" "1" "${WORK}/m01.out" "${rc}"
assert_has "M01 the acceptance verdict is FAIL" "ML_06A_ACCEPTANCE=FAIL" "${WORK}/m01.out"
assert_has "M01 the allowed file was NOT changed" "ML_06A_ALLOWED_PATH_CHANGED=false" "${WORK}/m01.out"

# The INTENDED BEHAVIORAL REASON, read from STRUCTURED observations.
#
# The previous revision searched the human-readable `spec` reporter output
# for several identifiers without requiring the corresponding FAILED
# status, and without requiring the unrelated validation controls to have
# PASSED. A free-text search is not an observation.
#
# The structured event stream is used instead: each assertion's terminal
# observation carries its exact status. The control requires:
#
#   - the three shared-substructure assertions to have FAILED;
#   - the ordinary-tree assertion to have PASSED;
#   - the three cycle-rejection assertions to have PASSED;
#   - the invalid-value assertion to have PASSED;
#   - the additional ML06A-10 failure caused by the SAME underlying defect.
#
# The ML06A-10 failure is a CONSEQUENCE of the same defect: the known-bad
# validator refuses the shared-substructure manifest, so the immutability
# assertion's precondition (the manifest is accepted) does not hold.
rm -rf "${WORK}/m01-probe"; cp -R "${WORK}/prep/workspace" "${WORK}/m01-probe"
DEPS="${REPO_ROOT}/labs/long-horizon-harness/node_modules"
mkdir -p "${WORK}/m01-probe/labs/long-horizon-harness/test/subject"
cp "${REPO_ROOT}/labs/model-lab/ml_06a_acceptance.test.ts" \
   "${WORK}/m01-probe/labs/long-horizon-harness/test/subject/ml-06a-acceptance.test.ts"
( cd "${WORK}/m01-probe/labs/long-horizon-harness" && TMPDIR=/tmp "${NODE_BIN}" \
     --import "${DEPS}/tsx/dist/loader.mjs" --test \
     --test-reporter="${REPO_ROOT}/labs/model-lab/ml_smoke_01_test_reporter.mjs" \
     test/subject/ml-06a-acceptance.test.ts ) > "${WORK}/m01-probe.jsonl" 2> "${WORK}/m01-probe.err"
probe_payload="$("${NODE_BIN}" "${REPO_ROOT}/labs/model-lab/ml_smoke_01_tool.mjs" \
    classify-json "${WORK}/m01-probe.jsonl" 2>/dev/null)"
probe_field() {
    printf '%s' "${probe_payload}" | "${NODE_BIN}" "${REPO_ROOT}/labs/model-lab/ml_smoke_01_tool.mjs" \
        field - "$1" 2>/dev/null
}
probe_status_of() {
    # probe_status_of <test name> -> the terminal STATUS of that identity.
    "${NODE_BIN}" -e '
        const fs = require("node:fs")
        const lines = fs.readFileSync(process.argv[1], "utf8").split("\n")
        let found = "ABSENT"
        for (const line of lines) {
            if (!line.trim()) continue
            let rec
            try { rec = JSON.parse(line) } catch { continue }
            if (rec.kind === "test" && rec.name === process.argv[2]) found = rec.status
        }
        process.stdout.write(found)
    ' "${WORK}/m01-probe.jsonl" "$1"
}
assert_eq() {
    # assert_eq <label> <expected> <actual>
    if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}
assert_eq "M01 ML06A-01 (ordinary tree) PASSED" "pass" "$(probe_status_of 'ML06A-01: an ordinary JSON tree is accepted')"
assert_eq "M01 ML06A-02 (shared sibling OBJECTS) FAILED" "fail" "$(probe_status_of 'ML06A-02: shared sibling OBJECTS are accepted')"
assert_eq "M01 ML06A-03 (shared sibling ARRAYS) FAILED" "fail" "$(probe_status_of 'ML06A-03: shared sibling ARRAYS are accepted')"
assert_eq "M01 ML06A-04 (shared substructure at different depths) FAILED" "fail" "$(probe_status_of 'ML06A-04: shared substructure at DIFFERENT DEPTHS is accepted')"
assert_eq "M01 ML06A-05 (direct cycle) PASSED" "pass" "$(probe_status_of 'ML06A-05: a DIRECT cycle is rejected')"
assert_eq "M01 ML06A-06 (indirect cycle) PASSED" "pass" "$(probe_status_of 'ML06A-06: an INDIRECT cycle is rejected')"
assert_eq "M01 ML06A-07 (cycle within shared substructure) PASSED" "pass" "$(probe_status_of 'ML06A-07: a cycle WITHIN shared substructure is rejected')"
assert_eq "M01 ML06A-08 (invalid-value behaviour) PASSED" "pass" "$(probe_status_of 'ML06A-08: the existing invalid-value behaviour is preserved')"
assert_eq "M01 ML06A-10 (the same underlying defect) FAILED" "fail" "$(probe_status_of 'ML06A-10: the input is not reshaped and the returned value is the SAME reference')"
assert_eq "M01 the observed failure count is exactly 4 (the three shared-substructure failures plus ML06A-10)" "4" "$(probe_field counts.failed)"
assert_eq "M01 the observed pass count is exactly 5" "5" "$(probe_field counts.passed)"

# ---------------------------------------------------------------------------
# M02 — the KNOWN-GOOD revision must PASS.
#
# The known-good revision's production file is copied over the fixture's
# allowed path. NOTHING else changes.
# ---------------------------------------------------------------------------

echo ""
echo "--- M02 known-good revision -> PASS ---"
rm -rf "${WORK}/m02"; cp -R "${WORK}/prep/workspace" "${WORK}/m02"
git -C "${REPO_ROOT}" show "${KNOWN_GOOD}:${ALLOWED_PATH}" > "${WORK}/m02/${ALLOWED_PATH}"
rc="$(run_oracle "${WORK}/m02" "${WORK}/m02.out")"
assert_disposition "M02 known-good" "PASS" "0" "${WORK}/m02.out" "${rc}"
assert_has "M02 the acceptance verdict is PASS" "ML_06A_ACCEPTANCE=PASS" "${WORK}/m02.out"
assert_has "M02 the allowed file was changed" "ML_06A_ALLOWED_PATH_CHANGED=true" "${WORK}/m02.out"
assert_has "M02 all nine REQUIRED acceptance tests passed" "ML_06A_ACCEPTANCE_TESTS_PASSED=9" "${WORK}/m02.out"
assert_has "M02 no acceptance test failed" "ML_06A_ACCEPTANCE_TESTS_FAILED=0" "${WORK}/m02.out"
assert_has "M02 all nine required tests executed" "ML_06A_REQUIRED_TESTS_EXECUTED=9/9" "${WORK}/m02.out"
assert_has "M02 all nine required tests are present" "ML_06A_REQUIRED_TESTS_PRESENT=YES" "${WORK}/m02.out"
assert_has "M02 the OBSERVATION is reported" "ML_06A_OBSERVATION_ML06A-OBS-01=" "${WORK}/m02.out"
assert_has "M02 the reference identity was established" "ML_06A_REFERENCE_IDENTITY=VALID" "${WORK}/m02.out"

# ---------------------------------------------------------------------------
# M03 — a CANDIDATE-SHAPED fix (not the historical patch) must also pass.
#
# The fixture keeps the ENTIRE allowed file editable and imposes no
# implementation shape. This control applies a MINIMAL, DIFFERENTLY-SHAPED
# fix — a recursion-path set with an explicit delete on exit — and proves
# it is accepted. The historical patch's shape is therefore not required.
# ---------------------------------------------------------------------------

echo ""
echo "--- M03 a differently-shaped candidate fix -> PASS ---"
rm -rf "${WORK}/m03"; cp -R "${WORK}/prep/workspace" "${WORK}/m03"
python3 - "${WORK}/m03/${ALLOWED_PATH}" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
# A DIFFERENTLY-SHAPED fix: the recursion path is an explicit ARRAY that
# is pushed on entry and popped on exit, instead of the historical
# revision's Set-with-try/finally. The data structure, the traversal and
# the control flow are all different from the known-good revision.
old_sig = "  seen: WeakSet<object> = new WeakSet(),\n): JsonValidation {"
new_sig = "  onPath: object[] = [],\n): JsonValidation {"
assert old_sig in t, "guard signature not found"
t = t.replace(old_sig, new_sig, 1)

old_guard = """  if (seen.has(obj)) {
    return fail(`${path}: cyclic value is not a JsonValue`);
  }
  seen.add(obj);
"""
new_guard = """  if (onPath.indexOf(obj) !== -1) {
    return fail(`${path}: cyclic value is not a JsonValue`);
  }
  onPath.push(obj);
  try {
    return validateJsonValueRest(value, path, obj, onPath);
  } finally {
    onPath.pop();
  }
}

function validateJsonValueRest(
  value: unknown,
  path: string,
  obj: object,
  onPath: object[],
): JsonValidation {
"""
assert old_guard in t, "guard body not found"
t = t.replace(old_guard, new_guard, 1)
t = t.replace("seen);", "onPath);")
open(p, "w").write(t)
PYEOF
if grep -q 'onPath.pop()' "${WORK}/m03/${ALLOWED_PATH}"; then
    ok "M03 the differently-shaped candidate fix was applied"
else
    bad "M03 the differently-shaped candidate fix did NOT apply"
fi
rc="$(run_oracle "${WORK}/m03" "${WORK}/m03.out")"
assert_disposition "M03 differently-shaped fix" "PASS" "0" "${WORK}/m03.out" "${rc}"
assert_has "M03 the differently-shaped fix is accepted" "ML_06A_ACCEPTANCE=PASS" "${WORK}/m03.out"

# ---------------------------------------------------------------------------
# M04 — an unauthorized patch is REJECTED BEFORE EXECUTION.
# ---------------------------------------------------------------------------

echo ""
echo "--- M04 unauthorized patch -> rejected BEFORE execution ---"
rm -rf "${WORK}/m04"; cp -R "${WORK}/prep/workspace" "${WORK}/m04"
echo "// unauthorized" >> "${WORK}/m04/labs/long-horizon-harness/src/subject/subject-decode.ts"
m04_started="$(date +%s)"
rc="$(run_oracle "${WORK}/m04" "${WORK}/m04.out")"
m04_elapsed=$(( $(date +%s) - m04_started ))
assert_disposition "M04 unauthorized patch" "FAIL" "1" "${WORK}/m04.out" "${rc}"
assert_has "M04 the gate was NOT executed" "ML_06A_GATE_EXECUTED=NO" "${WORK}/m04.out"
assert_has "M04 the rejection is named" "unauthorized_patch_rejected_before_execution" "${WORK}/m04.out"
if [ "${m04_elapsed}" -lt 30 ]; then
    ok "M04 the rejection was FAST (${m04_elapsed}s < 30s): the candidate's code was not executed"
else
    bad "M04 the rejection took ${m04_elapsed}s: the candidate's code was probably executed"
fi

# ---------------------------------------------------------------------------
# M05 — an UNCHANGED allowed file is not an acceptance.
# ---------------------------------------------------------------------------

echo ""
echo "--- M05 unchanged allowed file -> FAIL ---"
rm -rf "${WORK}/m05"; cp -R "${WORK}/prep/workspace" "${WORK}/m05"
rc="$(run_oracle "${WORK}/m05" "${WORK}/m05.out")"
assert_disposition "M05 unchanged allowed file" "FAIL" "1" "${WORK}/m05.out" "${rc}"
assert_has "M05 the unchanged file is reported" "allowed_path_unchanged" "${WORK}/m05.out"

# ---------------------------------------------------------------------------
# M06 / M07 / M08 — the HALT conditions.
# ---------------------------------------------------------------------------

echo ""
echo "--- M06 no prepared reference -> HALT ---"
bash "${ORACLE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${WORK}/m02" "" "${REFERENCE_DIGEST}" > "${WORK}/m06.out" 2>&1
rc=$?
assert_disposition "M06 no reference" "HALT" "2" "${WORK}/m06.out" "${rc}"
assert_has "M06 the refusal names the missing reference" "prepared_reference_required" "${WORK}/m06.out"

echo ""
echo "--- M07 wrong expected reference digest -> HALT ---"
rc="$(run_oracle "${WORK}/m02" "${WORK}/m07.out" "${WORK}/prep/workspace" "0000000000000000000000000000000000000000000000000000000000000000")"
assert_disposition "M07 wrong expected digest" "HALT" "2" "${WORK}/m07.out" "${rc}"
assert_has "M07 the refusal names the mismatch" "reference_digest_mismatch" "${WORK}/m07.out"

echo ""
echo "--- M08 invalid base commit -> HALT ---"
bash "${ORACLE}" "${REPO_ROOT}" "0000000000000000000000000000000000000000" "${WORK}/m02" \
    "${WORK}/prep/workspace" "${REFERENCE_DIGEST}" > "${WORK}/m08.out" 2>&1
rc=$?
assert_disposition "M08 invalid base" "HALT" "2" "${WORK}/m08.out" "${rc}"

# ---------------------------------------------------------------------------
# M09 — the SOLUTION-LEAKAGE scan of the candidate-visible fixture.
# ---------------------------------------------------------------------------

echo ""
echo "--- M09 solution-leakage scan of the candidate-visible fixture ---"
LEAKS=0
# The scan's DISPOSITIONS are explicit:
#
#   CLEAN            the required files were inspected and no match was found
#   LEAK_DETECTED    the required files were inspected and a match WAS found
#   SCAN_INCOMPLETE  the required files could NOT be inspected
#
# The previous revision conflated "no match" with "inspection failure": a
# `grep` that could not read the tree returned a non-zero status, which was
# indistinguishable from a clean tree. A scan that could not inspect the
# required files CANNOT establish CLEAN.
scan_marker() {
    # scan_marker <label> <marker>
    #
    # The enumeration is performed FIRST, and its status is checked. Only
    # when the required files were enumerated successfully can a "no match"
    # be read as CLEAN.
    local label="$1" marker="$2"
    local enumeration
    enumeration="$(find "${WORK}/prep/workspace" -type f 2>/dev/null)"
    local enum_status=$?
    if [ "${enum_status}" -ne 0 ] || [ -z "${enumeration}" ]; then
        bad "${label}: SCAN_INCOMPLETE (the candidate-visible tree could not be enumerated)"
        LEAKS=$((LEAKS + 1))
        return
    fi
    local hits
    hits="$(printf '%s\n' "${enumeration}" | while IFS= read -r f; do
        grep -lF "${marker}" "${f}" 2>/dev/null || true
    done)"
    if [ -n "${hits}" ]; then
        bad "${label}: LEAK_DETECTED (${marker})"
        LEAKS=$((LEAKS + 1))
    else
        ok "${label}: CLEAN (${marker})"
    fi
}
# (a) The historical solution's MARKERS must not appear anywhere in the
#     candidate-visible fixture.
for marker in 'ancestors' 'validateJsonValueInner' 'ancestors.delete' 'boundary_exception'; do
    scan_marker "M09 the historical solution's marker '${marker}' is absent" "${marker}"
done
# (b) NO evaluator-only test file may be present.
evaluator_files="$(find "${WORK}/prep/workspace" \( -name '*ml-06a*' -o -name '*ml_06a*' \) 2>/dev/null)"
if [ -n "${evaluator_files}" ]; then
    bad "M09 an evaluator-only ML-06A file IS present in the candidate-visible fixture"
    LEAKS=$((LEAKS + 1))
else
    ok "M09 NO evaluator-only ML-06A file is present in the candidate-visible fixture"
fi
# (c) NO Git history and NO correction evidence may be present.
if [ -e "${WORK}/prep/workspace/.git" ]; then
    bad "M09 the candidate-visible fixture carries a .git directory"
    LEAKS=$((LEAKS + 1))
else
    ok "M09 the candidate-visible fixture carries NO Git history"
fi
# The ML-06A-SPECIFIC correction evidence: the known-good revision's
# identity, and the evaluator's own fixture names. These are the markers
# that would let a candidate recognise the fixture's own history.
for marker in 'KNOWN_GOOD' '5b7508f' 'ml_06a' 'ml-06a' '0bd72f4'; do
    scan_marker "M09 the ML-06A correction-evidence marker '${marker}' is absent" "${marker}"
done
# The GENERIC historical markers. These are the base commit's OWN
# repository content (the harness README names historical ACTs, and
# several harness sources carry the word "correction"). They do NOT
# describe the ML-06A defect and they do NOT reveal the fix: the
# historical solution's markers are absent (checked above). Removing them
# would require an OVERLAY on the fixture, which this fixture must not
# have. They are therefore RECORDED, not treated as a leak.
for marker in 'ACT-FACTORY' 'correction'; do
    hits="$(grep -rlF "${marker}" "${WORK}/prep/workspace" 2>/dev/null | wc -l | tr -d ' ')"
    echo "  [NOTE] M09 the generic historical marker '${marker}' occurs in ${hits} base-commit file(s) (not ML-06A evidence; no overlay is applied)"
done
# (d) The candidate-visible fixture must NOT carry the known-good
#     production file.
KNOWN_GOOD_SHA="$(git -C "${REPO_ROOT}" show "${KNOWN_GOOD}:${ALLOWED_PATH}" | shasum -a 256 | awk '{print $1}')"
FIXTURE_SHA="$(shasum -a 256 "${WORK}/prep/workspace/${ALLOWED_PATH}" | awk '{print $1}')"
if [ "${KNOWN_GOOD_SHA}" = "${FIXTURE_SHA}" ]; then
    bad "M09 the candidate-visible fixture carries the KNOWN-GOOD production file"
    LEAKS=$((LEAKS + 1))
else
    ok "M09 the candidate-visible fixture does NOT carry the KNOWN-GOOD production file"
fi
# (e) The fixture must be the KNOWN-BAD production file.
KNOWN_BAD_SHA="$(git -C "${REPO_ROOT}" show "${BASE_COMMIT}:${ALLOWED_PATH}" | shasum -a 256 | awk '{print $1}')"
if [ "${KNOWN_BAD_SHA}" != "${FIXTURE_SHA}" ]; then
    bad "M09 the candidate-visible fixture does NOT carry the KNOWN-BAD production file"
    LEAKS=$((LEAKS + 1))
else
    ok "M09 the candidate-visible fixture carries the KNOWN-BAD production file"
fi

# ---------------------------------------------------------------------------
# M10 — the fixture preparation uses a FRESH output directory.
# ---------------------------------------------------------------------------

echo ""
echo "--- M10 fixture preparation -> FRESH output directory ---"
mkdir -p "${WORK}/m10-existing"
echo "precious" > "${WORK}/m10-existing/precious.txt"
bash "${PREPARE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${WORK}/m10-existing" > "${WORK}/m10.out" 2>&1
rc=$?
if [ "${rc}" -ne 0 ]; then
    ok "M10 an existing output directory is REFUSED"
else
    bad "M10 an existing output directory was NOT refused"
fi
if [ "$(cat "${WORK}/m10-existing/precious.txt")" = "precious" ]; then
    ok "M10 the refused directory's content is intact"
else
    bad "M10 the refused directory's content was DELETED"
fi
bash "${PREPARE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${WORK}/m10-fresh" > "${WORK}/m10b.out" 2>&1
rc=$?
if [ "${rc}" -eq 0 ]; then
    ok "M10 a FRESH output directory is accepted"
else
    bad "M10 a FRESH output directory was NOT accepted"
fi

echo ""
echo "=== Summary ==="
echo "PASS=${PASS_COUNT}  FAIL=${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -gt 0 ]; then
    exit 1
fi
exit 0
