# Factory Project Fitness Review

A framework for evaluating whether a software project can evolve safely under real-world conditions.

---

## When to use this

Use the Project Fitness Review when you want to:

- Understand a project's strengths and risks before contributing or adopting it
- Identify specific, actionable improvements (ACTs) grounded in evidence
- Create a shared vocabulary for discussing software quality
- Onboard to a project and orient quickly

The review works best on **real code**, **real pipelines**, and **real evidence**—not self-reports or marketing claims.

---

## What this is not

This framework is deliberately limited:

- **Not a vanity ranking.** High scores without evidence are noise. Every claim must be traceable to artifacts.
- **Not architecture purity scoring.** Clean architecture that doesn't ship is less valuable than pragmatic code that works.
- **Not a benchmark race.** A score of 40/100 for a prototype is honest; 90/100 for a greenfield project is suspicious.
- **Not a replacement for evidence.** No framework can substitute for reading the code, running the tests, and asking hard questions.

---

## Recommended reading order

Start here, then follow the links:

1. **[Project fitness review framework](./project-fitness-review.md)** — The full description of the 10 dimensions, scoring philosophy, and what each score means
2. **[Reviewer checklist](./reviewer-checklist.md)** — Compact checklist for reviewers: use before, during, and after every review
3. **[Review template](./review-template.md)** — Blank template for conducting a structured review of a specific project
4. **[Scorecard](./scorecard.md)** — Numeric interpretation of total scores and common scoring pitfalls

### Example review

5. **[KGB/tovarisch review](./examples/tovarisch-review.md)** — Illustrative example demonstrating evidence-based scoring, modest claims, and honest acknowledgment of blind spots

> Example reviews are teaching tools, not benchmarks. They show how to apply the framework; they are not canonical truth.

---

## Quick reference

| Dimension | What it measures |
| --------- | ---------------- |
| 1. Purpose clarity | Can a newcomer understand the project's purpose? |
| 2. Architecture legibility | Can the structure and boundaries be understood quickly? |
| 3. Change locality | Can changes be made surgically? |
| 4. Test and gate honesty | Do tests prove real behavior? |
| 5. Operational truthfulness | Does the project expose runtime state and errors? |
| 6. Contract discipline | Are schemas, APIs, and migrations explicit? |
| 7. LLM/human friendliness | Are files small and names clear? |
| 8. Resumability / cold start | Can another person resume work from docs? |
| 9. Evolutionary pressure | Does the project improve over time? |
| 10. Doctrine extraction | Are lessons preserved as reusable policy? |

**Scoring:** Each dimension scored 0–5. Total × 2 = 100-point score. See [scorecard.md](./scorecard.md) for interpretation.

---

*This framework distills practices from reviewing multiple real and illustrative software projects across platform engineering, developer tooling, operations, and product codebases. It is open to feedback and iteration.*
