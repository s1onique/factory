# Factory Project Fitness Scorecard

This document provides the numeric interpretation of total scores from a Factory Project Fitness Review.

---

## Scoring system

The default scoring is simple:

- **10 dimensions × 5 points each = 50 raw points**
- **Raw score × 2 = 100-point score**

| Raw score | 100-point score |
| :-------: | :-------------: |
| 0 | 0 |
| 1 | 2 |
| 2 | 4 |
| 3 | 6 |
| 4 | 8 |
| 5 | 10 |
| 6 | 12 |
| 7 | 14 |
| 8 | 16 |
| 9 | 18 |
| 10 | 20 |
| 11 | 22 |
| 12 | 24 |
| 13 | 26 |
| 14 | 28 |
| 15 | 30 |
| 16 | 32 |
| 17 | 34 |
| 18 | 36 |
| 19 | 38 |
| 20 | 40 |
| 21 | 42 |
| 22 | 44 |
| 23 | 46 |
| 24 | 48 |
| 25 | 50 |
| 26 | 52 |
| 27 | 54 |
| 28 | 56 |
| 29 | 58 |
| 30 | 60 |
| 31 | 62 |
| 32 | 64 |
| 33 | 66 |
| 34 | 68 |
| 35 | 70 |
| 36 | 72 |
| 37 | 74 |
| 38 | 76 |
| 39 | 78 |
| 40 | 80 |
| 41 | 82 |
| 42 | 84 |
| 43 | 86 |
| 44 | 88 |
| 45 | 90 |
| 46 | 92 |
| 47 | 94 |
| 48 | 96 |
| 49 | 98 |
| 50 | 100 |

---

## Score bands

| 100-point score | Meaning | What it implies |
| :-------------: | -------------------------------------------------- | -------------------------------------------- |
| **0–39** | Fragile / mostly folklore | Project relies on tribal knowledge, no automated gates, high risk of regression |
| **40–59** | Useful but hard to evolve | Works for current use case but change is risky, tests are weak, docs incomplete |
| **60–74** | Workable project with visible improvement path | Adequate foundation, clear gaps to address, structured approach to improvement |
| **75–84** | Strong, teachable project | Good feedback loops, trustworthy gates, can onboard new contributors |
| **85–94** | Factory-grade reference | Exemplary in multiple dimensions, can be used as a teaching example |
| **95–100** | Rare; assume overclaiming unless brutally verified | Unlikely to achieve honestly; approach with skepticism unless evidence is ironclad |

---

## Using weighted scoring (optional)

Some reviewers may want to weight dimensions by importance for their context.

**Simple weighting approach:**

1. Assign a weight (1-3) to each dimension
2. Calculate weighted raw score: `sum(dimension_score × dimension_weight)`
3. Calculate max weighted score: `sum(5 × dimension_weight)`
4. Convert to 100-point: `(weighted_raw / max_weighted) × 100`

**Example weights for a production service:**

| Dimension | Weight | Rationale |
| --------- | :----: | -------------------------------------------------- |
| 1. Purpose clarity | 2 | Core for onboarding |
| 2. Architecture legibility | 2 | Needed for change locality |
| 3. Change locality | 3 | Critical for a service that evolves fast |
| 4. Test and gate honesty | 3 | Production safety |
| 5. Operational truthfulness | 3 | Production reliability |
| 6. Contract discipline | 2 | API stability matters |
| 7. LLM/human friendliness | 1 | Nice to have for this team |
| 8. Resumability / cold start | 2 | Team continuity |
| 9. Evolutionary pressure | 2 | Sustained quality |
| 10. Doctrine extraction | 1 | Nice to have |

If using weights, document them in your review so others can understand the scoring basis.

---

## Common scoring pitfalls

### Hawthorne effect
The project looks better when the author knows you're reviewing. Look for evidence, not just self-reports.

### Survivorship bias
Reviewed projects are often the ones that "survived." Many projects that scored lower were abandoned. Don't assume a high score means the approach is universally superior.

### Dimension correlation
Some dimensions correlate (e.g., operational truthfulness often goes with test honesty). Don't double-count their benefits.

### Context dependency
A score of 3 in "test honesty" means different things for a prototype vs a production service. Consider context when interpreting results.

### Green CI is not enough
A passing CI pipeline is evidence, not proof. The framework explicitly warns:
> **"A green CI pipeline is evidence, not proof. Reviewers must distinguish 'tests pass' from 'the product behavior is true.'"**

---

## Verifying score honesty

When reviewing a project (especially one's own), ask:

1. **Can you show evidence for each score?** If you can't point to a file, command, or test, the score is probably inflated.
2. **Would a stranger agree?** If someone with no context read your review, could they verify your claims?
3. **Are you confusing "our team survives" with "the project is fit"?** Tribal knowledge can prop up fragile projects.
4. **Is the total plausible?** A 95+ score requires evidence that spans all 10 dimensions with excellence. Be skeptical.

---

## Related documents

- [Project fitness review framework](./project-fitness-review.md): Full dimension descriptions and scoring scale
- [Review template](./review-template.md): Conduct a structured review of a specific project
