# S0-06 — Authentication and Audit Foundation (Specification v0.2, DRAFT)

**Status:** DRAFT. **Not approved. S0-06 implementation is NOT STARTED.** Everything below is a proposal built on the directions C1 to C10 of the [decision register](S0-06-owner-decision-register.md); no decision in it is formally approved.

- **Date:** 2026-11-22. **Baseline:** `main` at `ae7dc51` (verified current).
- **Sources read:** CLAUDE.md, ADR-025 with A1 to A4 and its effective policy, the S0-05 acceptance and closure records, the S0-05 follow-up register, the S0-06 readiness summary, the Investigation service, repository and transaction ports, `AuditMetadata`, migrations `0001` and `0002`, and the architecture dependency matrix.
- **Not in the repository:** the Sprint 0 Blueprint. Scope below is derived from the Owner directions and the title, not from the Blueprint (decision D1).

## 1. Objectives and scope

**Proposed objective:** every state change the Investigation context commits is attributable to a trusted actor, is authorised, and leaves exactly one authoritative audit record written atomically with the change. Closing FU-3 (validation of `expectedVersion` and version exhaustion) is part of the scope because it changes the same command.

**In scope (proposed):** a synthetic identity and trusted actor context; a minimal write-permission model; an Investigation-owned audit writer, port and table; atomic state-plus-audit writes; FU-3 option B.

**Out of scope:** real authentication, HTTP endpoints and DTOs, audit for any other context, a shared audit context, outbox and inbox (ADR-025 Decision 7 deferral), audit read APIs, retention automation, S0-07 and later work.

### 1.1 Existing commands (verified against `modules/investigation/src/application/investigation-service.ts`)

| Command               | Input                                           | Effect                                                                                  | Result on success                                 | Mutation semantics                                                             |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `registerUut`         | `{ serialNumber?, hostname? }`                  | Inserts a UUT with a new UUIDv7 and `createdAt = deps.now()`                            | `Result<Uut, …>`                                  | Always creates; no uniqueness (Q3), so repeating the call creates another UUT  |
| `registerTestAttempt` | `{ uutId, stage, externalExecutionReference? }` | Validates stage (`IST`/`SAT`), requires the UUT, inserts an attempt                     | `Result<TestAttempt, …>`                          | Always creates; no uniqueness                                                  |
| `openCase`            | `{ uut: UutRef }`                               | Requires the UUT, inserts a case with `version = 1`                                     | `Result<InvestigationCase, …>`                    | Always creates                                                                 |
| `linkAttempt`         | `{ caseId, attemptId, role, expectedVersion }`  | Validates role, loads case and attempt, same-UUT, compares version, inserts link, bumps | `Result<LinkResult, …>` (`created` true or false) | Creates a link and bumps the version atomically, or is a no-op for a duplicate |

None of them takes an actor or a correlation identifier today and none writes audit data. Reads (`getUut`, `getTestAttempt`, `getCase`) have no transaction and are out of audit scope (proposal).

## 2. Synthetic identity

Proposed designs; the choice is decision D3. Detail and alternatives are in the [contract review](../reviews/S0-06-contract-design-review.md) sections 3 and 4.

### 2.1 Trusted credential verification

A **Synthetic Identity Provider** lives in the application layer, not in Investigation. It holds a fixed table of synthetic principals and verifies a synthetic credential (a static test token or a signed fixture assertion; the mechanism is an open Owner question) and returns either a verified principal or an authentication failure. It contains no real credentials and no real identity data (CLAUDE.md section 13).

### 2.2 Actors

| Concept                    | Proposal                                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human actor                | A synthetic person principal; `actorKind = HUMAN`                                                                                                                                                                                                                                                    |
| System actor               | A synthetic automation principal (for example a test harness); `actorKind = SYSTEM`. AI systems are **not** a privileged kind: an AI-originated request would be a System actor with no approval authority (CLAUDE.md section 8, golden invariant "AI recommendations cannot bypass human approval") |
| Principal-to-Actor mapping | A principal maps to one `EntityRef` (`entityType` `Actor`, `id` a UUIDv7) so it satisfies `AuditMetadata.actor`. The mapping is fixed data in the provider; nothing is inferred from a credential string                                                                                             |
| Actor Context              | An immutable value: `actor` (`EntityRef`), `actorKind`, `permissions` (set), `issuedAt`. It is the only identity input a command accepts                                                                                                                                                             |
| Correlation Context        | `correlationId` (Shared Kernel `CorrelationId`), optional `causationId`, `executionContext.source` (`api`, `test`). Supplied by the composition layer with the Actor Context; never generated by the audit writer                                                                                    |

### 2.3 Trust and test/production isolation

