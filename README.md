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

## Install and verify (on a machine with package registry access)

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm check:structure
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

Visit http://localhost:3000 and http://localhost:4000/health/live after starting the apps.

**Do not treat the scaffold as validated runtime:** installation, compilation, builds and startup must pass in your environment.

## Local safety

Copy `.env.example` to `.env.local` only when needed; never commit credentials. Synthetic-only test data. No production connectors or AI execution.

## Next steps

S0-02 Shared Kernel; S0-03 Architecture Boundary Rules; S0-04 PostgreSQL; S0-05 Investigation Aggregate; S0-06 Auth/Audit; S0-07 API Contracts; S0-08 Fixtures; S0-09 Golden Harness; S0-10 CI.
