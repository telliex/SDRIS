# S0-05 — FailureObservation Removal Plan

**Status:** APPROVED by the Engineering Owner (Q8, [approval record](S0-05-owner-approval.md)) and executed in the commits
of PR #6 in the order below. `FailureObservation` is deferred by section 9 of the
[S0-05 specification](S0-05-investigation-aggregate-foundation.md); it is replaced by `CaseTestAttemptLink` first and removed
afterwards.

## 1. Why the order matters

The current proofs of transaction commit and rollback, optimistic concurrency and cross-UUT rejection are all written
through the observation operation (`recordObservation`). It is the only write that follows opening a case. Removing it first
would delete those proofs. The rule of this plan is therefore **replace, then delete**: the same scenarios are re-expressed
on linking a TestAttempt to a case, and the observation code goes only when the replacement tests pass.

What survives unchanged: the composite-foreign-key mechanism for same-UUT protection (reused for links), `unique (id, uut_id)`
on the case, the optimistic version column, `TransactionScope`, the opaque `PersistenceHandle`, the composition entrypoint
and the compiled-runtime smoke test.

## 2. Preconditions

- [ ] Engineering Owner approves the specification scope (Register Q1) and the removal (Q8-A).
- [ ] Link model approved (Q5 uniqueness, duplicates, multiplicity; Q6 aggregate boundary and which records are versioned).
- [ ] Migration policy chosen (edit the unreleased `0002`, or a forward `0003`).
- [ ] UUT ownership (Q2) and the UUT, TestAttempt attribute decisions (Q3, Q4) recorded, because links need both sides to exist.

## 3. Inventory (what is affected)

| Layer            | File                                                                                                                                                                | What happens                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema           | `infrastructure/database/migrations/0002_create_investigation_case_tables.sql`                                                                                      | Remove `investigation.failure_observation`, its index, its composite foreign key and its comment; remove `opened_at` if Q7-A. Keep `investigation_case`, `unique (id, uut_id)` and `version`.                                                                      |
| Schema (docs)    | `infrastructure/database/src/schemas.ts`                                                                                                                            | Ownership text mentions "failure observations" for the Investigation schema: reword to the approved scope.                                                                                                                                                         |
| Domain           | `modules/investigation/src/domain/investigation-case.ts`                                                                                                            | Remove `FailureObservation`, `FailureObservationId`, `recordObservation`, `InvestigationCase.observations` and the codes `case_mismatch` and `duplicate_observation`. Add the UUT, TestAttempt and link model.                                                     |
| Application      | `modules/investigation/src/application/investigation-service.ts`                                                                                                    | Remove `recordObservation` from `InvestigationService` and its command; add UUT, attempt and link operations; keep `openCase`, `getCase`, the rollback-on-error wrapper.                                                                                           |
| Port             | `modules/investigation/src/application/ports/investigation-repository.ts`                                                                                           | Remove the `observation_id_in_use` code and observation persistence from `save`; add UUT, attempt and link persistence.                                                                                                                                            |
| Adapter          | `modules/investigation/src/infrastructure/persistence/drizzle-investigation-repository.ts`                                                                          | Remove `insertObservations`, the observation join in `get` and the FK-to-`uut_mismatch` mapping for observations; implement links (same mapping, for the link foreign keys).                                                                                       |
| ORM schema       | `modules/investigation/src/infrastructure/persistence/schema.ts`                                                                                                    | Remove the `failureObservation` table definition; add the new tables.                                                                                                                                                                                              |
| Public API       | `modules/investigation/src/public/index.ts`                                                                                                                         | Remove the exported types `FailureObservation` and `FailureObservationId` and the observation-related error codes. **A public-contract change.** Only tests and the `apps/api` composition root use the package today; no other consumer exists in the repository. |
| Composition      | `modules/investigation/src/composition/index.ts`                                                                                                                    | No reference to observations. Unchanged unless the service interface changes shape.                                                                                                                                                                                |
| Composition root | `apps/api/src/composition/investigation.composition.ts`                                                                                                             | Unchanged.                                                                                                                                                                                                                                                         |
| Tests            | see section 4                                                                                                                                                       | Re-expressed for links, then the observation cases removed.                                                                                                                                                                                                        |
| Architecture     | `tests/architecture/**`                                                                                                                                             | No fixture or test references observations; the type-surface tests assert the composition exports (`createInvestigationModule`, `InvestigationModule`, `InvestigationModuleOptions`), which do not change.                                                         |
| Docs             | `docs/architecture/persistence.md` (section 8), `docs/specs/S0-05-gap-analysis.md` (rows 4.1 to 4.4), PR #6 description, ADR-025 wording that mentions observations | Update to the approved model; ADR statuses are not touched.                                                                                                                                                                                                        |