- Investigation accepts an Actor Context only if the trusted issuer produced it. Proposed mechanism: the issuer keeps a module-private registry of contexts it issued (the same pattern as the `handles` WeakMap in `infrastructure/database/src/unit-of-work.ts`); the service rejects an unregistered object as unauthenticated.
- The Synthetic provider is selected by the composition root and refuses to start unless the environment is `local` or `test` (the same posture as the database reset protection of ADR-025 Decision 11). A production provider is a separate, later, Owner-approved task.
- An architecture rule must forbid Investigation domain, application and infrastructure code from importing the identity module, and forbid anything outside the approved composition roots from importing the issuer (contract review section 4).

### 2.4 Authentication failures

Authentication failure is an error value, not a thrown exception: `investigation.unauthenticated` (no context, an unregistered context, an expired or malformed one). It is returned before any database access, creates no state and no authoritative audit record. It must not reveal which part of a credential was wrong. Handling at the HTTP layer (status codes) is S0-07 and out of scope.

## 3. Authorization

### 3.1 Minimal write-permission model (proposed)

| Permission                        | Command               |
| --------------------------------- | --------------------- |
| `investigation.uut.register`      | `registerUut`         |
| `investigation.attempt.register`  | `registerTestAttempt` |
| `investigation.case.open`         | `openCase`            |
| `investigation.case.link_attempt` | `linkAttempt`         |

Permissions are granted to the synthetic principal by the provider's fixture table, as a flat set. There are no role hierarchies, no resource-level rules and no delegation in Phase 1. A request for a permission the context lacks returns `investigation.permission_denied` (details: the required permission only). Reads are left **unauthorised and unaudited in Phase 1 as a stated gap**; whether reads need a permission is an Owner question (review section 11).

This model does not interpret authorization as readiness or as approval of any engineering conclusion (AGENTS.md section 8).

### 3.2 Where it is enforced

Authorization is enforced **in the Investigation application service**, as the first step of each write command, before validation or any repository call. Direct calls to the application service from tests, a worker or a future script therefore get the same check as HTTP requests. HTTP-layer validation or a guard in `apps/api` may be added as defence in depth, but it is never the only enforcement: a future controller bug, a second caller or a direct service call would otherwise bypass it.

Proposed order for a write command: authenticate (valid, issued Actor Context) → authorise (permission present) → the existing validation order. Placing the check first does not change the relative order of any existing step.

## 4. Audit ownership

### 4.1 Components (all Investigation-owned; no shared Audit Context)

| Component             | Location (proposed)                                                            | Role                                                                      |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `AuditWriter` port    | `modules/investigation/src/application/ports/audit-writer.ts`                  | `record(entry, tx: TransactionToken): Promise<void>`                      |
| Drizzle audit adapter | `modules/investigation/src/infrastructure/persistence/` (new file)             | Inserts into `investigation.audit_record` with the transaction's executor |
| Audit table           | `investigation.audit_record`, migration `0003`                                 | Append-only                                                               |
| Public contract       | `modules/investigation/src/public/index.ts`: audit action names and entry type | Contract only, no adapter                                                 |

### 4.2 Candidate audit record

| Column                       | Type        | Source / rule                                                                                            |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `audit_id`                   | uuid, PK    | `deps.newId<'AuditRecord'>()` (UUIDv7)                                                                   |
| `action`                     | text, check | One of the vocabulary in 4.3                                                                             |
| `actor_type`                 | text        | `EntityRef.entityType` of the actor                                                                      |
| `actor_id`                   | uuid        | `EntityRef.id`                                                                                           |
| `actor_kind`                 | text, check | `HUMAN` or `SYSTEM`                                                                                      |
| `subject_type`, `subject_id` | text, uuid  | The entity created or changed (`UUT`, `TestAttempt`, `InvestigationCase`)                                |
| `case_id`                    | uuid, null  | The case for `attempt_linked`; null otherwise. Enables per-case history without parsing payloads         |
| `occurred_at`                | timestamptz | The injected clock, read once per command and shared with the domain timestamp; never a database default |
| `correlation_id`             | text        | `CorrelationId` from the Correlation Context                                                             |
| `causation_id`               | uuid, null  | Optional                                                                                                 |
| `source`                     | text        | `executionContext.source`                                                                                |
| `schema_version`             | integer     | `1`                                                                                                      |
| `details`                    | jsonb, null | Small, typed, per action (link: `attemptId`, `role`, `versionBefore`, `versionAfter`; others: none)      |

No foreign key from `subject_id` (a subject may be of different tables); integrity comes from writing it in the same transaction as the subject. The `case_id` column may carry a foreign key to `investigation_case(id)`; that is a review question.

### 4.3 Proposed action vocabulary (owned by Investigation, dotted lower-case as `parseAuditMetadata` requires)

`investigation.uut_registered`, `investigation.test_attempt_registered`, `investigation.case_opened`, `investigation.attempt_linked`.

