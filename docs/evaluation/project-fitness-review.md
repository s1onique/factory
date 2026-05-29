# Factory Project Fitness Review

## What is this?

The Factory Project Fitness Review is a framework for evaluating whether a software project can evolve safely under real-world conditions. It is not a vanity ranking, not an architecture purity contest, and not a popularity contest.

Factory evaluates projects by **evolvability under real work**—whether they can be understood after cold start, changed in small safe increments, tested through honest gates, resumed after context loss, and improved through feedback loops.

This framework distills the practices developed from reviewing k9b, TRIM-Platform, KGB/tovarisch, InDeep, Orchid, blockstor, and related projects.

---

## Core philosophy

A good project should:

1. Be understandable after cold start
2. Be changeable in small safe increments
3. Pass honest tests and gates
4. Be resumable after context loss
5. Be friendly to both humans and LLM agents
6. Be honest about risks, debt, and unknowns
7. Turn repeated work into reusable doctrine

---

## The 10 Dimensions

### 1. Purpose clarity

**What it measures:** Can a newcomer understand what the project is for, who it serves, and what "good" means?

**What to inspect:**
- README: Does it explain the problem domain, target users, and success criteria?
- Examples: Are there runnable cases that demonstrate purpose?
- Edge case coverage: Does documentation explain what the project does NOT do?

**Signs of strength:**
- One-paragraph explanation that a non-author can understand
- Clear "this is for X, not for Y" boundary statements
- Example-driven documentation that shows before/after behavior

**Warning signs:**
- README is a list of technical features without context
- "It's like X but for Y" without explaining what X is
- Purpose is only in the author's head, not written down

---

### 2. Architecture legibility

**What it measures:** Can the major components, boundaries, data flows, and runtime paths be understood quickly?

**What to inspect:**
- Directory structure: Does the layout reflect the domain, not just technology?
- Key files: Can you identify entry points, main abstractions, and data stores?
- Dependency graph: Are there obvious architectural layers?
- Documentation: Is there a system overview, data flow diagram, or similar?

**Signs of strength:**
- Directory names reflect domain concepts
- Boundary layers (core, interfaces, infrastructure) are visible
- Key runtime paths are documented or traceable

**Warning signs:**
- Flat directory with hundreds of files
- Layering is implied but not enforced
- Only one person understands how components interact

---

### 3. Change locality

**What it measures:** Can meaningful changes be made surgically without touching half the codebase?

**What to inspect:**
- Coupling: Do changes in one module require changes in unrelated modules?
- Abstractions: Are there stable interfaces that isolate change?
- Config vs code: Are toggles, feature flags, and parameters externalized?
- Side effects: Do functions do more than their names suggest?

**Signs of strength:**
- A single feature can be added with changes in 1-3 files
- Abstractions have clear contracts that don't need modification for new features
- Configuration externalization makes behavior changes reversible

**Warning signs:**
- Adding a feature requires touching 10+ files across layers
- No abstractions—just direct database queries and HTTP calls scattered everywhere
- Configuration lives in source code as constants

---

### 4. Test and gate honesty

**What it measures:** Do tests and gates prove real behavior, or only produce comforting green lights?

**What to inspect:**
- Test coverage: Are critical paths tested, or just easy paths?
- Test realism: Do tests use mocks everywhere, or real behavior?
- Integration points: Do gates actually verify cross-component behavior?
- Failure diagnosis: When a test fails, is the failure message useful?

**Signs of strength:**
- Tests verify behavior, not implementation
- Integration tests exist for critical paths
- Test failures point to specific failure modes, not generic assertions
- CI gates include linting, type checks, unit tests, and integration tests

**Warning signs:**
- 100% line coverage but tests don't catch known bugs
- Everything mocked to the point of testing nothing
- "Tests pass" but the product still doesn't work
- Gate only runs a linter

> **Note:** A green CI pipeline is evidence, not proof. Reviewers must distinguish "tests pass" from "the product behavior is true."

---

### 5. Operational truthfulness

**What it measures:** Does the project expose runtime state, failure modes, diagnostics, and production reality?

**What to inspect:**
- Logging: Is there structured logging that helps diagnosis?
- Metrics: Are key operational metrics exposed?
- Health checks: Do services expose readiness and liveness endpoints?
- Error handling: Are errors surfaced, or swallowed silently?
- Production parity: Does local dev environment match production behavior?

**Signs of strength:**
- Structured logs with trace IDs, context, and timing
- Operational dashboard or metrics endpoint
- Clear error messages that help debug production issues
- Health checks that verify dependencies, not just process aliveness

**Warning signs:**
- Logs are just print statements or unstructured text
- Errors caught and "handled" by doing nothing
- Health check just returns "200 OK" regardless of actual state
- Works on dev machine, fails in production due to environment differences

---

### 6. Contract discipline

**What it measures:** Are schemas, APIs, migrations, config, and artifacts explicit and version-conscious?

