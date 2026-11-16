# SDRIS — S0-05 Engineering Owner Approval

**Project:** Server Diagnostic & RCA Intelligence System (SDRIS)  
**Milestone:** S0-05 — Investigation Aggregate Foundation  
**Decision:** APPROVED WITH CHANGES  
**Authority:** Engineering Owner (approval communicated in the Claude Code session and recorded here)  
**Effective Scope:** S0-05 Domain Specification, Owner Decision Register, Persistence Policy, and Step 4 implementation  
**PR:** #6 — `feat/s0-05-persistence-dependency-policy`

This file is the committed record of the Owner's decision. The rest of the S0-05 documents are amended to match it; if
they ever disagree, this record is authoritative until the Owner says otherwise.

## 1. Approval Statement

The Engineering Owner approves the S0-05 Investigation Aggregate Foundation specification, subject to the decisions and
amendments below.

Claude Code is authorized to:

1. Update the S0-05 specification and Owner Decision Register.
2. Implement the approved domain and persistence model.
3. Replace FailureObservation-based operations and tests with CaseTestAttemptLink-based operations and tests.
4. Update the unreleased database migration as appropriate.
5. Complete all required architecture, domain, database, and compiled-runtime verification.
6. Commit the implementation in logically separated commits.
7. Trigger one Codex review after the final implementation commit.

This approval does not authorize merging PR #6, starting S0-06, or changing ADR-025/A1–A4 to ACCEPTED without their
separate approval.

## 2. Owner Decisions — Q1 to Q10

### Q1. Specification Approval

**APPROVED WITH CHANGES.**

Update the proposed specification to incorporate Q2–Q10 below.

The revised specification becomes the approved S0-05 domain baseline after its contents are verified against this
decision record.

### Q2. UUT Ownership

**APPROVED.**

For S0-05, Investigation owns the UUT entity and its persistence table in the `investigation` schema.

InvestigationCase and TestAttempt must reference the UUT using database foreign keys.

Potential future ownership transfer requires a separate architecture decision.

### Q3. UUT Attributes

**APPROVED.**

- Internal identity: UUIDv7.
- Serial number: optional, not globally unique.
- Hostname: optional, not globally unique.
- Store external identifiers exactly as supplied.
- No implicit trimming, case conversion, or normalization.
- Neither serial number nor hostname is an authoritative primary key.

### Q4. TestAttempt

**APPROVED WITH CHANGES.**

- Internal identity: UUIDv7.
- Each TestAttempt belongs to exactly one UUT.
- `stage` is required and uses a controlled vocabulary.
- Initial supported stages: `IST`, `SAT`.
- Additional stages require an explicit vocabulary extension.
- External execution reference is optional.
- External execution reference is not globally unique.
- No authoritative PASS/FAIL result field is introduced.
- TestAttempt is immutable after registration in S0-05.

Do not confuse the internal TestAttempt ID with an external execution reference.

### Q5. CaseTestAttemptLink Semantics

**APPROVED WITH CONDITIONS.**

Required roles:

- `INITIAL_FAILURE`
- `RETEST`
- `SUPPORTING`
- `CONTEXT`

Rules:

- A link connects one InvestigationCase and one TestAttempt.
- Both must belong to the same UUT.
- Database uniqueness: `(case_id, attempt_id, role)`.
- Multiple roles for the same Case–Attempt pair are permitted.
- Multiple `INITIAL_FAILURE` links are permitted.
- Identical repeated link requests are idempotent.
- A duplicate request must not silently overwrite conflicting data.
- Link roles are immutable after creation.
- No automatic role inference or role changes.
- RETEST does not imply RCA completion or repair effectiveness.

Cross-UUT linking must be rejected by both application logic and database constraints.

### Q6. Aggregate Boundaries and Concurrency

**APPROVED WITH CHANGES.**

- InvestigationCase is an Aggregate Root.
- CaseTestAttemptLink belongs to the InvestigationCase aggregate.
- Adding a new link increments the InvestigationCase version.
- A truly idempotent duplicate link request does not increment the version.
- UUT and TestAttempt are immutable after creation for S0-05.
- InvestigationCase uses optimistic concurrency control.
- Version checks must occur atomically in PostgreSQL.
- Concurrent stale writes must be rejected deterministically.
- Any retry must re-read authoritative state and re-evaluate the operation.
- No unlimited or hidden repository-level retries.

TransactionScope remains an Investigation-owned application port for S0-05.

### Q7. InvestigationCase Content

**APPROVED WITH CHANGES.**

InvestigationCase contains:

- Internal UUIDv7 identity.
- UUT reference.
- `opened_at` timestamp.
- Aggregate version.
- CaseTestAttemptLinks.

Retain `opened_at` as the time SDRIS opens the investigation.

Do not introduce an unapproved lifecycle state machine, description field, or validation limit.

Operational errors must distinguish at least:

- Case not found.
- Case already exists.
- Attempt not found.
- Cross-UUT link rejected.
- Optimistic concurrency conflict.

Error names and mappings must be documented and tested.

