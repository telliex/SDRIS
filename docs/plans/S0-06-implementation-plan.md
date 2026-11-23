# S0-06 — Implementation Plan (PLANNING ONLY, v0.2 DRAFT)

**Status:** DRAFT plan. **Do not execute.** S0-06 is NOT STARTED and no work package may start until the gate in section 1 is open. Everything depends on the Owner decisions D1 to D9 in the [decision register](../specs/S0-06-owner-decision-register.md) and may change with them. Revised after the independent architecture review; see the [remediation matrix](../reviews/S0-06-review-remediation.md).

- **Date:** 2026-11-22. **Reviewed baseline (pinned):** `main` at `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21`.
- **Integration base rule (every package):** the package is cut from the **integration SHA the Owner approves in the written authorization**, not from "the current main". Before the branch is cut: `git merge-base --is-ancestor ae7dc51 <approved SHA>`; the approved SHA must be an ancestor of or equal to the `origin/main` tip; diff the files this plan names between `ae7dc51` and the approved SHA; report any difference, and any movement of `origin/main` since the approval, to the Owner for re-approval or written confirmation. Never assume the reviewed baseline is the integration base.
- **Related:** [specification v0.4](../specs/S0-06-authentication-audit-foundation.md), [contract review](../reviews/S0-06-contract-design-review.md).
- **Commands** (CLAUDE.md section 7; confirm in `package.json` first): `pnpm check:structure`, `lint`, `format:check`, `typecheck`, `test`, `build`, `check:architecture`, `db:test` (Docker PostgreSQL via `pnpm db:up`), `test:runtime`.

## 1. Start gate

Open only when register section 8 holds: D1 to D8 recorded, D9 requirements approved, written authorisation to implement, Amendment A5 ACCEPTED through the existing ADR workflow for WP-04 and WP-05 (there is no alternative), and a clean branch cut from the **Owner-approved integration SHA**, which the written authorization names. **Gate today: CLOSED.**

## 2. Dependencies and parallelism

```text
WP-01 (FU-3, stage 1) ─────────────┬──────────> WP-03 ─┐
WP-02 (identity)  ─────────────────┘ (WP-03 needs both) ├─> WP-05 ─> WP-06
WP-04 (audit schema + adapter) ──────────────────────────┘
```

- **May proceed independently of WP-01 (and of each other):** WP-02 and WP-04 (WP-04 additionally needs A5 accepted).
- **Blocked by WP-01:** WP-03, WP-05, WP-06. WP-03 changes `linkAttempt`'s signature, so it must start from the **completed, reviewed and verified** FU-3 contract (specification 7, stage 1). WP-05 adds the audit call to the same command. This keeps stage 1 (additive) and stage 2 (breaking) from mixing.
- **Blocked by WP-02:** WP-03. **Blocked by WP-03 and WP-04:** WP-05.
- Each package is its own branch and PR; the Owner reviews and authorises the next (CLAUDE.md section 14). One Codex review of the final head per package is the proposed default (D9).

## 3. D9 verification requirements (fixed before implementation)

Defined now, approved by the Owner with D9, and applied to **every** package as relevant; the **final integrated evidence is collected in WP-06**.

1. Acceptance criteria AC-1 to AC-13 (specification 8; AC-13 only if the Owner confirms authenticated reads) are the pass conditions. **The criteria are approved by the Owner before implementation; evidence is produced during implementation in the package each criterion names and consolidated in WP-06.**
2. Real PostgreSQL for every persistence claim; no mocked database counts as persistence evidence.
3. Commands listed above run and their **actual** results reported (PASS/FAIL/NOT_RUN); an unexecuted test is never reported passed.
4. No allowlist widening, no `0001`/`0002` change, no new dependency, no ADR Status change.
5. Mutation or negative checks for each new guard on committed code (the S0-05 technique).
6. A fresh-clone verification at the end of WP-06.
7. All results are local until S0-10 provides CI.

## 4. Work packages

### WP-01 — FU-3 runtime validation and version exhaustion (stage 1)

