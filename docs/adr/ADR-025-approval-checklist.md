# ADR-025 and S0-05 — Engineering Owner Approval Checklist

> **Status snapshot note (added 2026-11-17).** Statements in this document that ADR-025 and Amendments A1 to A4 are `PROPOSED` (or not yet accepted) describe the state when the document was written, **before** the status transitions of commits `bec7381` to `93baa76` (2026-11-17). They are dated snapshots and are not updated by status commits. **The current status of each record is its own `Status` line in `docs/adr/ADR-025-postgresql-persistence-architecture.md`** (ADR-025 also in the ADR README index). This note changes no other content and does not change this document's own status. Statements that the S0-05 Architecture Acceptance or Closure is `DRAFT` or pending describe the state before the Engineering Owner decisions of 2026-11-17 recorded in the acceptance record (section 12) and the closure record (section 7); the current status of those two records is their own `Status` line.

**Status of this checklist:** a working document for the Engineering Owner. It records evidence and open points; it
approves nothing. **Each document's own Status line is authoritative; statements about status in this checklist are dated snapshots (at the refresh of commit `a99699c` no document below was marked ACCEPTED; the Phase 3 status transitions came later).** A document changes status only after the Engineering Owner's
explicit written approval is recorded in that document's sign-off block below, and the status change is then made in its own
commit.

**State of the repository when this checklist was refreshed (snapshot, commit `a99699c`):** S0-05 is merged into `main` (PR #6, merge commit `f8bb094`,
final implementation `2c11d93`, merge authorised by the Engineering Owner). Merge is not acceptance: the S0-05 Architecture
Acceptance and closure are **pending** (see section 7), and ADR-025 and A1 to A4 are **PROPOSED**. S0-06 is not started.

**Documents covered**

| #   | Document                                                               | Current status                                                                               | Where                                                                       |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | ADR-025 — PostgreSQL Persistence Architecture and Migration Governance | ACCEPTED                                                                                     | [ADR-025](ADR-025-postgresql-persistence-architecture.md), sections 1 to 17 |
| 2   | Amendment A1 — Persistence dependency policy for S0-05                 | ACCEPTED                                                                                     | same file, "Proposed Amendment A1"                                          |
| 3   | Amendment A2 — Dedicated composition entry point (revises A1 Rule 3)   | ACCEPTED                                                                                     | same file, "Proposed Amendment A2"                                          |
| 4   | Amendment A3 — Test-only entrypoints                                   | ACCEPTED                                                                                     | same file, "Proposed Amendment A3"                                          |
| 5   | Amendment A4 — Compiled runtime packaging                              | ACCEPTED                                                                                     | same file, "Proposed Amendment A4"                                          |
| 6   | S0-05 Domain Specification                                             | APPROVED WITH CHANGES (Owner, [final approval v1.0](../specs/S0-05-final-owner-approval.md)) | [specification](../specs/S0-05-investigation-aggregate-foundation.md)       |
| 7   | S0-05 Architecture Acceptance record                                   | DRAFT, pending Owner sign-off                                                                | [acceptance record](../specs/S0-05-architecture-acceptance.md)              |
| 8   | S0-05 Closure record                                                   | DRAFT, closure pending                                                                       | [closure record](../specs/S0-05-closure-record.md)                          |

ADR-024 is outside this checklist (also PROPOSED). Supporting documents: the
[gap analysis](../specs/S0-05-gap-analysis.md), the
[Owner Decision Register](../specs/S0-05-owner-decision-register.md), the
[proposed persistence policy](../specs/S0-05-proposed-persistence-policy.md) and the
[FailureObservation removal plan](../specs/S0-05-failureobservation-removal-plan.md).

**Effective order and workflow** (the workflow, with its phases, is defined once, in "Approval workflow" at the end of this checklist; the [decision package](ADR-025-decision-package.md) section 1.1 gives the reasons): each record is approved separately and
takes effect only from its own recorded approval. Only two dependencies are binding: ADR-025 may be accepted first, with
**Decision 5 recorded as still CONDITIONAL until A2 is ACCEPTED**; and **A2 takes effect only after A1 is ACCEPTED**, because it
revises A1 Rule 3. A3 and A4 are independent. Suggested reading order: 1, 2, 3, 4, 5. The specification (6) is already approved.

