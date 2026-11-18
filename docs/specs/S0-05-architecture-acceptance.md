# S0-05 — Architecture Acceptance Record (DRAFT)

> **Status snapshot note (added 2026-11-17).** Statements in this document that ADR-025 and Amendments A1 to A4 are `PROPOSED` (or not yet accepted) describe the state when the document was written, **before** the status transitions of commits `bec7381` to `93baa76` (2026-11-17). They are dated snapshots and are not updated by status commits. **The current status of each record is its own `Status` line in `docs/adr/ADR-025-postgresql-persistence-architecture.md`** (ADR-025 also in the ADR README index). This note changes no other content and does not change this document's own status.

**Status:** DRAFT — **ARCHITECTURE ACCEPTANCE PENDING OWNER SIGN-OFF.** This record states evidence and a technical
recommendation. It does not accept anything. The sign-off block in section 12 is deliberately empty and may be completed
only by the Engineering Owner.

**Milestone:** S0-05 — Investigation Aggregate Foundation  
**Authoritative decisions:** [S0-05-final-owner-approval.md](S0-05-final-owner-approval.md) (v1.0)  
**Related records:** [specification](S0-05-investigation-aggregate-foundation.md), [decision register](S0-05-owner-decision-register.md),
[persistence policy](S0-05-proposed-persistence-policy.md), [removal plan](S0-05-failureobservation-removal-plan.md),
[closure record](S0-05-closure-record.md), [ADR-025 decision package](../adr/ADR-025-decision-package.md)

## 1. Baseline (verified against the repository and GitHub on 2026-11-16)

| Fact                    | Value                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pull request            | #6 `feat/s0-05-persistence-dependency-policy`, base `main`                                                   |
| State                   | MERGED at 2026-11-16T08:52:03Z by account `telliex`; merge commit `f8bb094`                                  |
| Final implementation    | `2c11d93` (PR head). `git diff 2c11d93 origin/main` is empty: the tree on `main` equals the PR head          |
| Merge authorisation     | Authorised by the Engineering Owner (established fact, not re-examined here); performed by account `telliex` |
| Final-head Codex review | Comment 6911729542, 2026-11-16T08:48:29Z: "Didn't find any major issues", reviewed commit `2c11d931ea`       |
| Migration `0001`        | Unchanged since PR #5 (sha256 `c9add3b0…`, identical on `main`)                                              |

## 2. Q1 to Q10 compliance

Result key. **PASS** = the requirement is met and the evidence named in the last two columns exists; the kind of evidence is
stated in each row: _executed test_ (a test that was run and passed, named in the row) or _document review_ (consistency of
documents, no executable test) or _Owner confirmation_ (a recorded Engineering Owner statement). **NOT VERIFIED** = the evidence needed is not available to the implementation engineer.
**FAIL** = a requirement is not met (none).

| #   | Decision                                       | Result                 | Code evidence                                                                                                                              | Test evidence                                                                                                                   |
| --- | ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Specification is the baseline                  | PASS (document review) | Spec sections 11 to 13; register consistency check (7 contradictions resolved)                                                             | No executable test. Document review: the register's consistency check lists the contradictions found and resolved               |
| Q2  | Investigation owns UUT, real foreign keys      | PASS                   | `0002` `investigation.uut`; `test_attempt.uut_id` and `investigation_case.uut_id` reference it                                             | "stage vocabulary, UUT foreign keys"; unknown UUT for attempt and case                                                          |
| Q3  | SN and hostname optional, non-unique, as given | PASS                   | `domain/uut.ts` (no normalisation); nullable columns, no unique index                                                                      | "stores serial number and hostname exactly as supplied"; "allows duplicates (not unique)"                                       |
| Q4  | TestAttempt                                    | PASS                   | `domain/test-attempt.ts` (`TEST_STAGES = IST, SAT`, exact match); `0002` stage check; nullable reference; no result column; update trigger | "accepts exactly the controlled vocabulary", "rejects anything outside"; "has no result field"; immutability trigger test       |
| Q5  | Link semantics                                 | PASS                   | `0002` primary key `(case_id, attempt_id, role)`, role check, two composite foreign keys; `domain/investigation-case.ts` same-UUT check    | unique-key and role test; several roles and several `INITIAL_FAILURE`; forged links violating both composite keys; many-to-many |
| Q6  | `linkAttempt` with mandatory `expectedVersion` | PASS                   | Section 4 below                                                                                                                            | Section 4 below                                                                                                                 |
| Q7  | Case content and errors                        | PASS                   | `InvestigationCase` has identity, UUT, `openedAt`, `version`, links only; ten error codes (spec section 12); no observation code           | "holds exactly identity, UUT reference, opened_at, version and links"; one test per code                                        |
| Q8  | FailureObservation removed                     | PASS                   | Section 6 below                                                                                                                            | `migrations.spec.ts` asserts no `failure_observation`; replacement proofs on links                                              |
| Q9  | Retrieval order                                | PASS                   | One-statement load with `ORDER BY registered_at, attempt_id, role CASE` (`drizzle-investigation-repository.ts`)                            | Ordering test with scrambled insertion and two attempts sharing one `registered_at`                                             |
| Q10 | Timestamps, one injected clock                 | PASS                   | Section 5 below                                                                                                                            | "persists the timestamps of one injected application clock as UTC instants, and commands cannot override them"                  |