- **Depends on:** D1, D2, D8. **Independent of:** WP-02, WP-04.
- **Scope:** specification 7 stage 1 only: step 5 (`invalid_expected_version`), step 8 (`version_exhausted`), the two error types in the public contract, no actor, no audit, no migration, **no signature change**.
- **Closure additions (v0.2 to v0.3):** the exact tests are specification 7.5 (precedence, malformed values, maximum version, duplicate no-op, repository-shape race, service-shape stale, boundary race). Both existing shapes of `concurrency_conflict` are preserved and asserted separately (service: `expectedVersion` and `actualVersion`; repository race: `expectedVersion` only). The reads and every existing signature stay unchanged in this package.
- **Files likely:** `modules/investigation/src/application/investigation-service.ts` and `.spec.ts`, `modules/investigation/src/public/index.ts`, `apps/api/src/composition/investigation-links.integration.test.ts`; `tests/architecture/type-surface.test.mjs` re-run for the widened union.
- **Tests:** characterisation of existing precedence first; every value of specification 7.3 with the deterministic `reason`/`actualType`; precedence rows (case/attempt/same-UUT before step 5, step 6 after); version exhaustion on real PostgreSQL with a case seeded at 2147483647 by test-only SQL; duplicate and stale at the maximum; compiled-runtime check that the build still passes.
- **Exit evidence:** the compatibility inventory (specification 7.6) re-verified against the code at the integration base; Owner review of the contract before WP-03 starts.
- **Risks:** widened exported union; a hidden dependency on non-validation (none found in the repository).
- **Rollback:** revert the commits; no schema or data change exists, so rollback is complete.
- **Commits:** (1) `test(investigation): characterise linkAttempt error precedence` (2) `feat(investigation): validate expectedVersion at the comparison position` (3) `feat(investigation): fail explicitly at version exhaustion`.

### WP-02 — Synthetic identity and trusted actor handle

- **Depends on:** D1, D3. **Independent of:** WP-01, WP-04.
- **Scope:** `ActorHandle` and `ActorResolver` contracts in the Investigation public surface; the issuer, registry, trusted clock, expiry, revocation and fixture principals under `apps/api/src/composition/identity/**`; the `TrustedEnvironment` reader and fail-closed startup rejection; **the identity checker rules and their fixtures (assigned here, not to WP-06)**: Investigation may not import the identity module; nothing outside the composition roots and recognised test files may import the issuer or fixtures. No Investigation command changes.
- **Closure additions:** the internal typed resolver outcome and the 15-minute TTL with expiry at `now >= expiresAt` (specification 2.4); revocation and reuse tests; **startup is verified at the approved composition entrypoint `composeInvestigation`** (`main.ts` does not call it; wiring it is out of scope unless the Owner asks) with the paired positive and negative tests of specification 3.2 (the negative must fail with `code = 'SYNTHETIC_IDENTITY_FORBIDDEN'` while the positive control passes in the identical setup); the issuer takes its principals as an argument, fixtures live in `*.fixtures.ts` excluded through `apps/api/tsconfig.build.json` (a build setting, not an allowlist), and a packaging check scans `apps/api/dist` after `pnpm build`. No static tokens. No allowlist widening.
- **Files likely:** `apps/api/src/composition/identity/**` (new), `modules/investigation/src/public/index.ts`, `scripts/architecture/**` and `tests/architecture/fixtures/**` for the new restriction rules; **no change to `dependency-matrix.json` allowlists** (a need for one stops the package and goes to the Owner as a separate proposal).
- **Issuer refusals (specification 2.10):** the typed `issue` outcome, `security.issuance_refused` with the closed reasons, exactly one event per refusal, none on success, the injected event sink, and the six unit tests of 2.10 (capturing sink, no key text in events, throwing sink, N refusals give N events).
- **Tests:** issuer unit tests (valid, expired, revoked, foreign issuer, forged plain object, claim immutability, deep-frozen copies); environment matrix (unset, empty, `production`, `prod`, `Test`, conflicting variables); checker fixtures valid and invalid; the compiled-runtime startup rejection test is added in WP-06 but its harness may be prepared here.
- **Risks:** a new composition location; fixtures shipping in `dist` (decide per D3).
- **Rollback:** revert; nothing depends on it until WP-03.
- **Commits:** `feat(investigation): add the actor handle and resolver contracts`, `feat(api): add the synthetic identity issuer`, `feat(api): refuse the synthetic issuer outside local and test`, `test(architecture): enforce the identity import rules`.

