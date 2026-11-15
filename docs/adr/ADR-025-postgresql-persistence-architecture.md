# ADR-025: PostgreSQL Persistence Architecture & Migration Governance

- **Status:** PROPOSED — Pending Engineering Owner Approval
- **Date:** 2026-11-15
- **Decision Owner:** SDRIS Engineering Owner
- **Scope:** Sprint 0 — S0-04 PostgreSQL & Migration Baseline
- **Related:** ADR-024, AGENTS.md, CLAUDE.md
- **Implementation Reference:** PR #5 — S0-04 PostgreSQL & Migration Baseline
- **Proposed amendments:** A1 — S0-05 persistence dependency policy (see below). **PROPOSED, pending Engineering Owner approval.**

## 1. Context

SDRIS is an evidence-grounded, human-governed server diagnostic and repair intelligence system built as a TypeScript Modular Monolith.

Its bounded contexts require durable persistence while preserving:

- Domain ownership
- Evidence immutability
- Transactional consistency
- Auditability
- Optimistic concurrency
- Idempotent command processing
- Clear infrastructure dependency boundaries

S0-04 introduced a PostgreSQL persistence foundation and evaluated Drizzle ORM against Kysely.

The implementation also introduced a migration runner, database schemas, transaction primitives, and integration tests.

Several architectural decisions remained unresolved and must be formally governed before expanding domain persistence in S0-05 and later tasks.

This ADR defines the persistence baseline and its architectural constraints.

## 2. Decision Drivers

The persistence architecture must:

1. Support the existing TypeScript monorepo.
2. Preserve bounded-context ownership.
3. Keep ORM types outside domain models and application contracts.
4. Support PostgreSQL transactions and concurrency controls.
5. Support atomic domain, audit, and outbox persistence.
6. Provide deterministic and verifiable schema migrations.
7. Prevent unsafe development database resets.
8. Support reliable integration testing.
9. Minimize unnecessary abstractions.
10. Remain compatible with future SDRIS workflow and evidence requirements.

## 3. Decision 1 — PostgreSQL and Persistence Technology

**Decision: ACCEPT Drizzle ORM with SQL-first migrations as the S0-04 persistence baseline, subject to Engineering Owner approval of this ADR.**

PostgreSQL is the authoritative relational database for SDRIS MVP.

Drizzle ORM is selected for typed infrastructure-level database access.

Hand-written, version-controlled SQL files remain the authoritative migration definitions.

### Rationale

The S0-04 implementation evaluated Drizzle and Kysely against PostgreSQL.

Both supported the required transaction, optimistic concurrency, and idempotency scenarios.

The reported implementation spike found a compatibility issue when importing the evaluated Kysely version into the existing CommonJS NestJS API configuration.

Drizzle compiled successfully within the current configuration.

The SQL-first migration approach also provides explicit review of schema changes and avoids making the ORM schema generator authoritative.

### Constraints

- Drizzle is an infrastructure implementation detail.
- Domain entities must not extend or depend on Drizzle types.
- Domain contracts must remain framework-independent.
- Drizzle schema definitions do not replace domain invariants.
- ORM models must not become authoritative domain models.
- Introducing another persistence framework requires architectural review.

This decision does not prohibit revisiting the technology if the repository's module system or requirements change.

## 4. Decision 2 — SQL Migration Governance

**Decision: ACCEPT version-controlled SQL-first migrations.**

Migration files use a deterministic numbering convention:

`NNNN_description.sql`

The migration system must:

- Apply migrations in deterministic order.
- Track applied versions.
- Record a checksum for each migration.
- Reject modifications to already-applied migrations.
- Detect missing or out-of-order migration files.
- Apply each migration and its tracking record atomically.
- Serialize concurrent migration runners.
- Return nonzero exit codes for migration failures.
- Provide observable migration status.

### Migration immutability

Once a migration is applied to a shared environment, it must not be silently edited.

Corrections should normally be introduced through a new forward migration.

### Limitations

The baseline uses transactional, forward-only migrations.

Operations requiring execution outside a transaction, such as PostgreSQL `CREATE INDEX CONCURRENTLY`, require a separately approved migration procedure.

Automatic rollback of arbitrary production migrations is not guaranteed.

## 5. Decision 3 — Database Schema Ownership

**Decision: ACCEPT the initial ten-schema baseline.**

