# S0-05 — Investigation Aggregate Foundation

**Status:** APPROVED WITH CHANGES by the Engineering Owner ([approval record](S0-05-owner-approval.md)). The decisions of section 11 are part of this specification.  
**Sprint:** Sprint 0  
**Dependencies:** S0-02, S0-03, S0-04  
**Related ADR:** ADR-025, Amendments A1 and A2

## 1. Objective

Establish the Investigation bounded context's foundational domain model, persistence adapters, and application composition integration.

S0-05 must demonstrate that Investigation domain operations can be executed through approved repository ports and context-owned infrastructure adapters without violating architectural boundaries.

S0-05 does not implement AI diagnosis, repair workflows, RCA approval, or production integrations.

## 2. Required Domain Concepts

### UUT

Represents the server being tested.

- Internal UUIDv7 identity.
- External SN and hostname are optional attributes, not primary keys and not unique (section 11, Q3).
- One UUT may have multiple TestAttempts and InvestigationCases.
- External identifiers must not be silently treated as authoritative identity.

### TestAttempt

Represents one test execution.

- Internal UUIDv7 identity.
- References exactly one UUT.
- Records a test stage from a controlled vocabulary (`IST`, `SAT`) and an optional external execution reference (section 11, Q4).
- Does not directly own an InvestigationCase foreign key.
- Does not infer authoritative test results from incomplete evidence.

### InvestigationCase

Represents an investigation associated with one UUT.

- Internal UUIDv7 identity.
- References exactly one UUT.
- Supports multiple linked TestAttempts.
- Must not close automatically when a test passes.

### CaseTestAttemptLink

Represents an explicit many-to-many relationship.

Required roles:

- INITIAL_FAILURE
- RETEST
- SUPPORTING
- CONTEXT

Requirements:

- Both sides must reference the same UUT.
- Cross-UUT links must be rejected.
- Duplicate relationships are handled deterministically: an identical repeated request is idempotent (section 11, Q5).
- Linking a RETEST does not establish repair effectiveness or RCA.

## 3. Domain Scope

The minimum required lifecycle behavior is:

- Create and retrieve a UUT.
- Register and retrieve a TestAttempt.
- Open and retrieve an InvestigationCase.
- Link a TestAttempt to an InvestigationCase.
- Retrieve linked attempts and their roles.

Do not invent a detailed case lifecycle state machine in this task.

If lifecycle states are required by the implementation, propose them separately and obtain approval before enforcement.

Do not invent description length limits, trimming rules, or automatic normalization without an approved specification.

## 4. Aggregate and Ownership Rules

- UUT, TestAttempt, and InvestigationCase have independent identities.
- CaseTestAttemptLink is an explicit association.
- TestAttempt must not be duplicated for each InvestigationCase.
- Investigation owns its repository contracts and persistence adapters for the entities within its approved scope.
- Any UUT ownership outside Investigation must be resolved before enforcing cross-context foreign keys.

The exact aggregate boundaries must be documented and supported by tests.

## 5. Persistence Requirements

- PostgreSQL is authoritative.
- Use SQL-first migrations.
- Preserve migration checksum governance.
- Use UUIDv7 identifiers.
- Enforce appropriate database foreign keys and uniqueness constraints.
- Protect cross-UUT associations at both application and database levels.
- Use optimistic concurrency for mutable authoritative records.
- Ensure transaction rollback preserves consistency.

No production or company data is permitted in fixtures.

## 6. Architecture Requirements

- Domain and Application code must not depend on Drizzle or PostgreSQL drivers.
- Repository ports belong to the Investigation context.
- Persistence adapters belong under `src/infrastructure/**`.
- The approved composition entrypoint is `@sdris/investigation/composition`.
- Only approved composition roots may import that entrypoint.
- `src/public/**` must remain independent of private infrastructure.
- Preserve the A1/A2 architecture rules and negative regression fixtures.

Composition factories must expose public contracts, not concrete adapters.

## 7. Transaction Contract

The Investigation application layer may define its own `TransactionScope` port.

Its implementation must delegate to the approved database transaction infrastructure.

Requirements:

- Transaction ownership must be explicit.
- Repository operations in one logical transaction must share the same transaction context.
- Rollback must cover all affected operations.
- No Drizzle or driver types may appear in application-facing contracts.
- The final cross-context transaction policy remains deferred until another context demonstrates the requirement.

Do not move TransactionScope into Shared Kernel solely for reuse.

## 8. Runtime and Test Requirements

S0-05 must pass:

- Domain unit tests.
- Architecture boundary tests.
- PostgreSQL integration tests.
- Cross-UUT rejection tests.
- Optimistic concurrency tests.
- Transaction commit and rollback tests.
- Composition-root integration tests.
- Public API type-surface checks.
- Pure Node.js compiled-runtime smoke test.

A successful TypeScript build alone does not satisfy runtime acceptance.

## 9. Explicitly Deferred

