# Run a Project Fitness Review

Step-by-step procedure for conducting an evidence-backed Project Fitness Review.

---

## Purpose

This playbook guides you through running a Factory Project Fitness Review—from receiving a repo URL to delivering an evidence-backed review with 2–3 actionable ACTs.

The goal is not to produce a vanity score. The goal is to give the project owner specific, evidence-linked steps they can act on immediately.

---

## When to use this playbook

Use this playbook when you need to:

- Evaluate a project's fitness for contribution, adoption, or further development
- Onboard to an unfamiliar codebase and orient quickly
- Identify specific, actionable improvements grounded in evidence
- Create a shared vocabulary for discussing software quality with a team

**Do not use this playbook** for:
- Benchmarking or ranking projects against each other
- Architecture purity contests
- Generating impressive-looking scores without evidence

The playbook works best on **real code**, **real pipelines**, and **real evidence**. It is not a substitute for reading the code, running the tests, and asking hard questions.

---

## Inputs

Before starting, gather:

- **Repository URL** or local path to the project
- **Access level:** public repo only, full access, or live system
- **Time budget:** How much time can you dedicate to this review?
- **Review scope:** What parts of the project will you actually inspect? Declare this upfront.

---

## Outputs

By the end of the playbook, you will have:

1. **A completed review template** with scores for each dimension you inspected
2. **2–3 concrete ACTs** with effort estimates and evidence links
3. **A confidence and blind spots statement** documenting what you could and could not verify
4. **Optionally:** A close report if this review is part of a larger Factory loop

---

## Step 1: Define review scope

Before touching any code, declare what you will and will not inspect.

1. **Identify the project purpose.** What is this project for? Who uses it? What does "success" mean?
2. **Set access boundaries.** Public repo? Full access? Live system? This affects what you can claim.
3. **Declare known blind spots.** Write them down before you start. Confirmation bias is real.
4. **Set a time budget.** A rushed review produces vanity scores. Be honest about what you can verify.

**Checkpoint:** You have a written scope statement. The project owner (if consulted) agrees with it.

---

## Step 2: Collect evidence

Evidence is not "I looked at the project." Evidence is specific files, command outputs, and observations.

1. **List the files you will inspect.** Commit hashes, paths, specific resources.
2. **Run commands yourself.** Do not trust reported test results. Run `make test`, `make gate`, or equivalent yourself.
3. **Inspect the CI pipeline.** Read `.github/workflows/` or equivalent. What gates actually run?
4. **Verify README claims.** If the README says "comprehensive tests," find them. If it says "production-ready," look for health checks, logs, and error handling.
5. **Mark evidence types:**
   - **Verified** — you ran it, read it, or observed it directly
   - **Reported** — the project owner told you; not independently confirmed
   - **Illustrative** — provided as an example, not a verified artifact

> ⚠️ **Green CI is evidence, not proof.** A passing pipeline means the tests ran. It does not mean the product behavior is correct. Always verify the test quality, not just the green light.

**Checkpoint:** You have a list of files and command outputs. Each piece of evidence is marked as verified, reported, or illustrative.

---

## Step 3: Inspect the project

Walk through the 10 dimensions. For each dimension you inspect:

1. **Read the dimension description** in the [Project Fitness Review framework](../evaluation/project-fitness-review.md).
2. **Find specific evidence.** Look for the signs of strength and warning signs documented in the framework.
3. **Score with discipline.** Use the 0–5 scale:
   - **0** — Absent / actively harmful
   - **1** — Weak / mostly implicit
   - **2** — Present but inconsistent
   - **3** — Usable / adequate
   - **4** — Strong / repeatable
   - **5** — Exemplary / teachable

4. **Link scores to evidence.** "Score: 4 — see `src/auth.go:45`, `make test` output"

> ⚠️ **Do not score what you did not inspect.** If you did not look at the database layer, do not score it. Leave the cell blank or mark it "unknown." Guessing is not evidence.

**Checkpoint:** You have inspected at least the core source, CI pipeline, and documentation. Each score is linked to specific evidence.

---

## Step 4: Score the 10 dimensions

Use the [Review template](../evaluation/review-template.md) or [Scorecard](../evaluation/scorecard.md) as your scoring sheet.

| Dimension | What to inspect |
| --------- | --------------- |
| 1. Purpose clarity | README, examples, boundary statements |
| 2. Architecture legibility | Directory structure, key files, entry points |
| 3. Change locality | Coupling, abstractions, config externalization |
| 4. Test and gate honesty | CI pipeline, test coverage, failure messages |
| 5. Operational truthfulness | Logging, metrics, error handling |
| 6. Contract discipline | Schemas, APIs, migrations |
| 7. LLM/human friendliness | File sizes, naming, documentation |
| 8. Resumability / cold start | Docs, decision logs, bootstrap scripts |
| 9. Evolutionary pressure | Bug tracking, dependency updates, retrospectives |
| 10. Doctrine extraction | Templates, patterns, reusable examples |

**Scoring discipline:**
- Every score above 3 needs concrete evidence. "Seems good" is not evidence.
- Every 5/5 score needs reusable teaching value. Can you point to it and say "do this"?
- A total score above 95 is suspicious unless brutally verified.
- Uninspected dimensions should be left blank or marked unknown, not guessed.

**Checkpoint:** Your scorecard is complete. Each score above 3 is linked to evidence. Uninspected dimensions are marked.

