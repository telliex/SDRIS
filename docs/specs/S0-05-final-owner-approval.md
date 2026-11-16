# SDRIS — S0-05 Final Engineering Owner Approval

**Version:** 1.0  
**Decision:** APPROVED WITH CHANGES  
**Milestone:** S0-05 — Investigation Aggregate Foundation  
**Authority:** Engineering Owner  
**Approval source:** Explicit confirmation in the project conversation  
**Scope:** S0-05 Domain Specification, Owner Decision Register, Persistence Policy, FailureObservation Removal Plan, and Step 4 implementation  
**Pull Request:** #6

> **Authoritative.** This record supersedes [S0-05-owner-approval.md](S0-05-owner-approval.md),
> [S0-05-owner-approval-revised.md](S0-05-owner-approval-revised.md) and
> [S0-05-owner-clarification-addendum.md](S0-05-owner-clarification-addendum.md). A consolidation draft that preceded it
> (status "APPROVED WITH CHANGES — subject to the Engineering Owner's confirmation of the concurrency contract") is
> superseded as well: this document is that confirmation. The text below is recorded as the Owner supplied it.

---

## 1. Approval Authority and Precedence

The Engineering Owner approves the S0-05 domain design and authorizes implementation according to this document.

**This document supersedes all previous S0-05 Owner Approval drafts and clarification addenda.**

When earlier proposals conflict with this approval, this document takes precedence.

Claude Code must update the following documents to match the approved decisions:

- `docs/specs/S0-05-investigation-aggregate-foundation.md`
- `docs/specs/S0-05-owner-decision-register.md`
- `docs/specs/S0-05-proposed-persistence-policy.md`
- `docs/specs/S0-05-failureobservation-removal-plan.md`

Do not silently introduce additional business rules.

ADR-025 and Amendments A1–A4 retain their separate approval status.

---

## 2. Final Owner Decisions — Q1 to Q10

### Q1 — Specification Approval

**Decision: APPROVED WITH CHANGES**

Incorporate the decisions below into the S0-05 specification.

The resulting specification is the authoritative S0-05 domain baseline.

### Q2 — UUT Ownership

**Decision: APPROVED**

For S0-05:

- Investigation owns UUT.
- UUT is persisted in the `investigation` schema.
- InvestigationCase and TestAttempt reference UUT through real PostgreSQL foreign keys.
- UUT ownership is reconsidered only when a concrete cross-context requirement emerges.

No cross-context ownership transfer is authorized.

### Q3 — UUT Attributes

**Decision: APPROVED**

- UUT internal ID: UUIDv7.
- Serial number: optional, non-unique.
- Hostname: optional, non-unique.
- Store external values exactly as supplied.
- No implicit trimming, case folding, or normalization.
- Neither attribute is an authoritative identity.

Do not implement automatic UUT matching by SN or hostname.

### Q4 — TestAttempt

**Decision: APPROVED WITH CHANGES**

TestAttempt:

- Has an internal UUIDv7 ID.
- Belongs to exactly one UUT.
- Is immutable after registration in S0-05.
- Has a required controlled `stage` vocabulary.
- Supports `IST` and `SAT` initially.
- Rejects unsupported stages explicitly.
- Has an optional external `executionReference`.
- Does not require external execution-reference uniqueness.
- Has no authoritative PASS/FAIL field.

An external execution reference is not the internal TestAttempt identity.

A registered TestAttempt does not, by itself, prove that an external test completed successfully or that its result is
authoritative.

### Q5 — CaseTestAttemptLink

**Decision: APPROVED WITH CONDITIONS**

The link is an explicit association identified by the composite key:

`(case_id, attempt_id, role)`

No separate Link UUID is required in S0-05.

Allowed roles:

- `INITIAL_FAILURE`
- `RETEST`
- `SUPPORTING`
- `CONTEXT`

Rules:

1. One TestAttempt may be linked to multiple InvestigationCases belonging to the same UUT.
2. One TestAttempt may have multiple roles in the same Case.
3. One Case may have multiple INITIAL_FAILURE links.
4. Identical links are not duplicated.
5. Different roles create distinct links.
6. Roles are immutable after creation.
7. Roles are never inferred automatically.
8. A RETEST link does not imply repair effectiveness, case closure, or RCA completion.
9. Cross-UUT links are rejected at application and database levels.

Idempotent behavior is subject to the Expected Version contract in Q6.

### Q6 — Aggregate Boundary and Optimistic Concurrency

**Decision: APPROVED — OPTION A**

InvestigationCase is the Aggregate Root and owns its CaseTestAttemptLinks.

UUT and TestAttempt are immutable after creation in S0-05.

Only InvestigationCase requires an optimistic-concurrency version.

