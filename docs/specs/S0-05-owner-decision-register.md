# S0-05 — Owner Decision Register

**Status:** DECIDED — the Engineering Owner answered Q1 to Q10 (APPROVED WITH CHANGES). The decisions are recorded verbatim
in [S0-05-owner-approval.md](S0-05-owner-approval.md) and summarised in the table below. The "Recommended choice" text further
down is the original proposal and is kept for traceability; where it differs from the decision, **the decision wins**.

**Sources:** [S0-05 specification](S0-05-investigation-aggregate-foundation.md) (PROPOSED),
[gap analysis](S0-05-gap-analysis.md) section 6 (the ten questions, quoted verbatim below),
[ADR-025](../adr/ADR-025-postgresql-persistence-architecture.md) with Amendments A1 to A4 (all PROPOSED).

**How to use:** for each question, mark one option (or write another) in the "Owner decision" block. When every question
is answered, the specification is amended to contain the answers, and only then is the specification approved (Q1).

**Rules this register follows:** the original questions are reproduced exactly and are not replaced by inferred
alternatives. Options and recommendations never add an implicit uniqueness rule, validation limit or normalisation
(spec section 3). Where an option would add one, it is labelled as a decision that needs approval.

**Approval before implementation:** every question below requires Engineering Owner approval before implementation,
because each one touches an item CLAUDE.md section 12 lists as an escalation (aggregate ownership, authoritative identity
rules, new domain state semantics, public API compatibility).

---

## Recorded Owner decisions

| #   | Decision                             | Outcome                                                                                                                                            | Differs from the recommendation                                      |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Q1  | Approval                             | APPROVED WITH CHANGES; the revised specification becomes the baseline once verified against the decision record                                    | no                                                                   |
| Q2  | UUT ownership (revised: provisional) | APPROVED: Investigation owns the UUT table; case and attempt use foreign keys; transfer needs a separate decision                                  | no (the "provisional" note becomes "separate decision")              |
| Q3  | UUT attributes                       | APPROVED: optional, not unique, stored as supplied                                                                                                 | no                                                                   |
| Q4  | TestAttempt                          | APPROVED WITH CHANGES: stage required from a controlled vocabulary (`IST`, `SAT`); external execution reference optional and not unique; immutable | yes: controlled stage vocabulary; the reference is optional          |
| Q5  | Link semantics                       | APPROVED WITH CONDITIONS: key `(case_id, attempt_id, role)`; idempotent duplicates; multiple `INITIAL_FAILURE` allowed; roles immutable            | no (multiplicity stated explicitly: several `INITIAL_FAILURE` links) |
| Q6  | Aggregate, concurrency               | APPROVED WITH CHANGES: link inside the case aggregate; new link bumps the version, an idempotent duplicate does not; no hidden retries             | no (adds: no hidden repository retries)                              |
| Q7  | Case content                         | APPROVED WITH CHANGES: `opened_at` is retained; five distinguishing error cases                                                                    | yes: `opened_at` kept                                                |
| Q8  | FailureObservation                   | APPROVED FOR REMOVAL after replacement tests exist                                                                                                 | no                                                                   |
| Q9  | Retrieval order                      | APPROVED WITH CHANGES: `registered_at`, then `attempt_id`, then role order                                                                         | yes: `registered_at` first                                           |
| Q10 | Timestamps                           | APPROVED WITH CHANGES: `created_at`, `registered_at`, `opened_at`, `linked_at`; `timestamptz`, UTC                                                 | yes: timestamps are required                                         |

Migration policy: the Owner authorised revising the unreleased `0002` after re-verifying that nothing shared depends on its
checksum (see [the persistence policy](S0-05-proposed-persistence-policy.md) section 10).

---

## Traceability: decision, implementation, evidence

Verification of the specification against the decision record (Q1). Test names are in
`modules/investigation/src/**/*.spec.ts` (unit), `apps/api/src/composition/investigation*.integration.test.ts` (real
PostgreSQL) and `tests/runtime/` (compiled, plain Node).

