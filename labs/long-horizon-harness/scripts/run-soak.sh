#!/bin/bash
# run-soak.sh — LH-06 deterministic soak runner.
#
# (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
#
# This script launches the LH-06 soak in-process with a
# synthetic CI_SMOKE profile. Use the QUALIFICATION profile
# via the supervisor for full 60-minute / 500-epoch
# qualification.
#
# Usage:
#
#   bash scripts/run-soak.sh
#
# Env:
#
#   LH06_PROFILE       CI_SMOKE | QUALIFICATION | EXTENDED
#   LH06_INJECTION     NONE | LEAK01..LEAK07
#   LH06_MAX_EPOCHS    integer (default 10 = CI_SMOKE minimum)

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
lab_root="$(cd "$here/.." && pwd)"

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

profile="${LH06_PROFILE:-CI_SMOKE}"
injection="${LH06_INJECTION:-NONE}"
max_epochs="${LH06_MAX_EPOCHS:-10}"

result_dir="$lab_root/qualification"
mkdir -p "$result_dir"

result_path="$result_dir/lh06-deterministic-soak.json"

cd "$lab_root"

# Use tsx to load the worker in-process. This is the
# CI-friendly path; production deployments use the
# supervisor script which spawns the worker as a child.
export LH06_PROFILE="$profile"
export LH06_INJECTION="$injection"
export LH06_MAX_EPOCHS="$max_epochs"
export LH06_RESULT_PATH="$result_path"

node --import tsx --expose-gc soak/worker-runner.ts 2>&1 | tail -30