### WP-03 — Authorization boundary (stage 2, part 1)

- **Depends on:** WP-01 (completed and reviewed), WP-02, D3.
- **Scope:** the `context` first argument on the four write commands (and on the reads if D3 says so); authentication (A1) and authorization (A2) **before `transactions.run`**; `unauthenticated`, `permission_denied`, `invalid_request_context`; the Security Log port and its contract; `actorResolver` as a required composition option.
- **Closure additions:** the canonical order of specification 2.7 (Authentication → Correlation Validation → Authorization → Domain Validation → Transaction) with one Security Log event per rejection, emitted by the application service through an injected `SecurityLog` port; **if the Owner confirms C11**, Result-based reads with `RequestContext` and `AccessError` (specification 3.3) and the caller updates it lists (`investigation-service.spec.ts`, the two api integration tests, the compiled-runtime child); the strict correlation format and the fixed `source` (specification 4.6). **If the Owner defers read authentication**, the exposure boundary of specification 3.3 (read-only facade, no network exposure) and its two tests replace the read-authentication work.
- **Files likely:** `investigation-service.ts` and `.spec.ts`, `composition/index.ts`, `apps/api/src/composition/investigation.composition.ts`, the S0-05 tests (context argument only), the compiled-runtime child script.
- **Tests:** direct service calls with and without each permission; no transaction opened on rejection (asserted with a counting `TransactionScope`); Security Log events contain no credential, handle or payload values; sink failure does not change the result; a JavaScript caller with no or forged context.
- **Risks:** a large mechanical diff hiding regressions (mitigation: a first commit that only threads a default test context with no behaviour change); this is the **breaking** contract change and needs the Owner's approval.
- **Rollback:** revert; contracts return to the stage 1 shape. No schema exists yet.
- **Commits:** `refactor(investigation): thread the request context through the commands` (no behaviour), `feat(investigation): authenticate and authorise before the transaction`, `feat(investigation): add the security log port`, `test(investigation): cover rejection paths`.

### WP-04 — Investigation audit schema and persistence

- **Depends on:** D4, D5 (**A5 ACCEPTED**), D6. **Independent of:** WP-01 to WP-03.
- **Scope:** migration `0003`; Drizzle table; `AuditWriter` port; the adapter built on `PersistenceHandle` + `executorOf(handle, tx)` that **throws when the token is missing**; per-action check constraints (details allowlist, `case_id` rule, timestamps without defaults); foreign key to `investigation_case`; row triggers for update and delete and a statement trigger for truncate; the startup readiness query. **Not wired into any command.** **Migration inventory updates are assigned here:** the lists in `migrations.integration.test.ts`, `migrations.spec.ts` and the compiled-runtime child that enumerate tables or migrations.
- **Closure additions:** the adapter follows specification 4.2: it requires a token, relies on the existing infrastructure for unknown and ended tokens, and makes **no** claim about handle-to-token provenance; the four rollback verifications of 4.2 (audit insertion failure, failure after a successful audit insert but before commit including a commit-time deferred-constraint failure, missing token, ended token) run here for the adapter; database checks for the `source`, `correlation_id`, `causation_id` and `details` allowlists of 4.6.
- **Files likely:** `infrastructure/database/migrations/0003_create_investigation_audit_record.sql`, `modules/investigation/src/application/ports/audit-writer.ts`, `modules/investigation/src/infrastructure/persistence/{schema.ts,drizzle-audit-writer.ts}`, the test files above.
- **Tests (real PostgreSQL):** migration on a clean database and on one at `0002`; `0001`/`0002` checksums unchanged; each check constraint accepts the four valid shapes and rejects out-of-allowlist `details`, a wrong subject type, a `case_id` mismatch and `versionAfter ≠ versionBefore + 1`; update, delete and truncate rejected; the adapter with no token throws `AuditTransactionRequiredError`, with an ended token throws `TransactionContextError`, with a rolled-back unit leaves no row; the differential and invariant migration tests re-run.
- **Risks:** schema choices are hard to change after merge (forward repair only); table lists in existing tests.
- **Rollback:** before the migration is applied anywhere shared, revert in git. Once applied, **forward repair only** (`0004` or later); `0003` is never edited. Because nothing writes audit rows yet, the table stays inert and harmless.
- **Commits:** `feat(database): add the investigation audit record migration`, `feat(investigation): add the audit writer port and persistence adapter`, `test(database): update the migration inventory for 0003`, `test(investigation): cover audit persistence, immutability and token requirements`.

