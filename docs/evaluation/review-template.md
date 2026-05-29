# Project Fitness Review Template

Use this template to conduct a fitness review of any project. Copy it, fill in the sections, and score each dimension based on evidence.

---

## Project identity

**Project name:** <!-- e.g., k9b, my-service, trim-platform -->

**Version / commit inspected:** <!-- e.g., v2.1.0, abc123 -->

**Review date:** <!-- e.g., 2026-01-15 -->

**Reviewer:** <!-- e.g., Your name or handle -->

**Repository URL:** <!-- e.g., github.com/user/project -->

---

## Review scope

**Purpose of this review:**
<!-- Why are you reviewing this project? For onboarding? For improvement planning? For Factory doctrine extraction? -->

**Scope:**
<!-- What parts of the project did you inspect? e.g., core source, CI pipeline, documentation, deployment scripts -->

**Time spent:**
<!-- Approximate hours spent on this review -->

**Access level:**
<!-- What did you have access to? e.g., public repo only, full repo, live system -->

---

## Evidence inspected

List the specific files, commands, and resources you examined:

- <!-- e.g., README.md, src/main.rs, .github/workflows/ci.yml -->
- <!-- e.g., Ran `make test`, `make lint`, `docker-compose up` -->
- <!-- e.g., Reviewed metrics dashboard, error logs, migration files -->

---

## Executive summary

<!-- 3-5 sentences: What did you find? What is the overall fitness picture? What are the top concerns? -->

---

## Scorecard

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

---

## Dimension notes

### 1. Purpose clarity
<!-- What did you find? What evidence supports the score? -->

### 2. Architecture legibility
<!-- What did you find? What evidence supports the score? -->

### 3. Change locality
<!-- What did you find? What evidence supports the score? -->

### 4. Test and gate honesty
<!-- What did you find? What evidence supports the score? -->

### 5. Operational truthfulness
<!-- What did you find? What evidence supports the score? -->

### 6. Contract discipline
<!-- What did you find? What evidence supports the score? -->

### 7. LLM/human friendliness
<!-- What did you find? What evidence supports the score? -->

### 8. Resumability / cold start
<!-- What did you find? What evidence supports the score? -->

### 9. Evolutionary pressure
<!-- What did you find? What evidence supports the score? -->

### 10. Doctrine extraction
<!-- What did you find? What evidence supports the score? -->

---

## Top strengths

List 3-5 things the project does well:

1. <!-- e.g., Clear README with runnable examples -->
2. <!-- e.g., Comprehensive integration test coverage -->
3. <!-- e.g., Structured logging with trace IDs -->
4. <!-- e.g., Forward-only migration discipline -->
5. <!-- e.g., Agent-friendly file sizes -->

---

## Top risks

List 3-5 concerns that threaten evolvability:

1. <!-- e.g., No integration tests for critical paths -->
2. <!-- e.g., Monolithic files over 1000 lines -->
3. <!-- e.g., Configuration embedded in source code -->
4. <!-- e.g., No decision log for architectural choices -->
5. <!-- e.g., Dependencies 2+ years out of date -->

---

## Factory extraction candidates

What reusable patterns, templates, or doctrine could be extracted from this project?

| Pattern | Current location | Extraction target | Priority |
| ------- | ---------------- | ----------------- | -------- |
| <!-- e.g., WAL checkpoint script --> | <!-- e.g., scripts/wal.sh --> | <!-- e.g., scripts/template-wal.sh --> | High |
| <!-- e.g., API error handling --> | <!-- e.g., src/errors.go --> | <!-- e.g., docs/doctrine/error-handling.md --> | Medium |
| <!-- e.g., Config schema validation --> | <!-- e.g., src/config.go --> | <!-- e.g., docs/doctrine/config-contracts.md --> | Medium |

---

## Recommended next ACTs

What specific, actionable steps would improve this project's fitness?

1. **ACT:** <!-- e.g., Add integration tests for the auth flow -->
   **Rationale:** <!-- Why this matters -->
   **Effort:** <!-- e.g., 2-4 hours -->

2. **ACT:** <!-- e.g., Split the 1200-line main.go into domain modules -->
   **Rationale:** <!-- Why this matters -->
   **Effort:** <!-- e.g., 1 day -->

3. **ACT:** <!-- e.g., Document architectural decisions as ADRs -->
   **Rationale:** <!-- Why this matters -->
   **Effort:** <!-- e.g., 2-3 hours per ADR -->

---

## Reviewer confidence and blind spots

**Confidence level:** <!-- e.g., High, Medium, Low -->
<!-- Explain your confidence: How much of the project did you really understand? -->

**Known blind spots:**
- <!-- e.g., Did not inspect the database layer -->
- <!-- e.g., Only reviewed the happy path tests -->
- <!-- e.g., No access to production metrics -->

**Stakeholder perspective:**
- <!-- e.g., I am a potential contributor -->
- <!-- e.g., I am a downstream maintainer -->
- <!-- e.g., I am evaluating this project for adoption -->

---

## Sign-off

| Role | Name | Date |
| ---- | ---- | ---- |
| Reviewer | | |
| Project owner (if consulted) | | |

---

## Appendix: Raw evidence

Include raw notes, command outputs, screenshots, or other evidence here:

```
<!-- Paste command outputs, notes, etc. -->
```

---

*This template is part of the Factory Project Fitness Review framework. See [project-fitness-review.md](./project-fitness-review.md) for the full framework description.*