### Other conditions of the final approval

| Condition                                                                                                            | Result                    | Evidence                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final approval section 4: checksum of migration `0001` preserved                                                     | PASS (executed check)     | sha256 identical on `main` and unchanged since PR #5 (section 8)                                                                                                                                                                        |
| Final approval section 4: `0002` revised only if no shared or production environment ever used its previous checksum | PASS (Owner confirmation) | **OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17)**: the Owner confirmed that SDRIS has used only personal local development databases and that no non-personal database environment applied `0002` (decision S0-05-OPEN-1; section 8). |
| Final approval section 6: ADR-025 and A1 to A4 not marked ACCEPTED                                                   | PASS (document review)    | All five records still say PROPOSED (section 9)                                                                                                                                                                                         |

## 3. Domain and persistence architecture

- **Aggregate.** `InvestigationCase` is the aggregate root and owns its `CaseTestAttemptLink` rows; only the case carries a
  `version`. `Uut` and `TestAttempt` are immutable after creation (database trigger `reject_update` on `uut`, `test_attempt`,
  `case_test_attempt_link`).
- **Layers.** Domain and application have no Drizzle or driver import; repository ports are in `src/application/ports`; the
  adapter is in `src/infrastructure/persistence`; the factory in `src/composition` returns contracts only; only
  `apps/api/src/composition/**` may import `@sdris/investigation/composition`.
- **Transactions.** `TransactionScope` is an Investigation-owned application port, implemented over the database unit of work;
  a failed transaction is rolled back before anything else happens. No cross-context transaction mechanism exists.
- **Same-UUT protection** is enforced twice: in the domain (`uut_mismatch`) and by two composite foreign keys on the link
  (`(case_id, uut_id)` and `(attempt_id, uut_id)`). Only a violation of those two named constraints is translated; any other
  database failure is thrown and rolls the transaction back, never turned into idempotent success.
- **One-snapshot read.** The case and its links are loaded by a single statement, so the version and the links always come
  from one snapshot (defect found by Codex on `f56c417`, fixed in `ce44e01`).
- **Schema.** `0002` creates `uut`, `test_attempt`, `investigation_case`, `case_test_attempt_link`; vocabulary checks for stage
  and role; `version >= 1`; update-rejecting triggers; no timestamp default; no uniqueness on serial number, hostname or
  external execution reference.

## 4. Expected Version precedence (`linkAttempt`)

`investigation-service.ts` (lines as of `2c11d93`):

| Step                                                                                          | Where                                                     |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Validate role                                                                                 | line 197                                                  |
| Read the case, then the attempt (`case_not_found`, `attempt_not_found`)                       | lines 199 to 204                                          |
| Same-UUT check (`uut_mismatch`), before the version                                           | line 205                                                  |
| Compare `expectedVersion`; a difference is `concurrency_conflict` **even if the link exists** | lines 208 to 217                                          |
| Matching version and identical link: idempotent success, no write, no increment               | lines 218 to 225                                          |
| New link: one atomic `UPDATE ... WHERE version = $n`, then the link insert, one transaction   | line 226 and `drizzle-investigation-repository.ts` `save` |
| No retry anywhere                                                                             | (no retry code exists)                                    |

Real-PostgreSQL tests (`apps/api/src/composition/investigation-links.integration.test.ts`): matching-version idempotency,
stale version beats an existing link, a stale version for a new link and a future version, validation before the version,
two concurrent identical requests, two concurrent different requests, the deterministic stale writer, the torn-read race,
an unrelated unique violation that is thrown and rolled back, commit and rollback including an injected database failure
after the version bump.

**Determinism.** The tests that decide behaviour under concurrency gate the writers with a row lock and `pg_stat_activity`
(`writersBehindARowLock`, `readWhileAnotherWriterCommitsALink`, the stale-writer and unique-race tests), so every writer has
read the same version before any of them writes. They assert counts ("one stored, one rejected"), never which writer wins.
Five consecutive runs of the whole API suite gave 43/43 each time. Three other tests are not lock-gated (finding MINOR-2).

