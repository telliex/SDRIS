# S0-05 — Gap Analysis (implementation vs. proposed specification)

**Status:** PROPOSED. This analysis compares the code at PR #6 with
[S0-05-investigation-aggregate-foundation.md](S0-05-investigation-aggregate-foundation.md), which is itself
**PROPOSED — Engineering Owner Approval Required**. No approval is recorded.

**Rule applied:** domain changes that depend on an unresolved requirement are not made. This document lists
what is missing, what is outside the specification, and which questions the Engineering Owner must answer
first. It invents no lifecycle rule, validation limit or identity-normalisation policy.

## 1. Domain concepts (spec section 2)

| #   | Requirement                                                                                                                                            | Current implementation                                                                                          | Gap                                                                 | Blocked by |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| 1.1 | **UUT** entity with internal UUIDv7 identity                                                                                                           | Only an `EntityRef<'UUT'>` carried as `uut_id uuid` on case and observation. No UUT entity, table or repository | **Missing entity, table, repository, create/retrieve operations**   | Q2, Q3     |
| 1.2 | UUT external SN and hostname are attributes, never primary keys; external ids must not be treated as authoritative                                     | Not modelled                                                                                                    | **Missing**                                                         | Q3         |
| 1.3 | One UUT may have many TestAttempts and many InvestigationCases                                                                                         | Many cases per `uut_id` is possible (no uniqueness on `uut_id`)                                                 | Partial: no TestAttempt side                                        | Q2, Q4     |
| 1.4 | **TestAttempt** with UUIDv7 identity, exactly one UUT, test stage and execution identity                                                               | Not modelled                                                                                                    | **Missing entity, table, repository, register/retrieve operations** | Q4         |
| 1.5 | TestAttempt has no direct InvestigationCase foreign key; infers no authoritative result                                                                | n/a (no TestAttempt)                                                                                            | Must hold once added                                                | Q4         |
| 1.6 | **InvestigationCase** with UUIDv7 identity, exactly one UUT                                                                                            | Present: `investigation_case(id, uut_id, opened_at, version)`; id via kernel `EntityId`                         | Present. `opened_at` is **not in the specification** (see 4.2)      | Q7         |
| 1.7 | Case supports multiple linked TestAttempts; must not close automatically when a test passes                                                            | No link; no lifecycle or close behaviour exists (so nothing closes automatically)                               | **Links missing**; the no-auto-close property holds trivially       | Q5, Q6     |
| 1.8 | **CaseTestAttemptLink**, explicit many-to-many, roles `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`                                             | Not modelled                                                                                                    | **Missing entity, table, roles, repository operations**             | Q5, Q6     |
| 1.9 | Link: both sides reference the same UUT; cross-UUT links rejected; duplicates handled deterministically; RETEST implies no repair effectiveness or RCA | The same-UUT rule exists, but only for `FailureObservation` (domain check plus composite FK)                    | **Rule not applied to links**; duplicate policy undefined           | Q5         |

## 2. Domain scope (spec section 3)

| #   | Required minimum behaviour                       | Current implementation                            | Gap                                                             |
| --- | ------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------- |
| 2.1 | Create and retrieve a UUT                        | None                                              | **Missing** (Q2, Q3)                                            |
| 2.2 | Register and retrieve a TestAttempt              | None                                              | **Missing** (Q4)                                                |
| 2.3 | Open and retrieve an InvestigationCase           | `openCase`, `getCase`                             | Present (retrieval includes observations)                       |
| 2.4 | Link a TestAttempt to an InvestigationCase       | None                                              | **Missing** (Q5, Q6)                                            |
| 2.5 | Retrieve linked attempts and their roles         | None                                              | **Missing**; ordering of results unspecified (Q9)               |
| 2.6 | No detailed lifecycle state machine              | None implemented                                  | Conforms                                                        |
| 2.7 | No description limits, trimming or normalisation | Removed in `05a269f`; description stored as given | Conforms (and the description itself is outside scope, see 4.1) |