| PostgreSQL Schema | Owner                        |
| ----------------- | ---------------------------- |
| `investigation`   | Investigation Context        |
| `evidence`        | Evidence Context             |
| `diagnostics`     | Diagnostics Context          |
| `workflow`        | Workflow Context             |
| `verification`    | Verification Context         |
| `knowledge`       | Knowledge Context            |
| `platform`        | Platform Context             |
| `governance`      | Governance Context           |
| `integration`     | Integration Context          |
| `system`          | Cross-cutting infrastructure |

Each bounded context owns its authoritative data model.

### Ownership rules

- A context must not directly modify another context's authoritative tables.
- Cross-context business operations must use approved application contracts.
- Cross-schema SQL joins must not bypass domain authorization or ownership rules.
- Database foreign keys must not be used as an excuse to create tightly coupled domain ownership.
- Read projections may combine information from multiple contexts but do not become authoritative sources.

### Deferred decisions

The following are not resolved by this ADR:

- A dedicated Retrieval schema.
- Final ownership of Audit, Outbox, Inbox, and Job tables.
- Context-specific database roles.
- Row-level security policies.
- Production database tenancy strategy.

The `system` schema is an approved infrastructure namespace, not automatic authorization to place every cross-cutting table there.

Any future table requires explicit ownership and lifecycle definition.

## 6. Decision 4 — Infrastructure Dependency Policy

**Decision: ACCEPT a controlled infrastructure dependency policy.**

SDRIS follows dependency inversion.

Domain logic defines behavior and required contracts. Infrastructure implements persistence.

Conceptual structure:

```text
Application Service
        |
        v
Repository Port
        ^
        |
Repository Adapter
        |
        v
@sdris/database
        |
        v
PostgreSQL
```

### Allowed dependencies

Infrastructure adapters may depend on:

- Their owning context's published contracts.
- Approved domain or application ports within the same context.
- Shared Kernel primitives.
- Approved infrastructure packages such as `@sdris/database`.

### Forbidden dependencies

- Domain logic importing Drizzle or PostgreSQL drivers.
- Shared Kernel importing infrastructure packages.
- One bounded context directly importing another context's private repository.
- Application code bypassing repository ports to modify authoritative domain data.
- Generic shared infrastructure packages importing private domain implementations.

### Architecture enforcement

S0-03 architecture checks must enforce the dependency policy.

Any new dependency direction must be reviewed before modifying the architecture checker.

A passing TypeScript build does not authorize an otherwise forbidden dependency.

## 7. Decision 5 — UnitOfWork and TransactionContext

**Decision: CONDITIONAL — Retain the current infrastructure-owned transaction abstraction until its application-facing contract is validated in S0-05.**

The current `UnitOfWork` and `TransactionContext` interfaces are exported by `@sdris/database` for infrastructure-level integration.

This export does not authorize domain or application modules to depend directly on database infrastructure.

Architecture boundary rules remain authoritative.

The final ownership and public exposure of these interfaces are deferred until S0-05 validates them against a real Investigation repository adapter.

### Requirements

- No Drizzle or PostgreSQL driver types may leak into domain contracts.
- Domain models must remain persistence-independent.
- Transaction context must be opaque to domain logic.
- Repository adapters may use database transaction infrastructure only through explicitly approved dependency boundaries.
- Any expansion of module access to `@sdris/database` requires positive and negative architecture tests.

S0-05 must determine whether the transaction port should remain infrastructure-owned or move to an application-facing persistence contract.

Do not move it into Shared Kernel without a separate architectural justification.

## 8. Decision 6 — Module-Owned Repository Adapters

**Decision: ACCEPT controlled database access through context-owned infrastructure adapters.**

Each bounded context owns its repository interfaces and authoritative persistence behavior.

Repository adapters may use `@sdris/database` within the infrastructure layer.

### Required separation

Example conceptual structure:

```text
modules/investigation/
  src/
    domain/
    application/
      ports/
    infrastructure/
      persistence/
    public/
```

The exact repository layout may follow existing project conventions.

### Dependency policy

- Investigation domain code depends on no ORM.
- Investigation application services depend on repository ports.
- Investigation infrastructure adapters implement those ports.
- Infrastructure adapters may depend on `@sdris/database`.
- Other bounded contexts may not import Investigation's private adapters.

### Important implementation condition

