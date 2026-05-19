#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

tex_file="${1:-docs/factory_presentation.tex}"
out_dir="${OUT_DIR:-build}"

if [[ ! -f "$tex_file" ]]; then
  echo "ERROR: LaTeX source not found: $tex_file" >&2
  exit 1
fi

mkdir -p "$out_dir"

latexmk \
  -xelatex \
  -interaction=nonstopmode \
  -halt-on-error \
  -file-line-error \
  -outdir="$out_dir" \
  "$tex_file"

echo "$out_dir/$(basename "${tex_file%.tex}.pdf")"