**What to inspect:**
- Schema files: Are database schemas or data models version-controlled?
- API specs: Are REST/gRPC contracts documented with examples?
- Migrations: Is there a migration system, or " ALTER TABLE " in production?
- Config management: Are configuration schemas validated?
- Breaking changes: Are breaking changes tracked and communicated?

**Signs of strength:**
- Schema definitions are code, not implicit in ORM models
- API contracts are versioned and include request/response examples
- Forward-only migrations with explicit recovery/backfill strategy
- Config validation prevents silent misconfiguration

**Warning signs:**
- "Schema is whatever the ORM says it is"
- API responses have no documentation or version strategy
- Direct SQL changes with no migration tracking
- Config changes validated only at runtime

---

### 7. LLM/human friendliness

**What it measures:** Are files small, names clear, docs discoverable, and workflows agent-safe?

**What to inspect:**
- File size: Are files kept under ~300 lines?
- Naming: Do names reflect domain language?
- Documentation: Are there docstrings, comments, or READMEs in key places?
- Workflow scripts: Can workflows be executed by command or script, not just IDE?
- Context windows: Can an agent understand a file without reading 10 others?

**Signs of strength:**
- Files average under 200 lines
- Consistent naming conventions (e.g., snake_case, PascalCase)
- Key decisions explained in comments or docs
- Scripts and commands are documented
- Clear separation between "thin" and "fat" files

**Warning signs:**
- Files over 1000 lines with no clear reason
- Names like `utils`, `helper`, `manager` everywhere
- Documentation assumes context only the author has
- Complex workflows that require manual IDE steps
- No way for an agent to understand partial context

---

### 8. Resumability / cold start

**What it measures:** Can another person or agent resume work from docs, WALs, ACT reports, and repo state?

**What to inspect:**
- Documentation: Can a newcomer understand state from docs?
- Decision log: Are architectural decisions recorded?
- State snapshots: Is there a way to understand current project state?
- Session recovery: Can work resume after interruption?

**Signs of strength:**
- Decision log (e.g., ADR format) explains why, not just what
- Clear TODO/FIXME items that explain context
- Scripts for bootstrapping and state recovery
- Checkpoint or WAL system for resumable operations

**Warning signs:**
- All context is in the author's head or Slack messages
- No way to understand why a decision was made
- "Works on my machine" syndrome
- Must re-read entire codebase to understand current state

---

### 9. Evolutionary pressure

**What it measures:** Does the project have feedback loops that select better behavior over time?

**What to inspect:**
- Iteration tracking: Are bugs and improvements tracked and closed?
- Automated gates: Do CI/CD pipelines catch regressions before merge?
- Retrospectives: Is there a process for learning from failures?
- Dependency updates: Are dependencies kept current?

**Signs of strength:**
- Closed-loop bug tracking with evidence of resolution
- CI gates that catch regressions automatically
- Regular dependency updates with changelog review
- Process improvement tracking

**Warning signs:**
- Same bugs appear repeatedly without systemic fix
- No automated gates—code lands directly on main
- Dependencies never updated ("if it ain't broke...")
- No reflection on past failures

---

### 10. Doctrine extraction

**What it measures:** Does the project preserve lessons as reusable policy, templates, examples, or gates?

**What to inspect:**
- Templates: Are reusable patterns extracted into templates?
- Examples: Are examples maintained as runnable documentation?
- Policy: Are operational procedures written down?
- Contribution guide: Is there a clear path for external contributions?

**Signs of strength:**
- Patterns that worked are codified into templates
- Examples are kept in sync with code
- Operational runbooks exist for critical procedures
- Contribution guidelines explain not just "how" but "why"

**Warning signs:**
- Same mistake made twice before being codified
- Examples are stale or don't run
- Tribal knowledge only—must ask the author
- No distinction between "documentation" and "doctrine"

---

## Scoring scale

Each dimension is scored 0–5:

| Score | Meaning |
| -----: | -------------------------------------------------- |
| **0** | Absent / actively harmful |
| **1** | Weak / mostly implicit / high operator memory required |
| **2** | Present but inconsistent |
| **3** | Usable / adequate / some sharp edges |
| **4** | Strong / repeatable / mostly trustworthy |
| **5** | Exemplary / teachable / reusable as Factory doctrine |

---

## Scoring interpretation

Total score bands (0–39 to 95–100) and their meanings are documented in [scorecard.md](./scorecard.md).

> **Warning:** Scores of 95–100 should be treated skeptically unless backed by brutal evidence. Most projects that self-report such scores are overclaiming.

---

## Related documents

- [Review template](./review-template.md): Use this to conduct a review of a specific project
- [Scorecard](./scorecard.md): Numeric interpretation of total scores

---

## Examples

Illustrative example reviews demonstrating how to apply the framework:

- [KGB/tovarisch review](./examples/tovarisch-review.md): A constrained-node daemon evaluated against the 10 dimensions. Demonstrates evidence-based scoring, modest claims, and honest acknowledgment of blind spots.

> **Note:** Example reviews are illustrative, not canonical truth. They are meant to show how the framework can be applied, not to serve as benchmarks. See [scorecard.md](./scorecard.md) for a note on example reviews.
