#!/usr/bin/env python3
"""
Digest-driven review prompt generator for Factory Project Fitness Reviews.

Turns a repository digest into a reusable review prompt that guides an LLM or
human reviewer through a Factory Project Fitness Review using the digest as
evidence.

Usage:
    python3 scripts/make_review_prompt.py \
        --digest path/to/digest.txt \
        --output build/review-prompt.md

Required args:
    --digest   Path to the digest file
    --output   Path for the generated review prompt

Optional args:
    --project-name   Project name (default: extracted from digest or "Unnamed Project")
    --review-date    Review date in YYYY-MM-DD format (default: today)
    --reviewer       Reviewer name or handle (default: "Reviewer")
    --access-level   Access level description (default: "Not specified")
    --scope          Review scope description (default: "Not specified")
    --time-budget    Time budget for review (default: "Not specified")
"""

import argparse
import sys
from datetime import date
from pathlib import Path


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Generate a Factory Project Fitness Review prompt from a digest.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--digest",
        required=True,
        help="Path to the digest file",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path for the generated review prompt",
    )
    parser.add_argument(
        "--project-name",
        default=None,
        help="Project name (default: extracted from digest or 'Unnamed Project')",
    )
    parser.add_argument(
        "--review-date",
        default=None,
        help="Review date in YYYY-MM-DD format (default: today's date)",
    )
    parser.add_argument(
        "--reviewer",
        default="Reviewer",
        help="Reviewer name or handle (default: 'Reviewer')",
    )
    parser.add_argument(
        "--access-level",
        default="Not specified",
        help="Access level description",
    )
    parser.add_argument(
        "--scope",
        default="Not specified",
        help="Review scope description",
    )
    parser.add_argument(
        "--time-budget",
        default="Not specified",
        help="Time budget for review",
    )
    return parser.parse_args()


def validate_inputs(args: argparse.Namespace) -> None:
    """Validate required inputs."""
    digest_path = Path(args.digest)
    
    # Check digest file exists
    if not digest_path.exists():
        print(f"ERROR: Digest file not found: {args.digest}", file=sys.stderr)
        sys.exit(1)
    
    # Check digest file is not empty
    if digest_path.stat().st_size == 0:
        print(f"ERROR: Digest file is empty: {args.digest}", file=sys.stderr)
        sys.exit(1)
    
    # Ensure output parent directory exists or create it
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)