**Mandatory API contract:**

`linkAttempt` requires `expectedVersion`.

The operation follows this precedence:

1. Validate Case and TestAttempt existence and same-UUT ownership.
2. Read authoritative Case state.
3. Compare `expectedVersion` with the current Case Version.
4. If versions differ, return `concurrency_conflict`, even when the requested link already exists.
5. If versions match and the identical link exists, return idempotent success without changing the version.
6. If versions match and the link is new, atomically insert the link and increment the Case Version.
7. Reject concurrent stale writers deterministically.
8. Never commit a Link without its corresponding Case Version update.
9. Never advance the Case Version for an idempotent no-op.
10. Do not automatically retry stale-version requests.

**Explicit Owner decision:**

Expected Version takes precedence over duplicate-link idempotency.

An identical request with a stale Expected Version must return `concurrency_conflict`.

PostgreSQL constraints and atomic updates must protect this behavior under concurrent transactions.

Do not turn unrelated unique-key violations, foreign-key violations, deadlocks, or other database errors into successful
idempotent responses.

A failed transaction must be rolled back before any new operation begins.

The Investigation-owned TransactionScope remains unchanged in architectural ownership.

### Q7 — InvestigationCase Content

**Decision: APPROVED WITH CHANGES**

InvestigationCase contains:

- UUIDv7 identity.
- UUT reference.
- `opened_at`.
- Aggregate `version`.
- CaseTestAttemptLinks.

Retain `opened_at`.

Do not introduce additional case descriptions, lifecycle states, automatic closure, or validation limits.

Remove FailureObservation-specific public errors.

Define and test errors required for Case, UUT, TestAttempt, cross-UUT linking, and concurrency operations.

### Q8 — FailureObservation

**Decision: APPROVED FOR REMOVAL**

FailureObservation is deferred beyond S0-05.

Follow the replacement-before-removal plan:

1. Implement the approved CaseTestAttemptLink operations.
2. Replace existing FailureObservation-based tests.
3. Verify transaction, rollback, concurrency, cross-UUT, and compiled-runtime coverage.
4. Remove FailureObservation from the delivered domain model, schema, repositories, services, public contracts, and tests.
5. Retain relevant historical design information in documentation.

Do not introduce EvidenceAnchor, Diagnostics, RCA, or Repair workflows as part of this task.

### Q9 — Deterministic Retrieval

**Decision: APPROVED WITH CHANGES**

Return linked attempts in this order:

1. `registered_at ASC`
2. `attempt_id ASC`
3. Explicit role order:
   - INITIAL_FAILURE
   - RETEST
   - SUPPORTING
   - CONTEXT

Every relevant query must use deterministic ordering.

Do not rely on implicit PostgreSQL ordering or assume UUIDv7 alone represents authoritative execution chronology.

This ordering reflects SDRIS registration time, not necessarily the external execution time.

### Q10 — Timestamps

**Decision: APPROVED WITH CHANGES**

Required timestamps:

| Entity              | Field           |
| ------------------- | --------------- |
| UUT                 | `created_at`    |
| TestAttempt         | `registered_at` |
| InvestigationCase   | `opened_at`     |
| CaseTestAttemptLink | `linked_at`     |

Requirements:

- PostgreSQL storage uses `timestamptz`.
- Timestamps have unambiguous UTC semantics.
- Use one consistent, testable timestamp-generation mechanism.
- An injected Application Clock is preferred unless an existing approved convention requires another mechanism.
- Domain code must not depend on database-specific time functions.
- Public operations must not permit unapproved timestamp overrides.
- External test execution time remains a separate future concern.
- These timestamps do not replace audit logs.

---

## 3. Approved Persistence Policy

Implement:

- UUIDv7 primary keys for UUT, TestAttempt, and InvestigationCase.
- Composite Link identity `(case_id, attempt_id, role)`.
- Foreign keys from Case and TestAttempt to UUT.
- Composite foreign keys protecting same-UUT relationships.
- Approved role vocabulary constraints.
- Atomic optimistic-concurrency updates.
- Transactional consistency between Link insertion and Case Version updates.
- Deterministic retrieval ordering.
- Approved timestamps.

Do not introduce:

- SN uniqueness.
- Hostname uniqueness.
- External execution-reference uniqueness.
- Unapproved text normalization.
- Unapproved length limits.
- Additional lifecycle or result columns.
- Automatic authoritative identity reconciliation.

The SQL in the proposed persistence-policy document is illustrative until updated to match these decisions.

---

## 4. Migration Governance

The preferred strategy is to revise the unreleased S0-05 migration only if its previous checksum has not been used in any
shared or production environment.

Before modifying migration `0002`:

