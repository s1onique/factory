#!/usr/bin/env bash
# LH-03 frozen-contract guard.
#
# Compares the current source-tree state of immutable Phase E and
# LH-02 domains against the accepted immutable bases:
#
#   PHASE_E_FROZEN_HEAD = 61b0979
#   LH_02_FROZEN_HEAD   = 715e639
#
# Required negative oracles:
#   MODIFY_PHASE_E_FROZEN_FILE -> FAIL
#   MODIFY_LH02_FROZEN_FILE    -> FAIL
#
# This guard does NOT rely on working-tree dirt: it is a `git diff`
# against the accepted bases for the specific paths under test.

set -u

PHASE_E_FROZEN_HEAD="61b0979ebba52e391e1408561fb2c20a79d28af7"
LH_02_FROZEN_HEAD="715e6390d78228f089270259e1bd1307140adb75"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

phase_e_diff=0
lh_02_diff=0

if ! git diff --exit-code \
    "$PHASE_E_FROZEN_HEAD" -- \
    labs/long-horizon-harness/src/run \
    labs/long-horizon-harness/test/run > /tmp/lh03_phase_e_diff.txt 2>&1; then
  phase_e_diff=1
fi

if ! git diff --exit-code \
    "$LH_02_FROZEN_HEAD" -- \
    labs/long-horizon-harness/src/metrics \
    labs/long-horizon-harness/test/metrics > /tmp/lh03_lh02_diff.txt 2>&1; then
  lh_02_diff=1
fi

echo "=== LH-03 frozen-contract guard ==="
echo "PHASE_E_FROZEN_HEAD = $PHASE_E_FROZEN_HEAD"
echo "LH_02_FROZEN_HEAD   = $LH_02_FROZEN_HEAD"
echo

if [ "$phase_e_diff" -ne 0 ]; then
  echo "PHASE_E_CHANGED = TRUE"
  echo "--- phase-e diff ---"
  cat /tmp/lh03_phase_e_diff.txt
  echo "--------------------"
  echo "MODIFY_PHASE_E_FROZEN_FILE -> FAIL"
  PHASE_E_CHANGED=TRUE
else
  echo "PHASE_E_CHANGED = FALSE"
  PHASE_E_CHANGED=FALSE
fi

echo

if [ "$lh_02_diff" -ne 0 ]; then
  echo "LH_02_CHANGED = TRUE"
  echo "--- lh-02 diff ---"
  cat /tmp/lh03_lh02_diff.txt
  echo "------------------"
  echo "MODIFY_LH02_FROZEN_FILE -> FAIL"
  LH_02_CHANGED=TRUE
else
  echo "LH_02_CHANGED = FALSE"
  LH_02_CHANGED=FALSE
fi

echo
echo "FACTORY_LH03_FROZEN_DISPOSITION=OK"

if [ "$phase_e_diff" -ne 0 ] || [ "$lh_02_diff" -ne 0 ]; then
  echo
  echo "HALT_FROZEN_CONTRACT_MODIFIED"
  exit 1
fi