- Detailed case lifecycle state machine.
- FailureObservation and EvidenceAnchor.
- AI diagnosis and recommendations.
- Repair and retest effectiveness assessment.
- RCA approval.
- Knowledge promotion.
- Production MiATS/SFCS integration.
- Cross-context transaction coordination.
- GitHub database CI integration (S0-10).

## 10. Acceptance Criteria

S0-05 is complete when:

1. All four domain concepts exist and have executable invariants.
2. Case–TestAttempt relationships are many-to-many.
3. Cross-UUT linking is rejected at application and database levels.
4. Repository ports and adapters follow approved boundaries.
5. UnitOfWork/TransactionScope behavior is verified.
6. Optimistic concurrency and rollback are verified against PostgreSQL.
7. Compiled composition code runs under supported Node.js without tsx.
8. Test-only database entrypoints cannot be imported by production source files.
9. Architecture, lint, typecheck, build, and integration tests pass.
10. ADR decisions and exceptions are documented.
11. Latest PR head receives independent Codex review.
12. Engineering Owner completes SDRIS architecture acceptance.

No automatic merge is authorized.

## 11. Owner-approved decisions (Q1 to Q10)

These are the Engineering Owner's decisions, recorded in [S0-05-owner-approval.md](S0-05-owner-approval.md). Where this
section and an earlier section differ, this section wins.

| #   | Topic                     | Approved decision                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q2  | UUT ownership             | Investigation owns the UUT entity and its table in the `investigation` schema. InvestigationCase and TestAttempt reference it with database foreign keys. A later ownership transfer needs a separate architecture decision.                                                                                                                                       |
| Q3  | UUT attributes            | UUIDv7 identity. Serial number and hostname are optional, not unique, stored exactly as supplied (no trimming, case conversion or normalisation) and never an authoritative key.                                                                                                                                                                                   |
| Q4  | TestAttempt               | UUIDv7 identity; exactly one UUT; `stage` is required and one of `IST`, `SAT` (extension needs an explicit vocabulary change); an optional external execution reference that is not unique and is distinct from the internal id; no PASS/FAIL result field; immutable after registration.                                                                          |
| Q5  | Link semantics            | Roles `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`. One case and one attempt of the same UUT. Unique `(case_id, attempt_id, role)`. Several roles per pair and several `INITIAL_FAILURE` links are allowed. An identical repeat is idempotent and never overwrites. Roles are immutable and never inferred. RETEST implies no RCA or repair effectiveness. |
| Q6  | Aggregate and concurrency | InvestigationCase is the aggregate root and owns its links. A new link increments the case version; an idempotent duplicate does not. UUT and TestAttempt are immutable. Optimistic concurrency is checked atomically in PostgreSQL, stale writes are rejected deterministically, retries re-read and re-evaluate, there are no hidden repository retries.         |
| Q7  | Case content              | UUIDv7 identity, UUT reference, `opened_at`, version, links. No lifecycle state machine, description or validation limit. Errors distinguish case not found, case already exists, attempt not found, cross-UUT link rejected and concurrency conflict; names are documented in section 12 and tested.                                                              |
| Q8  | FailureObservation        | Removed from S0-05 after the replacement tests exist (replace, verify, then remove). No Evidence or Diagnostics functionality is implemented.                                                                                                                                                                                                                      |
| Q9  | Retrieval order           | Linked attempts are ordered by `registered_at` ascending, `attempt_id` ascending, then role order `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`. This is SDRIS registration order, not external execution order. Implicit PostgreSQL ordering is never relied on.                                                                                           |
| Q10 | Timestamps                | UUT `created_at`, TestAttempt `registered_at`, InvestigationCase `opened_at`, link `linked_at`: `timestamptz`, UTC. They record SDRIS creation or registration, not external execution times and not audit history. Execution times are never inferred from UUIDv7.                                                                                                |

## 12. Operational error codes

Each code is raised by the layer shown and is covered by a test (see the test names in the implementation report).

| Code                                   | Meaning                                                                 | Raised by                               |
| -------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| `investigation.case_not_found`         | No case with this id                                                    | Application                             |
| `investigation.case_already_exists`    | A case with this id is already stored                                   | Repository (primary key)                |
| `investigation.uut_not_found`          | No UUT with this id                                                     | Application                             |
| `investigation.uut_already_exists`     | A UUT with this id is already stored                                    | Repository (primary key)                |
| `investigation.attempt_not_found`      | No TestAttempt with this id                                             | Application                             |
| `investigation.attempt_already_exists` | A TestAttempt with this id is already stored                            | Repository (primary key)                |
| `investigation.uut_mismatch`           | The case and the attempt belong to different UUTs; nothing was attached | Domain, and the database composite keys |
| `investigation.invalid_test_stage`     | The stage is not in the controlled vocabulary                           | Domain                                  |
| `investigation.invalid_link_role`      | The role is not one of the four roles                                   | Domain                                  |
| `investigation.concurrency_conflict`   | The stored version no longer equals the version the writer read         | Repository (atomic version predicate)   |

There is no HTTP mapping yet: `apps/api` has no controller for this context in S0-05.
