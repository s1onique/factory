# Factory Project Fitness Reviewer Checklist

Use this checklist before, during, and after every review. Keep it visible. Do not skip steps to save time.

---

## Before Review

- [ ] **Scope the review.** What parts of the project will you actually inspect? Declare this upfront.
- [ ] **Define access level.** Public repo only? Full access? Live system? This affects what you can claim.
- [ ] **Set a time budget.** Rushed reviews produce vanity scores. Be honest about what you can verify in the time available.
- [ ] **Declare known blind spots.** Write them down before you start. Confirmation bias is real.

---

## Evidence Collection

- [ ] **List files inspected.** Commit hashes, specific paths, command outputs. Not "I looked at the project."
- [ ] **Run commands yourself.** Do not trust reported test results. Run `make test`, `make gate`, or equivalent.
- [ ] **Inspect the CI pipeline.** Read `.github/workflows/` or equivalent. What gates actually run?
- [ ] **Verify README claims.** If the README says "comprehensive tests," find them. If it says "production-ready," look for health checks, logs, and error handling.
- [ ] **Distinguish evidence types.** Mark each piece of evidence as:
  - **Verified** — you ran it, read it, or observed it directly
  - **Reported** — the project owner told you; not independently confirmed
  - **Illustrative** — provided as an example, not a verified artifact

> ⚠️ **Green CI is evidence, not proof.** A passing pipeline means the tests ran. It does not mean the product works.

---

## Scoring Discipline

- [ ] **Score what you inspected, not what you imagine.** If you did not look at the database layer, do not score it.
- [ ] **Every score above 3 needs concrete evidence.** "Seems good" is not evidence. File paths, command outputs, and line numbers are evidence.
- [ ] **Every 5/5 score needs reusable teaching value.** A 5 means the project can teach others. Can you point to it and say "do this"? If not, it is not a 5.
- [ ] **Score with the 0-5 scale in mind:**

  | Score | Meaning |
  | -----: | --------------------------------------------- |
  | **0** | Absent / actively harmful |
  | **1** | Weak / mostly implicit |
  | **2** | Present but inconsistent |
  | **3** | Usable / adequate |
  | **4** | Strong / repeatable |
  | **5** | Exemplary / teachable / reusable as doctrine |

---

## Anti-Overclaim Checks

- [ ] **Challenge every score.** Ask: "What would make me score this a 2 or a 3 instead?"
- [ ] **Check dimension correlation.** If operational truthfulness is high, test honesty often is too. Do not double-count.
- [ ] **Watch for Hawthorne effects.** Projects look better when the author knows you are reviewing. Look for evidence, not self-reports.
- [ ] **Scrutinize high totals.** 95–100 total scores are suspicious unless brutally verified. Ask: "Would a stranger believe this?"
- [ ] **Mark uninspected dimensions.** If you did not verify a dimension, say so. Do not fill in a score.

> ⚠️ **Do not score what you did not inspect.** Leaving a cell blank is more honest than guessing.

---

## Output Quality

- [ ] **Write for a stranger.** Someone who has never seen this project should be able to follow your review.
- [ ] **Link every score to evidence.** "Score: 4 — see `src/auth.go:45`, `make test` output, `schemas/auth-v1.json`"
- [ ] **Acknowledge blind spots explicitly.** What did you not verify? What would you need to confirm the scores?
- [ ] **Keep the executive summary honest.** Do not oversell. "Workable with a clear improvement path" is a valid verdict.
- [ ] **Check links.** All relative links should resolve to existing documents.

---

## Follow-up ACT Extraction

- [ ] **ACTs must be small.** "Refactor the entire backend" is not an ACT. "Add integration tests for the auth flow" is.
- [ ] **ACTs must be actionable.** Someone should be able to start on them the same day.
- [ ] **ACTs must be evidence-linked.** Each ACT should cite the gap it addresses. "Score was 2 because X; ACT fixes X."
- [ ] **ACTs must have effort estimates.** Without effort, priorities are meaningless.
- [ ] **Prioritize ruthlessly.** Recommend 2-3 ACTs maximum. If you recommend 10, nothing will be done.

> ⚠️ Recommended ACTs should be small, actionable, and evidence-linked. "Improve everything" is not an ACT.

---

## Reminders Summary

- **Green CI is evidence, not proof.**
- **Do not score what you did not inspect.**
- **Separate verified evidence from reported or illustrative evidence.**
- **Every score above 3 needs concrete evidence.**
- **Every 5/5 score needs reusable teaching value.**
- **95–100 total scores are suspicious unless brutally verified.**
- **Recommended ACTs should be small, actionable, and evidence-linked.**

---

## Related Documents

- [Project fitness review framework](./project-fitness-review.md): Full description of the 10 dimensions and scoring philosophy
- [Review template](./review-template.md): Blank template for conducting a structured review
- [Scorecard](./scorecard.md): Numeric interpretation of total scores and common pitfalls
- [Example review: KGB/tovarisch](./examples/tovarisch-review.md): Illustrative example demonstrating evidence-based scoring

---

*This checklist is part of the Factory Project Fitness Review framework. It reinforces evidence discipline and helps reviewers avoid vanity scoring. Keep it visible throughout every review.*