The S0-04 architecture checker currently prohibits module imports of `@sdris/database`.

Before S0-05 introduces a context-owned adapter, the checker must be refined to permit only approved infrastructure-layer imports.

Do not broadly allow `@sdris/database` throughout `modules/*`.

The change must include positive and negative architecture tests.

See Proposed Amendment A1, which defines this refinement (pending Owner approval).

## 9. Decision 7 — Audit, Outbox, and Transactional Consistency

**Decision: ACCEPT atomic persistence as an architectural requirement; defer concrete table ownership and workflow implementation.**

Future commands may require atomic persistence of:

```text
Domain State
    +
Audit Record
    +
Outbox Event
```

These writes must share an appropriate database transaction when they represent one authoritative operation.

### Requirements

- No partial authoritative commit.
- Audit records must correspond to committed state changes.
- Outbox records must represent committed facts.
- Idempotency must be enforced at an appropriate database boundary.
- Retry behavior must not assume exactly-once delivery.
- Unknown external outcomes must not be silently treated as failures.

### Deferred implementation

This ADR does not define:

- Final Audit table schemas.
- Outbox and Inbox message schemas.
- Worker retry policies.
- Event publishing infrastructure.
- Full command idempotency middleware.

Those belong to subsequent approved tasks.

## 10. Decision 8 — Optimistic Concurrency and Idempotency

**Decision: ACCEPT database-enforced concurrency and uniqueness controls.**

Authoritative aggregate updates must protect against lost updates where concurrent modifications are possible.

A version-based update is an approved pattern.

Example:

```sql
UPDATE example_record
SET version = version + 1
WHERE id = $1
  AND version = $2
RETURNING version;
```

A missing returned row must be interpreted according to the repository contract, distinguishing a stale version from a missing entity where required.

### Idempotency

Idempotency uniqueness must be enforced by PostgreSQL constraints within an explicitly defined scope.

Repeated requests with the same key and equivalent payload may reuse a prior result according to future command contracts.

The same key with a conflicting payload must not silently be treated as an equivalent request.

The idempotency key scope, retention, and response-replay behavior remain future application-contract decisions.

## 11. Decision 9 — drizzle-kit

**Decision: DEFER.**

`drizzle-kit` is not required for the current SQL-first migration baseline.

It may be evaluated later for schema development assistance or drift detection.

It must not silently become the authoritative migration mechanism.

Any adoption must preserve migration reviewability and checksum integrity.

## 12. Decision 10 — Database Testing and CI

**Decision: ACCEPT real PostgreSQL integration tests as mandatory evidence for persistence changes.**

The database test suite must validate actual PostgreSQL behavior.

Mocks alone are insufficient for:

- Transaction rollback.
- Concurrent updates.
- Database uniqueness constraints.
- Advisory locks.
- Migration correctness.
- Reset safety.

### Sprint 0 implementation

The database integration suite remains separately executable through:

`pnpm db:test`

It is not silently skipped when PostgreSQL is unavailable.

The general `pnpm test` command does not need to start Docker automatically.

### CI integration

S0-10 must add a database-backed CI job that:

1. Starts an isolated PostgreSQL service.
2. Applies migrations.
3. Runs database integration tests.
4. Fails the PR check if persistence invariants fail.

Until that CI gate exists, a successful local database test report is supporting evidence but not an independently verified GitHub CI result.

## 13. Decision 11 — Database Reset Safety

**Decision: ACCEPT strict local/test reset protection.**

Database reset operations must be limited to explicitly approved development or test targets.

Safety requirements:

- Reject production environments.
- Reject remote database hosts.
- Reject database names outside the approved local/test naming convention.
- Fail before destructive operations when validation fails.
- Avoid modifying unrelated databases.
- Require explicit reset invocation.

These checks must be enforced by executable code and negative tests, not documentation alone.

## 14. Security and Dependency Governance

S0-04 reports 22 existing production dependency audit findings in the API and Web applications.

These findings are outside the persistence implementation scope but require separate security triage.

Before production deployment:

- Identify severity and affected package versions.
- Determine whether vulnerabilities are reachable.
- Review patched versions and compatibility.
- Record remediation or risk acceptance.
- Re-run dependency auditing.

This ADR does not accept the vulnerabilities as safe or waive security review.

No real company logs, production credentials, or proprietary manufacturing data may be committed to the public SDRIS repository.

