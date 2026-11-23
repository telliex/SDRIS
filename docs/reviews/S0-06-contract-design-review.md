# S0-06 — Contract Design Review (v0.2, DRAFT)

**Status:** DRAFT review for the Engineering Owner. It recommends; it decides nothing. S0-06 implementation is **NOT STARTED**.

- **Date:** 2026-11-22. **Reviewed baseline (pinned):** `main` at `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21`, reviewed at branch HEAD `24b73c8`. It was current when v0.1 was written and is **not assumed current later**: the integration base is re-verified before any package starts (specification, front matter). v0.2 revises this review after the independent architecture review; section 12 lists the revisions.
- **Convention note:** the repository has no `docs/reviews/` directory and no earlier review-document convention (checked); this file creates the directory. Related: [decision register](../specs/S0-06-owner-decision-register.md), [specification](../specs/S0-06-authentication-audit-foundation.md), [plan](../plans/S0-06-implementation-plan.md).

## 1. Verified current-state architecture

| Area                    | Verified fact (path)                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write commands          | `registerUut`, `registerTestAttempt`, `openCase`, `linkAttempt` in `modules/investigation/src/application/investigation-service.ts`; none takes an actor or correlation id                                                                                                                                                                                  |
| Transaction ownership   | Application owns the boundary through `TransactionScope.run` (`application/ports/transaction-scope.ts`), adapter `PersistenceTransactionScope` over `unitOfWorkOf(persistence).run`                                                                                                                                                                         |
| UnitOfWork              | `infrastructure/database/src/unit-of-work.ts`: callback-scoped, commit on resolve, rollback on reject, context invalidated after exit, `executorFor(db, tx)` for adapters                                                                                                                                                                                   |
| Rollback in the service | Private `transactional()` throws `Rollback` for any `err`, so every error result rolls back all writes of the unit                                                                                                                                                                                                                                          |
| Error conventions       | `SdrisError<code, details>`; code regex `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`; Investigation codes are `investigation.*` unions (`NotFoundErrorCode`, `RepositoryErrorCode`, domain codes); errors are returned as `Result`, unexpected failures thrown                                                                                                   |
| `linkAttempt`           | Order today: role, case, attempt, same-UUT (inside `linkTestAttempt`), version comparison, no-op, save. `expectedVersion` has **no runtime validation** (MINOR-3)                                                                                                                                                                                           |
| Shared Kernel           | `AuditMetadata` (`event-metadata.ts`): `auditId` (`EntityId<'AuditRecord'>`), `action`, `actor: EntityRef`, `subject: EntityRef`, plus common fields; `parseAuditMetadata`; no `Actor`/`Principal` type exists anywhere                                                                                                                                     |
| Schema and migrations   | Sequential SQL files `0001`, `0002` in `infrastructure/database/migrations`; schema `investigation` exists; update-rejecting trigger `investigation.reject_update()`; table `comment on` ownership notes; `case` table is mutable only through versioned `save`; `version integer not null default 1 check (version >= 1)`                                  |
| Tests                   | Real-PostgreSQL integration tests with one-off databases (`infrastructure/database/src/testing/isolated-database.ts`), api suite `apps/api/src/composition/*.integration.test.ts`, deterministic row-lock concurrency technique, compiled-runtime test in `tests/runtime`; tests referencing tables: `migrations.integration.test.ts`, `migrations.spec.ts` |
| Architecture rules      | `scripts/architecture/dependency-matrix.json`: `@sdris/investigation` infrastructure may use `@sdris/database` and `drizzle-orm`; composition roots: `@sdris/api` under `apps/api/src/composition/**`; test-only entrypoint `@sdris/database/testing`                                                                                                       |
| Baseline drift          | `ae7dc51` equals `origin/main`; the local follow-up branch `3fae558` is contained in it. No drift                                                                                                                                                                                                                                                           |

### Conflicts found between the sources and the requested design

