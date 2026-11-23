# S0-06 — Implementation Plan (PLANNING ONLY, DRAFT)

**Status:** DRAFT plan. **Do not execute.** S0-06 is NOT STARTED and no work package may start until the gate in section 1 is open. Everything here depends on the Owner decisions D1 to D9 in the [decision register](../specs/S0-06-owner-decision-register.md) and may change with them.

- **Date:** 2026-11-22. **Baseline:** `main` at `ae7dc51`. Related: [specification](../specs/S0-06-authentication-audit-foundation.md), [contract review](../reviews/S0-06-contract-design-review.md).
- **Verification commands** (CLAUDE.md section 7; confirm in `package.json` before use): `pnpm check:structure`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:architecture`, `pnpm db:test` (needs Docker PostgreSQL via `pnpm db:up`).

## 1. Start gate

Open only when the register section 8 conditions hold: D1 to D8 recorded by the Owner, written authorisation to implement (S0-06 or a named package), the D5 record, a clean branch from current `main`. **Gate today: CLOSED.**

## 2. Work packages

```text
WP-01 ─────────────┐
WP-02 ─> WP-03 ────┼─> WP-05 ─> WP-06
WP-04 ─────────────┘
```

WP-01, WP-02 and WP-04 are independent of each other and may be separate PRs in any order. Each package is its own branch and PR; the Owner reviews and authorises the next (CLAUDE.md section 14). One Codex review of the final head per package is the proposed default (D9).

### WP-01 — FU-3 runtime validation and version exhaustion

- **Depends on:** D2, D8.
- **Scope:** validation of `expectedVersion` at step 5; `investigation.invalid_expected_version` and `investigation.version_exhausted`; the exhaustion check at step 8; public-contract export of the new codes. No audit, no actor, no migration.
- **Files likely:** `modules/investigation/src/application/investigation-service.ts` (+ spec), `modules/investigation/src/public/index.ts`, `apps/api/src/composition/investigation-links.integration.test.ts`, the S0-05 spec/FU-3 record (status note only if the Owner asks).
- **Tests:** the full matrix of review section 7 (unit); version exhaustion on real PostgreSQL with a case seeded by test-only SQL; regression of all S0-05 link tests.
- **Risks:** public error union change; a test that relies on current non-validation; precedence regressions (mitigation: the matrix rows run before the change as characterisation tests where they already hold).
- **Rollback:** revert the commits; no schema or data change exists.
- **Commits:** (1) `test(investigation): characterise linkAttempt error precedence` (2) `feat(investigation): validate expectedVersion at the comparison position` (3) `feat(investigation): fail explicitly at version exhaustion` (4) `docs(investigation): record the FU-3 outcome` (only if the Owner asks).

### WP-02 — Synthetic Identity and trusted Actor Context

- **Depends on:** D1, D3.
- **Scope:** Actor Context contract in the Investigation public surface; the synthetic provider and issuer registry in the application layer; environment refusal; synthetic fixture principals. No Investigation command changes yet.
- **Files likely:** `apps/api/src/identity/**` (new), `modules/investigation/src/public/index.ts`, `scripts/architecture/dependency-matrix.json` and checker rules **only if** the Owner approves the new import rules, fixtures under `tests/architecture` for them.
- **Tests:** issuer unit tests (valid, expired, malformed, unknown credential, forged object, wrong environment); architecture fixtures (Investigation cannot import identity; only composition roots import the issuer).
- **Risks:** a new composition location needs a reviewed allowlist entry (A1/A2); signed assertions would need a dependency (not proposed).
- **Rollback:** revert; nothing else depends on it until WP-03.
- **Commits:** `feat(api): add the synthetic identity provider`, `feat(investigation): add the actor context contract`, `test(architecture): cover identity import rules`.

### WP-03 — Authorization boundary

- **Depends on:** WP-02, D3.
- **Scope:** authenticate and authorise at step 0 for the four write commands; the permission set; `investigation.unauthenticated` and `investigation.permission_denied`; the new first argument or scoped binding chosen in D3. Updates call sites and existing tests mechanically.
- **Files likely:** `investigation-service.ts` (+ spec), `composition/index.ts`, `apps/api/src/composition/investigation.composition.ts`, the S0-05 integration tests (actor argument only).
- **Tests:** direct service calls with and without each permission; unauthenticated, forged and expired contexts; no row written on denial; read behaviour unchanged.
- **Risks:** a large mechanical diff in existing tests that hides regressions (mitigation: a separate preparatory commit that only adds a default test actor).
- **Rollback:** revert; contracts return to the S0-05 shape.
- **Commits:** `refactor(investigation): thread the actor context through write commands` (no behaviour), `feat(investigation): enforce write permissions in the application service`, `test(investigation): cover denial and unauthenticated paths`.

### WP-04 — Investigation audit schema and persistence

- **Depends on:** D4, D5 (and the D5 record).
- **Scope:** migration `0003`; Drizzle table; `AuditWriter` port; Drizzle adapter; append-only triggers; public action names. Not yet wired into commands.
- **Files likely:** `infrastructure/database/migrations/0003_…sql`, `modules/investigation/src/infrastructure/persistence/{schema,audit-adapter}.ts`, `application/ports/audit-writer.ts`, `migrations.integration.test.ts` and `migrations.spec.ts`, runtime child test.
- **Tests:** migration on clean and `0002` databases; `0001`/`0002` checksums unchanged; check constraints; update/delete rejection; adapter writes with a transaction and rolls back with it; the differential and invariant migration tests.
- **Risks:** table lists in existing tests; schema choices hard to change after merge.
- **Rollback:** an unreleased migration is reverted in git before it is applied anywhere shared; once applied, a forward migration is required (ADR-025 section 4 was searched for a down-migration policy and none was found; the Owner should confirm).
- **Commits:** `feat(database): add the investigation audit record migration`, `feat(investigation): add the audit writer port and adapter`, `test(investigation): cover audit persistence and immutability`.

### WP-05 — Atomic audit integration

- **Depends on:** WP-01, WP-03, WP-04, D6, D7.
- **Scope:** call the audit writer inside `transactional()` for each committed change; one clock read per command; correlation and actor propagated; no audit for no-ops, errors or rollbacks; the denial log decision from D7.
- **Files likely:** `investigation-service.ts` (+ spec), `composition/index.ts`, integration tests.
- **Tests:** section 5 table row by row; failure injection (audit port throws; DB check violation); concurrent link race with one audit row; exhaustion and duplicate at maximum version write none.
- **Risks:** forgotten audit call in a command (mitigation: AC-3 per command); audit failure turning into availability loss (intended; D6).
- **Rollback:** revert the wiring commit; WP-04 stays inert.
- **Commits:** `feat(investigation): record audit entries atomically with state changes`, `test(investigation): prove audit atomicity and rollback`, `test(investigation): audit under concurrent linking`.

### WP-06 — Integration tests, architecture checks and regression

- **Depends on:** WP-01 to WP-05, D9.
- **Scope:** the cross-cutting acceptance evidence AC-1 to AC-11 not already covered; architecture checker additions confirmed by the Owner; compiled-runtime smoke coverage for the new modules; the acceptance record for S0-06 as a draft for the Owner. Considers FU-2 scheduling techniques as input; does not fix FU-1, FU-2 or FU-4 unless asked.
- **Tests:** full suite, `pnpm db:test`, mutation checks of the new guards on committed code, fresh-clone verification as for S0-05.
- **Risks:** local-only PostgreSQL evidence until S0-10.
- **Rollback:** test and documentation only; revert.
- **Commits:** `test(investigation): add the S0-06 acceptance suite`, `test(architecture): lock the identity and audit boundaries`, `docs(s0-06): add the acceptance record draft`.

## 3. Cross-cutting rules

- Docs-first: each package updates the specification status line only through an Owner-approved change.
- No ADR Status change, no dependency addition, no loosening of the architecture checker, no `0001`/`0002` change in any package.
- Each package ends with the CLAUDE.md implementation report and stops for review.

## 4. Not planned

Outbox/inbox, audit read APIs, other contexts, HTTP endpoints, real authentication, retention automation, S0-07 and later work.