1. Verify the deployment and migration history.
2. Confirm no shared environment depends on the existing checksum.
3. Record the evidence.
4. Preserve the checksum of migration `0001`.

If the migration has already been shared, use a forward-only migration instead.

Developer database resets must be explicit and limited to disposable local test environments.

Never reset shared or production databases.

---

## 5. Architecture Constraints

Preserve the established architecture:

- Investigation Domain/Application remain independent of Drizzle and database drivers.
- Repository ports belong to the Investigation context.
- Adapters remain inside approved context infrastructure.
- Composition factories expose public contracts rather than concrete adapters.
- Composition entrypoints remain restricted to approved roots.
- Test-only database entrypoints remain restricted to tests.
- Public type surfaces remain verified.
- TransactionScope remains context-owned.
- Compiled production runtime must work under supported Node.js without tsx.

Do not create a new Shared Kernel abstraction or cross-context transaction framework without separate approval.

---

## 6. ADR Governance

ADR-025 and Amendments A1–A4 must be evaluated and approved independently.

Governance decisions:

1. Preserve amendments as independently traceable records.
2. Document the effective policy resulting from each approved amendment.
3. Record A2's revision of A1 Rule 3 explicitly.
4. Approval of ADR-025 does not automatically approve A1–A4.
5. Domain approval does not imply ADR approval.
6. Do not change an ADR status to ACCEPTED without its own recorded approval.

Update the approval checklist with the current decision status and outstanding items.

---

## 7. Required Verification

Run and report the full required verification suite.

### Domain and application

- UUT creation and retrieval.
- TestAttempt registration and retrieval.
- IST/SAT vocabulary validation.
- Optional execution reference.
- Case creation and retrieval.
- Link creation and retrieval.
- Multiple roles per Attempt.
- Multiple INITIAL_FAILURE links.
- Link immutability.
- Same-UUT validation.
- Cross-UUT rejection.
- Deterministic retrieval ordering.

### PostgreSQL integration

- UUT foreign keys.
- Composite cross-UUT foreign keys.
- Link uniqueness.
- Atomic Link insertion and Case Version increment.
- Matching-version idempotency.
- Stale-version conflict, including an already-existing Link.
- Two concurrent identical-link requests.
- Two concurrent different-link requests.
- Transaction commit and rollback.
- Timestamp persistence.
- Deterministic ordering when timestamps are equal.

### Architecture and runtime

- Architecture checker and negative fixtures.
- Public type-surface verification.
- Test-only entrypoint restrictions.
- Lint and formatting.
- Typecheck and build.
- Domain and application tests.
- PostgreSQL integration tests.
- Pure Node.js compiled-runtime smoke tests.
- Fresh-clone verification.
- Migration checksum validation.

All test fixtures must use synthetic data.

---

## 8. Implementation Authorization

Claude Code is authorized to:

1. Update the four S0-05 specification and policy documents.
2. Record Q1–Q10 as approved decisions.
3. Implement the four approved domain concepts.
4. Implement the approved repositories, persistence constraints, and application operations.
5. Replace and remove FailureObservation.
6. Update the approved migration.
7. Complete all verification.
8. Commit changes in logically separated commits.
9. Confirm the final PR head SHA.
10. Trigger one Codex review after implementation is complete.

Do not start implementation if the updated documents contradict this approval.

If an unapproved architecture or domain decision becomes necessary, stop and request Engineering Owner approval.

---

## 9. Codex Review and Stop Conditions

After all implementation changes are committed:

1. Confirm the final head SHA.
2. Trigger one `@codex review` for that final implementation head.
3. Wait for the review result.
4. Investigate findings and apply necessary corrections.
5. Report the final implementation and review evidence.
6. Stop for independent SDRIS Architecture Acceptance.

**Not authorized:**

- Automatic merge of PR #6.
- Starting S0-06.
- Automatic ADR-025/A1–A4 acceptance.
- Production deployment.
- Changes to published migration history.
- Expansion into Evidence, Diagnostics, Repair, RCA, or AI workflows.

---

## 10. Required Final Delivery

Provide:

1. Updated S0-05 Specification.
2. Completed Owner Decision Register.
3. Updated Persistence Policy.
4. FailureObservation Removal Report.
5. Domain and application implementation summary.
6. Migration changes and checksum evidence.
7. Test commands and results.
8. Architecture verification evidence.
9. ADR-025/A1–A4 status.
10. Final commit SHA.
11. Codex review findings and resolutions.
12. Remaining risks and merge-readiness recommendation.

**Final instruction:** Implement the approved S0-05 scope, complete verification, obtain one final-head Codex review, and stop
for independent Architecture Acceptance.

**NO MERGE. NO S0-06.**