1. **ADR-025 Decision 7 defers audit table ownership**; the directions C2/C3 decide it. Needs a recorded decision (D5). Not an error in the design, but it must not be implemented on the strength of chat history.
2. **The readiness summary is stale** (it still lists ADR status as proposed and sign-offs as open). It carries a snapshot note, so it was left unchanged; it should not be read as current for D2.
3. **Direction C6 versus AGENTS.md audit ownership:** unauthorized operations create no state-change audit record, but nothing in the directions records denials anywhere (D7 gap).
4. **The Sprint 0 Blueprint is absent**; acceptance criteria here are derived, not Blueprint-sourced (D1).
5. **Spec S0-05 states timestamps are not audit history, which belongs to S0-06**; consistent with the proposal, no conflict.
6. **Q6 and C7:** FU-3 changes the S0-05 public contract (new error codes); S0-05's approval of the contract does not cover it. Needs approval (D8).

No conflict was found between the directions and the final S0-05 approval, A1 to A4 or the architecture checker, provided the audit code stays inside `modules/investigation` and no cross-context transaction is introduced.

## 2. Proposed component boundaries

```text
apps/api (composition root, approved)
 ├─ identity/            Synthetic IdP + issuer registry (application layer; refuses non-local/test)
 └─ composition/         builds issuer, Actor Contexts, createInvestigationModule(...)
modules/investigation
 ├─ public/              Actor Context type, audit action names, new error codes (contracts only)
 ├─ application/         service: authenticate -> authorise -> existing order -> audit port
 │   └─ ports/           AuditWriter (new), TransactionScope (existing)
 ├─ domain/              unchanged (FU-3 validation is application-level; see 7)
 └─ infrastructure/persistence/  Drizzle audit adapter (new), audit table schema
infrastructure/database/migrations/0003_...sql   (future)
```

Investigation neither imports nor knows the provider; it knows only the `ActorContext` contract and the issuer-verification function injected by composition.

## 3. Actor and authentication alternatives (decision D3)

| Option                                                                       | Trade-offs                                                                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Explicit `ActorContext` argument on every command (issuer-registered)** | Explicit, testable, no ambient state, same check for any caller; changes every signature; context passed through call chains                                    |
| B. Scoped service (`service.forActor(ctx)`)                                  | Signatures stay as they are; one extra object per request; easy to hold a stale scoped service; the binding is less visible in call sites                       |
| C. Ambient `AsyncLocalStorage`                                               | Smallest diff; hidden dependency, easy to lose across worker or scheduled boundaries, harder to prove in tests; contradicts the explicit style of the contracts |
| D. Trust a plain `actorId` string                                            | Cheap; no authentication at all; forgeable by any caller. Rejected                                                                                              |

**Recommendation: A, with an opaque, member-less, issuer-registered `ActorHandle` instead of a context object that carries claims** (v0.2 change). The WeakMap pattern of `persistence-handle.ts` and `unit-of-work.ts` is the in-repository precedent; claims stay issuer-private and the service receives a fresh deep-frozen copy from an injected `ActorResolver` port. Authentication and authorization run before the transaction is created. **Evidence:** CLAUDE.md section 5 (explicit, readable code) and the existing explicit `tx` and `expectedVersion` parameters. **Blocks implementation:** yes (WP-02, WP-03, WP-05).

Sub-decisions with the same recommendation style:

- **Credential mechanism:** static synthetic tokens in a fixture table (recommended: simplest, clearly non-production) versus signed fixture assertions (more realistic, adds crypto code and possibly a dependency, which needs approval). Blocks WP-02.
- **Human versus System:** two kinds in one `actorKind` field (recommended) versus two types. AI is a System actor with no extra authority.
- **Principal mapping:** fixed table to `EntityRef { entityType: 'Actor', id: UUIDv7 }` (recommended). Whether `Actor` is an entity type owned by a context is open; the Phase 1 choice keeps it in the provider fixture and the Investigation public contract only.
- **Isolation:** environment allowlist (`local`, `test`) checked at provider construction (recommended), plus an architecture rule that Investigation cannot import identity.
- **Failures:** `unauthenticated` as a value, never thrown, no detail on the cause.

## 4. Authorization enforcement alternatives