Mutation evidence (each makes a test fail): removing the version comparison, running idempotency before the version check,
validating after the version check, and letting an idempotent duplicate advance the version; earlier rounds also covered the
version predicate, role order, tie-break order, duplicate writes, the domain UUT check, either composite foreign key, the
immutability trigger, the role check and a narrower link key.

## 5. Application clock

- One injected `now: () => Timestamp` in the service dependencies (`investigation-service.ts:102`), used at lines 151, 172, 187
  and 205. The composition factory accepts it as an option; the production composition root passes none, so the system clock
  is used.
- No command type carries a timestamp; the test passes forged `createdAt`, `registeredAt`, `openedAt` and `linkedAt` and shows
  they are ignored.
- `0002` timestamp columns are `timestamptz not null` with **no default**; domain and application code use no database time
  function. Values round-trip as ISO-8601 UTC with millisecond precision.
- Ordering stays deterministic when timestamps are equal (`attempt_id`, then role rank), tested with two attempts sharing one
  `registered_at`.
- History: an intermediate commit (`baed8dc`) generated timestamps in PostgreSQL following a clarification addendum; the final
  approval superseded it and `a5eec28` restored the injected clock. The tests written in between were kept.

## 6. FailureObservation removal

Executed replace, verify, remove: `03eb60e` (links added), `a9e4f10` (compiled-runtime checks on links), `4425dca` (removal).
Repository search at `2c11d93`: no occurrence in code, schema, tests or public exports except one negative assertion in
`migrations.spec.ts`. Remaining mentions are documentation (specification, register, removal plan, approval records, gap
analysis, checklist, all labelled as historical or superseded), the published `0001` schema comment and `schemas.ts` /
`persistence.md` which mirror it ("cases, failure observations, hypotheses"; `0001` is immutable), and the product-domain
description in `AGENTS.md`. None is active S0-05 functionality.

## 7. PostgreSQL integration results

Environment: PostgreSQL 16.14 (Docker `postgres:16`, aarch64, time zone UTC), Node v22.23.0, pnpm 9.15.9. Every test runs in
its own throw-away database `sdris_test_*`, dropped afterwards; no shared or production database was touched.