def generate_prompt(args: argparse.Namespace) -> str:
    """Generate the review prompt Markdown."""
    # Read the digest content
    digest_path = Path(args.digest)
    digest_content = digest_path.read_text()
    
    # Set defaults
    review_date = args.review_date or date.today().isoformat()
    project_name = args.project_name or "Unnamed Project"
    
    # Build the prompt
    prompt = f"""# Factory Project Fitness Review Prompt

Use this prompt to guide a reviewer or LLM through a Factory Project Fitness Review.

---

## Review Identity

    - **Project name:** {project_name}
    - **Review date:** {review_date}
    - **Reviewer:** {args.reviewer}
    - **Access level:** {args.access_level}
    - **Scope:** {args.scope}
    - **Time budget:** {args.time_budget}

---

## Mission

Conduct a Factory Project Fitness Review of the repository described in the digest below. Your goal is not to produce a vanity score. The goal is to identify specific, evidence-backed recommendations that the project owner can act on immediately.

---

## Evidence Discipline

**CRITICAL: Use only evidence from the provided digest unless explicitly marked as assumption.**

- **Verified** — confirmed by the digest (file paths, command outputs, observed behavior)
- **Reported** — stated in the digest but not independently confirmed
- **Illustrative** — provided as an example, not a verified artifact

When you cannot determine something from the digest, say "unknown" rather than guessing.

> ⚠️ **Green CI is evidence, not proof.** A passing pipeline means the tests ran. It does not mean the product behavior is correct. Inspect test quality, not just the green light.

> ⚠️ **Do not score uninspected dimensions.** If a dimension was not covered in the digest, mark it "unknown" or leave it blank. Guessing is not evidence.

---

## Required Output Structure

Produce a review with the following sections:

### 1. Executive Summary

3–5 sentences describing:
- What the project does
- Overall fitness picture
- Top concerns
- Verdict (keep claims modest; "workable with improvement path" is valid)

### 2. Scorecard

Score each of the 10 Factory dimensions 0–5:

| Dimension | Score (0-5) | Evidence | Notes |
| --------- | :---------: | -------- | ----- |
| 1. Purpose clarity | | | |
| 2. Architecture legibility | | | |
| 3. Change locality | | | |
| 4. Test and gate honesty | | | |
| 5. Operational truthfulness | | | |
| 6. Contract discipline | | | |
| 7. LLM/human friendliness | | | |
| 8. Resumability / cold start | | | |
| 9. Evolutionary pressure | | | |
| 10. Doctrine extraction | | | |
| **Total (×2 = /100)** | | | |

**Scoring guidelines:**
- **0** — Absent / actively harmful
- **1** — Weak / mostly implicit
- **2** — Present but inconsistent
- **3** — Usable / adequate
- **4** — Strong / repeatable
- **5** — Exemplary / teachable

Every score above 3 must be linked to specific evidence from the digest.

### 3. Dimension Notes

For each dimension you scored, write 1–3 sentences explaining the score with evidence links.

### 4. Top Strengths

List 3–5 things the project does well, with evidence links.

### 5. Top Risks

List 3–5 concerns that threaten evolvability, with evidence links.

### 6. 2–3 Recommended ACTs

Each ACT must be:
- **Small** — achievable in hours or a few days
- **Actionable** — someone can start today
- **Evidence-linked** — rooted in specific digest evidence
- **Prioritized** — the most impactful improvement first

Format each ACT as:

**ACT:** [Short imperative title]

**Evidence:** [Link to digest evidence]

**Rationale:** [Why this matters]

**Effort:** [Estimated hours or days]

**Acceptance Criteria:**
- [ ] [Specific, verifiable criterion]
- [ ] [Specific, verifiable criterion]

> ⚠️ **Avoid vanity scoring and overclaiming.** "Workable with a clear improvement path" is a valid verdict. Do not claim more than the evidence supports.

### 7. Reviewer Confidence and Blind Spots

- **Confidence level:** High / Medium / Low
- **Explanation:** Why this level?
- **Known blind spots:** What could you not verify from the digest?
- **Stakeholder perspective:** Are you a potential contributor? Downstream maintainer? Evaluator?

---

## Scoring Discipline Checklist

Before finalizing, verify:
- [ ] Green CI acknowledged as evidence, not proof
- [ ] Uninspected dimensions marked "unknown" or blank
- [ ] Every score above 3 linked to digest evidence
- [ ] Claims are modest and evidence-backed
- [ ] 2–3 ACTs maximum with acceptance criteria

---

## Repository Digest

The following digest was prepared for this review:

```
{digest_content}
```

---

*This prompt was generated by Factory's digest-driven review prompt generator.

Reference docs:
- docs/playbooks/run-project-fitness-review.md
- docs/evaluation/project-fitness-review.md
*
"""
    return prompt


def write_output(prompt: str, output_path: Path) -> None:
    """Write the prompt to output file atomically."""
    # Write to temp file first, then rename for atomic write
    temp_path = output_path.with_suffix('.tmp')
    temp_path.write_text(prompt)
    temp_path.rename(output_path)


def main() -> None:
    """Main entry point."""
    args = parse_args()
    validate_inputs(args)
    prompt = generate_prompt(args)
    output_path = Path(args.output)
    write_output(prompt, output_path)
    print(f"Review prompt written to: {args.output}")


if __name__ == "__main__":
    main()