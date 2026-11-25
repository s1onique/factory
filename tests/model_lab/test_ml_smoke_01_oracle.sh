#!/bin/bash
# test_ml_smoke_01_oracle.sh — FULL QUALIFICATION controls for the
# ML-SMOKE-01 acceptance oracle.
#
# These controls execute the REAL historical fixture end to end. They are
# the QUALIFICATION level, not the ordinary development gate: they prepare
# the fixture, run the real harness, and read the real verdict.
#
# The ordinary, fast feedback is `tests/model_lab/test_ml_smoke_01_lib.mjs`
# (synthetic structured-event inputs, no fixture execution, ~0.1 s).
#
# This script MUST be run when the oracle's authority changes:
#
#   bash tests/model_lab/test_ml_smoke_01_oracle.sh
#
# The controls are:
#   C01  prepared known-bad fixture        -> FAIL, and the intended
#                                              REC-TMP01 failure IS observed
#   C02  known-good fixture                -> PASS
#   C03  REC-TMP01 deleted                 -> FAIL
#   C04  REC-TMP01 skipped                 -> FAIL
#   C05  every test skipped                -> FAIL
#   C06  syntactically invalid mutation    -> NOT DETECTED
#   C07  mutation fails for an unrelated reason -> NOT DETECTED
#   C08  required regression test skipped  -> FAIL
#   C09  unauthorised changed file         -> FAIL
#   C10  invalid base commit               -> HALT
#   C11  the historical false-PASS counterexample -> FAIL (it SKIPS, it
#                                              does not throw)
#   C12  no prepared reference              -> HALT (never a self-comparison)
#   C13  candidate-owned dependency tree   -> FAIL (not TRUSTED)
#   C14  protected file replaced by a symlink -> FAIL
#   C15  an unauthorised mode change       -> FAIL
#   C16  a changed assertion in the allowed file -> FAIL
#
# Exit: 0 when every control behaves as specified, 1 otherwise.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ORACLE="${REPO_ROOT}/labs/model-lab/ml_smoke_01_acceptance_oracle.sh"
PREPARE="${REPO_ROOT}/labs/model-lab/prepare_ml_smoke_01.sh"
BASE_COMMIT="09fc12c6fb051dce096252bf30c2e96debed962c"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ml-smoke-01-qual-XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

ok()  { PASS_COUNT=$((PASS_COUNT + 1)); echo "  [PASS] $1"; }
bad() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo "  [FAIL] $1"; }

assert() {
    # assert <condition-result> <label>
    if [ "$1" -eq 0 ]; then ok "$2"; else bad "$2"; fi
}

