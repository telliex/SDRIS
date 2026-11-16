# SDRIS — S0-05 Engineering Owner Approval (Revised)

> **SUPERSEDED** by [S0-05-final-owner-approval.md](S0-05-final-owner-approval.md). Kept for traceability only; where it
> differs from the final approval, the final approval wins.

**Decision:** APPROVED WITH CHANGES  
**Scope:** S0-05 Domain Specification and Step 4 implementation  
**Authority:** Engineering Owner confirmation in the Claude Code session, recorded here

This document supersedes the previous S0-05 approval instruction ([S0-05-owner-approval.md](S0-05-owner-approval.md))
where the details differ.

## 1. Approved domain scope

Implement exactly these four concepts:

- UUT
- TestAttempt
- InvestigationCase
- CaseTestAttemptLink

FailureObservation is deferred and must be removed from the delivered S0-05 contract after replacement tests are
established.

Do not introduce case lifecycle states, authoritative PASS/FAIL, repair effectiveness, RCA approval, or new bounded
contexts.

## 2. Owner decisions

**Q1 — APPROVED WITH CHANGES.** Incorporate Q2–Q10 into the specification and Owner Decision Register.

**Q2 — APPROVED.** Investigation provisionally owns UUT for S0-05. Enforce UUT foreign keys within the context.

**Q3 — APPROVED.** SN and hostname are optional, non-unique, stored exactly as provided, and never authoritative
identifiers.

**Q4 — APPROVED WITH CHANGES.**

- TestAttempt uses UUIDv7.
- Stage is required and controlled: IST or SAT initially.
- External execution reference is optional and non-unique.
- No authoritative result field.
- TestAttempt is immutable after registration.
- External execution reference and internal TestAttempt ID are separate concepts.

**Q5 — APPROVED WITH CONDITIONS.**

- Unique link key: `(case_id, attempt_id, role)`.
- Roles: INITIAL_FAILURE, RETEST, SUPPORTING, CONTEXT.
- Multiple roles per Case–Attempt pair are allowed.
- Multiple INITIAL_FAILURE links are allowed.
- Identical duplicate requests are idempotent.
- Different roles create distinct links.
- Roles are immutable.
- Same-UUT protection is mandatory in application and database layers.
- Duplicate handling must be concurrency-safe and must not suppress unrelated database errors.

**Q6 — APPROVED WITH CONDITIONS.**

- InvestigationCase owns its links as an aggregate.
- New links atomically increment Case Version.
- Idempotent duplicates do not increment Case Version.
- UUT and TestAttempt are immutable in S0-05.
- Stale writes must be rejected or explicitly re-evaluated after a fresh authoritative read.
- No hidden unlimited retries.
- Preserve Investigation-owned TransactionScope.

**Q7 — APPROVED.**

Retain `opened_at` and Case Version.

Do not add unapproved case fields.

Remove observation-specific error codes. Define and test case, attempt, UUT, cross-UUT and concurrency errors required by
the new operations.

**Q8 — APPROVED.**

Remove FailureObservation using replacement-before-removal. Preserve or strengthen transaction, concurrency, cross-UUT,
idempotency and runtime tests.

**Q9 — APPROVED.**

Order linked attempts by:

1. `registered_at ASC`
2. `attempt_id ASC`
3. Role order: INITIAL_FAILURE, RETEST, SUPPORTING, CONTEXT

This is registration order, not external execution order.

**Q10 — APPROVED.**

Use timezone-aware timestamps:

- UUT: `created_at`
- TestAttempt: `registered_at`
- InvestigationCase: `opened_at`
- Link: `linked_at`

These are SDRIS record timestamps, not external execution timestamps or a replacement for audit logs.

## 3. Implementation safeguards

- Preserve UUIDv7 internal identity.
- Do not infer identity from SN, hostname, or external execution reference.
- Do not silently normalize external identifiers.
- Do not introduce uniqueness constraints beyond those approved.
- Enforce same-UUT linking with application validation and composite database foreign keys.
- Use atomic optimistic concurrency and transaction rollback.
- Test concurrent duplicate links and stale writers against real PostgreSQL.
- Preserve public type-surface checks and composition boundaries.
- Ensure compiled Node.js runtime works without tsx.

## 4. Migration governance

The unreleased `0002` migration may be revised only after confirming it has not reached any shared environment.

Never reset shared or production databases.

Record migration checksum evidence and fresh-clone test results.

## 5. ADR governance

This approval authorizes the S0-05 domain implementation.

It does not automatically approve ADR-025 or Amendments A1–A4.

Keep those records PROPOSED until separately approved.

Maintain amendments as independently traceable records, and explicitly document A2's revision of A1 Rule 3.

## 6. Final verification and review

After implementation:

1. Run all architecture, domain, integration, migration and compiled-runtime tests.
2. Record exact results.
3. Commit changes in logical units.
4. Confirm the final PR head SHA.
5. Trigger one `@codex review` for that head.
6. Wait for findings and address them.
7. Stop for independent SDRIS Architecture Acceptance.

**No merge. No S0-06.**