**Governance questions for the Owner (decide before approving)**

- [x] Are accepted amendments folded into the ADR-025 text, or kept as named amendments? **Answered by the final approval,
      section 6:** preserve them as independently traceable records and document the effective policy of each approved one.
- [x] Does approving ADR-025 leave the amendments PROPOSED until each is approved separately? **Answered by the final approval,
      section 6:** yes; approval of ADR-025 does not approve A1 to A4, and domain approval does not imply ADR approval.

**Evidence baseline (fresh clone of `2c11d93`, merged as `f8bb094`):** `check:structure`, `check:architecture` (17 packages,
78 files, 10 public type surfaces, 0 notes; 33 valid and 133 invalid fixtures; 30 type-surface tests), `lint`, `format:check`,
`typecheck`, `build` exit 0; `pnpm test` 261 root plus 60, 31, 38 and 1 per workspace; `pnpm db:test` against PostgreSQL 16.14:
database 53, API 43, compiled runtime 4; migration checksum of `0001` (`c9add3b0…`) equals `main`, `0002` is `b4914ddb…`. No CI
exists yet (S0-10), so all results are local. **OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17)**, release state of `0002` (no non-personal database environment applied it; acceptance record section 8).

---

## 1. ADR-025 — PostgreSQL Persistence Architecture and Migration Governance

Commits: `4dddcbc`, `8b4a2b0` (Decision 5 text), `9f792cd` (index). Related: ADR-024.

| Decision (section)                                    | What approval would make binding                                                  | Evidence                                                                                                                                                                                 | Owner confirms |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1. Drizzle ORM and PostgreSQL (3)                     | Drizzle as the one query layer; SQL files authoritative                           | Spike on real PostgreSQL in `docs/architecture/persistence.md` section 1 (Kysely 0.29 is ESM-only, TS1479 with the CommonJS API)                                                         | ☐              |
| 2. SQL migration governance (4)                       | Numbered, checksummed, immutable, ordered, atomic, serialised, exit codes         | Runner with advisory lock; `CHECKSUM_MISMATCH`, `MISSING_FILE`, `OUT_OF_ORDER`; transaction-control scanner and `standard_conforming_strings` pin, with differential and invariant tests | ☐              |
| 3. Ten-schema baseline (5)                            | Nine contexts plus `system`; ownership rules; deferrals listed                    | Migration `0001`; ownership map; Retrieval schema and audit/outbox ownership explicitly deferred                                                                                         | ☐              |
| 4. Infrastructure dependency policy (6)               | Dependency inversion; forbidden dependencies; checker enforcement                 | S0-03 checker rules and fixtures                                                                                                                                                         | ☐              |
| 5. UnitOfWork and TransactionContext (7), conditional | The infrastructure-owned abstraction stays until validated with a real repository | Validated in S0-05 (A2.6): unchanged contracts sufficed, a context-owned `TransactionScope` port was added; **remains conditional**                                                      | ☐              |
| 6. Module-owned repository adapters (8)               | Context-owned adapters under `src/infrastructure/**`                              | Implemented through A1 and A2 for Investigation                                                                                                                                          | ☐              |
| 7. Audit, outbox, atomic persistence (9)              | Atomicity as a requirement; implementation deferred                               | Capability shown with test-only tables; no workflow implemented                                                                                                                          | ☐              |
| 8. Optimistic concurrency and idempotency (10)        | Version predicate; database-enforced uniqueness                                   | Real-PostgreSQL tests including a deterministic stale writer and concurrent idempotent inserts                                                                                           | ☐              |
| 9. drizzle-kit (11)                                   | Deferred                                                                          | Not adopted                                                                                                                                                                              | ☐              |
| 10. Database testing and CI (12)                      | Real PostgreSQL integration tests are mandatory evidence; CI job belongs to S0-10 | Local runs only; **no CI gate yet**                                                                                                                                                      | ☐              |
| 11. Reset safety (13)                                 | Local and test targets only                                                       | Code guard and negative tests, run before any connection                                                                                                                                 | ☐              |
| Security and dependencies (14)                        | 22 existing audit findings are not waived                                         | `pnpm audit --prod`: all in `apps/api` and `apps/web`, none in `@sdris/database`; **separate triage still pending**                                                                      | ☐              |