| Option                                                      | Trade-offs                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **A. In the application service, first step of each write** | Covers HTTP, tests, workers, direct calls; small repeated code, mitigated by one `requirePermission` helper               |
| B. Only in `apps/api` guards/DTO validation                 | Simple for HTTP; a direct service call bypasses it entirely. The Owner's instruction already rules this out as sufficient |
| C. In repository or database (row-level security)           | Strongest at the data layer; needs actor propagation into the connection, role design, and is large for a synthetic MVP   |
| D. A and B together                                         | Defence in depth; B must not become the only control                                                                      |

**Recommendation: A, optionally with B later (D).** **Evidence:** CLAUDE.md section 5 places authentication integration in `apps/api` but domain commands in the application layer; `AGENTS.md` ties authorization to domain operations. **Blocks:** yes (WP-03). Reads: unresolved, see section 11.

## 5. Audit record contract alternatives (decisions D4, D5)

| Option                                                                                    | Trade-offs                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A. One flat `investigation.audit_record` table, typed columns + small `details` jsonb** | Queryable by actor, case, action; matches `AuditMetadata`; one adapter; `details` must stay small and typed |
| B. Full JSON payload only                                                                 | Flexible; hard to constrain and index, easy to leak sensitive fields                                        |
| C. Per-command audit tables                                                               | Strong typing; four tables for four commands, more migrations                                               |
| D. Database triggers producing audit rows                                                 | Cannot know the actor or correlation id without session variables; hides behaviour. Rejected                |

**Recommendation: A.** `case_id` is non-null exactly when the subject is an `InvestigationCase` (`case_opened`, `attempt_linked`) and equals `subject_id`; null for `uut_registered` and `test_attempt_registered`. Foreign key to `investigation_case(id)` with `NO ACTION` (v0.2 proposal; was open); deleting a case that has audit history must be rejected, never cascaded. `details` is a closed per-action allowlist enforced by the Investigation validator and by database checks; `recorded_at` is omitted in Phase 1. **Evidence:** `AuditMetadata` shape; existing flat tables in `0002`. **Blocks:** yes (WP-04).

Append-only: row triggers for update and delete plus a statement trigger for truncate (the existing `reject_update` rejects updates only). The triggers guard against application bugs, **not** against the table owner, a superuser, `DISABLE TRIGGER`, `DROP`, `session_replication_role` or a restore; role separation and tamper-evidence are production obligations (OBL-AUD-1, specification 4.7).

## 6. Transaction composition alternatives (decision D6)

| Option                                                                                                                                                                     | Trade-offs                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Service calls an `AuditWriter` port in the same `transactional()` unit; the adapter uses `PersistenceHandle` + `executorOf(handle, tx)` and rejects a missing token** | Explicit, uses the existing `TransactionToken`, easy failure injection; every command must remember to call it (mitigated by a helper and by AC-3 tests)   |
| B. Repository writes audit inside `save`/`add`                                                                                                                             | Impossible to forget; couples persistence to actor and action knowledge and hides audit from the service, and the repository would need the actor          |
| C. Decorator around the service                                                                                                                                            | Audit is separate from logic; but the decorator sits outside the transaction and could not make state and audit atomic without a second boundary. Rejected |
| D. Shared audit/transaction framework across contexts                                                                                                                      | Forbidden without separate approval (S0-05 final approval)                                                                                                 |

**Recommendation: A.** Audit failure fails closed. **v0.2 correction:** v0.1 named `executorFor(db, tx)` for the adapter; the Investigation module never holds a `db`, so the correct, existing design is `executorOf(handle, tx)`, as `DrizzleInvestigationRepository` already does (specification 4.2). `executorOf(handle)` without a token returns the pool, so the adapter must throw when the token is missing. **Evidence:** A2.6 (the context-owned port was the validated shape) and the existing atomic version-bump-plus-link. **Blocks:** yes (WP-05).

## 7. FU-3 error and precedence matrix

Validation is application-level in the service (the domain takes already-validated input). The matrix lists the first failing step for a request; steps are numbered as in the specification section 7.2.

