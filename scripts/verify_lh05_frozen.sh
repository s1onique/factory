#!/bin/bash
# verify_lh05_frozen.sh — LH-05 adversarial lifecycle corpus guard.
#
# Verifies that the LH-05 qualification artifact exists, is
# JSON-valid, declares the canonical schema, contains 12
# scenarios, all PASS, and binds to the frozen LH-03 /
# LH-04 substrates.
#
# Run from the Factory repo root.

set -u

# Make sure node is on PATH (verifier may be invoked from a
# minimal environment without /opt/homebrew/bin).
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${repo_root}"

errors=0

echo "=== LH-05 frozen-contract guard ==="
echo ""

# 1. The qualification artifact must exist.
art="${repo_root}/labs/long-horizon-harness/qualification/lh05-adversarial-lifecycle-corpus.json"
if [ ! -f "${art}" ]; then
  echo "  [FAIL] ${art} does not exist"
  echo "FACTORY_LH05_VERIFY_DISPOSITION=FAIL"
  exit 1
fi
echo "  [OK] ${art} exists"

# 2. JSON-valid + schema + scenario count + verdict + TWO_RUN_SEMANTIC_REPEATABILITY.
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const j = JSON.parse(fs.readFileSync(path, "utf8"));
  const required = (k) => { if (j[k] === undefined) { console.error("missing key:", k); process.exit(1); } };
  required("schema");
  required("emitted_at");
  required("contract_version");
  required("subject");
  required("substrate");
  required("verdict");
  required("summary");
  required("scenarios");
  if (j.schema !== "lh05-adversarial-lifecycle-corpus/v1") { console.error("wrong schema:", j.schema); process.exit(1); }
  if (j.summary.scenario_count !== 12) { console.error("scenario_count must be 12, got", j.summary.scenario_count); process.exit(1); }
  if (j.summary.passed !== j.summary.total_runs) { console.error("not all scenarios PASS:", j.summary); process.exit(1); }
  if (j.substrate.two_run_semantic_repeatability !== true) { console.error("TWO_RUN_SEMANTIC_REPEATABILITY must be true"); process.exit(1); }
  if (j.substrate.byte_identical_result_artifact !== false) { console.error("byte_identical_result_artifact must be false"); process.exit(1); }
  if (j.substrate.live_execution_performed !== false) { console.error("live_execution_performed must be false (replay-only)"); process.exit(1); }
  if (j.verdict !== "PASS_ADVERSARIAL_LIFECYCLE_CORPUS") { console.error("verdict must be PASS_ADVERSARIAL_LIFECYCLE_CORPUS, got", j.verdict); process.exit(1); }
  console.log("  [OK]  schema =", j.schema);
  console.log("  [OK]  scenario_count = 12");
  console.log("  [OK]  verdict =", j.verdict);
  console.log("  [OK]  TWO_RUN_SEMANTIC_REPEATABILITY = true");
  console.log("  [OK]  byte_identical_result_artifact = false (per L05-C06)");
  console.log("  [OK]  live_execution_performed = false (replay-only)");
' "${art}"
if [ $? -ne 0 ]; then
  errors=$((errors + 1))
fi

# 3. The frozen LH-03 / LH-04 substrate files must exist.
for f in labs/long-horizon-harness/qualification/lh03-frozen.json labs/long-horizon-harness/qualification/lh04-frozen.json; do
  if [ ! -f "${repo_root}/${f}" ]; then
    echo "  [FAIL] frozen substrate ${f} does not exist"
    errors=$((errors + 1))
  else
    echo "  [OK]  frozen substrate ${f} exists"
  fi
done

echo ""
if [ "${errors}" -gt 0 ]; then
  echo "  [FAIL]  LH-05 frozen-contract guard detected ${errors} issue(s)"
  echo "FACTORY_LH05_VERIFY_DISPOSITION=FAIL"
  exit 1
fi

echo "  [OK]  LH-05 frozen-contract guard (adversarial lifecycle corpus intact)"
echo "FACTORY_LH05_VERIFY_DISPOSITION=OK"
exit 0