## 4. Test re-expression (every observation-based case keeps a replacement)

**Domain unit tests, `investigation-case.spec.ts` (6)**

| Today                                                     | After                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| opens a case at version 1 with no observations            | opens a case at version 1 with no links (and no `opened_at` if Q7-A)                                                        |
| records an observation without mutating the original case | links an attempt without mutating the original case                                                                         |
| stores the description exactly as given                   | **Removed**, replaced by UUT and attempt tests: SN, hostname, stage and execution identity stored exactly as given (Q3, Q4) |
| refuses evidence from another UUT and attaches nothing    | refuses a link between a case and an attempt of different UUTs                                                              |
| refuses an observation addressed to a different case      | **Removed** (no equivalent concept); the unknown-case path is covered below                                                 |
| refuses a duplicate observation id                        | handles a duplicate link as decided in Q5                                                                                   |

**Application service tests, `investigation-service.spec.ts` (6)**: `records an observation and returns the new version` and
`rejects a cross-UUT observation and changes nothing` become the link equivalents; `opens and stores a case` loses `opened_at`
if Q7-A; the other three (unknown case, concurrency conflict rolls back, unexpected failure rolls back) stay and run for the
link operation.

**API chain tests against real PostgreSQL, `investigation.integration.test.ts` (17)**

| Today                                                                                     | After                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| records observations, increments the version and preserves order                          | links attempts, increments the version, returns links in the Q9 order |
| reports an unknown case without writing anything                                          | same, for linking                                                     |
| commits the version bump and the observation together                                     | commits the version bump and the link together                        |
| rolls back everything when a domain rule rejects the command                              | same, using the same-UUT rejection of a link                          |
| stores a description exactly as given                                                     | **Removed**, replaced by storing UUT and attempt attributes as given  |
| rolls back the version bump when storing the observation fails inside the database        | the trigger moves to the link table                                   |
| lets exactly one of many simultaneous writers advance the case ...                        | same, for links                                                       |
| rejects, deterministically, a writer that decided on an older version                     | same (row-lock technique), for links                                  |
| loses no update when writers retry on conflict                                            | same, for links                                                       |
| rejects an observation from another UUT through the whole stack                           | rejects a link to an attempt of another UUT through the whole stack   |
| raw insert with a mismatching UUT violates the composite foreign key                      | same, on `case_test_attempt_link`                                     |
| refuses an observation whose case does not exist (foreign key)                            | refuses a link whose case or attempt does not exist                   |
| stores a case, duplicate case id, unknown case, rolls back a failed open, raw stale write | unchanged (the `opened_at` assertion follows Q7)                      |

Of the seventeen cases, eleven are rewritten for links, one is removed (with a replacement), and five are unchanged apart from
the case content decided in Q7. **New cases** are added for UUT create and retrieve, attempt register and retrieve, same-UUT at both
levels, link duplicates (Q5), role immutability, and retrieval order (Q9).

**Migration tests (2)**: `migrations.integration.test.ts` (the table list) and `migrations.spec.ts` (the table assertions) are
updated to the approved table set.

**Compiled-runtime smoke test**: the observation-based checks in `tests/runtime/compiled-runtime.child.cjs` (record,
commit persisted both writes, cross-UUT, rollback, stale writer) and the expected-check list in
`compiled-runtime.test.mjs` are re-expressed on links. The no-tsx guarantees stay as they are.

## 5. Execution order (each step leaves every check green)