**Open points to read before approving**

- Decision 5 stays **CONDITIONAL until A2 is ACCEPTED**; the Owner should decide whether a shared transaction contract is ever
  wanted (A2.6 recommends waiting for a second context). If ADR-025 is accepted first, record Decision 5 as still conditional.
- Section 10 says a missing row may be distinguished from a stale version "where required"; today the adapter reports both as a
  conflict. The proposed policy (S0-05 persistence policy, section 6) distinguishes them.
- Section 17 follow-ups: CI (S0-10), Retrieval schema, audit/outbox/inbox/jobs ownership, dependency-vulnerability triage remain open.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED ☑ **APPROVED WITH CONDITIONS** (the Owner's wording; no change to the record's text is required)

Changes required: none (no change to the record's text is required).

Conditions and notes recorded by the Owner (non-text):

- Decision 5 remains CONDITIONAL, as written, until A2 becomes effective. This is the Owner's explicit record that ADR-025 takes effect with that condition open; it is satisfied later through A2's effective-policy record, not by editing ADR-025.
- Decision 7 (audit, outbox, atomic persistence) remains deferred; table ownership and workflow are not decided.
- OBL-SEC-1 (the 22 dependency advisories) remains open and is not waived; accepting ADR-025 is not security acceptance.

Owner statement, quoted from the project conversation of 2026-11-17:

> ADR-025 — APPROVED WITH CONDITIONS
> Accept the persistence architecture and migration governance.
> Decision 5 remains CONDITIONAL until A2 becomes effective.
> Decision 7 remains deferred.
> OBL-SEC-1 remains open and is not waived.

Approver (Engineering Owner): Engineering Owner, by explicit instruction in the project conversation (recorded by Claude Code). Date: 2026-11-17. Recorded in (link or commit): this checklist, section 1; commit `docs(adr): record the Owner decision on ADR-025`.

This records the decision only: ADR-025 stays PROPOSED until its Status commit (Approval workflow, Phase 3). No effective-policy record exists yet.

Status commit (subject `docs(adr): accept <record>`; its SHA is added by the step 4 commit): `bec73812e1509abc63ca275df282fddc1b4e35a0`

---

## 2. Amendment A1 — Persistence dependency policy for S0-05

Commits: `658bbf1`; fixes `b450740`, `83a5df1`, `986b65e`; rules `6491ca8`.

| Item                                                                                                                          | Evidence                                                                          | Owner confirms |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| Global Infrastructure (`infrastructure/*`) and Context Infrastructure (`modules/<context>/src/infrastructure/**`) terminology | `module-boundaries.md`                                                            | ☐              |
| Rule 1: Drizzle and `@sdris/database` only from allowlisted Context Infrastructure                                            | Fixtures 23 to 28e, 31 to 32c                                                     | ☐              |
| Rule 2: domain, application and public stay database-independent                                                              | Fixtures 27 to 27g                                                                | ☐              |
| Rule 3: dependencies point inward, full-path (as revised by A2)                                                               | Fixtures 29 to 29g and 51 to 51f; Codex finding on helper barrels confirmed fixed | ☐              |
| Rule 4: Global Infrastructure does not import business modules, no exception mechanism                                        | Invalid fixtures 25b and 30 to 30c                                                | ☐              |
| Rule 5: source path plus one central allowlist, no manifest system                                                            | `dependency-matrix.json` `contextInfrastructure` (Investigation only)             | ☐              |
| Rule 6: cross-context private-import restrictions unchanged                                                                   | Fixtures 32 to 32c, existing S0-03 fixtures                                       | ☐              |
| Rule 7: `@sdris/database` only through its published entrypoint                                                               | Fixtures 31 to 31d                                                                | ☐              |

**Open points:** directory names under `src/` carry architectural meaning (A1.5); intra-module layering beyond Rule 3 is not
covered; the Investigation allowlist entry was reviewed with the S0-05 adapter work, which the Owner's final approval authorised and which is merged; A1 itself remains PROPOSED.

**Sign-off**

Decision: ☑ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: none (no change to the record's text is required).

Owner statement, quoted from the project conversation of 2026-11-17:

> A1 — APPROVED
> Accept the persistence dependency policy and context infrastructure allowlist.

Approver (Engineering Owner): Engineering Owner, by explicit instruction in the project conversation (recorded by Claude Code). Date: 2026-11-17. Recorded in (link or commit): this checklist, section 2; commit `docs(adr): record the Owner decision on A1`.

This records the decision only: A1 stays PROPOSED until its Status commit (Approval workflow, Phase 3). No effective-policy record exists yet.

Status commit (subject `docs(adr): accept <record>`; its SHA is added by the step 4 commit): `e4b318b95660bc1e8ebaf0a2a3f092e7c3e9c5c3`

---

## 3. Amendment A2 — Dedicated composition entry point (revises A1 Rule 3)

Commits: `e605988` (rules), `a2d2a1f` (type surfaces), `938e1a8` (opaque handle), `6150498`, `1cd4530`, `841f70b` (ADR text).

| Item                                                                                                                                       | Evidence                                       | Owner confirms |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------- |
| **A2 revises A1 Rule 3**: `src/composition/**` may also import same-context infrastructure                                                 | Fixtures 29f and 29g still fail; V1 to V5 pass | ☐              |
| `src/composition/**` is a separate zone; only composition may import it                                                                    | Fixtures 40 to 40e, 51 to 51f                  | ☐              |
| Exactly one extra entrypoint, `@sdris/<context>/composition` to `src/composition/index.ts`                                                 | Fixtures 48 to 48e                             | ☐              |
| Only listed composition roots may import it (package and path); initial: `apps/api/src/composition/**` for Investigation, no `apps/worker` | Fixtures 44 to 47e; `compositionRoots` policy  | ☐              |
| Composition imports the database contract only as a type, never Drizzle                                                                    | Fixtures 41 to 42b                             | ☐              |
| Composition exposes factories and contracts, not adapters (including local re-exports)                                                     | Fixtures 43 to 43g                             | ☐              |
| Explicit factory return types; public type surface verified with the compiler and a real `.d.ts`                                           | `type-surface.mjs`, 30 tests, mutation checks  | ☐              |
| `PersistenceHandle` is opaque                                                                                                              | Unit tests and the non-opaque detection case   | ☐              |
| Decision 5 evaluation (A2.6) and the recommendation to keep a context-owned `TransactionScope`                                             | `persistence.md` section 8 and ADR-025 A2.6    | ☐              |

**Dependency:** A2 takes effect only after A1 is ACCEPTED (it revises A1 Rule 3); A2's own approval record states how A2.6 satisfies ADR-025 Decision 5's condition; ADR-025's text is not edited. **Open points:** one equivalent mutant (package check implied by the path check); type surfaces verify declared types, not
behaviour; each context currently owns its own `TransactionScope` copy; adapter tests must live under `src/infrastructure/**`.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED ☑ **APPROVED WITH CONDITIONS** (the Owner's wording; no change to the record's text is required)

Changes required: none (no change to the record's text is required).

Conditions and notes recorded by the Owner (non-text):

- A2 becomes effective only after A1 is accepted (an ordering condition, enforced by the order of the Phase 3 Status commits).
- A2.6 supplies the evaluation satisfying ADR-025 Decision 5 once A2 becomes effective; per the Approval workflow this is recorded in A2's section of the effective-policy file, and ADR-025 is not edited.

Owner statement, quoted from the project conversation of 2026-11-17:

> A2 — APPROVED WITH CONDITIONS
> Accept the dedicated composition entry point and revision to A1 Rule 3.
> A2 becomes effective only after A1 is accepted.
> A2.6 supplies the evaluation satisfying ADR-025 Decision 5 once A2 becomes effective.

Approver (Engineering Owner): Engineering Owner, by explicit instruction in the project conversation (recorded by Claude Code). Date: 2026-11-17. Recorded in (link or commit): this checklist, section 3; commit `docs(adr): record the Owner decision on A2`.

This records the decision only: A2 stays PROPOSED until its Status commit (Approval workflow, Phase 3). No effective-policy record exists yet.

Status commit (subject `docs(adr): accept <record>`; its SHA is added by the step 4 commit): `ac66482e95b958323cd4d46e6bb0141605e63e68`

---

## 4. Amendment A3 — Test-only entrypoints

Commits: `17f3ab6` (policy), `4af1348` (ADR text).

| Item                                                                                                              | Evidence                                                                  | Owner confirms |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------- |
| Central `testOnlyEntrypoints` policy; initially `@sdris/database` `./testing`                                     | `dependency-matrix.json`                                                  | ☐              |
| Only recognised test files (`*.test.*`, `*.spec.*`, `__tests__/`) and listed `approvedPaths` (none)               | Valid fixtures 30 to 30f (accept) and invalid fixtures 60 to 60p (reject) | ☐              |
| Protection covers the entrypoint **and the directory behind it**                                                  | Fixtures 60k, 60l                                                         | ☐              |
| Covers package name, subpath, alias, re-export, dynamic import, require, type-only, relative path, self-reference | Fixtures 60 to 60m                                                        | ☐              |
| No separate testing workspace package                                                                             | Scope statement                                                           | ☐              |

**Open points:** "recognised test file" is a naming convention, so a production file named `*.test.ts` would pass; the helper
still ships in the package's `dist` as a published entrypoint (clarified in the A3 and A4 text: A3 restricts imports, not
physical inclusion).

**Sign-off**

Decision: ☑ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: none (no change to the record's text is required).

Conditions and notes recorded by the Owner (non-text):

- Scope note: the restrictions do not imply runtime isolation or exclusion from compiled dist output.

Owner statement, quoted from the project conversation of 2026-11-17:

> A3 — APPROVED
> Accept the test-only entrypoint restrictions.
> These restrictions do not imply runtime isolation or exclusion from compiled dist output.

Approver (Engineering Owner): Engineering Owner, by explicit instruction in the project conversation (recorded by Claude Code). Date: 2026-11-17. Recorded in (link or commit): this checklist, section 4; commit `docs(adr): record the Owner decision on A3`.

This records the decision only: A3 stays PROPOSED until its Status commit (Approval workflow, Phase 3). No effective-policy record exists yet.

Status commit (subject `docs(adr): accept <record>`; its SHA is added by the step 4 commit): `66b24159ed297929e880ec1ec0722909b2052ecc`

---

## 5. Amendment A4 — Compiled runtime packaging

Commits: `02bc8a3`, `7889c29`, `994dc46`, `4af1348` (ADR text).

| Item                                                                                                                                      | Evidence                                                     | Owner confirms |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------- |
| `shared-kernel`, `database`, `investigation` build independently with `tsc` to `dist/`                                                    | `tsconfig.build.json` files; `pnpm build`                    | ☐              |
| Entrypoints are `{ sdris-source, types, default }`; `main`, `types`, `typesVersions` and the entrypoint set unchanged                     | Manifests                                                    | ☐              |
| The checker requires `types` and `default` to be the exact dist mirror, rejects other conditions                                          | Fixtures 40 and 70 to 70i                                    | ☐              |
| Repository tooling resolves source (`tsx --conditions`, `customConditions`, workspace `paths` for type surfaces) and needs no prior build | `pnpm test` and `typecheck` pass from a clone with no `dist` | ☐              |
| Plain-Node smoke test against real PostgreSQL, no tsx                                                                                     | `pnpm test:runtime`, 4 tests, mutation-checked               | ☐              |

**Open points / trade-offs:** each package needs a build before running outside `tsx`; the source condition must be passed
wherever source resolution is wanted; the API itself is still started with `tsx` in development; no bundling or publish
pipeline; the smoke test needs PostgreSQL (not in CI until S0-10).

**Sign-off**

Decision: ☑ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: none (no change to the record's text is required).

Conditions and notes recorded by the Owner (non-text):

- Scope note: production deployment readiness is not implied.

Owner statement, quoted from the project conversation of 2026-11-17:

> A4 — APPROVED
> Accept the compiled runtime packaging policy.
> Production deployment readiness is not implied.

Approver (Engineering Owner): Engineering Owner, by explicit instruction in the project conversation (recorded by Claude Code). Date: 2026-11-17. Recorded in (link or commit): this checklist, section 5; commit `docs(adr): record the Owner decision on A4`.

This records the decision only: A4 stays PROPOSED until its Status commit (Approval workflow, Phase 3). No effective-policy record exists yet.

Status commit (subject `docs(adr): accept <record>`; its SHA is added by the step 4 commit): `218bb6157f32f20954804740f0be388cb2c40b24`

---

## 6. S0-05 Domain Specification

Commit: `0252689`. **The Engineering Owner approved this specification WITH CHANGES** (Q1) in the
[final approval v1.0](../specs/S0-05-final-owner-approval.md), which supersedes every earlier approval draft and addendum.
The specification, the register, the persistence policy and the removal plan are updated to it; the register's
[consistency check](../specs/S0-05-owner-decision-register.md) lists the contradictions found and resolved, and its
traceability table maps each decision to implementation and tests. Domain approval does not approve any ADR (final approval
section 6): the gates below concern the ADRs and the final acceptance.

| Gate before approval                                                                                   | State                                                                                                                                                                                       | Owner confirms |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| All ten questions answered in the register                                                             | done (final approval v1.0)                                                                                                                                                                  | ☑              |
| The answers written into the specification, register, persistence policy and removal plan              | done, contradictions checked                                                                                                                                                                | ☐              |
| Scope confirmed: UUT, TestAttempt, InvestigationCase, CaseTestAttemptLink; FailureObservation deferred | done (Q8)                                                                                                                                                                                   | ☑              |
| Removal plan for FailureObservation approved (Q8)                                                      | done, executed (`4425dca`)                                                                                                                                                                  | ☑              |
| Persistence and identity policy approved (no implicit uniqueness or normalisation)                     | updated to the final approval                                                                                                                                                               | ☐              |
| ~~ADR-025 and A1 to A4 approved first (the specification section 6 depends on A1 and A2)~~             | **Historical condition, superseded by the final approval** (section 6 keeps the ADRs independent; the specification is already APPROVED WITH CHANGES). ADR decisions are tracked separately | n/a            |
| Acceptance criteria 1 to 12 still read correctly after the amendments                                  | open: Owner confirms                                                                                                                                                                        | ☐              |

**Separate tracks (each decided on its own record; none implies another):**

| Track                                     | State                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| S0-05 specification approval              | **Done** (APPROVED WITH CHANGES, final approval v1.0)                                                      |
| S0-05 architecture acceptance and closure | **Pending Owner** (acceptance record section 12; closure record gates, classification proposed)            |
| ADR-025 and A1 to A4, each individually   | **Independent**, tracked in sections 1 to 5 (snapshot at `a99699c`: PROPOSED; see each Status line)        |
| S0-06 start prerequisites                 | As listed in the [readiness summary](../specs/S0-06-readiness-summary.md), section 5; no earlier exception |

**State of the acceptance criteria:** 1 to 10 are met by the implementation and the merged evidence (criteria 7 and 8 by A4 and
A3); 11 is satisfied (the Codex review of the final head `2c11d93` reported no major issue, comment 6911729542); 12, the
Owner's architecture acceptance, is **pending**. The migration-governance condition of the final approval (section 4) is satisfied for the release state of `0002` by Owner
confirmation: **OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17)** (acceptance record section 8).

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

_Note: the Owner's decision on the specification is already recorded in the final approval v1.0, and the specification's own Status line was set in `814e8d3`. This block stays blank unless the Owner wants a separate sign-off here; the new workflow below applies to ADR-025 and A1 to A4 only._

---

## 7. S0-05 Architecture Acceptance and closure

Records: [acceptance record](../specs/S0-05-architecture-acceptance.md) and [closure record](../specs/S0-05-closure-record.md),
both DRAFT. Status ladder: IMPLEMENTATION MERGED (yes); TECHNICAL ACCEPTANCE RECOMMENDED (yes);
ARCHITECTURE ACCEPTANCE PENDING OWNER SIGN-OFF; CLOSURE PENDING.

**Proposed classification only — not yet confirmed by the Owner.** Proposed closure gates: G1 sign-off of the acceptance record;
G2 disposition of the four MINOR findings; G3 OPEN-1, which is **satisfied by the Owner's environment confirmation of 2026-11-17** (decision S0-05-OPEN-1; no waiver used; a
general acceptance sign-off would not have satisfied it); G4 this checklist refreshed. The ADR decisions above are tracked separately and are
proposed as **not** closure gates.

**Sign-off** (Engineering Owner only; not completed by this draft)

Architecture acceptance: ☐ ACCEPTED ☐ ACCEPTED WITH CONDITIONS ☐ NOT ACCEPTED

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

---

## Outstanding obligations (not approval gates)

| ID        | Obligation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Due                                  | State |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----- |
| OBL-SEC-1 | Security triage of the **22 production dependency advisories** (10 high, 10 moderate, 2 low, 0 critical, `pnpm audit --prod`, 2026-11-17; detail in the [decision package](ADR-025-decision-package.md) section 3.1): determine reachability, review patched versions and compatibility, record remediation or an **explicit Owner risk acceptance**, re-run the audit. No exemption exists, no framework upgrade has been performed, and any major-version upgrade needs separate Owner approval (`CLAUDE.md` section 4). | **Before any production deployment** | open  |

This is **not** an approval gate for ADR-025, A1 to A4, the S0-05 closure or S0-06. **Accepting an ADR is not security acceptance**
(ADR-025 section 14): approving any record in this checklist neither accepts nor waives these advisories.

---

## Approval workflow (authoritative)

Applies to ADR-025 and to each of A1 to A4. Fixed before it starts: the editorial corrections are committed (`07f1068`), and
**no approval is inferred** from anything in this repository. Every commit has one purpose; no commit mixes steps or records or
includes code.

**Order.** The Owner chooses the order of acceptance, subject to two dependencies only: ADR-025 may go first (Decision 5 then
stays CONDITIONAL), and **A2 only after A1 is ACCEPTED**. A3 and A4 are independent.

### Phase 0 - G-1 (resolved)

**G-1 is RESOLVED: the Engineering Owner approved Option A on 2026-11-17.** The ADR and each amendment are independently
governed records within one file; changing an individual amendment's Status line (and its mirrors) is a permitted lifecycle
transition even after ADR-025 is accepted; this does not permit editing previously accepted rules, rationale, constraints or
decision text, and a substantive change needs a new amendment or a superseding ADR. The conventions are recorded in the ADR
README by the commit `docs(adr): record G-1 amendment lifecycle interpretation`. G-1 therefore no longer blocks effective-policy
or Status commits; the prerequisites of Phase 1 and Phase 2 still apply.

### Phase 1 - record the Owner's decisions (all five, before any Status commit)

For each record R, one commit `docs(adr): record the Owner decision on <R>`, touching only R's sign-off block in this checklist,
filled from an **explicit, quoted Owner statement** (decision, conditions, approver, date, where recorded). The implementation
engineer never fills it unprompted. What happens next depends on the decision:

| Decision recorded     | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APPROVED              | R continues to Phase 3                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| APPROVED WITH CHANGES | The required changes are made in `docs/adr/`**before the first Status commit** (Phase 2), in a commit `docs(adr): apply the Owner's required changes to <R>`, and the Owner confirms in writing, in R's sign-off block, that they are satisfied. A condition that is not a text change must be satisfied before Phase 3, **or the Owner explicitly records that R takes effect with the condition open**, and R's effective-policy entry then states the open condition |
| REJECTED              | R stops: no effective-policy entry, no Status commit. The README has no REJECTED status value, so R stays PROPOSED unless the Owner separately decides how to mark it. Records that depend on R are re-opened (A2 depends on A1; ADR-025 Decisions 4 to 6 depend on A1 and A2) and cannot proceed                                                                                                                                                                       |

Because the ADR-025 file is frozen after its first Status commit, **all five decisions are recorded, and every required text
change applied, before the first Status commit.**

### Phase 2 - one-off preparation, before the first Status commit

1. The required changes of any APPROVED WITH CHANGES record, if any (see above).
2. **Snapshot wording (done in the governance-consistency commit):** the ADR-025 header line that listed the amendments as
   PROPOSED and the opening sentence of this checklist no longer state a status; they point to each record's own Status line, so
   no summary statement has to be maintained after a Status change (exact wording in decision package section 10.4).

### Phase 3 - for each accepted record R, in the Owner's order

| Step | Commit subject                                                | Touches only                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | `docs(adr): add the effective policy of <R>`                  | `docs/adr/ADR-025-effective-policy.md`: created by the first such commit, afterwards **append-only** (a new section per record, earlier sections never edited)                                                             |
| 3    | `docs(adr): accept <R>`                                       | **R's Status line** and the mirrors of that same value: the ADR README index row (ADR-025 only) and R's "Current status" cell in this checklist. Nothing else                                                              |
| 4    | `docs(adr): record the status commit of <R> in the checklist` | Only R's sign-off field "Status commit" (the SHA of step 3 cannot be known inside step 3). Always its own commit, made right after step 3 (rule 7 fixes the A1 and A2 sequence), never merged into another record's step 1 |

**Rules.**

1. **The effective-policy file is a traceability summary, not an ADR.** It has no Status of its own: each section takes effect
   only with the Status commit of the record it summarises ("in force from the Status commit of R; not in force before it"), so
   sections of different records legitimately have different effective dates. Its header states the document type, Decision
   Owner, Scope and Related documents. It says what is in force and under which conditions (for A2: after A1) and adds
   traceability, **never a new rule**. If it ever disagrees with the ADR text, the ADR text prevails.
2. **Accepted decision text is not edited.** After the first Status commit the ADR-025 file changes only by the Status line (and
   mirrors) of the record being accepted. A1 to A4 text is frozen from `07f1068` (plus any Phase 2 required changes). A change of
   substance afterwards needs a new ADR or a superseding revision, never an edit.
3. **Status mirrors are limited to step 3.** Apart from each record's own Status line and the two designated mirrors (the ADR
   README index row and the record's "Current status" cell in this checklist's table), every statement about a status is a
   **dated snapshot**: the acceptance record, the closure record, the readiness summary, the decision package and this
   checklist's prose included. Each record's Status line is authoritative, and status commits do not update snapshots.
4. **Decision 5.** Its historical wording stays CONDITIONAL in ADR-025 for good. A2.6 provides the evaluation. The condition is
   satisfied when A2 is in force, through A2's section of the effective-policy file. ADR-025 is never rewritten.
5. **Security.** Approving a record is not security acceptance; see OBL-SEC-1 above.
6. **S0-06 does not start** until the Engineering Owner has signed off the S0-05 acceptance and closed S0-05; there is no
   earlier exception. No merge or push is authorised by this checklist.
7. **A1–A2 controlled governance batch** (approved by the Engineering Owner). The A1 and A2 transitions are performed as exactly
   four commits, in this fixed order:
   1. the A1 Status transition commit (`docs(adr): accept A1`);
   2. the A1 Status commit SHA backfill commit (step 4 for A1);
   3. the A2 Status transition commit (`docs(adr): accept A2`);
   4. the A2 Status commit SHA backfill commit (step 4 for A2).

   These four commits constitute one controlled governance batch. **The A1 SHA backfill is the only permitted intervening commit
   between the A1 and A2 Status transitions.** No unrelated commits, deployments, releases or architectural changes may occur
   during the batch. A1 and A2 remain independently governed records, and each becomes effective only upon its own Status
   transition commit. The architecture checker already enforces the A2-expanded Rule 3; the temporary discrepancy between A1's
   effective policy and the checker's behaviour is acknowledged and is **not authorisation to activate A2 early**. If any step
   fails, stop and report the issue; do not skip, reorder or automatically repair the sequence. This rule does not change the
   approval dependencies of ADR-025, A3 or A4. The effective-policy commits of A1 and A2 (step 2) are already made and are not part
   of the batch.