| Scenario (`current.version = v`)                                                                                         | Outcome                                           | Why                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------- |
| Unknown role, valid everything else                                                                                      | role error                                        | Step 1                                      |
| Unknown case with an invalid `expectedVersion`                                                                           | `case_not_found`                                  | Step 2 before 5                             |
| Unknown attempt with an invalid `expectedVersion`                                                                        | `attempt_not_found`                               | Step 3 before 5                             |
| Different UUT with an invalid `expectedVersion`                                                                          | `uut_mismatch`                                    | Step 4 before 5                             |
| `'3'`, `3n`, `new Number(3)`, `NaN`, `Infinity`, `2.5`, `0`, `-1`, `2147483648`, `9007199254740993`, `undefined`, `null` | `invalid_expected_version`                        | Step 5 (no coercion)                        |
| Valid but ≠ `v`, identical link exists                                                                                   | `concurrency_conflict`                            | Step 6 beats idempotency (Q6 kept)          |
| Valid, `= v`, identical link exists, any `v` including 2147483647                                                        | `ok`, `created: false`, no audit                  | Step 7                                      |
| Valid, `= v = 2147483647`, new link                                                                                      | `version_exhausted`                               | Step 8                                      |
| Valid, `= v < 2147483647`, new link                                                                                      | `ok`, `created: true`, version `v + 1`, one audit | Steps 9 and 10 (the audit write is stage 2) |
| Valid, stale, at maximum                                                                                                 | `concurrency_conflict`                            | Step 6                                      |