### Q8. FailureObservation

**APPROVED FOR REMOVAL FROM S0-05.**

FailureObservation is explicitly deferred.

Use the approved replacement-before-removal sequence:

1. Implement the CaseTestAttemptLink domain and persistence operations.
2. Replace transaction, rollback, concurrency, cross-UUT, and runtime integration tests.
3. Verify equivalent or stronger coverage.
4. Remove FailureObservation from the S0-05 production domain, schema, services, repository adapters, public contracts,
   and tests.

Preserve relevant design knowledge in documentation.

Do not implement Evidence or Diagnostics functionality as part of this removal.

### Q9. Deterministic Retrieval

**APPROVED WITH CHANGES.**

Linked TestAttempts must be returned in deterministic order:

1. `registered_at ASC`
2. `attempt_id ASC`
3. Role order:
   - INITIAL_FAILURE
   - RETEST
   - SUPPORTING
   - CONTEXT

This is SDRIS registration order, not necessarily the chronological order in which external tests were executed.

Do not rely on PostgreSQL's implicit row ordering.

### Q10. Timestamps

**APPROVED WITH CHANGES.**

Required timestamps:

| Entity              | Timestamp       |
| ------------------- | --------------- |
| UUT                 | `created_at`    |
| TestAttempt         | `registered_at` |
| InvestigationCase   | `opened_at`     |
| CaseTestAttemptLink | `linked_at`     |

Timestamps represent SDRIS record creation or registration events.

They are not substitutes for external test execution timestamps or audit history.

Use timezone-aware PostgreSQL timestamps and consistent UTC handling.

Do not infer actual execution times from UUIDv7 identifiers.

## 3. Persistence and Migration Authorization

The approved model must include:

- UUIDv7 primary keys.
- UUT foreign keys for InvestigationCase and TestAttempt.
- Referential integrity for CaseTestAttemptLink.
- Database-level cross-UUT protection.
- Approved uniqueness constraints.
- Atomic Case version updates.
- Transaction rollback.
- No unapproved SN, hostname, or execution-reference uniqueness constraints.

Because migration `0002` has not been released to a shared environment, it may be revised to reflect the approved final
S0-05 schema.

Before changing it, verify again that no shared or production environment depends on its previous checksum.

Do not reset or modify any shared database.

## 4. Architecture and ADR Governance

Maintain the established boundaries:

- Domain/Application must not depend on Drizzle or PostgreSQL drivers.
- Context infrastructure owns persistence adapters.
- Composition entrypoints expose contracts, not adapters.
- Only approved composition roots may access composition entrypoints.
- Testing-only entrypoints remain restricted.
- Compiled production runtime must work under supported Node.js without tsx.

ADR-025 and Amendments A1–A4 remain individually PROPOSED until separately approved.

Governance decisions:

1. Preserve amendments as independently traceable decision records.
2. Maintain a current effective-policy summary where appropriate.
3. Approval of the parent ADR does not automatically approve amendments.
4. A2's revision of A1 Rule 3 must be explicitly recorded.
5. Do not mark an ADR or amendment ACCEPTED merely because its implementation passes tests.

## 5. Required Acceptance Evidence

Complete the following verification:

- Domain tests for all four required concepts.
- PostgreSQL foreign-key and uniqueness tests.
- Same-UUT and cross-UUT link tests.
- Duplicate and multiple-role link tests.
- Atomic optimistic-concurrency tests.
- Deterministic stale-writer tests.
- Idempotency tests confirming no unnecessary version increment.
- Transaction commit and rollback tests.
- Deterministic retrieval-order tests.
- Public type-surface and architecture checks.
- Pure Node.js compiled-runtime tests.
- Fresh-clone installation, lint, formatting, typecheck, and build.
- Migration checksum validation.

All tests must use synthetic data.

## 6. Codex Review Authorization

After all S0-05 changes are committed and the final head SHA is confirmed:

**AUTHORIZED: Trigger one `@codex review` for the final head.**

Do not trigger it on an intermediate commit.

Wait for the result, investigate findings, and report the evidence.

Do not automatically merge PR #6.

## 7. Stop Conditions

Stop and request further Engineering Owner approval if implementation requires:

- A new bounded context or ownership transfer.
- A change to the approved identity or uniqueness model.
- A new lifecycle state machine.
- New authoritative test-result semantics.
- A new cross-context transaction mechanism.
- Changes to published migrations.
- Relaxation of architecture boundaries.
- Material changes outside S0-05.

## 8. Required Final Report

Return:

1. Updated Owner Decision Register.
2. Updated approved S0-05 specification.
3. Domain implementation summary.
4. Migration and schema changes.
5. FailureObservation removal evidence.
6. Test results and exact commands.
7. ADR-025/A1–A4 status.
8. Final head SHA.
9. Codex review findings and responses.
10. Remaining risks and merge-readiness recommendation.

**Final instruction: Implement the approved S0-05 scope, complete verification and Codex review, then stop for independent
SDRIS Architecture Acceptance. No merge. No S0-06.**