These are audit **actions**, not domain events. The same names are reserved as future event types in the Shared Kernel's example (`investigation.case_opened`); event publication and the outbox stay deferred (ADR-025 Decision 7).

### 4.4 Relationship to `AuditMetadata`

`AuditMetadata` (`packages/shared-kernel/src/event-metadata.ts`) is the envelope: `auditId`, `action`, `actor`, `subject`, `schemaVersion`, `occurredAt`, `recordedAt?`, `correlationId`, `causationId?`, `executionContext?`. The table stores that envelope flattened, plus `actor_kind`, `case_id` and `details`. The adapter builds the record by calling `parseAuditMetadata` on what the service assembled, so invalid metadata fails the transaction. `recordedAt` is left null: Phase 1 has one clock, so it would duplicate `occurred_at`; that is a review question. The Shared Kernel is **not** changed.

### 4.5 Sensitive data and retention

- Serial numbers and hostnames may identify customer hardware. The audit record stores **identifiers only**, never those attributes, free text, credentials or tokens.
- Synthetic-only data applies (CLAUDE.md section 13). A retention period for real data is undecided and is an Owner question; Phase 1 never deletes or updates audit rows (append-only triggers, as for the existing immutable tables).
- Audit rows reference actors by synthetic identifier; no personal data enters the table.

## 5. Audit semantics

Only a committed state change produces an authoritative audit record, and every committed state change produces exactly one.

| Case                                                                             | State change | Authoritative audit record                       | Result                                                                  |
| -------------------------------------------------------------------------------- | ------------ | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Successful create (UUT, attempt, case)                                           | Yes          | **One**, same transaction                        | `ok`                                                                    |
| Successful link (new)                                                            | Yes          | **One** (`attempt_linked`)                       | `ok`, `created: true`                                                   |
| Duplicate link at the matching version                                           | No           | **None**                                         | `ok`, `created: false`, version unchanged                               |
| Validation failure (role, stage, not found, same-UUT, invalid `expectedVersion`) | No           | **None**                                         | error value                                                             |
| Concurrency conflict (stale version)                                             | No           | **None**                                         | `investigation.concurrency_conflict`, even if the identical link exists |
| Authentication or authorization failure                                          | No           | **None** (state-change audit); see the gap in D7 | `investigation.unauthenticated` / `investigation.permission_denied`     |
| Version exhaustion                                                               | No           | **None**                                         | `investigation.version_exhausted` for a new link at version 2147483647  |
| Transaction rollback (any cause, incl. audit write failure)                      | No           | **None** (nothing persists)                      | error value or thrown unexpected error                                  |

A repeated `registerUut`, `registerTestAttempt` or `openCase` is a new state change each time (no uniqueness is approved), so each leaves its own record.

## 6. Transaction atomicity

- The service already runs each write command in one `TransactionScope.run`; an `err` result throws `Rollback` and nothing persists.
- **Proposal:** after the domain write succeeds, and only when a state change was made, the service calls `deps.audit.record(entry, tx)` in the same unit. A failing audit insert throws; the unit rolls back; the caller gets an unexpected error (thrown, not a value), consistent with the Q5 rule that database errors are not suppressed.
- No new transaction framework, no second connection, no cross-context call (the S0-05 final approval forbids that without separate approval). `PersistenceTransactionScope` is reused unchanged; the audit adapter takes its executor from the same `executorFor(db, tx)`.
- **Rollback contract:** after any rolled-back unit, no domain row **and** no audit row from that unit exists. After a committed unit, both exist, with the same `occurred_at`.
- **Integration-test strategy (real PostgreSQL, the existing one-off database helper):** (1) each of the four commands writes exactly one audit row, with the right actor, action, subject and correlation; (2) a duplicate link, validation failures, a stale version, a denied command and a version-exhausted link write none; (3) an audit writer that throws after the domain write leaves no domain row (failure injection through the `AuditWriter` port); (4) a database-level audit failure (for example a violated check) rolls back the link and the version bump; (5) two concurrent `linkAttempt` calls with the same `expectedVersion` produce one winner and one audit row, using the existing row-lock and `pg_stat_activity` technique; (6) audit rows cannot be updated or deleted.

## 7. FU-3 — `expectedVersion` validation and version exhaustion (Option B)

### 7.1 Validation

`expectedVersion` is valid only if `typeof value === 'number'`, `Number.isSafeInteger(value)`, `value >= 1` and `value <= 2147483647`. No coercion: strings, `bigint`, boxed `Number`, `NaN`, `Infinity`, fractions, `0`, negatives and `undefined` are rejected. The check runs **at the existing comparison position**, after same-UUT validation and before the version comparison, so no earlier error changes precedence.

### 7.2 Precedence (existing order preserved; the added steps are marked)