| Command (fresh clone of `2c11d93`)                               | Exit | Result                                                                  |
| ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                 | 0    |                                                                         |
| `pnpm check:structure`                                           | 0    |                                                                         |
| `pnpm check:architecture`                                        | 0    | 17 packages, 78 files, 10 public type surfaces, 0 notes                 |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` | 0    |                                                                         |
| `pnpm test`                                                      | 0    | root 261/261; shared-kernel 60; database 31; investigation 38; api 1    |
| `pnpm db:test`                                                   | 0    | database 53/53; api 43/43; compiled runtime 4/4; 0 skipped, 0 cancelled |
| Five repeated API suite runs                                     | 0    | 43/43 each                                                              |

## 8. Migration checksum evidence

| File   | sha256 (full)                                                      | Note                                                                                                         |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `0001` | `c9add3b033050413c54e851957ba9fdec6e3513ffc35668bb1c4b6aba916847b` | Identical to `origin/main`; unchanged since PR #5                                                            |
| `0002` | `b4914ddb67a28615d9342ebac4bbcada02fa8ccbbaea28f0f0721ff61eac0f49` | Revised in place before PR #6 merged; release state: OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17) (below) |

On a one-off database the runner applied both scripts in order, reported both as `applied`, and applying again applied
nothing.

**OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17)**, release state of `0002` (decision S0-05-OPEN-1, Engineering Owner, 2026-11-17).

- **Owner statement.** SDRIS has used only personal local development databases to date. No shared development, integration,
  QA, staging, production, cloud-hosted or other non-personal database environment has applied migration `0002`. No
  non-personal environment depends on an earlier checksum or revision of `0002`.
- **Supporting observations (they support but do not independently establish the absence of external deployments).** The
  repository shows `0002` was not on `main` before PR #6 merged; the commits of this PR revised `0002` before it merged; there
  are no GitHub Actions runs, deployments or environments; the documented database deployment is local Docker Compose bound to
  `127.0.0.1`; `0001` is unchanged; the final implementation was verified against disposable databases. **The Owner's explicit
  environment confirmation is the decisive evidence.**
- **Decision.** The S0-05 migration-governance requirement (final approval section 4) is satisfied for the verified project
  deployment history. The merged `0002` (`b4914ddb…`) is retained; no forward-only corrective migration is required on the basis
  of OPEN-1; **no migration reset or database modification is authorised by this confirmation.**
- **Scope and limits.** It applies to the deployment history of SDRIS through 2026-11-17. It does not authorise modifying `0002`
  again, is not an Architecture Acceptance signature, does not close S0-05, does not approve ADR-025 or A1 to A4, and does not
  authorise S0-06. **If contradictory deployment evidence is discovered later, OPEN-1 must be reopened and reassessed.**

A developer's local `sdris_local` created from an earlier draft reports `modified` until `pnpm db:reset` (local, disposable
only).

## 9. Architecture verification

- Boundary enforcement of ADR-025 A1 to A4 by `scripts/architecture`: 33 valid and 133 invalid fixtures, 30 type-surface tests,
  public type surfaces of 10 entrypoints verified with the compiler, test-only entrypoint restriction
  (`@sdris/database/testing`), composition-root restriction (`apps/api/src/composition/**` only), compiled runtime in plain
  Node without tsx (4 smoke tests against real PostgreSQL).
- `dependency-matrix.json` keeps `contextInfrastructure`, `compositionRoots` and `testOnlyEntrypoints` entries unchanged by
  the final round.
- ADR-025 and Amendments A1 to A4 are all **PROPOSED**; nothing was marked ACCEPTED.

## 10. Final-head Codex review and history

| Reviewed commit | Result                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `658bbf1`       | Finding (barrel bypass) fixed and confirmed                                                                          |
| `841f70b`       | Four findings (same-package import, unapproved description rules, test-only entrypoint, compiled runtime), all fixed |
| `f56c417`       | One P2 (torn read of version and links), fixed in `ce44e01` with two failing-then-passing tests                      |
| `ce44e01`       | No major issues (comment 6910987506)                                                                                 |
| `94cbe52`       | No major issues (comment 6911293503)                                                                                 |
| `2c11d93`       | No major issues (comment 6911729542), the final head                                                                 |

Six inline review threads remain unresolved on GitHub; all are outdated and each finding was fixed. Resolving them is a
reviewer or Owner decision.

## 11. Known limitations and findings

No BLOCKER and no MAJOR finding **about the code or architecture** is reported. OPEN-1 was NOT VERIFIED and is resolved by Owner confirmation (2026-11-17, section 8); it is not a code finding.

| ID      | Level         | Finding                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MINOR-1 | MINOR         | The test "loses no update when writers retry on conflict" has an unbounded `for (;;)` retry loop in test code (`investigation-links.integration.test.ts:757`). The service has no retry.                                                                                                                                                                                  |
| MINOR-2 | MINOR         | Three concurrency tests (lines 680, 735, 750) are not lock-gated: they start writers concurrently and assert only invariants that must hold for any interleaving (no lost update, distinct versions, explicit conflicts). Which interleaving occurs is not controlled, so each run may exercise a different schedule; the assertions themselves are schedule-independent. |
| MINOR-3 | MINOR         | `expectedVersion` is not type-validated at runtime; a non-integer simply fails the comparison and yields `concurrency_conflict` (safe, but there is no dedicated error).                                                                                                                                                                                                  |
| MINOR-4 | MINOR         | `DrizzleInvestigationRepository.save` re-reads the stored links to find the new one (an extra query); the new link could be passed explicitly.                                                                                                                                                                                                                            |
| INFO-1  | INFORMATIONAL | The approval names `executionReference`; the code and column use `externalExecutionReference` / `external_execution_reference` to avoid confusion with the internal id (recorded in spec section 11).                                                                                                                                                                     |
| INFO-2  | INFORMATIONAL | `InvestigationModuleOptions.now` is a composition-level clock override ("mainly for tests"); only approved composition roots may import it and `apps/api` passes none.                                                                                                                                                                                                    |
| INFO-3  | INFORMATIONAL | No CI exists (S0-10): every result above is a local result. Not verified: other Node versions or operating systems, (the release state of `0002` is covered by the Owner's confirmation, OPEN-1).                                                                                                                                                                         |
| INFO-4  | INFORMATIONAL | The `0001` schema comment still lists "failure observations" for the Investigation schema; it is published and immutable.                                                                                                                                                                                                                                                 |
| OPEN-1  | RESOLVED      | **OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17)** (decision S0-05-OPEN-1). Applies to the deployment history through 2026-11-17; reopen and reassess if contradictory deployment evidence appears. Not an acceptance signature and not a closure.                                                                                                                       |

## 12. Technical recommendation and sign-off

**TECHNICAL ACCEPTANCE RECOMMENDED.** OPEN-1, the release state of migration `0002`, is resolved by Owner confirmation (2026-11-17). The implementation meets Q1 to Q10, the evidence above was produced by commands that were
actually executed on a fresh clone of the final head, the final-head Codex review reported no major issue, and the cited technical report raised no BLOCKER or MAJOR finding about the code or architecture.

This is the implementation engineer's recommendation. **It is not the Engineering Owner's acceptance.**

**Owner sign-off (to be completed by the Engineering Owner only)**

Decision: ☐ ACCEPTED ☐ ACCEPTED WITH CONDITIONS ☐ NOT ACCEPTED

Conditions: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in (link or commit): ______________
