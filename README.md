# SDRIS — Server Diagnostic & Repair Intelligence System

**Status:** Sprint 0 / S0-01 repository scaffold. **Not a diagnostic or production system.**

## Architecture

- `apps/web`: Next.js application shell
- `apps/api`: NestJS composition root and liveness route
- `apps/worker`: background worker entrypoint (no job processing yet)
- `modules/*`: nine bounded contexts; `src/public` is the cross-module import boundary
- `packages/*`: future shared kernel, public contracts, testing and tooling
- `infrastructure/*`: adapters and migrations (not implemented in S0-01)
- `fixtures/*`: synthetic and golden fixtures (not implemented in S0-01)

## Requirements

Node.js 22 LTS, pnpm 9.15.9 via Corepack. Docker will be required from S0-04 onward.

## Local setup

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
cp .env.example .env.local   # optional; synthetic values only
pnpm dev
```

- Web: http://localhost:3000
- API liveness: http://localhost:4000/health/live (returns `{"status":"ok"}`)
- Worker: logs a startup line and idles; it processes no jobs yet.

## Workspace scripts

| Script                        | Purpose                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                    | Run web, api and worker in watch mode                                                                                                   |
| `pnpm build`                  | Build every workspace that defines a build                                                                                              |
| `pnpm typecheck`              | Type-check apps, modules and shared packages                                                                                            |
| `pnpm lint`                   | ESLint (`pnpm lint:fix` to auto-fix)                                                                                                    |
| `pnpm format`                 | Prettier write (`pnpm format:check` to verify)                                                                                          |
| `pnpm test`                   | Workspace structure, architecture boundary fixtures (incl. a TypeScript-resolver parity check), shared-kernel and API tests             |
| `pnpm check:architecture`     | Enforce module import boundaries; exit 0 compliant, 1 violations, 2 cannot analyse (see [docs](docs/architecture/module-boundaries.md)) |
| `pnpm check:structure`        | Verify expected apps, modules and public entry points                                                                                   |
| `pnpm db:up` / `pnpm db:down` | Start / stop the local PostgreSQL 16 container (Docker; data kept in the `sdris_pgdata` volume)                                         |
| `pnpm db:migrate`             | Apply pending SQL migrations (repeatable; applied files are checksummed and immutable)                                                  |
| `pnpm db:status`              | Show each migration as `applied`, `pending`, `modified` or `missing` (exit 1 on a history problem)                                      |
| `pnpm db:seed`                | Apply synthetic seed scripts (local/test databases only)                                                                                |
| `pnpm db:reset`               | Drop the SDRIS schemas and re-migrate (local/test databases only; refused otherwise)                                                    |
| `pnpm db:test`                | Database integration tests against real PostgreSQL in throw-away `sdris_test_*` databases                                               |

Run a single workspace with `pnpm --filter @sdris/api <script>`. Add dependencies to a
specific workspace the same way (`pnpm --filter @sdris/api add <pkg>`), not at the root.

## Database (PostgreSQL)

Persistence uses Drizzle ORM with hand-written SQL migrations in `infrastructure/database` (`@sdris/database`).
Decision record: [ADR-025](docs/adr/ADR-025-postgresql-persistence-architecture.md) (PROPOSED). Implementation notes, schema ownership and open items: [docs/architecture/persistence.md](docs/architecture/persistence.md).

```bash
pnpm db:up        # start PostgreSQL on 127.0.0.1:5432 and wait until healthy
pnpm db:migrate   # create the ten schemas (one per bounded context + system)
pnpm db:status    # confirm 0001 is applied
pnpm db:seed      # optional; the S0-04 seed is intentionally empty
pnpm db:test      # integration tests (needs the container running)
pnpm db:down      # stop; data survives in the volume
```

- Connection: `DATABASE_URL` (see `.env.example`; override locally in `.env.local`, which is never committed). If unset,
  the documented local default is used. If port 5432 is taken, set `SDRIS_POSTGRES_PORT` and update `DATABASE_URL`.
- Readiness: `docker exec sdris-postgres pg_isready -U sdris_local -d sdris_local`, or `pnpm db:status`.
- Reset safely: `pnpm db:reset` only runs against `localhost` databases named `sdris_local` / `sdris_test*` and never when
  `NODE_ENV=production`. To wipe the whole local server including data: `pnpm db:down && docker volume rm sdris_pgdata`.
- Add a migration: create `infrastructure/database/migrations/NNNN_description.sql` (next number), run `pnpm db:migrate`.
  Never edit a migration after it is applied or merged; add a new one.
- Troubleshooting: "Cannot connect to PostgreSQL" means the container is not running (`pnpm db:up`); `CHECKSUM_MISMATCH`
  means an applied migration file was edited (restore it); `port is already allocated` means 5432 is in use.
- Security: credentials are synthetic and local; the container listens on loopback only. Do not point these commands at
  shared or production databases.

## Local safety

Copy `.env.example` to `.env.local` only when needed; never commit credentials. Synthetic-only test data. No production connectors or AI execution.

## Next steps

S0-05 Investigation Aggregate; S0-06 Auth/Audit; S0-07 API Contracts; S0-08 Fixtures; S0-09 Golden Harness; S0-10 CI.