| Decision                                                 | Implementation                                                                 | Evidence                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q2 Investigation owns UUT; case and attempt use FKs      | `investigation.uut`; FKs on `test_attempt.uut_id`, `investigation_case.uut_id` | "is also enforced by the database: stage vocabulary, UUT foreign keys"; unknown UUT for attempt and case                                                   |
| Q3 SN and hostname optional, not unique, as supplied     | nullable columns, no unique index, no checks                                   | unit "stores serial number and hostname exactly as supplied"; integration "as supplied, duplicates allowed"                                                |
| Q4 stage `IST`/`SAT`; optional, non-unique execution ref | `parseTestStage`, `check (stage in ...)`, nullable reference                   | unit "accepts exactly the controlled vocabulary"; "rejects anything outside"; integration invalid stage                                                    |
| Q4 no result field; immutable                            | no result column; update trigger                                               | unit "has no result field"; integration "keeps UUT, attempt and link rows immutable"                                                                       |
| Q5 roles, same UUT, key `(case, attempt, role)`          | `LINK_ROLES`, composite FKs, primary key                                       | unit link specs; integration "enforces unique (case_id, attempt_id, role)"                                                                                 |
| Q5 several roles per pair, several `INITIAL_FAILURE`     | no narrower key, no cardinality rule                                           | unit and integration "permits several roles ... several INITIAL_FAILURE links"                                                                             |
| Q5 idempotent duplicate; roles immutable                 | `linkTestAttempt` returns `created: false`; update trigger                     | unit "is idempotent"; integration "is idempotent: an identical repeat changes nothing"                                                                     |
| Q5 cross-UUT rejected in application and database        | domain check; `uut_mismatch`; two composite FKs                                | unit "refuses an attempt of another UUT"; integration forged-link test with three mismatches                                                               |
| Q6 link inside case aggregate; version bump rules        | `save` bumps the version once; duplicate does not save                         | unit and integration idempotency (no version increment, no save call); version assertions                                                                  |
| Q6 atomic version check, deterministic stale rejection   | one `UPDATE ... WHERE version = $n`                                            | integration row-lock stale writer; atomic raw update; compiled-runtime stale writer                                                                        |
| Q6 retry re-reads; no hidden retries                     | repository and service never retry                                             | unit "never retries on its own"; integration "re-reads and re-evaluates on retry"                                                                          |
| Q6 `TransactionScope` stays an Investigation port        | unchanged port and adapter                                                     | architecture checks; commit and rollback integration tests                                                                                                 |
| Q7 case content; no lifecycle                            | `InvestigationCase` has five fields                                            | unit "holds exactly identity, UUT reference, opened_at, version and links"                                                                                 |
| Q7 distinct errors, documented                           | specification section 12                                                       | one test per code (see the specification)                                                                                                                  |
| Q8 FailureObservation removed after replacement          | commits `03eb60e`, `a9e4f10`, `4425dca`                                        | removal plan section 11; `migrations.spec` asserts no `failure_observation`                                                                                |
| Q9 order `registered_at`, `attempt_id`, role             | SQL `ORDER BY` with a role `CASE`                                              | integration ordering test (scrambled insertion, equal `registered_at`); mutants M1 and M2 fail it                                                          |
| Q10 four `timestamptz` columns, generated by PostgreSQL  | `default now()`; the adapter never writes them; domain drafts carry none       | integration "generates every timestamp in PostgreSQL ... callers cannot supply or override one"; unit "decides to create a link ... without any timestamp" |
| Migration 0002 revised, nothing shared touched           | `0002` rewritten; `0001` unchanged                                             | `origin/main` holds only `0001`; checksums recorded in the implementation report                                                                           |

---

## Clarification addendum and document consistency check

The Owner's [clarification addendum](S0-05-owner-clarification-addendum.md) (A to G) is recorded here as confirmed design
direction (addendum F1) and incorporated into the specification (section 13) and the persistence policy. Contradictions
found between the documents before this status was kept, and how each was resolved:

| #   | Contradiction                                                                                                          | Resolution                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Q10 said "timezone-aware, UTC" but did not say who generates the timestamps; the code used an application clock option | Addendum D2/D4 decides: PostgreSQL generates them. Code, migration, policy, spec and tests changed  |
| 2   | Policy section 8 SQL and `persistence.md` showed timestamp columns without a database default                          | Both now show `default now()`                                                                       |
| 3   | The register's own traceability row for Q10 cited a test that set a caller clock                                       | Replaced by the database-generated, non-overridable timestamp test                                  |
| 4   | The original register recommended Q4-A (free text stage) and Q7 "remove `opened_at`", the Owner decided otherwise      | Already marked as differing in the decisions table; the decisions win                               |
| 5   | The first approval said Q2 "APPROVED"; the revised approval says "provisionally"                                       | Spec and register use "provisionally"                                                               |
| 6   | The addendum header says "Proposed clarification" while the Owner asked for it to be implemented                       | Recorded with the Owner's own label; nothing is marked ACCEPTED, ADR-025 and A1 to A4 stay PROPOSED |

No other contradiction was found between the decision records, the specification, the persistence policy and the
code. The specification keeps the status APPROVED WITH CHANGES given by the Owner.

---

## Summary of recommendations (non-binding, original proposal)

| #   | Topic                     | Recommended choice                                                                                            |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Q1  | Approval                  | Approve with amendments: record Q2 to Q10 in the specification first, then approve                            |
| Q2  | UUT ownership             | `investigation` schema owns the UUT table in S0-05, with a recorded note that ownership may move              |
| Q3  | UUT attributes            | Both optional, no uniqueness, stored exactly as given                                                         |
| Q4  | TestAttempt               | Stage and execution identity required (non-null) free text, stored as given, no uniqueness, no result field   |
| Q5  | Link semantics            | Unique `(case, attempt, role)`; identical repeat is an idempotent no-op; roles immutable; no cardinality caps |
| Q6  | Aggregate and concurrency | Links belong to the case aggregate and advance the case version; UUT and TestAttempt immutable, unversioned   |
| Q7  | Case content              | Case is an identity, a UUT and its links; remove `opened_at`; keep only the error codes that still apply      |
| Q8  | FailureObservation        | Remove, after the link model (Q5, Q6) is approved                                                             |
| Q9  | Retrieval order           | Order by attempt id (UUIDv7, ascending), then by role in the specification's order                            |
| Q10 | Timestamps                | None in S0-05 (creation time stays derivable from the UUIDv7); audit timestamps belong to S0-06               |

---

## Q1. Approval

> Is the specification approved as written, or are amendments required?

**Options**

- **A.** Approve the specification as written.
- **B.** Approve after amendments: the answers to Q2 to Q10 are written into the specification, then it is approved.
- **C.** Reject or rewrite.

**Recommended choice:** B. The specification leaves the nine other questions open, so approving it "as written" would
leave implementers to guess. Recording the answers makes the specification and this register agree.

| Impact                         | Detail                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Domain                         | None directly. It gates all domain work (specification acceptance criteria 1 to 3).  |
| Database constraints           | None directly; the constraints follow from Q2 to Q7.                                 |
| Migration                      | None directly; it gates the migration content.                                       |
| Tests                          | None directly; it fixes which tests count towards acceptance criteria 1 to 12.       |
| Approval before implementation | **Yes.** Nothing dependent on the specification is implemented until it is approved. |

**Owner decision:** ☐ A ☐ B ☐ C ☐ Other: ______________ Date: __________

---

## Q2. UUT ownership

> Section 4 says ownership outside Investigation must be resolved before cross-context foreign keys. In S0-05, is the UUT
> table owned by the `investigation` schema (so case and attempt can have real foreign keys to it inside the context), or
> does another context own it?

**Options**

