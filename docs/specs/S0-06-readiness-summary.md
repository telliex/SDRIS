# S0-06 — Readiness Summary (DRAFT, planning only)

> **Status snapshot note (added 2026-11-17).** Statements in this document that ADR-025 and Amendments A1 to A4 are `PROPOSED` (or not yet accepted) describe the state when the document was written, **before** the status transitions of commits `bec7381` to `93baa76` (2026-11-17). They are dated snapshots and are not updated by status commits. **The current status of each record is its own `Status` line in `docs/adr/ADR-025-postgresql-persistence-architecture.md`** (ADR-025 also in the ADR README index). This note changes no other content and does not change this document's own status. Statements that the S0-05 Architecture Acceptance or Closure is `DRAFT` or pending describe the state before the Engineering Owner decisions of 2026-11-17 recorded in the acceptance record (section 12) and the closure record (section 7); the current status of those two records is their own `Status` line.

**Status:** DRAFT. This is a readiness summary, **not an S0-06 specification and not a start of S0-06.** It reports what the
repository actually says, what it does not say, and what has to be settled before S0-06 can be planned. **The S0-06 scope is
not defined here and nothing below should be read as scope.**

## 1. What the repository says about S0-06

| Source                                     | Statement                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` section 3, Sprint 0 task table | `S0-06` is **"Authentication and Audit Foundation"**                                                       |
| `README.md` line 87                        | "S0-06 Auth/Audit" in the Sprint 0 task order (S0-05 Investigation Aggregate; S0-07 API Contracts follows) |
| `CLAUDE.md` section 3                      | "Task scope and dependencies must follow the approved Sprint 0 Blueprint"                                  |
| `docs/adr/ADR-024-sprint-0-execution.md`   | Nine lines only; it says S0-01 only scaffolds the workspace. It contains no S0-06 detail                   |
| `docs/adr/README.md`                       | ADR-001 to ADR-023 and the planning history are **not in the repository**                                  |

**Gap reported, not filled:** the approved Sprint 0 Blueprint, which defines S0-06's objectives, dependencies and acceptance
criteria, is not committed. The title is the only S0-06 statement in the repository. Objectives, acceptance criteria and
dependencies **cannot be stated from the repository** and are not invented here.

## 2. Existing in-repository constraints that S0-06 would touch (context, not scope)

| Source                                                            | What it says                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` lines 19 and 89                                       | SDRIS owns its audit trail; cross-cutting services include authentication, audit, outbox/inbox, durable jobs, observability                                                                                          |
| `AGENTS.md` line 119                                              | The Shared Kernel may hold actor and correlation references and domain-event and audit envelopes                                                                                                                     |
| `AGENTS.md` line 272                                              | Domain state changes, audit records and outbox records should be persisted atomically when the design requires them                                                                                                  |
| `AGENTS.md` section 8 (lines 197, 210)                            | "Authorization" is one of the independent domain states that must not be collapsed into one flag; "readiness does not grant authorization"                                                                           |
| `CLAUDE.md` line 108                                              | `apps/api` responsibilities include "Authentication integration"                                                                                                                                                     |
| `packages/shared-kernel/src/event-metadata.ts`                    | `AuditMetadata` already exists: `auditId`, an `action` name owned by the emitting context, a required `actor` reference and a `subject` reference                                                                    |
| **PROPOSED** ADR-025 Decision 7 and section 17 (not yet in force) | Atomic domain state plus audit plus outbox is proposed as an architectural requirement; **table ownership and workflow are deferred**; "Decide Audit/Outbox/Inbox/Jobs ownership" is a listed future governance task |
| `infrastructure/database/src/schemas.ts`, `0001`                  | The `system` schema is described as "migration tracking, later audit, outbox/inbox, durable jobs"                                                                                                                    |
| S0-05 specification and persistence policy                        | Case, attempt and link timestamps are SDRIS record times and **not audit history, which belongs to S0-06**; no external execution times                                                                              |
| `apps/api/src`                                                    | Contains only the health controller, the module, `main.ts` and the Investigation composition root: there is no authentication or request-identity code yet                                                           |

## 3. Dependencies on S0-05 (what S0-06 would build on)

These are facts about what S0-05 delivered, offered as inputs for planning:

- The first state-changing operations exist: `registerUut`, `registerTestAttempt`, `openCase`, `linkAttempt`. They currently
  take **no actor or execution context** and write **no audit record**.