## 3. Aggregate, persistence and architecture (spec sections 4 to 7)

| #    | Requirement                                                                    | Current implementation                                                               | Status                                                              |
| ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 3.1  | Independent identities; TestAttempt not duplicated per case                    | Case only                                                                            | Cannot be shown yet                                                 |
| 3.2  | Exact aggregate boundaries documented and tested                               | Case and its observations form one unit; nothing documented as a boundary decision   | **Gap** (Q6)                                                        |
| 3.3  | UUT ownership outside Investigation resolved before cross-context FKs          | `uut_id` is a plain reference, no FK                                                 | Open (Q2)                                                           |
| 3.4  | PostgreSQL authoritative; SQL-first migrations; checksum governance; UUIDv7    | Yes: `0001`, `0002`, runner with checksums; kernel UUIDv7                            | Conforms                                                            |
| 3.5  | Appropriate FKs and uniqueness constraints                                     | Composite FK `(case_id, uut_id)` for observations; `unique (id, uut_id)` on case     | Partial (no UUT, attempt, link constraints)                         |
| 3.6  | Cross-UUT protected at application and database level                          | Both, but for observations only                                                      | Partial                                                             |
| 3.7  | Optimistic concurrency for mutable authoritative records                       | `version` on the case; verified deterministically against PostgreSQL                 | Conforms for the case; which other records are mutable is open (Q6) |
| 3.8  | Rollback preserves consistency                                                 | Verified against PostgreSQL (domain error, injected database failure, failed open)   | Conforms for current operations                                     |
| 3.9  | No production or company data in fixtures                                      | Synthetic ids only                                                                   | Conforms                                                            |
| 3.10 | Domain and Application independent of Drizzle and drivers                      | Enforced by A1/A2 rules and type-surface checks                                      | Conforms                                                            |
| 3.11 | Repository ports in the context; adapters under `src/infrastructure/**`        | Yes                                                                                  | Conforms                                                            |
| 3.12 | Composition entrypoint `@sdris/investigation/composition`; only approved roots | Yes, `apps/api/src/composition/**` only                                              | Conforms                                                            |
| 3.13 | `src/public/**` independent of private infrastructure                          | Yes, and the public type surface is checked                                          | Conforms                                                            |
| 3.14 | Factories expose contracts, not adapters                                       | Yes, explicit return type, type-surface verified                                     | Conforms                                                            |
| 3.15 | Context-owned `TransactionScope` delegating to database infrastructure         | `TransactionScope` port plus `PersistenceTransactionScope`; not in the Shared Kernel | Conforms                                                            |
| 3.16 | Explicit transaction ownership; one transaction context shared; no ORM types   | Callback-scoped `run`; token passed to every repository call                         | Conforms                                                            |

## 4. Present in the code but outside the specification

| #   | Item                                                                                                                                  | Specification                        | Note                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| 4.1 | `FailureObservation` (domain type, `failure_observation` table, repository save logic, service command, tests, public contract types) | **Explicitly deferred** (section 9)  | Removing it is itself a domain change, so it is **not done** until the Owner decides (Q8) |
| 4.2 | `opened_at` on the case                                                                                                               | Not listed                           | An assumption carried since the first draft; keep, drop or specify (Q7)                   |
| 4.3 | Domain error codes `case_not_found`, `case_already_exists`, `duplicate_observation`, `observation_id_in_use`                          | Not specified                        | Operational codes; need confirmation against the approved model (Q7)                      |
| 4.4 | The same-UUT rule currently guards observations, not links                                                                            | The rule is required for links (1.9) | Moves to links once approved (Q5)                                                         |

## 5. Runtime and test requirements (spec section 8) and acceptance criteria (section 10)