- **A.** The `investigation` schema owns the UUT table in S0-05. Case and attempt have real foreign keys to it.
- **B.** Another context owns the UUT (the Owner names it). Case and attempt keep a plain `uut_id` reference with no foreign
  key; UUT existence is then not enforced by the database in this context.
- **C.** As A for Sprint 0, recorded explicitly as provisional, with a requirement to revisit ownership before any
  cross-context foreign key is introduced.

**Recommended choice:** C. The specification lists the UUT among Investigation's required domain concepts and section 4
makes Investigation own the repositories of the entities in its approved scope. C keeps real foreign keys inside the
context and records the open ownership question instead of hiding it.

| Impact                         | Detail                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                         | A UUT entity, a UUT repository port and create/retrieve operations in the Investigation context (A, C). With B, none: the UUT is only a reference. |
| Database constraints           | A, C: table `investigation.uut`; foreign keys from case and attempt to it. B: no existence constraint.                                             |
| Migration                      | A, C: new table and foreign keys (see the migration policy in the proposal document). B: none for the UUT.                                         |
| Tests                          | A, C: UUT create/retrieve, rejection of a case or attempt for a UUT that does not exist. B: tests cannot assert UUT existence.                     |
| Approval before implementation | **Yes.** It decides schema ownership (ADR-025 section 5) and aggregate ownership (CLAUDE.md section 12).                                           |

**Owner decision:** ☐ A ☐ B (context: ________) ☐ C ☐ Other: ______________ Date: __________

---

## Q3. UUT attributes

> SN and hostname are "attributes". Are they optional or required? Must either be unique? Section 2 forbids treating them
> as authoritative identity and the task forbids inventing normalisation; may they therefore be stored exactly as given?

**Options**

- **A.** Both optional; neither unique; stored exactly as given (no trimming, case folding or other normalisation).
- **B.** SN required, hostname optional; neither unique; stored exactly as given.
- **C.** At least one of the two required; neither unique; stored exactly as given.
- **D.** Either one unique (needs a stated scope and a normalisation rule, which the specification forbids inventing).

**Recommended choice:** A. It adds no rule the specification does not state. Duplicate or missing SN/hostname are then
representable; treating them as ambiguous identity (AGENTS.md section 7) is a reconciliation concern outside S0-05.

| Impact                         | Detail                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain                         | `UUT { id, serialNumber?, hostname? }` with opaque strings; no identity derived from them.                                                       |
| Database constraints           | Nullable `text` columns. **No unique constraint and no check constraint.** A plain (non-unique) index may be added for lookup.                   |
| Migration                      | Two nullable columns in the UUT table.                                                                                                           |
| Tests                          | Values stored exactly as given (whitespace and case preserved); duplicates allowed; absence allowed; no lookup returns an "authoritative" match. |
| Approval before implementation | **Yes.** It defines authoritative identity rules (CLAUDE.md section 12).                                                                         |

**Owner decision:** ☐ A ☐ B ☐ C ☐ D ☐ Other: ______________ Date: __________

---

## Q4. TestAttempt

> What are "test stage" and "execution identity": free text or an enumerated vocabulary, required or optional, and what
> uniqueness (if any) applies to the execution identity? Does a TestAttempt carry any result field at all, given that it
> "does not infer authoritative test results"?

**Options for "test stage" and "execution identity"**

- **A.** Both required (non-null), free text, stored as given, no enumeration.
- **B.** Both optional free text.
- **C.** Stage drawn from an enumerated vocabulary supplied by the Owner; execution identity free text.

**Options for uniqueness of the execution identity**

- **U1.** No uniqueness.
- **U2.** Unique per UUT (needs a stated scope and normalisation; not specified).
- **U3.** Globally unique (same caveat).

**Options for a result field**

- **R1.** None in S0-05. The attempt records that an execution happened; the official PASS/FAIL stays in the test system
  (AGENTS.md section 1).
- **R2.** A raw external result string kept as a reference only.

**Recommended choice:** A, U1 and R1. "Records test stage and execution identity" reads as values that are provided;
unspecified uniqueness and a result field are decisions the specification has not made.