- Transactions are owned by the Investigation context's `TransactionScope`; the application owns the boundary. Whether an audit
  write can join that same transaction depends on where audit tables live (section 5).
- Conventions to reuse: UUIDv7 identifiers, the injected application clock, `expectedVersion` and `concurrency_conflict`, the
  `Result` and error-code style, the context-owned adapter and composition layout.
- Verification machinery exists: architecture checker with fixtures, real-PostgreSQL integration tests with one-off databases,
  the deterministic row-lock technique for concurrency tests, the compiled-runtime smoke test.

## 4. Required architecture approvals (derived from existing decisions, not from the Blueprint)

| Decision                                                                                                                  | Why it is on the path                                                                                                                                                                                                                               | State                                       |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| ADR-025 and A1 to A4 (**PROPOSED, pending approval**)                                                                     | If approved, S0-06 persistence follows them; until then they are proposed policy. The checker already enforces them and the merged S0-05 work was authorised by the Owner's final approval                                                          | All **PROPOSED**; decision package prepared |
| Ownership of audit (and outbox/inbox/jobs) tables                                                                         | ADR-025 Decision 7 defers it; the `system` schema is the only hint                                                                                                                                                                                  | **Undecided**                               |
| Cross-context transaction or shared transaction contract                                                                  | Audit that must be atomic with Investigation state needs either an Investigation-owned audit write or a shared mechanism; the final S0-05 approval forbids a cross-context transaction framework without separate approval; A2.6 recommends waiting | **Needs Owner decision**                    |
| Authentication approach and actor identity                                                                                | No approach is recorded in the repository                                                                                                                                                                                                           | **Undecided; not derivable**                |
| Any change to the allowlists (`contextInfrastructure`, `compositionRoots`) for a new persistence user or composition root | A1 and A2 require a reviewed entry                                                                                                                                                                                                                  | Only if S0-06 adds one                      |

## 5. Outstanding prerequisites

> **Update (2026-11-17):** the S0-05 acceptance and closure were recorded as ACCEPTED WITH CONDITIONS and CLOSED WITH CONDITIONS (the conditions are the four open MINOR follow-up tasks and OBL-SEC-1). **Whether a closure with open conditions satisfies prerequisite 3, and whether FU-3 (the `expectedVersion` input-validation contract, which touches the service layer S0-06 will use) must be resolved first, is an Engineering Owner decision that is not yet recorded.** S0-06 remains NOT STARTED.

1. The Sprint 0 Blueprint section for S0-06 (or an Owner-written S0-06 specification) committed to the repository.
2. Recorded Owner decisions on ADR-025 and A1 to A4, each decided independently, because S0-06 persistence will be written against them (see the [decision package](../adr/ADR-025-decision-package.md) for the effective order).
3. The Engineering Owner's sign-off of the S0-05 Architecture Acceptance and the closure of S0-05 (gates G1 to G4 of the [closure record](S0-05-closure-record.md), where G3, OPEN-1, is resolved by Owner confirmation of 2026-11-17 but G1, G2 and G4 stay open). **There is no exception that allows S0-06 to start before this.**
4. Owner decision on the four MINOR findings of S0-05 (fix, defer or accept), since S0-06 will touch the same service layer.
5. The audit-ownership and transaction questions above.
6. Not a prerequisite but a known gap: CI for the PostgreSQL tests is deferred to S0-10.

## 6. Recommended planning activities (no implementation)

The approach that worked for S0-05 was: gap analysis, then an Owner Decision Register with options and recommendations, then
approval, then implementation. For S0-06:

1. Obtain or write the S0-06 task specification; if it cannot be provided, ask the Owner for it rather than inferring it.
2. Draft a gap analysis of the repository against that specification.
3. Prepare a decision register. Candidate **questions** to put to the Owner, offered as questions and not as decisions:
   where audit tables live and who writes them; whether an audit write shares the aggregate's transaction; how the actor and
   execution context reach an application service; which operations are audited; whether audit timestamps use the same
   injected clock; what "authentication" means for a synthetic-data-only MVP; what the test and fixture strategy is.
4. Prepare the ADR work that the answers require (audit and outbox ownership), separately from the S0-06 implementation.
5. Only after an Engineering Owner approval, plan the commits and tests.

**Not done and not authorised:** S0-06 is not started and does not start until section 5 is satisfied; no S0-06 task was started, no code, schema or ADR was changed, and no scope was assumed.