| Item                                                                  | State                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Domain unit tests                                                     | Exist for the current model only                                                                       |
| Architecture boundary tests                                           | Pass (A1/A2 fixtures including 29f/29g and 51-51f)                                                     |
| PostgreSQL integration tests                                          | Pass for the current model                                                                             |
| Cross-UUT rejection tests                                             | Pass for observations; links absent                                                                    |
| Optimistic concurrency, transaction commit and rollback               | Pass for the case                                                                                      |
| Composition-root integration tests                                    | Pass                                                                                                   |
| Public API type-surface checks                                        | Pass                                                                                                   |
| **Pure Node.js compiled-runtime smoke test**                          | **Implemented** (acceptance 7): `pnpm test:runtime`, ADR-025 A4. Independent of the domain questions   |
| **Test-only database entrypoint restriction**                         | **Implemented** (acceptance 8): `testOnlyEntrypoints`, ADR-025 A3. Independent of the domain questions |
| Acceptance 1, 2, 3 (all four concepts, many-to-many, cross-UUT links) | **Not met**: UUT, TestAttempt and link are missing                                                     |
| Acceptance 4, 5, 6                                                    | Met for the current model; to be re-shown for the full model                                           |
| Acceptance 10, 11, 12                                                 | ADR documented; Codex review and Owner acceptance pending                                              |

## 6. Questions for the Engineering Owner

Domain work (Step 4) is **blocked** until the specification is approved and these are answered. Each question quotes
what the specification leaves open; the code makes no assumption about any of them.

- **Q1. Approval.** Is the specification approved as written, or are amendments required?
- **Q2. UUT ownership.** Section 4 says ownership outside Investigation must be resolved before cross-context foreign
  keys. In S0-05, is the UUT table owned by the `investigation` schema (so case and attempt can have real foreign keys to it
  inside the context), or does another context own it?
- **Q3. UUT attributes.** SN and hostname are "attributes". Are they optional or required? Must either be unique? Section 2
  forbids treating them as authoritative identity and the task forbids inventing normalisation; may they therefore be stored
  exactly as given?
- **Q4. TestAttempt.** What are "test stage" and "execution identity": free text or an enumerated vocabulary, required or
  optional, and what uniqueness (if any) applies to the execution identity? Does a TestAttempt carry any result field at all,
  given that it "does not infer authoritative test results"?
- **Q5. Link semantics.** What is "deterministic" for duplicates: an idempotent no-op or a rejected conflict, and is the
  uniqueness key `(case, attempt)` or `(case, attempt, role)`? May one attempt hold several roles in one case? May a case have
  several `INITIAL_FAILURE` links? Can a link's role change after creation (which would make links mutable)?
- **Q6. Aggregate boundaries and concurrency.** Is the link part of the InvestigationCase aggregate (loaded and saved under the
  case's version) or an independent record? Is TestAttempt immutable after registration? Which records are "mutable authoritative
  records" that need a version column?
- **Q7. Case content.** Is `opened_at` wanted? The specification names no other case attribute; is a case only an identity,
  a UUT and its links? Are the operational error codes in 4.3 acceptable?
- **Q8. FailureObservation.** It is deferred by section 9 but exists in this PR. Remove it, keep it as an experiment outside the
  delivered contract, or adapt it? (Recommendation, not a decision: remove it once the link model is approved, so the delivered
  contract matches the specification.)
- **Q9. Retrieval.** What deterministic order should "linked attempts and their roles" be returned in?
- **Q10. Timestamps.** Do UUT, TestAttempt and link records carry creation timestamps? None are specified.

## 7. Recommended next step

1. Engineering Owner approves or amends the specification and answers Q1 to Q10.
2. Then implement UUT, TestAttempt, CaseTestAttemptLink, their repositories, migration `0003` (or an edit of the unreleased
   `0002`, as the Owner prefers), the same-UUT rule for links at both levels, tests against real PostgreSQL, and the
   documented aggregate boundaries.
