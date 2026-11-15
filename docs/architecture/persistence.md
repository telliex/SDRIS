# Persistence architecture (S0-04)

Status: **PROPOSED**. Nothing here is an approved decision. This document is the implementation-side companion of
[ADR-025](../adr/ADR-025-postgresql-persistence-architecture.md), which is itself **PROPOSED, pending Engineering Owner
approval**. If the two ever differ, ADR-025 governs and this document must be corrected.

## 1. Decision: Drizzle ORM (query layer) + hand-written SQL migrations

**Recommendation:** use `drizzle-orm` with the `pg` driver as the single query layer. Write migrations as plain,
numbered SQL files applied by SDRIS's own small runner. Do **not** adopt `drizzle-kit` for now.

### Spike evidence

Both libraries were exercised against real PostgreSQL 16.14 with identical scenarios (scratch project, not committed).

| Criterion                                                      | Drizzle 0.45.4                          | Kysely 0.29.9                                                             |
| -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Schema-qualified tables (`pgSchema` / `'schema.table'`)        | Yes                                     | Yes                                                                       |
| Transaction commit and rollback                                | Pass                                    | Pass                                                                      |
| Optimistic update (`UPDATE ... WHERE version = $n RETURNING`)  | Pass, 8 racers -> exactly 1 winner      | Pass, 8 racers -> exactly 1 winner                                        |
| Idempotent insert (`ON CONFLICT DO NOTHING`) under concurrency | Pass, 8 racers -> exactly 1 winner      | Pass, 8 racers -> exactly 1 winner                                        |
| Type safety                                                    | Typed from table definitions            | Typed from a hand-written `DB` interface                                  |
| Import from the CommonJS API under TypeScript 5.7              | **Compiles**                            | **`TS1479`**: v0.29 is ESM-only; needs ESM conversion or a pinned old API |
| Detects an edited, already-applied migration                   | **No** (silently ignored, nothing runs) | **No** (re-run reports no results; no checksum stored)                    |

Reasoning:

- Capability is a tie on the criteria the task cares about, so the deciding factors are fit and risk.
- `apps/api` is CommonJS (NestJS, `module: CommonJS`) on the baseline TypeScript 5.7. Kysely 0.29 is ESM-only,
  which would force an ESM migration of the API or a pinned older Kysely: out of scope and a risk.
- Neither migrator protects migration history. Because of that, SDRIS needs its own checksum-verifying runner
  regardless of library, which removes the main reason to adopt `drizzle-kit` migrations.
- One abstraction only: Drizzle for queries, plain SQL for schema. No second query builder is introduced.

Open point for the Owner: if schema-as-code diffing (`drizzle-kit generate`) is wanted later, that is a separate
decision; the SQL-first migrations here do not preclude it.

### Dependency versions

`drizzle-orm@^0.45.4`, `pg@^8.23.1` (runtime); `@types/pg` (dev). Versions are pinned by `pnpm-lock.yaml`.
Drizzle is pre-1.0, so minor upgrades may carry breaking changes; upgrade deliberately.

## 2. Where persistence code lives

```text
Domain / Application port        (module src/domain, src/application — no ORM types)
            ^
Infrastructure adapter           (infrastructure/database: @sdris/database)
            |
Drizzle + pg  ->  PostgreSQL
```

`infrastructure/database` is the workspace package `@sdris/database`. It holds the connection, the migration/seed
runner, the transaction abstraction, persistence error classification and the guards for destructive operations.

Enforced by `pnpm check:architecture` (S0-03 rules, extended in this task; see
[module-boundaries.md](module-boundaries.md)):

- `infrastructure` is a new layer. It may import only `kernel`, `contracts` and `config`.
- `app` may import `infrastructure` (the composition root wires adapters).
- Modules, contracts, config, testing and the shared kernel cannot import ORMs, query builders or database
  drivers (`drizzle-orm`, `drizzle-kit`, `kysely`, `pg`, `postgres`, `knex`, `typeorm`, `prisma`, ...), nor declare
  them in their manifests.
- Modules cannot import `@sdris/database` (default-deny layer rule).

### Transactions without leaking ORM types

`UnitOfWork.run(work)` hands `work` an opaque `TransactionContext` (a branded object with no ORM members).
Application code passes it back to repository ports. Only an adapter can call `executorFor(db, tx)` to obtain the
Drizzle transaction. A context becomes invalid when the unit of work ends, so a leaked context cannot be reused.

## 3. Schema ownership

One PostgreSQL schema per bounded context (AGENTS.md section 4), created by `0001_create_bounded_context_schemas.sql`.
Each schema carries a `COMMENT` naming its owner.

| Schema          | Owner               | Holds (later tasks)                                                      |
| --------------- | ------------------- | ------------------------------------------------------------------------ |
| `investigation` | Investigation       | cases, failure observations, hypotheses                                  |
| `evidence`      | Evidence            | raw artifacts, parser runs, normalized records, evidence anchors         |
| `diagnostics`   | Diagnostics         | AI analysis runs, recommendations, diagnostic execution                  |
| `workflow`      | Workflow            | work items, dependencies                                                 |
| `verification`  | Verification        | repair interventions, retests, effectiveness assessments                 |
| `knowledge`     | Knowledge           | knowledge cases, claims, patterns                                        |
| `platform`      | Platform            | platform profiles, component identity, configuration drift               |
| `governance`    | Governance          | policies, readiness, review and release governance                       |
| `integration`   | Integration         | external adapters, integration state                                     |
| `system`        | Cross-cutting infra | `schema_migrations`, `schema_seeds` now; audit, outbox/inbox, jobs later |