## 15. Consequences

### Positive

- Explicit database ownership boundaries.
- Type-safe infrastructure persistence.
- Deterministic migration lifecycle.
- Testable transactional behavior.
- Reduced ORM coupling.
- Foundation for Audit and Outbox reliability.
- Clear path for S0-05 repository adapters.

### Trade-offs

- SQL migrations require manual maintenance.
- Custom migration infrastructure must be tested and maintained.
- Transaction abstractions may require revision during real domain implementation.
- Context-specific repository adapters introduce deliberate duplication.
- Database-backed integration tests require PostgreSQL infrastructure.

### Risks

- Shared database access may accidentally bypass bounded-context ownership.
- Premature transaction abstractions may become overly generic.
- Schema ownership may be confused with permission to query or mutate other contexts.
- Migration tooling may diverge from ORM definitions.
- Missing CI integration temporarily reduces independent verification.

These risks are addressed through architecture tests, contract tests, ADR governance, and later CI implementation.

## 16. Rejected or Deferred Alternatives

### Kysely as the current baseline

Not selected for S0-04 due to the reported integration friction with the current TypeScript/CommonJS API configuration.

This is a project-specific decision, not a claim that Kysely is generally unsuitable.

### ORM-generated migrations as the sole authority

Not selected because the current baseline prioritizes explicit, reviewable SQL migrations.

### Shared Kernel as the home for all persistence contracts

Rejected as a default approach because it risks expanding Shared Kernel beyond minimal technical primitives.

### Direct database access from application/domain logic

Rejected because it weakens dependency inversion and bounded-context ownership.

### Full Audit/Outbox implementation during S0-04

Deferred to avoid expanding the persistence foundation task into workflow implementation.

## 17. Follow-up Actions

| Task                   | Required action                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S0-04                  | Obtain ADR approval and reconcile the PR documentation                                                                                                 |
| S0-05                  | Validate repository adapter ownership and UnitOfWork contract                                                                                          |
| S0-05                  | Refine architecture rules for context-owned persistence adapters (proposed in Amendment A1; implemented in the checker on a branch, awaiting approval) |
| Future governance task | Decide Audit/Outbox/Inbox/Jobs ownership                                                                                                               |
| Future retrieval task  | Decide Retrieval persistence and schema                                                                                                                |
| S0-10                  | Add PostgreSQL integration tests to GitHub CI                                                                                                          |
| Security review        | Triage existing dependency vulnerabilities                                                                                                             |

## Proposed Amendment A1 — Persistence Dependency Policy for S0-05

- **Status:** PROPOSED — Pending Engineering Owner Approval. This amendment does not change the status of ADR-025
  and is not in force until the Engineering Owner approves it in writing.
- **Resolves:** the open points about Decisions 4 and 6 (where a repository adapter lives, whether it may import
  `drizzle-orm` directly, and how "approved infrastructure-layer imports" is decided).
- **Implementation reference:** branch `feat/s0-05-persistence-dependency-policy` (checker, fixtures and tests only; no
  repository adapter is implemented).

### A1.1 Terminology

- **Global Infrastructure:** workspace packages under `infrastructure/*`, for example `@sdris/database`. They contain
  technology plumbing shared by all contexts and no business logic.
- **Context Infrastructure:** source files under `modules/<context>/src/infrastructure/**`. They implement that
  context's own ports (for example the Investigation repository adapter) and are owned by that context.

### A1.2 Rules

1. **Persistence libraries are usable only from Context Infrastructure.** `drizzle-orm` (including subpaths such as
   `drizzle-orm/pg-core`) and `@sdris/database` may be imported only from `modules/<context>/src/infrastructure/**`,
   and only when explicitly allowlisted for that context (A1.3).
2. **Domain, Application and Public code stay independent of database infrastructure.** Files under `src/domain`,
   `src/application`, `src/public` (and any other path in a module) may not import ORMs, query builders, database
   drivers or `@sdris/database`, even if their context is allowlisted. Type-only imports and re-exports are included.
3. **Dependencies point inward.** `src/domain`, `src/application` and `src/public` may not import the same module's
   `src/infrastructure/**`, directly, through a relative path, an alias, a barrel file or a re-export. A repository
   adapter implements a port defined in `src/application`; the port never imports the adapter.
