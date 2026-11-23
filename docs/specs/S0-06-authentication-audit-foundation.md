# S0-06 — Authentication and Audit Foundation (Specification v0.3, DRAFT)

**Status:** DRAFT, an **Owner Approval Candidate** after the independent architecture review (Codex: REVISE, 1 BLOCKER, 5 MAJOR, 2 MINOR). **Not approved. S0-06 implementation is NOT STARTED.** Everything below is a proposal built on the directions C1 to C10 of the [decision register](S0-06-owner-decision-register.md); no decision in it is formally approved.

- **Date:** 2026-11-22.
- **Reviewed baseline (pinned):** `main` at `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21` (documents reviewed at branch HEAD `24b73c8`). **Integration base:** before any work package starts, the implementer records the then-current `origin/main` SHA, runs `git merge-base --is-ancestor ae7dc51 origin/main`, and diffs the files this specification names (`investigation-service.ts`, the ports, `persistence-handle.ts`, `unit-of-work.ts`, `dependency-matrix.json`, migrations) between `ae7dc51` and that base. Any difference is reported to the Owner before work starts; "`main` is unchanged" is never assumed.
- **Not in the repository:** the Sprint 0 Blueprint. Scope below is derived from the Owner directions and the title (decision D1).
- **Revision note (v0.2 to v0.3):** replaced the audit-adapter integration with the existing `PersistenceHandle`/`executorOf` design; made the actor contract an opaque issuer-verified handle; added production isolation, audit activation/recovery, record integrity, the Security Log contract, the full FU-3 contract and the A5 amendment draft. Findings are traced in the [remediation matrix](../reviews/S0-06-review-remediation.md).

## 1. Objectives and scope

**Proposed objective:** every state change the Investigation context commits is attributable to a trusted actor, is authorised, and leaves exactly one authoritative audit record written atomically with the change. Closing FU-3 (validation of `expectedVersion`, version exhaustion) is in scope because it changes the same command, and it is delivered **first and on its own** (WP-01) before any audit integration.

**In scope (proposed):** a synthetic identity and trusted actor handle; a minimal permission model; an Investigation-owned audit writer, port and table; atomic state-plus-audit writes; FU-3 option B; a Security Log contract for rejected operations.

**Out of scope:** real authentication, HTTP endpoints and DTOs, audit for any other context, a shared audit context, outbox and inbox, audit read APIs, retention automation, a security-event database table, S0-07 and later work. FU-1, FU-2 and FU-4 stay separately tracked and unscheduled; OBL-SEC-1 stays a production-deployment obligation and is not a gate.

### 1.1 Existing commands (verified in `modules/investigation/src/application/investigation-service.ts` at `ae7dc51`)

| Command               | Input                                           | Effect                                                                                                        | Result on success                              | Mutation semantics                                               |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `registerUut`         | `{ serialNumber?, hostname? }`                  | Inserts a UUT with a new UUIDv7 and `createdAt = deps.now()`                                                  | `Result<Uut, …>`                               | Always creates; no uniqueness (Q3)                               |
| `registerTestAttempt` | `{ uutId, stage, externalExecutionReference? }` | Validates stage, requires the UUT, inserts an attempt (`registeredAt`)                                        | `Result<TestAttempt, …>`                       | Always creates                                                   |
| `openCase`            | `{ uut: UutRef }`                               | Requires the UUT, inserts a case, `version = 1`, `openedAt`                                                   | `Result<InvestigationCase, …>`                 | Always creates                                                   |
| `linkAttempt`         | `{ caseId, attemptId, role, expectedVersion }`  | Validates role, loads case and attempt, same-UUT, compares version, inserts link and bumps version atomically | `Result<LinkResult, …>` (`created` true/false) | New link, or no-op for an identical link at the matching version |

None takes an actor or correlation identifier and none writes audit data. Reads (`getUut`, `getTestAttempt`, `getCase`) run without a transaction (policy in 3.3).

## 2. Synthetic identity and the actor trust contract

Alternatives and trade-offs are in the [contract review](../reviews/S0-06-contract-design-review.md) sections 3 and 4.

### 2.1 Trust boundary

```text
 caller (api request, test, future worker)         trusted issuer (apps/api composition)        Investigation
 ────────────────────────────────────────         ───────────────────────────────────────      ─────────────────────
 asks for a handle with a principal key   ──────>  verifies; derives claims; mints ActorHandle
 holds ONLY the opaque handle             <──────  (claims stay inside the issuer)
 passes { actor: handle, correlationId }  ─────────────────────────────────────────────────>  resolves handle through the
                                                                                               injected ActorResolver port
```

- The **issuer** is the only code that creates handles and the only holder of claims. It lives under `apps/api/src/composition/identity/**`, which is already an approved composition-root path in `dependency-matrix.json`; **no allowlist entry is added or widened.** Rules that restrict who may import it are new restrictions, covered by executable checker tests in WP-02 (a restriction is not an allowlist widening, but the Owner reviews it as part of D3).
- **Investigation never verifies credentials.** It owns only the contract: an `ActorHandle` type and an `ActorResolver` port (`resolve(handle) → verified actor | undefined`), implemented by the issuer and injected through the module composition option `actorResolver`. The service factory refuses to be built without it, so no composition can forget authentication.