No business table is created in S0-04. A table has exactly one owning schema, and only the owning context writes it.

**Gaps reported, not invented:**

- AGENTS.md describes Retrieval as a read-side capability with its own persistence. No committed document assigns it
  a schema, so none is created. Owner decision needed.
- Whether audit/outbox/inbox/jobs share `system` or get separate schemas is undecided; `system` is the placeholder
  the task allows for "approved cross-cutting infrastructure tables".

## 4. Migration lifecycle

Files live in `infrastructure/database/migrations/` as `NNNN_snake_case.sql`.

- Applied in ascending order; each file runs in its own transaction together with its tracking row.
- Tracking: `system.schema_migrations (version, name, checksum, applied_at)`. Seeds use `system.schema_seeds`.
- **Applied files are immutable.** Editing one fails with `CHECKSUM_MISMATCH` (line endings are normalised).
  A missing applied file fails with `MISSING_FILE`. A new file numbered below an applied one fails with
  `OUT_OF_ORDER`. Fix by restoring the file and adding a new numbered migration.
- A session advisory lock serialises concurrent runners, so racing or repeated runs are safe.
- A failing script is rolled back, nothing is recorded, and the CLI exits non-zero naming the file and the database error.
- Scripts therefore cannot contain statements that refuse to run in a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`).
  A task needing one must raise it for review.
- No migration is ever run automatically against a shared database; there is no production migration path in Sprint 0.

### Adding a migration

1. Create `infrastructure/database/migrations/NNNN_description.sql` with the next unused number.
2. Make it idempotent where cheap (`IF NOT EXISTS`); it still only runs once.
3. `pnpm db:migrate`, then `pnpm db:status` to confirm it is `applied`.
4. Commit the file. Never edit it after it has been merged.

### Reset safety

`pnpm db:reset` and `pnpm db:seed` are refused, before any connection is attempted, unless **all** hold:

- `NODE_ENV` is not `production`;
- the host is `localhost`, `127.0.0.1` or `::1` (no empty host, no `host=`/`hostaddr=`/`service=` URL overrides);
- the database name matches `^sdris_(local|test)(_[a-z0-9]+)*$`.

Reset drops only the ten SDRIS schemas, so anything else in the database (for example a foreign schema) survives.
Integration tests create and drop their own `sdris_test_<hex>` database and never touch `sdris_local`.

## 5. Capability spike results

Verified against real PostgreSQL by `pnpm db:test` using test-only tables (a throw-away schema, not in any migration):

| Capability                     | Evidence                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Atomic multi-write commit      | two inserts in one unit of work both persist                                                                                   |
| Rollback on failure            | application error and database error both leave zero rows                                                                      |
| Atomic domain + audit + outbox | all three rows commit together; an injected failure after the audit write leaves none                                          |
| Optimistic concurrency         | matching version succeeds; stale and missing-row updates return a `version-conflict` result; 12 racers -> exactly 1 win        |
| No lost update                 | 8 writers x 5 retrying increments end at exactly 40, version 41                                                                |
| Idempotency uniqueness         | PK `(scope, key)` enforced by the database; 12 identical racers -> 1 `created`, 11 `replayed`; differing payload -> `conflict` |

These prove technical capability only. The Audit and Transactional Outbox workflows are not implemented.

## 6. Open items and where ADR-025 treats them (all remain PROPOSED)

| Item                                                                                                   | ADR-025                  | State in this PR                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle ORM + SQL-first migrations                                                                     | Decision 1, 2            | Implemented as proposed                                                                                                                                                             |
| Ten-schema ownership baseline                                                                          | Decision 3               | Implemented; Retrieval schema and audit/outbox/inbox/jobs ownership deferred                                                                                                        |
| `infrastructure` layer policy and persistence-library ban                                              | Decision 4               | Implemented in the S0-03 checker with fixtures                                                                                                                                      |
| `UnitOfWork` / `TransactionContext` home                                                               | Decision 5 (conditional) | Kept inside `@sdris/database`; S0-05 must re-evaluate with a real repository                                                                                                        |
| Module-owned repository adapters depending on `@sdris/database` and their own module's public contract | Decision 6               | **Not implemented**: the checker still denies `module -> @sdris/database` and `infrastructure -> module`. ADR-025 requires a narrow, tested refinement before S0-05 adds an adapter |
| Atomic domain + audit + outbox, idempotency, optimistic concurrency                                    | Decision 7, 8            | Capability verified with test-only tables; workflows not implemented                                                                                                                |
| `drizzle-kit`                                                                                          | Decision 9 (deferred)    | Not adopted                                                                                                                                                                         |
| Database integration tests and CI                                                                      | Decision 10              | `pnpm db:test` works locally; CI job belongs to S0-10, so local results are not an independently verified CI result                                                                 |
| Reset safety                                                                                           | Decision 11              | Enforced in code with negative tests                                                                                                                                                |

Until the Engineering Owner approves ADR-025, none of the above is an approved decision.

## 7. Limitations

- Integration tests need Docker/PostgreSQL; without it `pnpm db:test` fails loudly (it is never silently skipped).
- Credentials in `docker-compose.yml` and `.env.example` are synthetic local values. The database is bound to loopback only.
- No row-level security, roles per context, or production hardening (out of Sprint 0 scope).
- The migration runner is intentionally small: forward-only, no down migrations, no per-file transaction opt-out.