| Impact                         | Detail                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                         | `TestAttempt { id, uut, stage, executionIdentity }`; no result; no lifecycle. C would add an enumeration owned by the Owner.                                                                |
| Database constraints           | `uut_id` not null with a foreign key (Q2); `unique (id, uut_id)` to support the same-UUT rule; stage and execution identity not null with **no** unique or check constraint under A and U1. |
| Migration                      | New `investigation.test_attempt` table.                                                                                                                                                     |
| Tests                          | Register and retrieve; values stored as given; two attempts may share an execution identity (U1); no result is inferred or stored.                                                          |
| Approval before implementation | **Yes.** It introduces domain vocabulary and identity semantics.                                                                                                                            |

**Owner decision:** stage/identity ☐ A ☐ B ☐ C ☐ Other ______ uniqueness ☐ U1 ☐ U2 ☐ U3 result ☐ R1 ☐ R2 Date: ______

---

## Q5. Link semantics

> What is "deterministic" for duplicates: an idempotent no-op or a rejected conflict, and is the uniqueness key
> `(case, attempt)` or `(case, attempt, role)`? May one attempt hold several roles in one case? May a case have several
> `INITIAL_FAILURE` links? Can a link's role change after creation (which would make links mutable)?

**Options for the uniqueness key**

- **K1.** `(case, attempt, role)`: one attempt may hold several roles in one case.
- **K2.** `(case, attempt)`: one role per attempt per case.

**Options for a duplicate request**

- **D1.** Identical request (same key and role) is an idempotent no-op returning the existing link; a same-key request with
  a different role is a rejected conflict.
- **D2.** Any duplicate is a rejected conflict.

**Options for multiplicity and mutability**

- **M1.** No cardinality limit on any role (several `INITIAL_FAILURE` links allowed); roles immutable after creation (a
  different role is a different link).
- **M2.** A limit on some role (for example one `INITIAL_FAILURE` per case): a new business rule that needs approval.
- **M3.** Mutable roles: links become mutable records and need a version (see Q6).

**Recommended choice:** K1, D1, M1. The specification lists four roles and says duplicates are handled deterministically;
it states no cardinality limit and no role change. D1 is safe under retries (AGENTS.md section 10: no exactly-once
assumption). Linking a RETEST establishes nothing about repair effectiveness (specification section 2).

| Impact                         | Detail                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                         | `CaseTestAttemptLink { case, attempt, role }`; roles `INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`; the same-UUT rule; duplicate handling as chosen.                                        |
| Database constraints           | K1: `unique (case_id, attempt_id, role)`. A role check limited to the four listed values. Composite foreign keys for same-UUT (see the proposal document). **No cardinality constraint under M1.** |
| Migration                      | New `investigation.case_test_attempt_link` table.                                                                                                                                                  |
| Tests                          | Duplicate behaviour per D1 or D2; several roles per attempt (K1); several `INITIAL_FAILURE` links (M1); role immutability; RETEST implies no effectiveness.                                        |
| Approval before implementation | **Yes.** It defines the association's identity and invariants.                                                                                                                                     |

**Owner decision:** key ☐ K1 ☐ K2 duplicates ☐ D1 ☐ D2 multiplicity ☐ M1 ☐ M2 (rule: ______) ☐ M3 Date: ______

---

## Q6. Aggregate boundaries and concurrency