### WP-05 — Atomic audit integration and activation

- **Depends on:** WP-01, WP-03, WP-04; D6, D7.
- **Scope:** audit entry assembly and validation before the first write; the audit call inside `transactional()` only for created state changes; one clock reading per command; **the mandatory-audit activation point**: `createInvestigationService` requires the audit writer, with no flag; the startup readiness check; step 10 of the precedence.
- **Closure additions:** the operational cutover of specification 6.2 (apply and verify; stop, drain or fence; verify no old writer; activate; verify before accepting writes; fail closed), the `application_name` change to the database connection if the Owner accepts it, the completeness query, recovery rules (6.3), unknown-outcome handling (6.4) and the six verification tests of 6.5, including overlapping builds and lost acknowledgment.
- **Files likely:** `investigation-service.ts` and `.spec.ts`, `composition/index.ts`, the integration tests.
- **Tests:** the table in specification 5 row by row; failure injection (audit port throws; database check violation; missing token); the concurrent-link race with one audit row; duplicate and exhausted links write none; per-operation persisted-timestamp equality; startup refuses a database without the audit shape; the service cannot be built without an audit writer.
- **Activation and recovery (specification 6):** the commit that makes audit required is **the activation point** and is identified in the PR. After it, mutations fail closed if audit is unavailable. **Recovery is a working audit-capable build or held writes. Reverting to a build without mandatory audit is not a recovery path** and is never performed silently in an environment that has accepted audited writes; a faulty applied schema is repaired by a forward migration. A lost commit acknowledgment is an unknown outcome: the service throws, `linkAttempt` is safe to replay (stale `expectedVersion` yields `concurrency_conflict`), creates are reconciled by `correlation_id` before any retry.
- **Risks:** a forgotten audit call (AC-3 per command); availability loss from audit failure (intended; D6).
- **Rollback:** development-time only: revert the activation commit **before** any shared environment adopts it. After adoption, see Recovery. WP-04's table is unaffected either way.
- **Commits:** `feat(investigation): validate audit entries against the investigation vocabulary`, `feat(investigation): record audit entries atomically with state changes` (**activation point**), `feat(investigation): verify the audit schema at startup`, `test(investigation): prove audit atomicity, rollback and exclusions`, `test(investigation): audit under concurrent linking`.

### WP-06 — Integrated verification and regression

- **Depends on:** WP-01 to WP-05; D9.
- **Scope:** **integrated verification only**; each earlier package keeps its own tests. WP-06 adds the cross-cutting evidence not covered elsewhere (the compiled-runtime startup rejection and packaging check for the identity module, the compiled-runtime audit round trip), runs the full D9 requirement list and collects the evidence for AC-1 to AC-12, mutation checks of the new guards on committed code, and a fresh-clone verification. It does not move checker rules (WP-02) or migration inventory updates (WP-04). Treats FU-2 scheduling techniques as input; does not fix FU-1, FU-2 or FU-4 unless asked.
- **Deliverable:** an S0-06 acceptance record drafted for the Owner (same pattern as S0-05). Closure and sign-off remain the Owner's.
- **Risks:** local-only PostgreSQL evidence until S0-10.
- **Rollback:** tests and documentation only; revert.
- **Commits:** `test(runtime): reject the synthetic issuer in the compiled api`, `test(investigation): add the integrated S0-06 acceptance suite`, `docs(s0-06): add the acceptance record draft`.

## 5. Cross-cutting rules

- No ADR Status change, no allowlist widening, no new dependency, no `0001`/`0002` change in any package.
- Specification status lines change only through an Owner-approved change.
- Each package ends with the CLAUDE.md implementation report and stops for review.

## 6. Not planned

Outbox/inbox, audit read APIs, other contexts, HTTP endpoints, real authentication, retention automation, a security-event table, tamper-evidence, worker actors, S0-07 and later work.
