#!/bin/bash
# test_lh06_frozen.sh — adversarial tests for the LH-06 frozen verifier.
#
# Required cases (per ACT §31..§32):
#
#   LH06-FREEZE-CONTROL01   committed packet                => PASS
#   LH06-FREEZE-NEG01       result byte changed             => FAIL (result SHA)
#   LH06-FREEZE-NEG02       witness result_sha256 forged    => FAIL
#   LH06-FREEZE-NEG03       telemetry byte changed          => FAIL (telemetry SHA)
#   LH06-FREEZE-NEG04       telemetry line removed          => FAIL (line count)
#   LH06-FREEZE-NEG05       duration < 60min                => FAIL
#   LH06-FREEZE-NEG06       epochs < 500                    => FAIL
#   LH06-FREEZE-NEG07       lifecycle_drift_count = 1       => FAIL
#   LH06-FREEZE-NEG08       lifecycle_drift_by_scenario != {} => FAIL
#   LH06-FREEZE-NEG09       heap verdict pass=false         => FAIL
#   LH06-FREEZE-NEG10       latency verdict pass=false      => FAIL
#   LH06-FREEZE-NEG11       frozen_tree.changed = true      => FAIL
#   LH06-FREEZE-NEG12       substrate repo_commit != subject => FAIL
#   LH06-FREEZE-NEG13       publication durability ATOMIC   => FAIL
#   LH06-FREEZE-NEG14       RED packet removed              => FAIL
#   LH06-FREEZE-NEG15       wrong run_id in witness         => FAIL
#
# Each negative case copies the canonical packet into a sandbox,
# mutates exactly one property, and invokes the production
# verifier (scripts/verify_lh06_frozen.sh) with FACTORY_LH06_PACKET_ROOT
# pointing at the sandbox. This re-uses the same verifier authority
# (no parallel test-only validation logic).

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
verifier="${repo_root}/scripts/verify_lh06_frozen.sh"

if [ ! -x "${verifier}" ]; then
  echo "FAIL: verifier not executable: ${verifier}"
  exit 1
fi

packet_src="${repo_root}/labs/long-horizon-harness/qualification/lh06-qualification02"
freeze_src="${repo_root}/qualification/lh06-frozen.json"
red_in_lab_src="${repo_root}/labs/long-horizon-harness/qualification/lh06-red-2026-09-21"
red_root_src="${repo_root}/qualification/lh06-red-qualification01"

passes=0
failures=0
failed_names=()

pass() {
  echo "  PASS  $1"
  passes=$((passes + 1))
}

fail() {
  echo "  FAIL  $1"
  failures=$((failures + 1))
  failed_names+=("$1")
}

# create_sandbox <case_id>
#   Returns absolute path to a fresh sandbox that mirrors the
#   canonical packet layout. The sandbox includes:
#     <sandbox>/labs/long-horizon-harness/qualification/lh06-qualification02/
#     <sandbox>/qualification/lh06-frozen.json
#     <sandbox>/qualification/lh06-red-qualification01/   (read-only mirror)
#     <sandbox>/labs/long-horizon-harness/qualification/lh06-red-2026-09-21/ (read-only mirror)
#   The RED directories are mirrored from the canonical sources so
#   the RED-history guard remains satisfied unless the case
#   explicitly removes them.
create_sandbox() {
  local case_id="$1"
  local sandbox
  sandbox="$(mktemp -d -t lh06-freeze-${case_id}-XXXXXX)"
  mkdir -p "__SANDBOX__/labs/long-horizon-harness/qualification"
  mkdir -p "__SANDBOX__/qualification"
  cp -R "${packet_src}" "__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02"
  cp "${freeze_src}" "__SANDBOX__/qualification/lh06-frozen.json"
  cp -R "${red_in_lab_src}" "__SANDBOX__/labs/long-horizon-harness/qualification/lh06-red-2026-09-21"
  cp -R "${red_root_src}" "__SANDBOX__/qualification/lh06-red-qualification01"
  echo "__SANDBOX__"
}

# run_verifier <sandbox> <case_id> [red_root]
#   If red_root is provided, FACTORY_LH06_RED_ROOT is set so the
#   RED-history guard operates on the sandbox instead of the
#   canonical repo_root RED packet.
run_verifier() {
  local sandbox="$1"
  local case_id="$2"
  local red_root="${3:-}"
  local log rc
  log="$(mktemp -t lh06-verify-${case_id}-XXXXXX.log)"
  if [ -n "${red_root}" ]; then
    ( cd "${repo_root}" && FACTORY_LH06_PACKET_ROOT="${sandbox}" FACTORY_LH06_RED_ROOT="${red_root}" bash "${verifier}" > "${log}" 2>&1 )
  else
    ( cd "${repo_root}" && FACTORY_LH06_PACKET_ROOT="${sandbox}" bash "${verifier}" > "${log}" 2>&1 )
  fi
  rc=$?
  rm -f "${log}"
  echo "${rc}"
}

