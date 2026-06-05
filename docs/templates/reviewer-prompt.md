# Reviewer Prompt Template

> Give a reusable prompt for reviewing an ACT or epic patch.

---

## Review Target

<!-- What is being reviewed? (e.g., "ACT: Add user authentication", "Epic: Platform migration") -->

## Context

<!-- Brief context for the reviewer: Why does this work exist? What problem does it solve? -->

## Scope to Inspect

<!-- What aspects should the reviewer focus on? -->

- [ ] <!-- Specific area 1 -->
- [ ] <!-- Specific area 2 -->
- [ ] <!-- Specific area 3 -->

## Required Checks

<!-- Mandatory checks the reviewer must perform before approving -->

1. **Correctness** — Does the change do what it claims? Is the logic sound?
2. **Completeness** — Are acceptance criteria met? Is the close report accurate?
3. **Safety** — Are there regressions, data risks, or security concerns?
4. **Clarity** — Is the change understandable to future maintainers?
5. **Verification** — Did the author run and document verification?

## Rejection Triggers

<!-- Conditions that must result in rejection (request changes before merge) -->

- [ ] Incorrect behavior or broken logic
- [ ] Missing or incomplete acceptance criteria
- [ ] Verification commands fail or are absent
- [ ] Security, privacy, or safety violations
- [ ] Reviewer concerns unaddressed

## Output Format

<!-- Expected format for the review output -->

```
## Review Summary
<!-- One-paragraph overview -->

## Findings

### Must Fix
<!-- Issues that block approval -->

### Should Fix
<!-- Issues that should be addressed, but don't block -->

### Considerations
<!-- Optional improvements or suggestions -->

## Verdict
APPROVE / REQUEST CHANGES / REJECT

## Sign-off
Reviewer: <!-- Name -->
Date: <!-- YYYY-MM-DD -->
```
