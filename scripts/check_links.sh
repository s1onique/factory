#!/bin/bash
# Minimal link sanity checker for Factory documentation
# Verifies that key paths exist without introducing third-party dependencies

set -euo pipefail

ERRORS=0

check_path() {
    local label="$1"
    local path="$2"
    if [ -e "$path" ]; then
        echo "  ✓ $label ($path)"
    else
        echo "  ✗ $label ($path) - NOT FOUND"
        ERRORS=$((ERRORS + 1))
    fi
}

check_link_text() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo "  ✓ $label (link text found)"
    else
        echo "  ✗ $label (link text NOT found in $file)"
        ERRORS=$((ERRORS + 1))
    fi
}

echo "=== Factory Link Sanity Check ==="
echo ""

# Verify key paths exist
echo "Checking key paths..."
check_path "README.md" "README.md"
check_path "docs/README.md" "docs/README.md"
check_path "docs/concepts/" "docs/concepts"
check_path "docs/concepts/README.md" "docs/concepts/README.md"
check_path "docs/concepts/factory.md" "docs/concepts/factory.md"
check_path "docs/doctrine/" "docs/doctrine"
check_path "docs/doctrine/README.md" "docs/doctrine/README.md"
check_path "docs/playbooks/" "docs/playbooks"
check_path "docs/playbooks/README.md" "docs/playbooks/README.md"
check_path "docs/playbooks/run-project-fitness-review.md" "docs/playbooks/run-project-fitness-review.md"
check_path "docs/templates/" "docs/templates"
check_path "docs/templates/README.md" "docs/templates/README.md"
check_path "docs/templates/epic.md" "docs/templates/epic.md"
check_path "docs/templates/act.md" "docs/templates/act.md"
check_path "docs/templates/close-report.md" "docs/templates/close-report.md"
check_path "docs/templates/reviewer-prompt.md" "docs/templates/reviewer-prompt.md"
check_path "docs/evaluation/" "docs/evaluation"
check_path "docs/evaluation/README.md" "docs/evaluation/README.md"
check_path "docs/evaluation/review-template.md" "docs/evaluation/review-template.md"
check_path "docs/factory_presentation.tex" "docs/factory_presentation.tex"

echo ""

# Verify specific link patterns in files
echo "Checking link patterns..."

# docs/playbooks/README.md should link to ../evaluation/
check_link_text "docs/playbooks/README.md" "\.\./evaluation/" "playbooks -> evaluation/"
check_link_text "docs/playbooks/README.md" "run-project-fitness-review\.md" "playbooks -> run-project-fitness-review.md"

# docs/playbooks/run-project-fitness-review.md should link to evaluation and template docs
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./evaluation/README\.md" "playbook -> evaluation README"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./evaluation/project-fitness-review\.md" "playbook -> project-fitness-review.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./evaluation/reviewer-checklist\.md" "playbook -> reviewer-checklist.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./evaluation/review-template\.md" "playbook -> review-template.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./evaluation/scorecard\.md" "playbook -> scorecard.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./evaluation/examples/tovarisch-review\.md" "playbook -> tovarisch-review.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./templates/act\.md" "playbook -> act.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./templates/close-report\.md" "playbook -> close-report.md"
check_link_text "docs/playbooks/run-project-fitness-review.md" "\.\./templates/reviewer-prompt\.md" "playbook -> reviewer-prompt.md"

# docs/templates/README.md should link to ../evaluation/review-template.md
check_link_text "docs/templates/README.md" "\.\./evaluation/review-template\.md" "templates -> review-template.md"

# docs/templates/README.md should link to new template files
check_link_text "docs/templates/README.md" "epic\.md" "templates -> epic.md"
check_link_text "docs/templates/README.md" "act\.md" "templates -> act.md"
check_link_text "docs/templates/README.md" "close-report\.md" "templates -> close-report.md"
check_link_text "docs/templates/README.md" "reviewer-prompt\.md" "templates -> reviewer-prompt.md"

# docs/README.md should link to all sections (using directory links)
check_link_text "docs/README.md" "\./concepts/" "docs -> concepts/"
check_link_text "docs/README.md" "\./doctrine/" "docs -> doctrine/"
check_link_text "docs/README.md" "\./playbooks/" "docs -> playbooks/"
check_link_text "docs/README.md" "playbooks/run-project-fitness-review\.md" "docs -> run-project-fitness-review.md"
check_link_text "docs/README.md" "\./templates/" "docs -> templates/"
check_link_text "docs/README.md" "\./evaluation/" "docs -> evaluation/"
check_link_text "docs/README.md" "factory_presentation\.tex" "docs -> presentation"

# docs/concepts/README.md should link to factory.md
check_link_text "docs/concepts/README.md" "factory\.md" "concepts -> factory.md"

# Root README.md should link to docs/
check_link_text "README.md" "docs/README\.md" "root -> docs/"
check_link_text "README.md" "docs/evaluation/README\.md" "root -> evaluation/"

echo ""
echo "=== Done ==="

if [ $ERRORS -gt 0 ]; then
    echo "Found $ERRORS error(s)"
    exit 1
else
    echo "All checks passed"
    exit 0
fi
