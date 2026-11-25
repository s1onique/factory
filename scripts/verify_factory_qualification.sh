#!/bin/bash
# verify_factory_qualification.sh — the FULL adversarial qualification gate.
#
# This is the AUTHORITATIVE gate. It runs the fast gate AND the controls
# that execute the REAL historical fixtures end to end.
#
#   bash scripts/verify_factory_qualification.sh
#
# It MUST be run whenever the oracle's authority changes, and before any
# Model Lab candidate result is minted. It is intentionally slow: the real
# fixture is executed twice per control (once for the candidate, once for
# the mutant), and each execution starts a real Node test runner.
#
# Run from the Factory repo root.

set -euo pipefail

errors=0

echo "=== Factory FULL qualification gate (authoritative) ==="
echo ""

echo "--- 1/2 Factory FAST gate ---"
if bash scripts/verify_factory_fast.sh; then
    echo "  [OK]  fast gate green"
else
    echo "  [FAIL] fast gate is NOT green"
    errors=$((errors + 1))
fi
echo ""

echo "--- 2/3 Model Lab REAL-fixture qualification controls ---"
if bash tests/model_lab/test_ml_smoke_01_oracle.sh; then
    echo "  [OK]  Model Lab real-fixture qualification controls"
else
    echo "  [FAIL]  Model Lab real-fixture qualification controls detected a defect"
    errors=$((errors + 1))
fi
echo ""

echo "--- 3/3 Model Lab ML-06A production-code fixture qualification controls ---"
if bash tests/model_lab/test_ml_06a_qualification.sh; then
    echo "  [OK]  Model Lab ML-06A qualification controls"
else
    echo "  [FAIL]  Model Lab ML-06A qualification controls detected a defect"
    errors=$((errors + 1))
fi
echo ""

echo "=== Factory QUALIFICATION gate complete ==="
if [ "${errors}" -gt 0 ]; then
    echo "FACTORY_VERIFY_QUALIFICATION_DISPOSITION=FAIL (${errors} verifier(s) failed)"
    exit 1
fi
echo "FACTORY_VERIFY_QUALIFICATION_DISPOSITION=PASS"
exit 0