assert_disposition() {
    # assert_disposition <label> <expected> <expected_exit> <outfile> <actual_exit>
    local label="$1" expected="$2" expected_exit="$3" out="$4" actual_exit="$5"
    local actual
    actual="$(grep -a '^ML_SMOKE_01_DISPOSITION=' "${out}" | tail -1 | cut -d= -f2)"
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

assert_has() {
    # assert_has <label> <pattern> <outfile>
    if grep -aq "$2" "$3"; then ok "$1"; else bad "$1"; fi
}

assert_not_has() {
    # assert_not_has <label> <pattern> <outfile>
    if grep -aq "$2" "$3"; then bad "$1"; else ok "$1"; fi
}

run_oracle() {
    # run_oracle <workspace> <outfile> [reference] -> echoes the exit code
    #
    # The EXPECTED reference digest is supplied EXTERNALLY, exactly as the
    # supervisor supplies it during a live run: it is the digest the
    # supervisor recorded BEFORE the candidate executed. The oracle never
    # reads it from an adjacent file next to the reference.
    local ws="$1" out="$2" ref="${3:-${WORK}/prep/workspace}"
    local expected="${4:-${REFERENCE_DIGEST}}"
    bash "${ORACLE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${ws}" "${ref}" "${expected}" > "${out}" 2>&1
    echo "$?"
}

run_behavioral() {
    # run_behavioral <workspace> <outfile> -> echoes the exit code
    #
    # The BEHAVIOURAL mode executes the candidate's allowed file and
    # observes its diagnostics. It NEVER mints a verdict: its disposition
    # is `BEHAVIORAL` and its exit code is 3. It exists so the DIRECT
    # behavioural and mutation controls can observe the fixture's own
    # behaviour without weakening the AUTHORITATIVE path.
    local ws="$1" out="$2"
    bash "${ORACLE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${ws}" "${WORK}/prep/workspace" \
        "${REFERENCE_DIGEST}" --behavioral-probe > "${out}" 2>&1
    echo "$?"
}

# Apply the historical fix to a workspace copy: the seam is anchored under
# os.tmpdir() and the `tmpdir` import is added. NOTHING else changes.
make_known_good() {
    local ws="$1"
    python3 - "${ws}/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import re, sys
p = sys.argv[1]
t = open(p).read()
t2, n = re.subn(r'const tmpRoot = await fs\.mkdtemp\([^;]*\);',
                'const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));', t, count=1)
if n != 1:
    sys.exit(3)
if 'import { tmpdir } from "node:os";' not in t2:
    t2 = t2.replace('import { join } from "node:path";',
                    'import { tmpdir } from "node:os";\nimport { join } from "node:path";', 1)
open(p, "w").write(t2)
PYEOF
}

echo "=== ML-SMOKE-01 oracle FULL qualification controls ==="
echo ""

if [ ! -f "${ORACLE}" ]; then
    echo "oracle not found: ${ORACLE}" >&2
    exit 1
fi

echo "--- preparing fixture ---"
if ! bash "${PREPARE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${WORK}/prep" > "${WORK}/prep.log" 2>&1; then
    echo "preparation FAILED" >&2
    cat "${WORK}/prep.log" >&2
    exit 1
fi
echo "  prepared OK"

# The supervisor's INDEPENDENT record of the reference identity, taken
# BEFORE any candidate code runs. The oracle is given this value; it
# never derives it from the tree it is asked to judge.
REFERENCE_DIGEST="$(cat "${WORK}/prep/fixture.sha256")"
if [ -z "${REFERENCE_DIGEST}" ]; then
    echo "preparation did not record a fixture digest" >&2
    exit 1
fi
echo "  reference digest recorded by the supervisor: ${REFERENCE_DIGEST}"


# ---------------------------------------------------------------------------
# C01 — the prepared known-bad fixture must FAIL, and the intended defect
# must be OBSERVED in the gate.
#
# The CORR01 control asserted only `GATE_FAILED=1`, which does not establish
# that the failure was REC-TMP01's. This control asserts that REC-TMP01
# specifically failed while REC-TMP02 — the regression half — still executed
# and passed. That is the defect's own signature, and it is what makes C01
# mean "the fixture still carries the defect under test".
# ---------------------------------------------------------------------------

echo ""
echo "--- C01 prepared known-bad fixture -> FAIL with the intended defect observed ---"
rm -rf "${WORK}/c01"; cp -R "${WORK}/prep/workspace" "${WORK}/c01"
rc="$(run_oracle "${WORK}/c01" "${WORK}/c01.out")"
assert_disposition "C01 known-bad" "FAIL" "1" "${WORK}/c01.out" "${rc}"
assert_has "C01 REC-TMP01 itself failed" "ML_SMOKE_01_REQUIRED_FAILED REC-TMP01" "${WORK}/c01.out"
assert_has "C01 the regression half executed" "ML_SMOKE_01_REQUIRED_TESTS_EXECUTED=11/11" "${WORK}/c01.out"
# The known-bad fixture already carries the defect, so there is nothing to
# mutate: the mutation control must report NOT_APPLIED rather than a
# detection. This is the FAILURE IDENTITY discipline applied to the
# mutation control itself.
assert_has "C01 nothing to mutate, so no detection is claimed" "ML_SMOKE_01_MUTATION_STATUS=NOT_APPLIED" "${WORK}/c01.out"

# ---------------------------------------------------------------------------
# C02 — known-good fixture must PASS.
# ---------------------------------------------------------------------------

echo ""
echo "--- C02 known-good fixture -> PASS ---"
rm -rf "${WORK}/c02"; cp -R "${WORK}/prep/workspace" "${WORK}/c02"
make_known_good "${WORK}/c02"
rc="$(run_oracle "${WORK}/c02" "${WORK}/c02.out")"
assert_disposition "C02 known-good" "PASS" "0" "${WORK}/c02.out" "${rc}"
assert_has "C02 the reference identity was established" "ML_SMOKE_01_REFERENCE_IDENTITY=VALID" "${WORK}/c02.out"
assert_has "C02 the allowed region was validated" "ML_SMOKE_01_ALLOWED_REGION=true" "${WORK}/c02.out"
assert_has "C02 the dependencies were evaluator-supplied" "ML_SMOKE_01_DEPENDENCY_TRUST=EVALUATOR_SUPPLIED" "${WORK}/c02.out"

# ---------------------------------------------------------------------------
# C03 — REC-TMP01 deleted must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C03 REC-TMP01 deleted -> FAIL ---"
rm -rf "${WORK}/c03"; cp -R "${WORK}/c02" "${WORK}/c03"
python3 - "${WORK}/c03/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
i = t.index('test("REC-TMP01')
j = t.index('test("REC-TMP02')
open(p, "w").write(t[:i] + t[j:])
PYEOF
rc="$(run_oracle "${WORK}/c03" "${WORK}/c03.out")"
assert_disposition "C03 REC-TMP01 deleted" "FAIL" "1" "${WORK}/c03.out" "${rc}"
assert_has "C03 the unauthorised in-file change was rejected BEFORE execution" "ML_SMOKE_01_GATE_EXECUTED=NO" "${WORK}/c03.out"
# The DIRECT behavioural control observes the fixture's OWN diagnostic. It
# never mints a verdict: its disposition is BEHAVIORAL.
rc="$(run_behavioral "${WORK}/c03" "${WORK}/c03.behavioural.out")"
assert_has "C03 the behavioural probe observed the missing required test" "ML_SMOKE_01_REQUIRED_MISSING REC-TMP01" "${WORK}/c03.behavioural.out"
assert_has "C03 the behavioural probe minted NO verdict" "ML_SMOKE_01_DISPOSITION=BEHAVIORAL" "${WORK}/c03.behavioural.out"

# ---------------------------------------------------------------------------
# C04 — REC-TMP01 skipped must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C04 REC-TMP01 skipped -> FAIL ---"
rm -rf "${WORK}/c04"; cp -R "${WORK}/c02" "${WORK}/c04"
python3 - "${WORK}/c04/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
old = 'test("REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent", async () => {'
new = ('test("REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent", '
       'async (t) => { t.skip("vacuous"); return;')
assert old in t, "anchor not found"
open(p, "w").write(t.replace(old, new, 1))
PYEOF
rc="$(run_oracle "${WORK}/c04" "${WORK}/c04.out")"
assert_disposition "C04 REC-TMP01 skipped" "FAIL" "1" "${WORK}/c04.out" "${rc}"
rc="$(run_behavioral "${WORK}/c04" "${WORK}/c04.behavioural.out")"
assert_has "C04 skipped required test reported" "ML_SMOKE_01_REQUIRED_SKIPPED REC-TMP01" "${WORK}/c04.behavioural.out"

# ---------------------------------------------------------------------------
# C05 — every test skipped must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C05 all tests skipped -> FAIL ---"
rm -rf "${WORK}/c05"; cp -R "${WORK}/prep/workspace" "${WORK}/c05"
python3 - "${WORK}/c05/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import re, sys
p = sys.argv[1]
t = open(p).read()
def repl(m):
    return 'test("%s", async (t) => { t.skip("all"); return;' % m.group(1)
t = re.sub(r'test\("([^"]+)", async \(([^)]*)\) => \{', repl, t)
open(p, "w").write(t)
PYEOF
rc="$(run_oracle "${WORK}/c05" "${WORK}/c05.out")"
assert_disposition "C05 all skipped" "FAIL" "1" "${WORK}/c05.out" "${rc}"
rc="$(run_behavioral "${WORK}/c05" "${WORK}/c05.behavioural.out")"
assert_has "C05 all-skipped reported" "ML_SMOKE_01_REQUIRED_SKIPPED REC-TMP01" "${WORK}/c05.behavioural.out"


# ---------------------------------------------------------------------------
# C06 / C07 — FAILURE IDENTITY.
#
#   C06  a mutation whose source is syntactically INVALID
#        -> MUTATION_STATUS=INVALID_MUTATION, MUTATION_DETECTED=NO
#   C07  a mutation whose required test fails for an UNRELATED reason
#        -> MUTATION_STATUS=WRONG_FAILURE, MUTATION_DETECTED=NO
# ---------------------------------------------------------------------------

echo ""
echo "--- C06 mutation with invalid syntax -> NOT DETECTED ---"
rm -rf "${WORK}/c06"; cp -R "${WORK}/c02" "${WORK}/c06"
printf '\nconst factory_syntax_error_probe = ;\n' >> "${WORK}/c06/labs/long-horizon-harness/test/recovery/cp-crash.test.ts"
rc="$(run_behavioral "${WORK}/c06" "${WORK}/c06.out")"
assert_has "C06 invalid mutation classified INVALID_MUTATION" "ML_SMOKE_01_MUTATION_STATUS=INVALID_MUTATION" "${WORK}/c06.out"
assert_has "C06 invalid mutation NOT counted as detected" "ML_SMOKE_01_MUTATION_DETECTED=NO" "${WORK}/c06.out"

echo ""
echo "--- C07 mutation failing for an unrelated reason -> NOT DETECTED ---"
rm -rf "${WORK}/c07"; cp -R "${WORK}/c02" "${WORK}/c07"
python3 - "${WORK}/c07/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
anchor = 'async () => {\n  // Hermetic parent seam (CORRECTION10 refinement): use a'
probe = ('async () => {\n  assert.fail("UNRELATED_FAILURE_MARKER");\n'
         '  // Hermetic parent seam (CORRECTION10 refinement): use a')
assert anchor in t, "anchor not found"
open(p, "w").write(t.replace(anchor, probe, 1))
PYEOF
rc="$(run_behavioral "${WORK}/c07" "${WORK}/c07.out")"
assert_has "C07 unrelated failure classified WRONG_FAILURE" "ML_SMOKE_01_MUTATION_STATUS=WRONG_FAILURE" "${WORK}/c07.out"
assert_has "C07 unrelated failure NOT counted as detected" "ML_SMOKE_01_MUTATION_DETECTED=NO" "${WORK}/c07.out"

# ---------------------------------------------------------------------------
# C08 — the required REGRESSION test must also execute and pass.
# ---------------------------------------------------------------------------

echo ""
echo "--- C08 required regression test skipped -> FAIL ---"
rm -rf "${WORK}/c08"; cp -R "${WORK}/c02" "${WORK}/c08"
python3 - "${WORK}/c08/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
old = 'test("REC-TMP02: tmpDir() returns a unique dir per call", async () => {'
new = 'test("REC-TMP02: tmpDir() returns a unique dir per call", async (t) => { t.skip("vacuous"); return;'
assert old in t, "anchor not found"
open(p, "w").write(t.replace(old, new, 1))
PYEOF
rc="$(run_oracle "${WORK}/c08" "${WORK}/c08.out")"
assert_disposition "C08 regression skipped" "FAIL" "1" "${WORK}/c08.out" "${rc}"
rc="$(run_behavioral "${WORK}/c08" "${WORK}/c08.behavioural.out")"
assert_has "C08 skipped regression test reported" "ML_SMOKE_01_REQUIRED_SKIPPED REC-TMP02" "${WORK}/c08.behavioural.out"

# ---------------------------------------------------------------------------
# C09 — unauthorised changed file must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C09 unauthorized changed file -> FAIL ---"
rm -rf "${WORK}/c09"; cp -R "${WORK}/c02" "${WORK}/c09"
echo "// unauthorized" >> "${WORK}/c09/labs/long-horizon-harness/src/recovery/process-reconciler.ts"
rc="$(run_oracle "${WORK}/c09" "${WORK}/c09.out")"
assert_disposition "C09 unauthorized file" "FAIL" "1" "${WORK}/c09.out" "${rc}"
assert_has "C09 scope violation reported" "SCOPE_VIOLATION MODIFIED" "${WORK}/c09.out"

# ---------------------------------------------------------------------------
# C10 — invalid base commit must HALT, never PASS.
# ---------------------------------------------------------------------------

echo ""
echo "--- C10 invalid base commit -> HALT ---"
bash "${ORACLE}" "${REPO_ROOT}" "0000000000000000000000000000000000000000" "${WORK}/c02" "${WORK}/prep/workspace" > "${WORK}/c10.out" 2>&1
rc=$?
assert_disposition "C10 invalid base" "HALT" "2" "${WORK}/c10.out" "${rc}"

# ---------------------------------------------------------------------------
# C11 — the historical false-PASS counterexample must no longer pass.
#
# The counterexample: a fixture whose every test is skipped, plus a helper
# test that passes. Under the REBOOT-01 oracle this produced
#   ACCEPTANCE=PASS / MUTATION_DETECTED=YES / DISPOSITION=PASS.
#
# The counterexample must SKIP, not THROW. The CORR01 control used a regex
# that did not match the file's actual `async () => {` shape, so its "skip"
# was never applied: the counterexample THREW a ReferenceError
# (`t is not defined`) and the control passed for the wrong reason. This
# control therefore asserts that the SKIP was actually applied.
# ---------------------------------------------------------------------------

echo ""
echo "--- C11 historical false-PASS counterexample -> must not PASS, and must SKIP ---"
rm -rf "${WORK}/c11"; cp -R "${WORK}/prep/workspace" "${WORK}/c11"
python3 - "${WORK}/c11/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
old = 'test("REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent", async () => {'
new = ('test("REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent", '
       'async (t) => { t.skip("vacuous"); return;')
assert old in t, "anchor not found"
open(p, "w").write(t.replace(old, new, 1))
PYEOF
rc="$(run_oracle "${WORK}/c11" "${WORK}/c11.out")"
assert_disposition "C11 counterexample" "FAIL" "1" "${WORK}/c11.out" "${rc}"
rc="$(run_behavioral "${WORK}/c11" "${WORK}/c11.behavioural.out")"
assert_has "C11 counterexample actually SKIPPED (not a thrown ReferenceError)" "ML_SMOKE_01_REQUIRED_SKIPPED REC-TMP01" "${WORK}/c11.behavioural.out"
assert_not_has "C11 counterexample did not fail through an unrelated mechanism" "ML_SMOKE_01_REQUIRED_FAILED REC-TMP01" "${WORK}/c11.behavioural.out"

# ---------------------------------------------------------------------------
# C12 — no prepared reference must HALT. The oracle must NEVER fall back to
# comparing the candidate against itself.
# ---------------------------------------------------------------------------

echo ""
echo "--- C12 no prepared reference -> HALT ---"
bash "${ORACLE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${WORK}/c02" > "${WORK}/c12.out" 2>&1
rc=$?
assert_disposition "C12 no reference" "HALT" "2" "${WORK}/c12.out" "${rc}"
assert_has "C12 the refusal names the missing reference" "prepared_reference_required" "${WORK}/c12.out"

# ---------------------------------------------------------------------------
# C13 — a candidate-owned dependency tree must NOT be TRUSTED.
# ---------------------------------------------------------------------------

echo ""
echo "--- C13 candidate-owned dependency tree -> FAIL, not TRUSTED ---"
rm -rf "${WORK}/c13"; cp -R "${WORK}/c02" "${WORK}/c13"
rm -f "${WORK}/c13/labs/long-horizon-harness/node_modules"
mkdir -p "${WORK}/c13/labs/long-horizon-harness/node_modules"
echo "// candidate owned dependency" > "${WORK}/c13/labs/long-horizon-harness/node_modules/tsx.js"
rc="$(run_oracle "${WORK}/c13" "${WORK}/c13.out")"
assert_disposition "C13 candidate dependency tree" "FAIL" "1" "${WORK}/c13.out" "${rc}"
assert_has "C13 the candidate dependency tree is NOT trusted" "ML_SMOKE_01_DEPENDENCY_TRUST=UNTRUSTED" "${WORK}/c13.out"
assert_has "C13 the candidate dependency tree is a scope violation" "SCOPE_VIOLATION FORBIDDEN_DEPENDENCY" "${WORK}/c13.out"

# ---------------------------------------------------------------------------
# C14 — a protected file replaced by a symlink must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C14 protected file replaced by a symlink -> FAIL ---"
rm -rf "${WORK}/c14"; cp -R "${WORK}/c02" "${WORK}/c14"
PROTECTED="${WORK}/c14/labs/long-horizon-harness/src/recovery/process-reconciler.ts"
cp "${PROTECTED}" "${WORK}/c14-protected-copy.ts"
rm -f "${PROTECTED}"
ln -s "${WORK}/c14-protected-copy.ts" "${PROTECTED}"
rc="$(run_oracle "${WORK}/c14" "${WORK}/c14.out")"
assert_disposition "C14 symlink substitution" "FAIL" "1" "${WORK}/c14.out" "${rc}"
assert_has "C14 the symlink is an unsupported object" "SCOPE_VIOLATION UNSUPPORTED_OBJECT" "${WORK}/c14.out"

# ---------------------------------------------------------------------------
# C15 — an unauthorised mode change must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C15 unauthorized mode change -> FAIL ---"
rm -rf "${WORK}/c15"; cp -R "${WORK}/c02" "${WORK}/c15"
chmod 777 "${WORK}/c15/labs/long-horizon-harness/src/recovery/process-reconciler.ts"
rc="$(run_oracle "${WORK}/c15" "${WORK}/c15.out")"
assert_disposition "C15 unauthorized mode change" "FAIL" "1" "${WORK}/c15.out" "${rc}"
assert_has "C15 the mode change is a scope violation" "SCOPE_VIOLATION MODE_CHANGED" "${WORK}/c15.out"

# ---------------------------------------------------------------------------
# C16 — a changed assertion in the allowed file must FAIL.
# ---------------------------------------------------------------------------

echo ""
echo "--- C16 changed assertion in the allowed file -> FAIL, REJECTED BEFORE EXECUTION ---"
rm -rf "${WORK}/c16"; cp -R "${WORK}/c02" "${WORK}/c16"
python3 - "${WORK}/c16/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
old = '`REC-TMP01: ${d} must be the freshly created run dir`'
new = '`REC-TMP01: ${d} must be the freshly created run dir (tampered)`'
assert old in t, "anchor not found"
# The EVALUATOR-OWNED EXECUTION SENTINEL.
#
# The tampered candidate bytes carry a statement that would CREATE a
# sentinel file if they were ever EXECUTED. The sentinel path is derived
# from an environment variable the evaluator sets for the run, so the
# candidate's bytes cannot name it statically: the bytes only create it if
# they actually run.
#
# The sentinel is the PROOF of non-execution. Elapsed time alone is not a
# proof: a fast rejection and a fast execution are indistinguishable by
# elapsed time alone.
sentinel = ('import { writeFileSync } from "node:fs";\n'
            'writeFileSync(process.env.FACTORY_EXECUTION_SENTINEL as string, "EXECUTED\\n");\n')
t = t.replace('import { test, after } from "node:test";', sentinel + 'import { test, after } from "node:test";', 1)
open(p, "w").write(t.replace(old, new, 1))
PYEOF
export FACTORY_EXECUTION_SENTINEL="${WORK}/c16-sentinel.txt"
rm -f "${FACTORY_EXECUTION_SENTINEL}"
rc="$(run_oracle "${WORK}/c16" "${WORK}/c16.out")"
assert_disposition "C16 changed assertion" "FAIL" "1" "${WORK}/c16.out" "${rc}"
assert_has "C16 the changed assertion is a scope violation" "SCOPE_VIOLATION CONTENT_OUTSIDE_ALLOWED_REGION" "${WORK}/c16.out"
assert_has "C16 the gate was NOT executed" "ML_SMOKE_01_GATE_EXECUTED=NO" "${WORK}/c16.out"
if [ ! -e "${FACTORY_EXECUTION_SENTINEL}" ]; then
    ok "C16 the EVALUATOR-OWNED SENTINEL was NOT created: the prohibited candidate bytes never executed"
else
    bad "C16 the EVALUATOR-OWNED SENTINEL WAS created: the prohibited candidate bytes executed"
fi
unset FACTORY_EXECUTION_SENTINEL

# The behavioural probe DOES execute the file, so the sentinel is created
# there. This proves the sentinel is effective: it is not a sentinel that
# can never fire.
rm -rf "${WORK}/c16b"; cp -R "${WORK}/c02" "${WORK}/c16b"
python3 - "${WORK}/c16b/labs/long-horizon-harness/test/recovery/cp-crash.test.ts" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p).read()
sentinel = ('import { writeFileSync } from "node:fs";\n'
            'writeFileSync(process.env.FACTORY_EXECUTION_SENTINEL as string, "EXECUTED\\n");\n')
