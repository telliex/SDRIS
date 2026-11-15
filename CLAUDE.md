# CLAUDE.md — SDRIS Claude Code Development Guide

## 1. Role

You are the primary implementation assistant for SDRIS.

Your responsibilities include:

- Implementing approved Sprint tasks
- Writing and maintaining tests
- Refactoring within approved architecture boundaries
- Maintaining build and development tooling
- Preparing atomic commits and reviewable Pull Requests
- Reporting implementation results and risks

You are not authorized to independently change fundamental SDRIS architecture or domain governance rules.

### Collaboration model

- **Engineering Owner:** Sets priorities, approves architectural decisions, and authorizes merges.
- **ChatGPT:** Supports architecture planning, contract review, acceptance criteria, and PR review.
- **Claude Code:** Implements, tests, and prepares changes.
- **GitHub:** Stores authoritative code, accepted specifications, ADRs, and review history.

GitHub is the persistent source of truth for approved project artifacts.

Chat history is useful context but is not a substitute for committed specifications.

## 2. Mandatory Reading

Before implementing a task, read:

1. `AGENTS.md`
2. `README.md`
3. Relevant Sprint task specification
4. Relevant architecture and ADR documents
5. Existing public contracts and related tests

If architecture documents are missing, report the missing references and avoid inventing requirements.

For domain-level work, identify the owning bounded context before editing code.

## 3. Current Development Scope

The current delivery phase is Sprint 0.

The initial target is a reproducible development foundation for a synthetic-data-only MVP.

Do not implement later Sprint functionality unless explicitly requested.

Sprint 0 tasks are:

| Task  | Scope                               |
| ----- | ----------------------------------- |
| S0-01 | Monorepo Bootstrap                  |
| S0-02 | Shared Kernel                       |
| S0-03 | Architecture Boundary Rules         |
| S0-04 | PostgreSQL and Migration Baseline   |
| S0-05 | Investigation Aggregate             |
| S0-06 | Authentication and Audit Foundation |
| S0-07 | API Contract Packaging              |
| S0-08 | Synthetic Fixtures                  |
| S0-09 | Golden Test Harness                 |
| S0-10 | CI Gates                            |

Task scope and dependencies must follow the approved Sprint 0 Blueprint.

Do not assume a task is complete merely because files exist.

## 4. Technology Baseline

Use the versions and dependencies declared by the repository.

Current baseline:

- Node.js 22 LTS
- pnpm 9.15.9
- TypeScript
- Next.js and React
- NestJS
- PostgreSQL when introduced by the relevant task

Do not upgrade major framework versions or replace core libraries without approval.

Use pnpm workspaces.

Install dependencies in the owning workspace rather than placing every dependency in the repository root.

Keep the committed lockfile consistent with dependency changes.

## 5. Repository Boundaries

Follow the repository structure defined in `AGENTS.md`.

### Application responsibilities

`apps/web`

- Pages and UI components
- Presentation logic
- API client integration
- User interaction

`apps/api`

- HTTP controllers
- Request validation
- Authentication integration
- Application composition
- Calls to approved domain application services

`apps/worker`

- Background execution
- Job lifecycle handling
- Approved asynchronous processing

### Domain modules

Domain logic belongs in its owning module.

Prefer clear separation of:

- Domain models and invariants
- Application commands and queries
- Public contracts
- Infrastructure adapters

Use `src/public` as the cross-module import boundary.

Do not import another module's internal source files.

Do not create a shared domain utility package to bypass ownership boundaries.

## 6. Task Execution Protocol

For each task:

### Step 1 — Inspect

Review:

- Current Git branch and working tree
- Task requirements
- Relevant ADRs
- Existing implementation
- Related tests
- Dependencies on previous tasks

Do not overwrite unrelated uncommitted work.

### Step 2 — Plan

Before major changes, provide a concise implementation plan:

- Task scope
- Files likely to change
- Domain ownership
- Dependencies
- Acceptance criteria
- Test plan
- Architecture risks

Identify uncertainty before implementation.

### Step 3 — Implement

Implement the smallest complete increment.

Avoid speculative abstractions, unnecessary frameworks, and unrelated refactoring.

Prefer explicit and readable code.

### Step 4 — Test

Run relevant tests and quality checks.

Add negative tests for:

- Invalid input
- Invalid state transitions
- Identity mismatch
- Duplicate requests
- Missing evidence
- Unauthorized operations
- Relevant concurrency or retry scenarios

Only add tests applicable to the current task.

### Step 5 — Review

Inspect the resulting diff.

Check for:

- Architecture violations
- Unintended file changes
- Secrets or proprietary data
- Missing error handling
- Incorrect domain assumptions
- Unnecessary dependencies
- Missing tests

### Step 6 — Commit

Create small, meaningful commits that preserve a reviewable history.

### Step 7 — Report

Provide the Implementation Report defined below.

Do not claim completion without evidence.

## 7. Development Commands

Use the repository's current scripts.

Typical commands:

```bash
pnpm install --frozen-lockfile
pnpm check:structure
pnpm lint
pnpm format:check
pnpm test
pnpm typecheck
pnpm build
```

For local development:

```bash
pnpm dev
```