4. **Global Infrastructure does not import business modules by default.** `infrastructure/*` may depend only on the
   Shared Kernel, contracts and config. It may not import a business module's public entrypoint or internals. There is
   no exception mechanism in this amendment: any exception requires a further amendment.
5. **Access is restricted by source path and by one centralised allowlist.** A context's Context Infrastructure may use
   a package only if both its path is `src/infrastructure/**` and the package is listed for that context in the
   allowlist. No manifest-based mechanism is introduced at this stage.
6. **Cross-context restrictions are unchanged.** A context may not import another context's private files or
   repository adapters; module-to-module dependencies still require an approved edge through the other module's public
   entrypoint. Context Infrastructure gets no additional cross-context rights.
7. **`@sdris/database` is used only through its published entrypoint.** Subpath, relative-path and alias imports that
   reach its internals remain forbidden for every importer.

### A1.3 The centralised allowlist

One file, `scripts/architecture/dependency-matrix.json`, already the home of the module-to-module matrix. A new top-level
key lists, per module, what its Context Infrastructure may use. Everything not listed is denied:

```json
{
  "moduleDependencies": {},
  "contextInfrastructure": {
    "@sdris/investigation": {
      "workspacePackages": ["@sdris/database"],
      "externalPackages": ["drizzle-orm"]
    }
  }
}
```

- `workspacePackages` must name Global Infrastructure packages only. A business module cannot be listed.
- `externalPackages` must name recognised persistence libraries.
- A malformed entry makes the checker exit with code 2 (cannot analyse); it never silently grants or denies access.
- A module's `package.json` may declare an allowlisted package as a dependency (pnpm requires it) and may not declare any
  other persistence package.
- The default committed allowlist is empty. The Investigation entry above is an example of what the S0-05 adapter pull
  request would add, reviewed together with the adapter. It is not added by this amendment.

### A1.4 Enforcement

| Rule ID                               | Enforces                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `dependency/forbidden-external`       | Rules 1 and 2 for ORMs and drivers, including subpaths and type-only imports                          |
| `dependency/direction`                | Rules 1 and 2 for `@sdris/database`; Rule 4 (Global Infrastructure to business modules); Rule 6 edges |
| `dependency/manifest`                 | Manifests declaring a non-allowlisted persistence package or Global Infrastructure package (Rule 5)   |
| `boundary/infrastructure-inversion`   | Rule 3, including relative, alias, barrel, re-export and directory-case spellings                     |
| `boundary/private-import`             | Rules 6 and 7 for subpath and alias imports; unchanged                                                |
| `boundary/package-specifier-required` | Rule 7 for relative-path imports into another package; unchanged                                      |

Positive and negative fixtures cover alias, relative-path, subpath, type-only, barrel and re-export bypass attempts.
Mutation checks show that removing the path restriction, the allowlist lookup, the inversion rule, the case handling or
the manifest check each turns fixtures red.

### A1.5 Consequences and trade-offs

- Directory names under `src/` become architecture: files outside `src/public`, `src/domain`, `src/application` and
  `src/infrastructure` have no persistence rights. A directory spelled `Infrastructure` is not treated as
  Context Infrastructure, while import targets are matched case-insensitively so a spelling cannot hide a violation.
- A new context that needs persistence needs a reviewed allowlist entry, which is deliberate friction.
- Intra-module layering beyond Rule 3 (for example domain importing application) is not addressed by this amendment.

### A1.6 Not decided here

- Where `UnitOfWork` / `TransactionContext` finally live: still governed by Decision 5; S0-05 validates it with a real
  repository.
- Whether Global Infrastructure may ever import a business module's public contract (Rule 4 has no exception).
- Audit, Outbox, Inbox and Job table ownership; the Retrieval schema; role-per-context and row-level security.

## 18. Acceptance and Change Control

This ADR becomes **ACCEPTED** only after explicit approval by the SDRIS Engineering Owner.

Before acceptance:

- The implementation may remain in a reviewable PR.
- Proposed decisions must not be represented as approved.
- Conflicting architectural changes require escalation.

After acceptance:

- Persistence changes must comply with this ADR.
- Deviations require a new ADR or an approved superseding revision.
- Changes to dependency boundaries must include executable architecture tests.
- Database changes must include migration and integration test evidence.

**Core principle: Domain ownership remains authoritative; persistence technology remains an implementation detail.**
