#!/usr/bin/env bash
# LH-04 frozen-contract guard.
#
# Compares the current source-tree state of the LH-04 deterministic
# fault laboratory against the accepted immutable base:
#
#   LH_04_FROZEN_HEAD = a8caa82655ca6036bc40a43be5000bdda5bb84bf
#
# Required negative oracle:
#   MODIFY_LH04_FROZEN_FILE -> FAIL (HALT_LH04_FROZEN_SUBSTRATE_MODIFIED)
#
# After LH04_FREEZE_COMMIT, any modification to the protected paths is a
# halt. The guard is a `git diff` against the accepted base for the
# specific paths under test, NOT a working-tree-dirt check.
#
# The guard also fails closed if LH_04_FROZEN_HEAD is missing from the
# repository's object database (a future operator cannot rely on a head
# that does not exist).

set -u

LH_04_FROZEN_HEAD="d50f6d88ab42c4b26462d00038876d1756f0f172"
LH_04_FROZEN_PRE_FREEZE_HEAD="a8caa82655ca6036bc40a43be5000bdda5bb84bf"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Confirm the frozen head exists in this repository's object database.
if ! git cat-file -e "$LH_04_FROZEN_HEAD" 2>/dev/null; then
  echo "=== LH-04 frozen-contract guard ==="
  echo "LH_04_FROZEN_HEAD = $LH_04_FROZEN_HEAD"
  echo
  echo "FACTORY_LH04_FROZEN_HEAD_MISSING = TRUE"
  echo "HALT_LH04_FROZEN_HEAD_UNAVAILABLE"
  exit 1
fi

lh04_diff=0

if ! git diff --exit-code \
    "$LH_04_FROZEN_HEAD" -- \
    labs/long-horizon-harness/fault-lab/deterministic \
    labs/long-horizon-harness/test/lh04 \
    labs/long-horizon-harness/qualification/lh04-deterministic-faults.json \
    > /tmp/lh04_frozen_diff.txt 2>&1; then
  lh04_diff=1
fi

echo "=== LH-04 frozen-contract guard ==="
echo "LH_04_FROZEN_HEAD = $LH_04_FROZEN_HEAD"
echo

if [ "$lh04_diff" -ne 0 ]; then
  echo "LH_04_CHANGED = TRUE"
  echo "--- lh-04 diff ---"
  cat /tmp/lh04_frozen_diff.txt
  echo "------------------"
  echo "MODIFY_LH04_FROZEN_FILE -> FAIL"
  LH_04_CHANGED=TRUE
else
  echo "LH_04_CHANGED = FALSE"
  LH_04_CHANGED=FALSE
fi

echo
echo "FACTORY_LH04_FROZEN_DISPOSITION=OK"

if [ "$lh04_diff" -ne 0 ]; then
  echo
  echo "HALT_LH04_FROZEN_SUBSTRATE_MODIFIED"
  exit 1
fi
