# Digest-driven Review

Step-by-step procedure for generating a reusable review prompt from a repository digest.

---

## Purpose

This playbook explains how to turn a repository digest into a ready-to-use Project Fitness Review prompt. The digest provides evidence, and the generated prompt guides a reviewer or LLM through a structured Factory evaluation.

This bridges the gap between the [targeted digest script](../../scripts/make_targeted_digest.sh) and the [Project Fitness Review framework](../evaluation/project-fitness-review.md).

---

## Inputs

Before starting, gather or create:

- **Repository digest** — A text file containing evidence about the project (see Step 1 below)
- **Project name** — The project identifier for the review
- **Reviewer** — Name or handle of the reviewer
- **Access level** — What access was available (public repo, full access, live system)
- **Scope** — What parts of the project were inspected or are relevant
- **Time budget** — How much time is available for the review

---

## Outputs

By the end of the playbook, you will have:

1. **A review prompt file** — A Markdown document that guides a reviewer through a Factory Project Fitness Review
2. **An embedded digest** — The source evidence is included in the prompt for reference

---

## Step 1: Create or Collect a Digest

A digest is a structured text file containing evidence about a repository. You can:

**Use `make_targeted_digest.sh`** for git-based digests:

```bash
# Digest staged changes
./scripts/make_targeted_digest.sh --staged --output build/digest.txt

# Digest all uncommitted changes
./scripts/make_targeted_digest.sh --dirty --output build/digest.txt

# Digest changes in a commit range
./scripts/make_targeted_digest.sh --range HEAD~10..HEAD --output build/digest.txt
```

**Create a manual digest** with content like:

```markdown
# Manual Digest: my-project

## Evidence Inspected
- README.md
- src/main.rs
- .github/workflows/ci.yml

## Key Observations
- Project has clear README with runnable examples
- CI pipeline runs `cargo test` and `cargo clippy`
- No integration tests visible

## Verified Claims
- Tests pass (ran `cargo test`)
- Code compiles without warnings

## Reported Claims
- "Production-ready" (README claim, not verified)
```

> **Tip:** A good digest separates verified, reported, and illustrative evidence. See the [Project Fitness Review framework](../evaluation/project-fitness-review.md) for evidence discipline guidelines.

---

## Step 2: Generate Review Prompt

Use `make_review_prompt.py` to generate the review prompt:

```bash
python3 scripts/make_review_prompt.py \
  --digest build/digest.txt \
  --output build/review-prompt.md \
  --project-name my-project \
  --review-date 2026-01-15 \
  --reviewer @yourhandle \
  --access-level "Public repo, read-only access" \
  --scope "Core source, CI pipeline, README only" \
  --time-budget "2 hours"
```

**Required arguments:**
- `--digest` — Path to the digest file
- `--output` — Path for the generated prompt

**Optional arguments:**
- `--project-name` — Project name (default: "Unnamed Project")
- `--review-date` — Date in YYYY-MM-DD format (default: today)
- `--reviewer` — Reviewer name or handle (default: "Reviewer")
- `--access-level` — Access description
- `--scope` — Scope description
- `--time-budget` — Time budget for review

---

## Step 3: Run Review

The generated prompt is a reusable instruction set for a reviewer or LLM. Use it to:

1. **Feed to an LLM** — Provide the prompt and ask for a structured review
2. **Guide a human reviewer** — Use the prompt as a checklist and template
3. **Iterate on the digest** — If the prompt reveals gaps, update the digest and regenerate

The prompt includes:
- Review identity metadata
- Evidence discipline rules
- Required output structure (executive summary, scorecard, dimension notes, strengths, risks, ACTs, confidence)
- Scoring guidelines (0–5 scale)
- Embedded digest for reference

---

## Step 4: Extract ACTs

After the review is complete, extract the 2–3 recommended ACTs:

1. **Identify the top improvements** from the review
2. **Format each as an ACT** using the [ACT template](../templates/act.md)
3. **Link to digest evidence** — Each ACT should cite specific digest evidence
4. **Add acceptance criteria** — What "done" looks like for each ACT
5. **Prioritize ruthlessly** — 2–3 maximum; if you have more, pick the highest impact

---

## Verification Checklist

Before considering the loop complete, verify:

- [ ] Digest file exists and is not empty
- [ ] Review prompt was generated successfully
- [ ] Prompt includes evidence discipline rules
- [ ] Prompt includes "Green CI is evidence, not proof" reminder
- [ ] Prompt includes "Do not score uninspected dimensions" warning
- [ ] Prompt requires 2–3 recommended ACTs
- [ ] Digest is embedded under "## Repository Digest" heading
- [ ] Reviewer confidence and blind spots are requested
- [ ] Generated prompt is readable and actionable

---

## Related References

| Document | Purpose |
| -------- | ------- |
| [Run a Project Fitness Review](./run-project-fitness-review.md) | Full step-by-step playbook for conducting reviews |
| [Project Fitness Review module](../evaluation/README.md) | Entry point and overview for the evaluation module |
| [Project Fitness Review framework](../evaluation/project-fitness-review.md) | Framework description and dimension definitions |
| [Review template](../evaluation/review-template.md) | Blank template for structured reviews |
| [Reviewer checklist](../evaluation/reviewer-checklist.md) | Compact quality checklist |
| [ACT template](../templates/act.md) | Format for individual ACTs |
| [make_targeted_digest.sh](../../scripts/make_targeted_digest.sh) | Script for generating git-based digests |
| [make_review_prompt.py](../../scripts/make_review_prompt.py) | Script for generating review prompts |

---

*This playbook is part of the Factory documentation. It connects the digest tooling to the Project Fitness Review framework.*