Unauthenticated and permission-denied precede all rows (steps A1 and A2, stage 2). **Alternatives to Option B** (for the record): A, validate at function entry (changes today's precedence for missing cases, rejected by C7); C, validate in the HTTP layer only (a direct call would pass any value). **Recommendation: B** as directed. **Blocks:** WP-01.

## 8. Migration implications

- New file `infrastructure/database/migrations/0003_create_investigation_audit_record.sql`; `0001` and `0002` are not touched (their checksums stay `c9add3b0…` and `b4914ddb…`).
- No timestamp defaults (injected clock); check constraints for `action`, `actor_kind`, `schema_version`; update **and** delete rejecting triggers; `comment on table` ownership note.
- Tests that list tables or migrations (`migrations.integration.test.ts`, `migrations.spec.ts`, and the compiled-runtime child) are updated in **WP-04** (assigned there, not in WP-06); the differential and invariant migration tests should be re-run.
- The `integer` version column is not changed (C9). If a future need arises to exceed 2147483647, that is a separate migration decision.

## 9. Security risks

| Risk                                                       | Severity | Mitigation                                                                                                |
| ---------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| In-process forgery of an Actor Context                     | Medium   | Issuer registry; only composition roots import the issuer (checker rule); tests for hand-built contexts   |
| Synthetic provider reaching a non-test deployment          | High     | Environment refusal at construction; no credentials in the repository; `.env.example` placeholders only   |
| Authorization only at HTTP                                 | High     | Enforcement in the service (option A)                                                                     |
| Denied attempts unrecorded                                 | Medium   | Owner decision D7; structured security log as the proposed minimum                                        |
| Audit table tampering                                      | Medium   | Triggers for update and delete; no application path to modify; later, privilege separation (out of scope) |
| Sensitive data in audit `details`                          | Medium   | Identifiers only; typed `details`; tests that the serial number and hostname never appear                 |
| Log injection through the echoed invalid `expectedVersion` | Low      | Do not echo non-numeric values                                                                            |
| Audit becomes a single point of failure                    | Low      | Intended fail-closed behaviour, confirmed by D6                                                           |
| OBL-SEC-1 (22 dependency advisories)                       | Open     | Not a gate; S0-06 adds no dependency; triage remains required before any production deployment            |

## 10. Test matrix

| Concern                     | Layer                           | Tests                                                                                                                  |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| FU-3 validation, precedence | Unit (service, fake repo)       | Every row of section 7 matrix; `Result` shape; no repository call after step 5 failure                                 |
| Version exhaustion          | Integration (real PG)           | Case seeded at 2147483647 by test-only SQL; new link, duplicate, stale; column definition unchanged                    |
| Identity                    | Unit + architecture             | Issuer, registry, forged context, environment refusal; checker fixtures for the import rules                           |
| Authorization               | Unit + integration              | Direct service calls with and without each permission                                                                  |
| Audit coverage              | Integration                     | One row per committed change, none otherwise (section 5 table)                                                         |
| Atomicity                   | Integration (failure injection) | Audit port throws; check-constraint violation; both leave no domain row                                                |
| Concurrency                 | Integration                     | Row-lock gating with the audit write in the unit; one winner, one audit row. FU-2 informs the scheduling technique     |
| Append-only                 | Integration                     | UPDATE and DELETE on `audit_record` fail                                                                               |
| Migration                   | Integration                     | `0003` on clean and on `0002` databases; checksums of `0001` and `0002` unchanged                                      |
| Regression                  | All                             | S0-05 suites; compiled-runtime smoke test; `pnpm db:test`                                                              |
| Golden                      | Deferred                        | No Golden scenario is in scope; the "AI cannot bypass approval" scenario belongs to the task that introduces approvals |

## 11. Remaining Owner decisions

| Decision                                                                | Recommendation                                            | Blocks implementation |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | --------------------- |
| D1 Which document is the specification baseline; Blueprint availability | Designate this specification after revision               | Yes                   |
| D2 Does conditional closure satisfy the prerequisite; FU-3 first        | Yes for planning; FU-3 is WP-01                           | Yes                   |
| D3 Actor Context option, credential mechanism, `Actor` entity type      | Option A; static tokens; Actor type kept in Investigation | Yes (WP-02+)          |
| D4 Audited command list; reads out of scope                             | The four commands                                         | Yes (WP-04, 05)       |
| D5 Record of audit ownership (ADR or amendment) given Decision 7        | A short ADR or amendment                                  | Yes (WP-04)           |
| D6 Fail-closed audit in the same unit                                   | Option A section 6                                        | Yes (WP-05)           |
| D7 Where denials and authentication failures are recorded               | Separate security log, no table in Phase 1                | Yes (WP-05)           |
| D8 Approve the additive error codes as a public-contract change         | Approve                                                   | Yes (WP-01)           |
| D9 Acceptance gates and Codex review cadence                            | As in the register                                        | Before WP-06 closes   |
| Read authorisation (`getUut`, `getTestAttempt`, `getCase`)              | Out of Phase 1, recorded as a known gap                   | No                    |
| Foreign key from `audit_record.case_id`; `recorded_at` omitted          | FK yes; omit                                              | No                    |
| Retention period for audit data                                         | Undecided; none needed for synthetic data                 | No                    |

## 12. Revisions in v0.2 (independent architecture review)

| Area                    | Change                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audit persistence       | `executorFor(db, tx)` replaced by `PersistenceHandle` + `executorOf(handle, tx)`; missing token is an explicit error (section 6)                                                                                   |
| Actor trust             | Opaque handle, issuer-private claims, trusted clock, foreign-issuer rejection, checks before the transaction (section 3); production isolation and read policy in specification 3                                  |
| Decision 5              | Historical wording stays CONDITIONAL; the condition is satisfied through the A2 section of the effective-policy file; v0.1's "CONDITIONAL until A2 is effective" is withdrawn as stale                             |
| FU-3                    | Two stages (existing service plus FU-3; later authenticated integration); full error contracts and the compatibility inventory are in specification 7; precedence now starts with authentication and authorization |
| Decision 7              | Proposed Amendment A5 drafted in the ADR-025 file with Status PROPOSED; nothing accepted                                                                                                                           |
| Audit integrity         | Per-action details allowlist, `case_id` rule, foreign key, timestamp provenance, roles and trigger limits, Security Log contract (specification 4)                                                                 |
| Activation and recovery | One mandatory-audit activation point, startup readiness, no rollback to an unaudited build, forward repair, lost-acknowledgment strategy (specification 6, plan WP-05)                                             |
| Work packages           | Identity checker rules in WP-02, migration inventory in WP-04, integrated verification only in WP-06; WP-03, WP-05, WP-06 blocked by WP-01; WP-02 and WP-04 independent (plan section 2)                           |

The remaining Owner decisions are in the [decision register](../specs/S0-06-owner-decision-register.md) section 6 and the [remediation matrix](S0-06-review-remediation.md).