# run_neg <case_id> <description> <mutation_fn>
#   mutation_fn is a shell command. Use the literal token
#   __SANDBOX__ where you want the sandbox path; the function
#   substitutes it after the sandbox is created. This avoids
#   `set -u` blowing up on unbound __SANDBOX__ at call time.
#   __RED__ is replaced with the sandbox path (assumed to also
#   contain a mirror of the RED packet) so the RED-history guard
#   can be exercised safely.
run_neg() {
  local case_id="$1"
  local desc="$2"
  local mutation="$3"
  local sandbox rc
  sandbox="$(create_sandbox "${case_id}")"
  mutation="${mutation//__SANDBOX__/${sandbox}}"
  mutation="${mutation//__RED__/${sandbox}}"
  eval "${mutation}"
  rc="$(run_verifier "${sandbox}" "${case_id}" "${sandbox}")"
  rm -rf "${sandbox}"
  if [ "${rc}" -ne 0 ]; then
    pass "${case_id}  ${desc}"
  else
    fail "${case_id}  ${desc}  (verifier returned 0)"
  fi
}

# run_pos <case_id> <description>
run_pos() {
  local case_id="$1"
  local desc="$2"
  local sandbox rc
  sandbox="$(create_sandbox "${case_id}")"
  rc="$(run_verifier "__SANDBOX__" "${case_id}")"
  rm -rf "__SANDBOX__"
  if [ "${rc}" -eq 0 ]; then
    pass "${case_id}  ${desc}"
  else
    fail "${case_id}  ${desc}  (verifier returned ${rc})"
  fi
}

# ---------------------------------------------------------------------------
# CONTROL — committed packet must pass
# ---------------------------------------------------------------------------
echo "=== LH06-FREEZE control ==="
run_pos LH06-FREEZE-CONTROL01 "committed QUALIFICATION02 packet => PASS"

echo ""
echo "=== LH06-FREEZE negative corpus ==="

# NEG01 — flip one byte in result.json (changes SHA).
run_neg LH06-FREEZE-NEG01 "result byte changed => FAIL result SHA" \
  "printf X >> \"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\""

# NEG02 — forge witness.result_sha256 to a different value.
run_neg LH06-FREEZE-NEG02 "witness result_sha256 forged => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.commit.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.result_sha256=\"0000000000000000000000000000000000000000000000000000000000000000\";fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG03 — append a byte to telemetry (changes SHA but not line count).
run_neg LH06-FREEZE-NEG03 "telemetry byte changed => FAIL telemetry SHA" \
  "printf X >> \"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/telemetry.jsonl\""

# NEG04 — drop one telemetry line.
run_neg LH06-FREEZE-NEG04 "telemetry line removed => FAIL line count" \
  "head -n 31530 \"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/telemetry.jsonl\" > \"__SANDBOX__/lh06-tel.tmp\" && mv \"__SANDBOX__/lh06-tel.tmp\" \"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/telemetry.jsonl\""

# NEG05 — duration_ms < 3,600,000.
run_neg LH06-FREEZE-NEG05 "duration < 60min => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.duration_ms=3599999;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG06 — epochs_completed < 500.
run_neg LH06-FREEZE-NEG06 "epochs < 500 => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.epochs_completed=499;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG07 — lifecycle_drift_count = 1.
run_neg LH06-FREEZE-NEG07 "lifecycle_drift_count = 1 => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.semantic.lifecycle_drift_count=1;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG08 — lifecycle_drift_by_scenario non-empty.
run_neg LH06-FREEZE-NEG08 "lifecycle_drift_by_scenario non-empty => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.semantic.lifecycle_drift_by_scenario={\"LC11\":1};fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG09 — heap verdict pass=false.
run_neg LH06-FREEZE-NEG09 "heap verdict pass=false => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.resources.heap_verdict.pass=false;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG10 — latency verdict pass=false.
run_neg LH06-FREEZE-NEG10 "latency verdict pass=false => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.latency.verdict.pass=false;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG11 — frozen_tree.changed=true.
run_neg LH06-FREEZE-NEG11 "frozen_tree.changed = true => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.frozen_tree.changed=true;fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG12 — substrate.repo_commit != subject_commit.
run_neg LH06-FREEZE-NEG12 "substrate repo_commit != subject_commit => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.substrate.repo_commit=\"0000000000000000000000000000000000000000\";fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG13 — publication_durability = ATOMIC_ONLY.
run_neg LH06-FREEZE-NEG13 "publication durability ATOMIC_ONLY => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.publication_durability=\"ATOMIC_ONLY\";fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# NEG14 — RED packet removed (RED-history guard; sandbox-safe).
run_neg LH06-FREEZE-NEG14 "RED packet removed => FAIL" \
  "rm -f \"__RED__/qualification/lh06-red-qualification01/worker-result.json\""

# NEG15 — wrong run_id in witness.
run_neg LH06-FREEZE-NEG15 "wrong run_id in witness => FAIL" \
  "node -e 'const fs=require(\"fs\");const p=\"__SANDBOX__/labs/long-horizon-harness/qualification/lh06-qualification02/result.commit.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.run_id=\"deadbeefdeadbeef\";fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\n\")'"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Summary ==="
echo "PASS=${passes}  FAIL=${failures}"
if [ "${failures}" -gt 0 ]; then
  echo "FAILED: ${failed_names[*]}"
  exit 1
fi
exit 0