1. **Additive:** add the UUT, TestAttempt and link tables, domain model, ports and adapter, with their own tests. Observations
   still exist.
2. **Replace:** move the application service, adapter writes and all tests listed in section 4 from observations to links.
3. **Delete:** remove the observation domain code, service command, repository code, ORM table, public types and the
   `failure_observation` table (migration policy below).
4. **Docs:** update `persistence.md`, the gap analysis and the PR description.

Commits follow the same split (additive, replace, delete, docs). The architecture rules, the public type-surface check and
the runtime smoke test run after every step.

## 6. Migration options

| Option        | What changes                                                                                                   | Consequence                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edit 0002** | `0002` is rewritten to the final shape (no `failure_observation`, no `opened_at` if Q7-A, plus the new tables) | Allowed because `0002` is unreleased. Developers must run `pnpm db:reset`; `pnpm db:status` reports `modified` until then. Checksum of `0001` is unchanged. |
| **Add 0003**  | `0003` drops `failure_observation` and `opened_at` and creates the new tables; `0002` stays byte-identical     | History stays append-only; the price is a migration that undoes part of the previous one. Required once anything has been merged.                           |

## 7. What is not deleted

- The same-UUT composite foreign key mechanism and its tests (reused for links).
- The error code `uut_mismatch` and `concurrency_conflict`, `case_not_found`, `case_already_exists`.
- The deterministic stale-writer technique and the injected-failure rollback technique.
- The composition, public type-surface and compiled-runtime verification.

## 8. Alternative if the Owner chooses Q8-B ("keep as an experiment")

The code is kept **outside the delivered contract**: preserved on a separate branch or tag (for example
`experiment/failure-observation`), not exported, not in the migrations, not in the public API and not in this PR. It then
follows the same removal steps here, with the branch as its archive.

## 9. Verification after removal

- `grep` finds no `FailureObservation`, `failure_observation` or `recordObservation` outside the preserved history and the
  explanatory documents.
- `pnpm check:structure`, `check:architecture` (including the public type surfaces), `lint`, `format:check`, `test`,
  `typecheck`, `build` exit 0 from a fresh clone.
- `pnpm db:test` passes against real PostgreSQL (database, API chain and compiled runtime), with the link-based tests
  replacing the observation-based ones, and the migration checksums are recorded.
- No test was deleted without a replacement for the scenario it proved (section 4).

## 10. Risks and rollback

| Risk                                                        | Mitigation                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Loss of the only proofs of commit, rollback and concurrency | Replace first, delete last (section 1); the mapping in section 4 is the checklist                               |
| Public contract change                                      | Only tests and the composition root use it today; recorded in the PR and the ADR text                           |
| Link semantics change after the tests are written           | Do not start before Q5 and Q6 are approved                                                                      |
| Developer databases keep the old `0002`                     | `pnpm db:reset` instructions; `db:status` reports `modified`                                                    |
| Rollback                                                    | Each step is its own commit and can be reverted; with the edit-0002 option, developers reset the database again |

## 11. Execution record

| Step                              | Commit                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Decision recorded                 | `814e8d3` docs(specs): record the Engineering Owner decisions Q1-Q10 for S0-05 |
| Additive: UUT, TestAttempt, links | `03eb60e` feat(investigation): add UUT, TestAttempt and CaseTestAttemptLink    |
| Replace: compiled-runtime checks  | `a9e4f10` test(runtime): re-express the compiled-runtime checks on links       |
| Delete: FailureObservation        | `4425dca` refactor(investigation): remove the deferred FailureObservation      |

Every proof listed in section 4 now exists on links: commit of version bump and write together, rollback on a domain
rejection and on an injected database failure, simultaneous writers, the deterministic stale-writer case, retrying
writers, a stale raw update, cross-UUT rejection through the whole stack and by the database, and a link whose case or
attempt does not exist. Removed without a link equivalent: "description stored exactly as given" (replaced by the UUT and
attempt attributes stored exactly as given) and "observation addressed to a different case" (no equivalent concept: a link
is addressed by the case id). The `0001` migration and its schema comment, which still mention "failure observations" as the
intended future content of the `investigation` schema, are published and were not changed.