0. _(added by S0-06)_ authenticate, then authorise;
1. role validation;
2. case lookup (`case_not_found`);
3. attempt lookup (`attempt_not_found`);
4. same-UUT validation (`uut_mismatch`);
5. _(new)_ `expectedVersion` runtime validation (`invalid_expected_version`);
6. version comparison (`concurrency_conflict`);
7. idempotency: identical link exists, so `ok` with `created: false`;
8. _(new)_ version exhaustion check: a new link when `current.version === 2147483647` gives `version_exhausted`;
9. save (atomic insert and bump), then audit write in the same transaction.

Consequences: an invalid `expectedVersion` on a nonexistent case still yields `case_not_found` (steps 2 and 3 come first); a **valid but stale** value at maximum version yields `concurrency_conflict`; a **matching duplicate at maximum version stays a no-op** with no error and no audit record; only a new link that needs `version + 1` fails.

### 7.3 Error contract (proposed; both extend `InvestigationServiceError`)

| Code                                     | When         | `details`                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `investigation.invalid_expected_version` | Step 5 fails | `{ reason: 'not_a_number' \| 'not_a_safe_integer' \| 'out_of_range', minimum: 1, maximum: 2147483647, actualType: string }`. The offending value is **not** echoed for non-numbers (log-injection and size safety); numbers may be echoed |
| `investigation.version_exhausted`        | Step 8       | `{ actualVersion: 2147483647, maximumVersion: 2147483647 }`                                                                                                                                                                               |

Because step 8 runs only when `current.version === expectedVersion` (step 6) and the guard prevents `version + 1` from exceeding the maximum, the repository `save` can never overflow the `integer` column, and the PostgreSQL 22003 error is unreachable through the service. The column and `check (version >= 1)` stay as they are (C9).

## 8. Acceptance criteria (proposed, testable)

All persistence criteria run against real PostgreSQL (ADR-025 Decision 10).

| ID    | Area                      | Criterion                                                                                                                                                                                                                                      |
| ----- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | Trusted Actor             | A write with no Actor Context, a hand-built object, or a context the issuer did not issue returns `unauthenticated`; no row (domain or audit) is written. The synthetic provider refuses to run outside local/test                             |
| AC-2  | Authorization             | A valid actor without the permission gets `permission_denied` from a **direct** service call; with it the command succeeds; no row is written on denial                                                                                        |
| AC-3  | Audit coverage            | Each of the four commands writes exactly one `audit_record` with the correct action, actor, subject, `case_id`, correlation, schema version and the same `occurred_at` as the domain row                                                       |
| AC-4  | Transaction atomicity     | A failing audit write rolls back the domain write (no orphan rows); a failing domain write leaves no audit row; counts of audit rows equal counts of committed state changes                                                                   |
| AC-5  | Idempotency               | A matching duplicate link returns `created: false`, leaves version and tables unchanged and writes no audit row, including at version 2147483647                                                                                               |
| AC-6  | Concurrency               | Concurrent links with the same `expectedVersion`: one `ok` and one `concurrency_conflict`; one link and one audit row; the existing deterministic row-lock technique is used                                                                   |
| AC-7  | Invalid `expectedVersion` | Each invalid class in 7.1 returns `invalid_expected_version` at step 5, after `case_not_found`, `attempt_not_found` and `uut_mismatch`, and before `concurrency_conflict`; nothing is written                                                  |
| AC-8  | Version exhaustion        | A case set to version 2147483647 (test-only SQL) returns `version_exhausted` for a new link, `ok` with `created: false` for a duplicate, and `concurrency_conflict` for a stale value; the column definition is unchanged                      |
| AC-9  | Architecture compliance   | `pnpm check:architecture` passes with no change to `contextInfrastructure` or loosened rule; audit code only under `modules/investigation`; the identity module is not importable by Investigation; no shared audit package; no new dependency |
| AC-10 | PostgreSQL integration    | Migration `0003` applies on a clean database and on one at `0002`; `0001` and `0002` checksums are unchanged; audit rows reject update and delete; `pnpm db:test` passes                                                                       |
| AC-11 | S0-05 regression          | All S0-05 unit, integration, concurrency and compiled-runtime tests pass; changes to existing tests are limited to adding the Actor Context argument and the FU-3 cases                                                                        |

## 9. Constraints that remain in force

ADR-025 and A1 to A4 (no new persistence user outside the allowlist, no cross-module internal imports, `src/public` as the only cross-module surface), no `drizzle-kit`, no new major dependency, synthetic data only, injected clock, UUIDv7 identifiers, no automatic progression to S0-07. The Golden invariant "AI recommendations cannot bypass human approval" is respected by 2.2 (no privileged AI actor kind); its test belongs to a later task and is not added here.

## 10. Open questions for the Owner

Consolidated in the [contract design review](../reviews/S0-06-contract-design-review.md) section 11 and the [decision register](S0-06-owner-decision-register.md).