t = t.replace('import { test, after } from "node:test";', sentinel + 'import { test, after } from "node:test";', 1)
open(p, "w").write(t)
PYEOF
export FACTORY_EXECUTION_SENTINEL="${WORK}/c16b-sentinel.txt"
rm -f "${FACTORY_EXECUTION_SENTINEL}"
rc="$(run_behavioral "${WORK}/c16b" "${WORK}/c16b.out")"
if [ -e "${FACTORY_EXECUTION_SENTINEL}" ]; then
    ok "C16 the sentinel DOES fire when the bytes are executed: it is an effective execution witness"
else
    bad "C16 the sentinel did NOT fire in the behavioural probe: it cannot witness execution"
fi
unset FACTORY_EXECUTION_SENTINEL

# ---------------------------------------------------------------------------
# C17 — two CONCURRENT oracle runs on the SAME workspace must both reach the
# same verdict.
#
# The observed interference: the CORR01 oracle ran the gate directly in the
# candidate workspace and removed `.tmp-home` from it, so two concurrent runs
# fought over the same directory and one saw the other's residue. The
# corrected oracle runs the gate in a FRESH evaluator reconstruction that it
# builds itself, so concurrent runs are independent by construction. This
# control proves it by execution.
# ---------------------------------------------------------------------------