> Is the link part of the InvestigationCase aggregate (loaded and saved under the case's version) or an independent record?
> Is TestAttempt immutable after registration? Which records are "mutable authoritative records" that need a version column?

**Options**

- **A.** Links belong to the case aggregate: linking loads and saves the case under its version and advances it. UUT and
  TestAttempt are immutable after creation, so they have no version column.
- **B.** Links are independent immutable records protected only by constraints; linking does not touch the case version.
  Nothing in S0-05 is then versioned, and optimistic concurrency cannot be demonstrated on a real record.
- **C.** Links are independent records, but linking also advances the case version.
- **D.** TestAttempt and/or UUT are mutable (the Owner names the operations), so they carry a version.

**Recommended choice:** A. Specification acceptance criterion 6 requires optimistic concurrency and rollback to be verified
against PostgreSQL. A gives the case a real mutating operation (linking) without inventing any mutable attribute, and keeps
the aggregate boundary explicit. The cost is that concurrent links to one case retry on conflict; the unique key and the
composite foreign keys still protect the invariants in the database.

Additional consideration (not a new question): whether a link has its own UUIDv7 or is identified by its natural key. The
specification lists UUIDv7 identity for UUT, TestAttempt and InvestigationCase and calls the link an "explicit association";
under A the natural key `(case, attempt, role)` is sufficient and avoids a fourth identifier.

| Impact                         | Detail                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                         | A: `InvestigationCase` carries its links; `linkAttempt` returns a new case state; the repository saves case and new links atomically.                                                       |
| Database constraints           | A: `version` only on `investigation_case`, advanced by `update ... where version = $expected`. UUT and attempt tables have no version.                                                      |
| Migration                      | Keeps the existing `version` column on the case; adds none elsewhere under A.                                                                                                               |
| Tests                          | Optimistic concurrency and rollback are re-expressed on linking (see the removal plan): a deterministic stale writer, retrying writers, link and version committed or rolled back together. |
| Approval before implementation | **Yes.** It defines aggregate ownership and concurrency semantics (ADR-025 Decision 8).                                                                                                     |

**Owner decision:** ☐ A ☐ B ☐ C ☐ D (records: ________) Link identity ☐ natural key ☐ own UUIDv7 Date: ______

---

## Q7. Case content

> Is `opened_at` wanted? The specification names no other case attribute; is a case only an identity, a UUT and its links?
> Are the operational error codes in 4.3 acceptable?

(The codes in 4.3 of the gap analysis are `case_not_found`, `case_already_exists`, `duplicate_observation` and
`observation_id_in_use`.)

**Options for case content**

- **A.** A case is an identity, a UUT and its links. Remove `opened_at`.
- **B.** Keep `opened_at` (an attribute the specification does not name).
- **C.** Add further attributes (the Owner names them).

**Options for the error codes**

- **E1.** Keep the codes that still apply (`case_not_found`, `case_already_exists`, `concurrency_conflict`, `uut_mismatch`),
  remove the observation-specific ones, and name the codes for the new operations only after Q5 is decided.
- **E2.** Replace the whole set with an Owner-supplied list.

**Recommended choice:** A and E1. The specification names no case attribute besides identity, UUT and links; `opened_at` is
an assumption carried from the first draft. The observation-specific codes disappear with Q8.

| Impact                         | Detail                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Domain                         | `openCase` takes only the UUT; `InvestigationCase` loses `openedAt` (A).                          |
| Database constraints           | Drop `opened_at` from `investigation_case` (A). The `unique (id, uut_id)` and `version` stay.     |
| Migration                      | Column removal in the unreleased `0002` or a follow-up migration (see the migration policy).      |
| Tests                          | Unit, repository and runtime tests no longer assert `opened_at`; error-code assertions follow E1. |
| Approval before implementation | **Yes.** Error codes are part of the public contract.                                             |

**Owner decision:** content ☐ A ☐ B ☐ C (attributes: ______) codes ☐ E1 ☐ E2 Date: ______

---

## Q8. FailureObservation

> It is deferred by section 9 but exists in this PR. Remove it, keep it as an experiment outside the delivered contract, or
> adapt it? (Recommendation, not a decision: remove it once the link model is approved, so the delivered contract matches
> the specification.)

(The parenthetical is part of the gap analysis text and is reproduced as written.)

**Options**

- **A.** Remove it, following the removal plan, after the link model (Q5, Q6) is approved.
- **B.** Keep it as an experiment outside the delivered contract (not exported, not in the migrations, not in the public API).
- **C.** Adapt it to the approved model (the Owner states how).

**Recommended choice:** A. It is explicitly deferred (section 9). An implementation that exists but is not specified is
unapproved behaviour (AGENTS.md section 14). The plan is in
[S0-05-failureobservation-removal-plan.md](S0-05-failureobservation-removal-plan.md).

| Impact                         | Detail                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                         | `FailureObservation`, `recordObservation` and `InvestigationCase.observations` removed; error codes `case_mismatch` for observations and `duplicate_observation` removed.                                                                   |
| Database constraints           | `investigation.failure_observation` and its indexes and foreign key removed; the same-UUT composite-foreign-key mechanism is reused for links.                                                                                              |
| Migration                      | See the removal plan: edit the unreleased `0002` or add a forward migration.                                                                                                                                                                |
| Tests                          | The observation-based tests in five suites (domain 6, service 2, API chain 12, migrations 2, plus the compiled-runtime checks) are re-expressed for links and mapped one by one in the removal plan; none is deleted without a replacement. |
| Approval before implementation | **Yes.** Removal is a domain and public-API change.                                                                                                                                                                                         |

**Owner decision:** ☐ A ☐ B ☐ C (how: ______) Date: ______

---

## Q9. Retrieval

> What deterministic order should "linked attempts and their roles" be returned in?

**Options**

- **O1.** By attempt id ascending (UUIDv7, so registration order), then by role in the specification's order
  (`INITIAL_FAILURE`, `RETEST`, `SUPPORTING`, `CONTEXT`).
- **O2.** By role in the specification's order, then by attempt id ascending.
- **O3.** By link creation time (requires a timestamp, which conflicts with the recommendation for Q10).
- **O4.** Another order stated by the Owner.

**Recommended choice:** O1. It is a total order that needs no new column: UUIDv7 identifiers sort by creation time, and the
role breaks ties for an attempt that holds several roles.

| Impact                         | Detail                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Domain                         | Retrieval returns a list in the stated order; no caller relies on insertion order.                                     |
| Database constraints           | None beyond the unique key. The query uses an explicit `ORDER BY`; the role rank is a fixed mapping of the four roles. |
| Migration                      | None.                                                                                                                  |
| Tests                          | Insert in shuffled order and assert the returned order; several roles for one attempt; stable across repeated reads.   |
| Approval before implementation | **Yes.** It is part of the retrieval contract.                                                                         |

**Owner decision:** ☐ O1 ☐ O2 ☐ O3 ☐ O4 (order: ______) Date: ______

---

## Q10. Timestamps

> Do UUT, TestAttempt and link records carry creation timestamps? None are specified.

**Options**

- **T1.** No timestamp columns in S0-05. Creation time of a UUT, attempt or case stays derivable from its UUIDv7.
- **T2.** A creation timestamp on all three records.
- **T3.** A creation timestamp only where the Owner names it.

**Recommended choice:** T1, consistently with Q7. Audit trails arrive in S0-06, and the kernel can already read the creation
time out of an identifier.

| Impact                         | Detail                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Domain                         | No timestamp attribute on UUT, TestAttempt or the link (T1).                     |
| Database constraints           | None (T1). T2 and T3 add `not null` timestamp columns.                           |
| Migration                      | None (T1); a later migration can add columns if audit needs them.                |
| Tests                          | None for T1; T2 and T3 need tests for who sets the value and its format.         |
| Approval before implementation | **Yes.** A record that carries or omits a timestamp is a data-contract decision. |

**Owner decision:** ☐ T1 ☐ T2 ☐ T3 (records: ______) Date: ______

---

## Decision record

| Item                      | Value                                                  |
| ------------------------- | ------------------------------------------------------ |
| All of Q1 to Q10 answered | ☐ yes                                                  |
| Specification amended     | ☐ yes (commit: ____________)                           |
| Specification approved    | ☐ yes — Engineering Owner: ____________ Date: ________ |
| FailureObservation scope  | ☐ confirmed removal ☐ other: ____________              |

Until this record is completed, the status of the specification and of every ADR remains **PROPOSED**.