### 2.2 Opaque verified Actor Handle

An `ActorHandle` is a frozen object with **no members**, created by the issuer and registered in an issuer-private `WeakMap` (the same pattern as `PersistenceHandle` in `infrastructure/database/src/persistence-handle.ts` and `TransactionContext` in `unit-of-work.ts`). It carries no claims, so a caller cannot read or alter them. Anything else passed as a handle (a plain object with `permissions`, a copy, a handle from another issuer, `null`) is not in the registry and is rejected as unauthenticated.

### 2.3 Issuer-private canonical claims

Claims are created once at issuance from the issuer's fixed principal table and never from caller input:

| Claim                   | Rule                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`                 | `EntityRef { entityType: 'Actor', id }`, `id` a **fixed, valid UUIDv7 literal** per synthetic principal (deterministic across runs; checked by `isEntityId`); no Actor table, no foreign key |
| `actorKind`             | `HUMAN` or `SYSTEM`, a field of the principal table entry. It is never derived from a credential string, a name pattern or a caller argument                                                 |
| `permissions`           | A frozen, sorted, de-duplicated array of strings from the closed permission vocabulary in 3.1, built at issuance. No nested objects, no maps, no getters, no caller-owned references         |
| `issuedAt`, `expiresAt` | From the issuer's trusted clock (below)                                                                                                                                                      |

`resolve(handle)` returns a **fresh, deep-frozen copy** each time, so the service cannot mutate registry state and no caller-held object aliases it. The service uses the copy for one command and never stores it.

### 2.4 Trusted clock, expiry, lifetime and reuse

- The issuer receives its clock by injection from the composition root (the same application clock family as `deps.now`); a caller can never supply "now". Expiry is checked inside `resolve` against that clock.
- A handle is **reusable** until `expiresAt` (a bearer for several commands) and can be **revoked** by the issuer. The time-to-live is an Owner parameter; proposed default 15 minutes for synthetic use. A handle is process-local: it does not survive a restart, is not serialisable, and must not be logged, stored or sent across a process boundary.
- Expiry is checked once per command, **before the transaction is created**; a transaction already running is not interrupted. This is a stated limit, not a defect: commands are short and the check protects against stale handles, not against actions in flight.
- A handle from another issuer instance (another test issuer, a stale process object) is not in this issuer's registry and is rejected as `unauthenticated`.

### 2.5 Human and System actors

Two kinds in the one `actorKind` field. A System actor is an automation principal (for example a test harness). **AI is not a privileged kind:** an AI-originated request is a System actor with only the permissions its principal entry lists, and none that imply approval authority (CLAUDE.md section 8, "AI recommendations cannot bypass human approval").

### 2.6 Request context and correlation provenance

The first argument of every command is `context: { actor: ActorHandle; correlationId: CorrelationId }`. `correlationId` is **not** an authority claim. It is created or propagated by the composition layer at request entry (an incoming trace id or a newly generated one), parsed with `parseCorrelationId` (`CorrelationId` is a branded Shared Kernel type), and stored as given. The audit writer never generates one. A missing or malformed value is rejected by the service before the transaction with `investigation.invalid_request_context`. `causationId` and `executionContext.source` are optional context fields with the same provenance.

### 2.7 When authentication and authorization happen

Both happen **before `transactions.run` is called**: no connection is taken, no transaction opens, and no domain or audit row can exist for an unauthenticated or unauthorised request. The service resolves the handle, checks the permission and validates the context, and only then enters the transactional unit. (Step order for `linkAttempt` is in section 7.)

### 2.8 Direct Application Service calls

Every enforcement step is inside the service, not in a controller. A test, a script or a future worker that calls `service.linkAttempt(...)` gets exactly the same checks. TypeScript requires the `context` argument; a JavaScript caller that omits or forges it gets `unauthenticated` (the handle is checked at runtime, not trusted by type). HTTP validation or an `apps/api` guard may be added later as defence in depth, never as the only control.

### 2.9 Failures

`investigation.unauthenticated` is a returned error value (not thrown) for: no handle, a handle not in the registry, a foreign-issuer handle, an expired or revoked handle. The returned error carries no detail on the cause. The cause is recorded only in the Security Log (section 4.7) as a closed reason code.

## 3. Authorization, production isolation, reads

### 3.1 Permission model (proposed)

| Permission                        | Command               |
| --------------------------------- | --------------------- |
| `investigation.uut.register`      | `registerUut`         |
| `investigation.attempt.register`  | `registerTestAttempt` |
| `investigation.case.open`         | `openCase`            |
| `investigation.case.link_attempt` | `linkAttempt`         |
| `investigation.read`              | the three reads (3.3) |

Flat grants from the principal table; no hierarchy, resource rules or delegation. A missing permission returns `investigation.permission_denied` with `details: { requiredPermission }` only. Permissions do not mean readiness or approval of any engineering conclusion (AGENTS.md section 8).

### 3.2 Production isolation

| Topic                                    | Proposed rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted environment configuration source | One function in the identity module reads the process environment once at startup (the same source the repository already uses: `process.env`, `.env.local`, `NODE_ENV`, `DATABASE_URL`) and returns a `TrustedEnvironment` value. The issuer constructor accepts only that value, never a caller-supplied string                                                                                                                                                                                                                             |
| Fail closed                              | The synthetic issuer is allowed only on a **positive** match: `SDRIS_ENV` is exactly `local` or `test`, `NODE_ENV` is not `production`, and, when a database URL is in use, `assertDisposableLocalTarget` accepts it. A missing, empty, misspelt or conflicting value throws at startup. The default is **refusal**, never "synthetic". This differs from a negative check (`NODE_ENV !== 'production'`), which would pass when the variable is unset                                                                                         |
| Synthetic credential lifecycle           | Phase 1 has no HTTP and therefore **no credential strings at all**: tests obtain handles by principal key. When S0-07 adds HTTP, a credential is generated per process with a cryptographic random source, held in memory only, never logged or committed, invalid after restart; no static token literal enters the repository (CLAUDE.md section 13)                                                                                                                                                                                        |
| Production startup rejection             | Constructing the synthetic issuer outside `local`/`test` throws `SyntheticIdentityForbiddenError`; the API process exits non-zero before it listens. No production issuer exists in S0-06; a real one is a separate Owner-approved task                                                                                                                                                                                                                                                                                                       |
| Packaging and startup tests              | (a) unit tests for every environment combination (unset, empty, `production`, `prod`, `Test`, conflicting `NODE_ENV`/`SDRIS_ENV`); (b) an extension of the compiled-runtime test that starts the **compiled** API with a production-like environment and asserts a non-zero exit before listening; (c) a packaging check that the fixture principal table is excluded from the build output (as `spike-store.ts` is excluded by A4) or, if the Owner prefers it to ship, that (a) and (b) are the only protection. Recommendation: exclude it |
| Authorized test fixture access           | Fixture principals and `issue(principalKey)` are importable only from `*.test.*`, `*.spec.*`, `__tests__/` files and the identity module itself, enforced by a checker rule (WP-02), in the style of Amendment A3. No change to `testOnlyEntrypoints` is proposed here; if the rule needs one, that is a separate proposal                                                                                                                                                                                                                    |
| Issuer import restrictions               | Outside `apps/api/src/composition/**` and recognised test files nothing may import the issuer; `modules/investigation/**` may not import the identity module at all (it sees only `ActorHandle` and `ActorResolver`)                                                                                                                                                                                                                                                                                                                          |
| Worker composition                       | `apps/worker` is **not** an approved composition root (ADR-025 A2.7, dependency matrix) and so can neither import the issuer nor the Investigation composition entrypoint. Any future worker mutation needs a separate Owner proposal covering a worker System principal. S0-06 adds none                                                                                                                                                                                                                                                     |

Limit: an environment variable is a configuration source, not a security boundary against someone who controls the process. The rule prevents accidental and mispackaged use, not a hostile operator.

### 3.3 Reads: authorization and exposure

Reads return identifiers, serial numbers and hostnames. **Proposal (recommended):** the three read methods also take `context`, require authentication and `investigation.read`, return the existing types, and write **no** audit record (no state change; read-access auditing is out of scope and is a stated gap). Rejections go to the Security Log. **Alternative:** leave reads open in Phase 1 and record the gap. Either choice changes or preserves the S0-05 read signatures, so it is listed in the compatibility inventory (7.5) and decided by the Owner (D3). Exposure: the read methods are reachable only through the service object the composition root returns; nothing outside the composition roots can obtain it.

## 4. Audit ownership, persistence and integrity

### 4.1 Components (Investigation-owned; no shared Audit Context)

| Component             | Location (proposed)                                                            | Role                                                                          |
| --------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `AuditWriter` port    | `modules/investigation/src/application/ports/audit-writer.ts`                  | `record(entry: InvestigationAuditEntry, tx: TransactionToken): Promise<void>` |
| Drizzle audit adapter | `modules/investigation/src/infrastructure/persistence/drizzle-audit-writer.ts` | The only place that touches Drizzle or SQL for audit                          |
| Audit table           | `investigation.audit_record`, migration `0003`                                 | Append-only                                                                   |
| Public contract       | `modules/investigation/src/public/index.ts`                                    | Action names, entry type, error codes: contracts only                         |

### 4.2 Persistence contract: the existing `PersistenceHandle` design

This **replaces** the v0.2 text that named `executorFor(db, tx)`. The Investigation infrastructure never receives a `db` object. It receives an opaque `PersistenceHandle` (created by the composition root with `createPersistenceHandle`) and resolves an executor with `executorOf(handle, tx)`, exactly as `DrizzleInvestigationRepository` does (`this.persistence`, `executorOf(this.persistence, tx as unknown as TransactionContext | undefined)`). The audit adapter:

1. is constructed with the same `PersistenceHandle` in `createInvestigationModule`, next to the repository and the `PersistenceTransactionScope` (which uses `unitOfWorkOf(handle).run`);
2. **requires** an active transaction token: `record(entry, tx)` first checks that `tx` is defined and throws `AuditTransactionRequiredError` if it is not. This closes a gap that exists in the primitive: `executorOf(handle)` with no `tx` **returns the pool executor** (`executorFor` returns `db` when `tx` is undefined), so an unguarded adapter could write audit outside the unit of work. The check must not be optional;
3. relies on `executorFor` for validity: an unknown token throws `TransactionContextError('Unknown transaction context.')` and a token whose unit has ended throws `TransactionContextError('Transaction context is no longer active.')`. Neither may be caught and downgraded; they propagate, the unit rolls back, and the command throws;
4. keeps Drizzle, the table definition and every ORM type inside `src/infrastructure/**`; the port and the service mention none.

The A1 to A4 rules already allow all of this for `@sdris/investigation` (`@sdris/database`, `drizzle-orm` are allowlisted for its infrastructure); no checker or allowlist change is needed.

### 4.3 Candidate audit record

| Column                       | Type            | Source / rule                                                                               |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `audit_id`                   | uuid, PK        | `deps.newId<'AuditRecord'>()` (UUIDv7)                                                      |
| `action`                     | text, check     | One of the four actions in 4.4                                                              |
| `actor_type`, `actor_id`     | text, uuid      | The `EntityRef` of the verified actor (`Actor`, UUIDv7); no foreign key                     |
| `actor_kind`                 | text, check     | `HUMAN` or `SYSTEM`                                                                         |
| `subject_type`, `subject_id` | text, uuid      | The entity the command created or changed (4.4)                                             |
| `case_id`                    | uuid, null      | Non-null **iff** `subject_type = 'InvestigationCase'`, and then equal to `subject_id` (4.5) |
| `occurred_at`                | timestamptz     | The single injected-clock reading of the command; never a database default                  |
| `correlation_id`             | text            | From the request context (2.6)                                                              |
| `causation_id`, `source`     | uuid null, text | Optional context; `source` from the request context                                         |
| `schema_version`             | integer         | `1`                                                                                         |
| `details`                    | jsonb, null     | Per-action allowlist (4.4); a database check enforces the key set                           |

`recorded_at` is omitted in Phase 1 (one clock; it would duplicate `occurred_at`).

### 4.4 Actions, subjects and allowed details (closed allowlist)

| Action                                  | `subject`                     | `case_id` | Allowed `details` keys                               | Persisted timestamp equality                                     |
| --------------------------------------- | ----------------------------- | --------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `investigation.uut_registered`          | `UUT` (the new UUT)           | null      | none (`details` null)                                | `occurred_at = uut.created_at`                                   |
| `investigation.test_attempt_registered` | `TestAttempt` (the new one)   | null      | `uutId`, `stage`                                     | `occurred_at = test_attempt.registered_at`                       |
| `investigation.case_opened`             | `InvestigationCase` (new)     | = subject | `uutId`                                              | `occurred_at = investigation_case.opened_at`                     |
| `investigation.attempt_linked`          | `InvestigationCase` (changed) | = subject | `attemptId`, `role`, `versionBefore`, `versionAfter` | `occurred_at = case_test_attempt_link.linked_at` of the new link |

**Sensitive-data allowlist:** only the identifiers and controlled values in the table (UUIDv7 ids, `stage` from `IST`/`SAT`, `role` from the four roles, integer versions). **Never** stored: serial number, hostname, `externalExecutionReference`, credentials, handles, claims, free text, error messages. `versionAfter = versionBefore + 1` is a check in the validator and in tests.

These are audit **actions**, not domain events; event publication and outbox stay deferred (ADR-025 Decision 7).

### 4.5 Subject and case relationships; foreign keys; deletion

- `case_opened` and `attempt_linked` have the case as subject, so `case_id = subject_id`. For `attempt_linked` the attempt appears in `details.attemptId`. `uut_registered` and `test_attempt_registered` have no case, so `case_id` is null. A database check states `(subject_type = 'InvestigationCase') = (case_id is not null)` and `case_id = subject_id` when set.
- **Foreign key:** `case_id references investigation.investigation_case (id)` with the default `NO ACTION`. It is satisfiable because the case row exists earlier in the same transaction for both actions. Deleting a case is not an approved operation and nothing implements it. **Future deletion policy:** deleting a case that has audit rows must be rejected, never cascaded; any case-deletion feature needs its own Owner decision about archival of the audit history before it is built. There is no foreign key on `subject_id` (it is polymorphic), on `actor_id` (no Actor table) or on ids inside `details`; their integrity comes from being written in the same transaction as the rows they name.

### 4.6 Investigation-specific validation and provenance

`parseAuditMetadata` (Shared Kernel) validates the **generic** envelope only: any dotted lower-case `action`, any `EntityRef`. It does not know the Investigation vocabulary. The Investigation application layer therefore adds `validateInvestigationAuditEntry`, which runs before the first write and rejects: an action outside the four; a `subject.entityType` that does not match the action; a `case_id` rule violation; a `details` key outside the allowlist or an out-of-range value; a `versionAfter` that is not `versionBefore + 1`; an invalid actor `EntityRef`; an invalid correlation id. A failure throws before any row is written. The database check constraints repeat the same rules as defence in depth.

- **Timestamp provenance:** `deps.now()` is read **once per command**, and that reading is used for the domain timestamp and `occurred_at`. In the current `linkAttempt` the clock is read once, inside `linkTestAttempt`; the implementation must keep a single reading. Comparisons in tests are per operation as the last column of 4.4 states, on the persisted `timestamptz` values, not on in-memory objects.
- **Correlation provenance:** section 2.6.
- **Shared Kernel** is not changed.

### 4.7 Integrity limits, database roles and the Security Log

**Database roles (assumption for production, not enforceable locally).** The application should connect as a role that has `INSERT` and `SELECT` on `investigation.audit_record` and **no** `UPDATE`, `DELETE`, `TRUNCATE`, or DDL rights; migrations run as a separate owner role. The local development setup uses one role (`sdris_local`) that owns everything, so in Phase 1 **privilege separation is not demonstrated**.

**What the triggers do and do not give.** `BEFORE UPDATE` and `BEFORE DELETE` row triggers (like the existing `reject_update`) plus a statement-level `BEFORE TRUNCATE` trigger stop application bugs and ordinary SQL from changing audit history. They do **not** stop the table owner, a superuser, `ALTER TABLE … DISABLE TRIGGER`, `DROP TRIGGER`, `DROP TABLE`, `session_replication_role = replica`, a restored backup, or direct file access. The table is **not tamper-evident** (no hash chain or external anchoring); that is out of scope and listed as deferred. The production obligation proposed as **OBL-AUD-1**: separate roles, restricted DDL, and an Owner decision on tamper-evidence before any production deployment. It is not a gate for S0-06.

**Security Log (rejected operations; a structured log contract, not a database table).** Authentication failures, permission denials and invalid request contexts create no authoritative audit record. They are written to a **Security Log** through an Investigation `SecurityLog` port, with these rules:

| Aspect                  | Contract                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event                   | One JSON object per rejection: `event` (`security.unauthenticated`, `security.permission_denied`, `security.invalid_request_context`), `at` (injected clock), `command`, `correlationId` (only if valid), `reason`, and `actorId` + `requiredPermission` **only** for `permission_denied` (the actor is verified there)                                                 |
| Reason codes            | Closed set: `missing_handle`, `unknown_handle`, `expired_handle`, `revoked_handle`, `permission_missing`, `invalid_correlation`                                                                                                                                                                                                                                         |
| Redacted / never logged | Credentials, handles, claims, tokens, request payload values (serial number, hostname, reference, ids supplied by the caller), stack traces, and anything the caller controls except the validated `correlationId`                                                                                                                                                      |
| Credential failures     | Logged as a reason code only; the returned error never says which part failed (2.9). The log does not distinguish "wrong secret" from "no such principal"                                                                                                                                                                                                               |
| Access control          | Readable only by operators of the deployment; never exposed through the API or a read method; in Phase 1 the sink is the process log                                                                                                                                                                                                                                    |
| Retention               | Phase 1: only what the process log keeps. A production retention period is an **open Owner decision**; the synthetic-only data needs none                                                                                                                                                                                                                               |
| Sink failure            | The rejection result stands: a failing sink never turns a denial into success and never throws into the command path. The failure is reported best-effort to standard error and counted. This is acceptable because the Security Log is non-authoritative; if the Owner wants denials to be authoritative, a security-event table needs its own approval (not proposed) |

## 5. Audit semantics

Only a committed state change produces an authoritative audit record, and every committed state change produces exactly one.

| Case                                                                                                      | State change | Authoritative audit record  | Result                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------ | --------------------------- | ----------------------------------------------------------------------- |
| Successful create (UUT, attempt, case)                                                                    | Yes          | **One**, same transaction   | `ok`                                                                    |
| Successful new link                                                                                       | Yes          | **One** (`attempt_linked`)  | `ok`, `created: true`                                                   |
| Duplicate link at the matching version                                                                    | No           | **None**                    | `ok`, `created: false`, version unchanged                               |
| Validation failure (role, stage, not found, same-UUT, invalid `expectedVersion`, invalid request context) | No           | **None**                    | error value                                                             |
| Concurrency conflict                                                                                      | No           | **None**                    | `investigation.concurrency_conflict`, even if the identical link exists |
| Authentication or authorization failure                                                                   | No           | **None**; Security Log only | `investigation.unauthenticated` / `investigation.permission_denied`     |
| Version exhaustion                                                                                        | No           | **None**                    | `investigation.version_exhausted` for a new link at version 2147483647  |
| Transaction rollback (any cause, incl. an audit write failure)                                            | No           | **None** (nothing persists) | error value, or a thrown unexpected error                               |

A repeated create is a new state change each time (no uniqueness is approved), so each leaves its own record.

## 6. Transaction atomicity, activation and recovery

### 6.1 Atomic write

Each write command runs in one `TransactionScope.run` (existing). Inside the unit, in order: build and validate the audit entry (4.6) before the first write; write the domain rows; call `audit.record(entry, tx)` **only if a state change was made**; commit. A failing audit insert throws; the unit rolls back; the caller gets a thrown, unexpected error (consistent with the rule that database errors are not suppressed). No new transaction framework, no second connection, no cross-context call. **Rollback contract:** after any rolled-back unit there is no domain row and no audit row from it; after a committed unit both exist with equal `occurred_at` (4.4).

### 6.2 Activation (mandatory auditing)

1. **Schema step (WP-04):** migration `0003` is applied and verified on the target database: table, columns, checks, foreign key and the three triggers exist (a verification test and a startup readiness query). At this step nothing writes audit rows: the table is inert.
2. **Activation point:** exactly one change, in WP-05, makes the audit writer a **required** dependency of `createInvestigationService`, so a service without audit cannot be constructed. There is no feature flag, no environment toggle and no "audit optional" mode. From the build that contains that change, auditing is mandatory.
3. **Startup readiness check:** the module verifies at start that `investigation.audit_record` has the expected shape (a read-only catalogue query through the same persistence handle). If it does not, the process refuses to start (fail closed) rather than accept unaudited writes.

### 6.3 Fail-closed behaviour after activation

If the audit table or the audit write is unavailable, **mutations fail**; they never proceed without an audit record. Reads are unaffected.

### 6.4 Recovery

| Situation                                                                                        | Recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit-capable build fails or is faulty                                                           | Restore a **working audit-capable build** (a fixed forward build or the last audit-capable one), or **hold writes** (stop write traffic; reads may continue)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Rolling back to a build without mandatory audit                                                  | **Not a recovery path.** It silently disables mandatory auditing. A pre-activation build may not serve writes in any environment that has accepted audited writes; the only exception is a written Owner decision that also holds writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `0003` already applied and found wrong                                                           | **Forward repair only:** a new migration (`0004` or later). `0003` is never edited after it has been applied anywhere shared (migration immutability, ADR-025 Decision 2), and no down-migration is assumed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Audit schema or metadata failure (missing column, failing check, validator rejection)            | The startup check or the validator fails; writes are held until the forward repair or a fixed build is in place; nothing is written without audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Lost commit acknowledgment** (the transaction committed, the caller saw an error or a timeout) | The outcome is **unknown**, not failed (ADR-025 Decision 7: unknown outcomes are not silently treated as failures); the service throws, it does not return a failure value. Reconciliation: `linkAttempt` is safe to replay, because the version advanced, so a replay with the old `expectedVersion` returns `concurrency_conflict` and the caller re-reads the case and sees the link. For the three create commands there is **no** natural idempotency: a blind replay creates another UUT, attempt or case and another audit row, each legitimate under the approved no-uniqueness rules. The caller should reuse the same `correlationId` on a retry and first check the audit table by that `correlation_id` (an operational query; an audit read API is out of scope). Full command idempotency middleware is deferred by Decision 7 and remains so |

## 7. FU-3 — `expectedVersion` validation and version exhaustion (Option B)

### 7.1 Two stages

- **Stage 1 (WP-01): the existing service behaviour plus FU-3.** The service keeps its current `linkAttempt(command)` signature and has no actor, no audit and no transaction change. Only the steps marked in 7.2 are added.
- **Stage 2 (WP-03/WP-05): the future authenticated integration.** The context argument, authentication and authorization (steps A1 and A2) and the audit write (step 11) are added later. Stage 1 must be complete, reviewed and verified before stage 2 begins, so the two contract changes never mix.

### 7.2 Precedence

| Step | Check                                                   | Stage        | Error                                        |
| ---- | ------------------------------------------------------- | ------------ | -------------------------------------------- |
| A1   | Authentication (resolve the handle; request context)    | 2            | `unauthenticated`, `invalid_request_context` |
| A2   | Authorization (permission)                              | 2            | `permission_denied`                          |
| 1    | Role validation                                         | 1 (existing) | `investigation.invalid_link_role`            |
| 2    | Case lookup                                             | 1 (existing) | `investigation.case_not_found`               |
| 3    | Attempt lookup                                          | 1 (existing) | `investigation.attempt_not_found`            |
| 4    | Same-UUT validation                                     | 1 (existing) | `investigation.uut_mismatch`                 |
| 5    | **Runtime `expectedVersion` validation**                | 1 (new)      | `investigation.invalid_expected_version`     |
| 6    | Version comparison                                      | 1 (existing) | `investigation.concurrency_conflict`         |
| 7    | Duplicate detection (identical link, matching version)  | 1 (existing) | none: `ok`, `created: false`                 |
| 8    | **Version exhaustion** (new link needing `version + 1`) | 1 (new)      | `investigation.version_exhausted`            |
| 9    | Save (atomic insert and bump)                           | 1 (existing) | repository errors                            |
| 10   | Audit write, same transaction                           | 2            | thrown on failure; rollback                  |

Steps A1 and A2 run before the transaction exists; steps 1 to 9 run inside it as today. This is the order the Owner stated: Authentication → Authorization → Role → Case → Attempt → Same-UUT → Runtime Version Validation → Version Comparison → Duplicate Detection → Version Exhaustion → Save → Audit.

### 7.3 Runtime validation (step 5)

Valid only if `typeof value === 'number'`, `Number.isSafeInteger(value)`, `value >= 1` and `value <= 2147483647`. No coercion. Rejected: `'3'`, `3n`, `new Number(3)`, `NaN`, `±Infinity`, `2.5`, `0`, `-1`, `2147483648`, `9007199254740993`, `undefined`, `null`, arrays, objects.

### 7.4 Exact error contracts (proposed)

Both codes are new members of `InvestigationServiceError`; `concurrency_conflict` already exists in `RepositoryErrorCode` and is returned by the service at step 6 and by `save`.

```ts
// investigation.invalid_expected_version  — step 5; returned as a value, never thrown
type InvalidExpectedVersionError = SdrisError<
  'investigation.invalid_expected_version',
  {
    readonly reason: 'not_a_number' | 'not_a_safe_integer' | 'out_of_range';
    readonly minimum: 1;
    readonly maximum: 2147483647;
    readonly actualType:
      | 'number'
      | 'string'
      | 'bigint'
      | 'boolean'
      | 'object'
      | 'undefined'
      | 'symbol'
      | 'function'
      | 'null';
    readonly actual?: number; // present only when typeof value === 'number' and the number is finite
  }
>;

// investigation.version_exhausted  — step 8; returned as a value, never thrown
type VersionExhaustedError = SdrisError<
  'investigation.version_exhausted',
  { readonly actualVersion: 2147483647; readonly maximumVersion: 2147483647 }
>;

// existing, unchanged shape
//   investigation.concurrency_conflict  details: { expectedVersion: number; actualVersion: number }
```

Deterministic `reason` rules, evaluated in this order: `typeof !== 'number'` → `not_a_number`; else not a finite safe integer (`NaN`, infinities, fractions, unsafe integers such as `9007199254740993`) → `not_a_safe_integer`; else `< 1` or `> 2147483647` → `out_of_range`. `actualType` is `typeof` with `null` reported as `'null'`. A non-numeric value is **never echoed** (log-injection and size safety); `actual` appears only for finite numbers. `message` is fixed text and not part of the contract.

### 7.5 Public API compatibility inventory (verified by search at `ae7dc51`)

| Surface                                                                   | Where it is used today                                                                                                                                                                                         | Effect of the change                                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InvestigationServiceError` (exported from `@sdris/investigation` public) | Defined in `investigation-service.ts`, re-exported by `public/index.ts`; consumed in `investigation-service.spec.ts` and the two api integration tests                                                         | Stage 1 **widens the union** with two members (additive, compile-visible for exhaustive consumers)                                                                                        |
| Direct service callers                                                    | `investigation-service.spec.ts`, `apps/api/src/composition/investigation.integration.test.ts`, `investigation-links.integration.test.ts`, `tests/runtime/compiled-runtime.child.cjs`                           | Stage 1: no signature change; callers passing a non-conforming `expectedVersion` now get an error value (none in the repository do). Stage 2: **breaking** (new `context` first argument) |
| Factory callers                                                           | `apps/api/src/composition/investigation.composition.ts` (`composeInvestigation`), `modules/investigation/src/composition/index.ts`, and the architecture fixtures/type-surface test that reference the factory | Stage 1: none. Stage 2: `createInvestigationModule` gains required wiring (`actorResolver`, audit) and a changed options type                                                             |
| Exhaustive error handlers                                                 | **None found** in `modules` or `apps` (search for `switch` on `code` or `error` found none)                                                                                                                    | Nothing breaks inside the repository; external consumers would, which is why the Owner approves the contract                                                                              |
| Compiled-runtime consumers                                                | `tests/runtime/compiled-runtime.child.cjs` and `compiled-runtime.test.mjs`, running compiled `dist` under plain Node; the type-surface test (`tests/architecture/type-surface.test.mjs`)                       | Stage 1: runtime test unaffected unless extended; the type-surface check must still pass with the widened union. Stage 2: the child script and its fixtures must supply an actor          |

Compatibility statement: stage 1 is **additive and non-breaking at runtime** for every in-repository caller; stage 2 is a deliberate breaking change of the service and factory contracts and needs the Owner's approval as such (CLAUDE.md section 12).

### 7.6 Version exhaustion and storage

The `integer` column and `check (version >= 1)` are unchanged (C9). Step 8 runs only when `current.version === expectedVersion` (step 6), and it fails when that version is 2147483647, so `save` never evaluates `version + 1` past the maximum and PostgreSQL error 22003 is unreachable through the service. At the maximum: a matching duplicate stays `ok` with `created: false` and writes no audit record; a stale value yields `concurrency_conflict`; only a new link fails.

## 8. Acceptance criteria (proposed, testable)

All persistence criteria run against real PostgreSQL (ADR-025 Decision 10). Evidence for **D9** is defined before implementation (decision register D9) and **collected in WP-06**; a work package may add its own evidence earlier.

| ID    | Area                      | Criterion                                                                                                                                                                                                                                                                                                                                       |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | Trusted Actor             | No handle, a plain object, a foreign-issuer handle, an expired or revoked handle: `unauthenticated`, no transaction opened, no row; claims cannot be altered through anything the caller holds; the synthetic issuer refuses every non-`local`/`test` configuration including missing and malformed values, and the compiled API exits non-zero |
| AC-2  | Authorization             | A valid actor without the permission gets `permission_denied` from a **direct** service call, before a transaction opens; with it the command succeeds; a Security Log event is written without credential, handle or payload values                                                                                                            |
| AC-3  | Audit coverage            | Each of the four commands writes exactly one `audit_record` with the action, subject, `case_id`, actor, kind, correlation and `details` of 4.3 and 4.4, and the persisted-timestamp equality of the last column of 4.4                                                                                                                          |
| AC-4  | Transaction atomicity     | A failing audit write rolls back the domain write; a missing or invalid transaction token makes the audit adapter throw and write nothing; a failing domain write leaves no audit row; audit row counts equal committed state changes                                                                                                           |
| AC-5  | Idempotency               | A matching duplicate link returns `created: false`, changes nothing and writes no audit row, including at version 2147483647                                                                                                                                                                                                                    |
| AC-6  | Concurrency               | Concurrent links with the same `expectedVersion`: one `ok` and one `concurrency_conflict`; one link and one audit row (existing row-lock technique)                                                                                                                                                                                             |
| AC-7  | Invalid `expectedVersion` | Every value of 7.3 returns `invalid_expected_version` with the deterministic `reason`/`actualType` of 7.4, after `case_not_found`, `attempt_not_found`, `uut_mismatch` and before `concurrency_conflict`; nothing is written                                                                                                                    |
| AC-8  | Version exhaustion        | At version 2147483647 (test-only SQL): new link → `version_exhausted`; duplicate → `created: false`; stale → `concurrency_conflict`; column definition unchanged                                                                                                                                                                                |
| AC-9  | Architecture compliance   | `pnpm check:architecture` passes with **no** change to `contextInfrastructure` or `compositionRoots` and no loosened rule; new restriction rules have fixtures; audit code only under `modules/investigation`; no shared audit package; no new dependency                                                                                       |
| AC-10 | PostgreSQL integration    | Migration `0003` (file `infrastructure/database/migrations/0003_create_investigation_audit_record.sql`) applies on a clean database and on one at `0002`; `0001` and `0002` checksums unchanged; update, delete and truncate of audit rows are rejected; the check constraints reject out-of-allowlist `details`; `pnpm db:test` passes         |
| AC-11 | S0-05 regression          | All S0-05 unit, integration, concurrency and compiled-runtime tests pass; changes to existing tests are limited to the `context` argument (stage 2) and the FU-3 cases (stage 1)                                                                                                                                                                |
| AC-12 | Recovery and activation   | The startup readiness check refuses to start against a database without the expected audit shape; the service cannot be constructed without an audit writer after activation                                                                                                                                                                    |

Note on placement: AC-10 and AC-4 name files by the repository's actual layout (migrations under `infrastructure/database/migrations`, adapters under `modules/investigation/src/infrastructure/persistence`, ports under `application/ports`), correcting v0.2 text that implied other locations.

## 9. Constraints that remain in force

ADR-025 and A1 to A4 (no new persistence user outside the allowlist, no cross-module internal imports, `src/public` as the only cross-module surface), no `drizzle-kit`, no new dependency, synthetic data only, injected clock, UUIDv7 identifiers, no automatic progression to S0-07. **ADR-025 Decision 5:** its historical text stays CONDITIONAL in ADR-025 for good; the condition is satisfied by the A2 section of the [effective-policy file](../adr/ADR-025-effective-policy.md) now that A2 is accepted. Decision 7 stays as written; the [proposed Amendment A5](../adr/ADR-025-postgresql-persistence-architecture.md) narrows it for Investigation only and is **PROPOSED**.

## 10. Open questions for the Owner

Consolidated in the [decision register](S0-06-owner-decision-register.md) section 6 and the remediation matrix.