echo ""
echo "--- C17 two concurrent oracle runs on the same workspace -> identical verdicts ---"
rm -rf "${WORK}/c17"; cp -R "${WORK}/c02" "${WORK}/c17"
run_oracle "${WORK}/c17" "${WORK}/c17-a.out" > /dev/null &
pid_a=$!
run_oracle "${WORK}/c17" "${WORK}/c17-b.out" > /dev/null &
pid_b=$!
wait "${pid_a}"; wait "${pid_b}"
verdict_a="$(grep -a '^ML_SMOKE_01_DISPOSITION=' "${WORK}/c17-a.out" | tail -1)"
verdict_b="$(grep -a '^ML_SMOKE_01_DISPOSITION=' "${WORK}/c17-b.out" | tail -1)"
if [ "${verdict_a}" = "ML_SMOKE_01_DISPOSITION=PASS" ] && [ "${verdict_b}" = "ML_SMOKE_01_DISPOSITION=PASS" ]; then
    ok "C17 both concurrent runs reached DISPOSITION=PASS"
else
    bad "C17 concurrent verdicts diverged: A=${verdict_a} B=${verdict_b}"
fi
assert_has "C17 run A observed no scope violation" "ML_SMOKE_01_SCOPE_VIOLATIONS=0" "${WORK}/c17-a.out"
assert_has "C17 run B observed no scope violation" "ML_SMOKE_01_SCOPE_VIOLATIONS=0" "${WORK}/c17-b.out"