---

## Step 5: Write the review

1. **Executive summary** — 3–5 sentences. What did you find? What is the overall picture? Do not oversell.
2. **Dimension notes** — For each dimension you scored, write 1–3 sentences explaining why. Link to evidence.
3. **Top strengths** — 3–5 things the project does well.
4. **Top risks** — 3–5 concerns that threaten evolvability.
5. **Write for a stranger.** Someone who has never seen this project should be able to follow your review.

> ⚠️ **Keep claims modest.** "Workable with a clear improvement path" is a valid verdict. Do not claim more than the evidence supports.

**Checkpoint:** Your review is readable by someone with no context on the project. Every claim is traceable to evidence.

---

## Step 6: Extract 2–3 ACTs

An ACT (Actionable Change Target) is a small, concrete, time-bound increment.

1. **Identify the top gaps.** What are the 2–3 most impactful improvements based on your evidence?
2. **Write each ACT with:**
   - **Title** — Short imperative (e.g., "Add integration tests for auth flow")
   - **Rationale** — Why this matters, linked to your evidence
   - **Effort estimate** — In hours or days
   - **Acceptance criteria** — What "done" looks like

3. **Prioritize ruthlessly.** 2–3 ACTs maximum. If you recommend 10, nothing will be done.

> ⚠️ **"Improve everything" is not an ACT.** Each ACT must be something someone can start on the same day.

**Resources:**
- [ACT template](../templates/act.md) — Use this for formatting each ACT
- [Close report template](../templates/close-report.md) — Use this if the ACT is part of a larger loop

**Checkpoint:** You have 2–3 ACTs, each with rationale, effort, and acceptance criteria.

---

## Step 7: Record confidence and blind spots

1. **Declare your confidence level.** High, Medium, or Low. Explain why.
2. **List known blind spots.** What did you not verify? What would you need to confirm the scores?
3. **State your stakeholder perspective.** Are you a potential contributor? A downstream maintainer? An evaluator?

> ⚠️ **Honest blind spots strengthen the review.** They help the reader interpret the scores correctly.

**Checkpoint:** Your review explicitly acknowledges what you could and could not verify.

---

## Step 8: Publish or hand off the review

1. **Check all links.** Ensure relative links resolve to existing documents.
2. **Add reviewer sign-off.** Name and date.
3. **Deliver to the project owner.** If this is part of a larger loop, use the [Close report template](../templates/close-report.md).

**Resources:**
- [Reviewer checklist](../evaluation/reviewer-checklist.md) — Use this for a final quality check before publishing
- [Example review: KGB/tovarisch](../evaluation/examples/tovarisch-review.md) — Reference for style and evidence discipline

**Checkpoint:** The review is published, links are valid, and the project owner has received it.

---

## Verification checklist

Before publishing, verify:

- [ ] Review scope is declared upfront
- [ ] Evidence is specific (file paths, command outputs, line numbers)
- [ ] Green CI is acknowledged as evidence, not proof
- [ ] Uninspected dimensions are blank or marked unknown
- [ ] Each score above 3 is linked to evidence
- [ ] 2–3 ACTs with effort estimates and acceptance criteria
- [ ] Confidence and blind spots are documented
- [ ] Claims are modest and evidence-backed
- [ ] Links resolve correctly
- [ ] Review is readable by a stranger

---

## Common failure modes

| Failure | Why it happens | How to avoid it |
| ------- | --------------- | --------------- |
| **Vanity scoring** | Rushed review, desire to be positive | Set time budget; score what you inspect, not what you imagine |
| **Unverified claims** | Trusting README without inspection | Run commands yourself; verify every claim |
| **Green CI = all good** | Assuming passing tests = correct behavior | Inspect test quality; distinguish "tests pass" from "behavior is true" |
| **Guessing scores** | Pressure to fill every cell | Leave uninspected dimensions blank; say "unknown" |
| **Too many ACTs** | Trying to address everything | Prioritize ruthlessly; 2–3 maximum |
| **Overclaiming** | Hawthorne effect or self-review bias | Challenge every score; ask "would a stranger believe this?" |
| **No blind spots stated** | Fear of appearing incomplete | Document blind spots honestly; they strengthen the review |

---

## Related templates and references

| Document | Purpose |
| -------- | ------- |
| [Project Fitness Review module](../evaluation/README.md) | Entry point and recommended reading order for the evaluation module |
| [Project Fitness Review framework](../evaluation/project-fitness-review.md) | Full description of the 10 dimensions and scoring philosophy |
| [Reviewer checklist](../evaluation/reviewer-checklist.md) | Compact checklist for reviewers |
| [Review template](../evaluation/review-template.md) | Blank template for conducting a structured review |
| [Scorecard](../evaluation/scorecard.md) | Numeric interpretation of total scores |
| [Example review: KGB/tovarisch](../evaluation/examples/tovarisch-review.md) | Illustrative example with evidence-based scoring |
| [ACT template](../templates/act.md) | Format for individual ACTs |
| [Close report template](../templates/close-report.md) | Capture what changed, verification, and follow-ups |
| [Reviewer prompt template](../templates/reviewer-prompt.md) | Reusable prompt for reviewing ACT patches |

---

*This playbook is part of the Factory documentation. It turns the Project Fitness Review framework into an actionable sequence. See the evaluation module for the full framework reference.*