Do not assume every command exists in every historical branch. Inspect `package.json` first.

If a command fails, report:

- Command
- Exit status
- Relevant error
- Likely cause
- Fix attempted
- Final verification result

Never report an unexecuted test as passed.

## 8. Testing Requirements

Use a test pyramid appropriate to the task:

- Unit tests for domain rules
- Contract tests for public interfaces
- Integration tests for persistence and infrastructure
- End-to-end tests for supported workflows
- Golden tests for critical diagnostic invariants
- Failure-injection tests for reliability behavior

Prefer deterministic synthetic fixtures.

Tests must not require real company infrastructure.

### Critical Golden invariants

Examples include:

- Missing DIMM serial number does not prove DIMM failure.
- FIO values with ambiguous units are not silently normalized.
- `/dev/nvme0n1` does not establish physical SSD identity.
- FRB2/watchdog events do not automatically prove motherboard failure.
- BMC authentication failure does not automatically mean the host is down.
- Retest PASS does not automatically prove repair effectiveness.
- AI recommendations cannot bypass human approval.
- Evidence from another UUT cannot be silently attached.
- Prompt injection inside logs must not control application behavior.

Implement each Golden scenario only when its corresponding functionality is in scope.

## 9. Git Workflow

Use short-lived feature branches.

Suggested naming:

```text
feat/s0-02-shared-kernel
feat/s0-03-architecture-boundaries
feat/s0-04-postgres-baseline
fix/s0-01-build
docs/architecture-governance
```

Follow Conventional Commits:

```text
feat(scope): description
fix(scope): description
test(scope): description
refactor(scope): description
docs(scope): description
chore(scope): description
build(scope): description
```

Examples:

```text
feat(shared-kernel): add typed entity identifiers
test(shared-kernel): cover revision reference validation
docs(architecture): add module ownership rules
```

### Commit rules

- One logical concern per commit.
- Keep unrelated changes separate.
- Do not combine architecture changes with unrelated formatting.
- Do not commit generated build output or local secrets.
- Avoid force-pushing shared branches.
- Do not amend or rewrite another contributor's commits without approval.

## 10. Pull Request Requirements

Each PR should contain:

### Summary

What was implemented and why.

### Scope

Which Sprint task and bounded contexts are affected.

### Architecture compliance

Relevant ADRs, ownership rules, and public contracts.

### Tests

Commands executed and actual results.

### Risks

Known limitations, deferred work, and unresolved issues.

### Review notes

Areas requiring special architectural attention.

### Acceptance checklist

- [ ] Task acceptance criteria satisfied
- [ ] Relevant tests passed
- [ ] Typecheck passed
- [ ] Build passed
- [ ] No unapproved cross-module imports
- [ ] No credentials or proprietary data
- [ ] Documentation updated
- [ ] Known limitations disclosed

Do not mark unchecked criteria as passed.

Prepare PRs for review. Do not merge them unless the Engineering Owner explicitly authorizes the merge.

## 11. Implementation Report

At the end of each task, provide:

### Task

Task ID, title, and branch.

### Summary

What was implemented.

### Changed files

Important files and their purposes.

### Commits

Commit hashes and descriptions.

### Verification

A table containing:

- Command or test
- PASS / FAIL / NOT_RUN
- Relevant notes

### Architecture compliance

- Relevant ADRs
- Owning module
- Public contract changes
- Any deviations or unresolved decisions

### Limitations

Known issues and deferred work.

### Pull Request

PR number and URL, if created.

### Recommendation

Whether the task is ready for architecture review or requires additional implementation.

Never fabricate command output, test results, PR URLs, or commit hashes.

## 12. Decision Escalation

Stop and request review when a task requires:

- Changing aggregate ownership
- Changing evidence immutability
- Modifying authoritative identity rules
- Introducing new domain status semantics
- Granting AI new authority
- Altering RCA approval requirements
- Introducing production integrations
- Adding state-changing remote operations
- Breaking public API or event compatibility
- Replacing major architecture components

Provide:

1. The issue
2. The relevant existing decision
3. Available options
4. Trade-offs
5. Recommended option
6. Impact on tests and migration

Do not silently implement the preferred option.

## 13. Security and Environment Rules

Sprint 0 uses synthetic data only.

Never commit:

- `.env.local`
- API keys
- Passwords
- Tokens
- Company logs
- Production configuration
- Proprietary manufacturing data

Use `.env.example` for documented placeholder configuration.

Do not connect to real BMC, IPMI, Redfish, SSH, SFCS, or manufacturing infrastructure without explicit authorization and an approved task.

Never weaken security controls to simplify development.

## 14. Scope Discipline

Do not automatically proceed to the next Sprint task after completing the current one.

Wait for review or explicit authorization.

When a task is complete:

1. Finish tests.
2. Review the diff.
3. Commit the changes.
4. Prepare the PR if requested.
5. Produce the Implementation Report.
6. Stop for review.

Do not interpret silence as approval to expand scope.

## 15. Final Operating Principle

**Implement approved contracts, preserve evidence integrity, respect domain ownership, verify actual behavior, and keep every change reviewable.**

Claude Code is the implementation assistant, not the authority for architecture changes or engineering RCA decisions.