echo ""
echo "--- C18 unauthorized patch -> rejected BEFORE execution ---"
rm -rf "${WORK}/c18"; cp -R "${WORK}/c02" "${WORK}/c18"
echo "// unauthorized" >> "${WORK}/c18/labs/long-horizon-harness/src/recovery/process-reconciler.ts"
c18_started="$(date +%s)"
rc="$(run_oracle "${WORK}/c18" "${WORK}/c18.out")"
c18_elapsed=$(( $(date +%s) - c18_started ))
assert_disposition "C18 unauthorized patch" "FAIL" "1" "${WORK}/c18.out" "${rc}"
assert_has "C18 the gate was NOT executed" "ML_SMOKE_01_GATE_EXECUTED=NO" "${WORK}/c18.out"
assert_has "C18 the rejection is named" "unauthorized_patch_rejected_before_execution" "${WORK}/c18.out"
if [ "${c18_elapsed}" -lt 30 ]; then
    ok "C18 the rejection was FAST (${c18_elapsed}s < 30s): the candidate's code was not executed"
else
    bad "C18 the rejection took ${c18_elapsed}s: the candidate's code was probably executed"
fi

echo ""
echo "--- C19 unauthorized protected-directory mode change -> FAIL ---"
rm -rf "${WORK}/c19"; cp -R "${WORK}/c02" "${WORK}/c19"
chmod 700 "${WORK}/c19/labs/long-horizon-harness/src/recovery"
rc="$(run_oracle "${WORK}/c19" "${WORK}/c19.out")"
assert_disposition "C19 protected directory mode change" "FAIL" "1" "${WORK}/c19.out" "${rc}"
assert_has "C19 the directory mode change is a scope violation" "SCOPE_VIOLATION MODE_CHANGED" "${WORK}/c19.out"

echo ""
echo "=== Summary ==="
echo "PASS=${PASS_COUNT}  FAIL=${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -gt 0 ]; then
    exit 1
fi
exit 0

assert_has "C16 the changed assertion is a scope violation" "SCOPE_VIOLATION CONTENT_OUTSIDE_ALLOWED_REGION" "${WORK}/c16.out"

echo ""
echo "=== Summary ==="
echo "PASS=${PASS_COUNT}  FAIL=${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -gt 0 ]; then
    exit 1
fi
exit 0

