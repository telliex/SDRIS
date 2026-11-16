# ADR-025 and S0-05 — Engineering Owner Approval Checklist

**Status of this checklist:** a working document for the Engineering Owner. It records evidence and open points; it
approves nothing. **No document below is marked ACCEPTED.** A document changes status only after the Engineering Owner's
explicit written approval is recorded in that document's sign-off block below, and the status change is then made in its own
commit.

**Documents covered**

| #   | Document                                                               | Current status | Where                                                                       |
| --- | ---------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| 1   | ADR-025 — PostgreSQL Persistence Architecture and Migration Governance | PROPOSED       | [ADR-025](ADR-025-postgresql-persistence-architecture.md), sections 1 to 17 |
| 2   | Amendment A1 — Persistence dependency policy for S0-05                 | PROPOSED       | same file, "Proposed Amendment A1"                                          |
| 3   | Amendment A2 — Dedicated composition entry point (revises A1 Rule 3)   | PROPOSED       | same file, "Proposed Amendment A2"                                          |
| 4   | Amendment A3 — Test-only entrypoints                                   | PROPOSED       | same file, "Proposed Amendment A3"                                          |
| 5   | Amendment A4 — Compiled runtime packaging                              | PROPOSED       | same file, "Proposed Amendment A4"                                          |
| 6   | S0-05 Domain Specification                                             | PROPOSED       | [specification](../specs/S0-05-investigation-aggregate-foundation.md)       |

ADR-024 is outside this checklist (also PROPOSED). Supporting documents: the
[gap analysis](../specs/S0-05-gap-analysis.md), the
[Owner Decision Register](../specs/S0-05-owner-decision-register.md), the
[proposed persistence policy](../specs/S0-05-proposed-persistence-policy.md) and the
[FailureObservation removal plan](../specs/S0-05-failureobservation-removal-plan.md).

**Suggested approval order:** 1, then 2, then 3 (A2 revises A1 Rule 3, so A1 and A2 should be read together), then 4 and 5,
then 6 last (the specification also needs the register decisions and refers to A1 and A2).

**Governance questions for the Owner (decide before approving)**

- [ ] Are accepted amendments folded into the ADR-025 text, or kept as named amendments? (Today they sit in the same file,
      each with its own Status line.)
- [ ] Does approving ADR-025 leave the amendments PROPOSED until each is approved separately? (Recommended: yes.)

**Evidence baseline (fresh clone at `4af1348`):** `check:structure`, `check:architecture` (0 violations, 10 public type
surfaces), `lint`, `format:check`, `typecheck`, `build` exit 0; `pnpm test` 261 root plus 60, 31, 12 and 1 per workspace;
`pnpm db:test` against real PostgreSQL: database 53, API chain 17, compiled runtime 4; migration checksums of `0001` and `0002`
equal the recorded ones. No CI exists yet (S0-10), so all results are local.

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

- Decision 5 stays conditional; the Owner should decide whether a shared transaction contract is ever wanted (A2.6 recommends
  waiting for a second context).
- Section 10 says a missing row may be distinguished from a stale version "where required"; today the adapter reports both as a
  conflict. The proposed policy (S0-05 persistence policy, section 6) distinguishes them.
- Section 17 follow-ups: CI (S0-10), Retrieval schema, audit/outbox/inbox/jobs ownership, dependency-vulnerability triage remain open.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in (link or commit): ______________

Status line updated in commit: ______________ (only after this block is complete)

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
covered; the Investigation allowlist entry is authorised by the S0-05 adapter work, which is itself unapproved.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

Status line updated in commit: ______________

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

**Open points:** one equivalent mutant (package check implied by the path check); type surfaces verify declared types, not
behaviour; each context currently owns its own `TransactionScope` copy; adapter tests must live under `src/infrastructure/**`.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

Status line updated in commit: ______________

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
still ships in the package's `dist` as a published entrypoint.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

Status line updated in commit: ______________

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

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

Status line updated in commit: ______________

---

## 6. S0-05 Domain Specification

Commit: `0252689`. **Blocked on the Owner Decision Register** (Q1 to Q10).

| Gate before approval                                                                                   | State | Owner confirms |
| ------------------------------------------------------------------------------------------------------ | ----- | -------------- |
| All ten questions answered in the register                                                             | open  | ☐              |
| The answers written into the specification (amended specification committed)                           | open  | ☐              |
| Scope confirmed: UUT, TestAttempt, InvestigationCase, CaseTestAttemptLink; FailureObservation deferred | open  | ☐              |
| Removal plan for FailureObservation approved (Q8)                                                      | open  | ☐              |
| Persistence and identity policy approved (no implicit uniqueness or normalisation)                     | open  | ☐              |
| ADR-025 and A1 to A4 approved first (the specification section 6 depends on A1 and A2)                 | open  | ☐              |
| Acceptance criteria 1 to 12 still read correctly after the amendments                                  | open  | ☐              |

**Known gaps at this point:** UUT, TestAttempt and link are not implemented (acceptance 1 to 3); acceptance 11 (Codex review)
and 12 (Owner acceptance) are pending. Criteria 7 and 8 are met by A4 and A3.

**Sign-off**

Decision: ☐ APPROVED ☐ APPROVED WITH CHANGES ☐ REJECTED

Changes required: ______________________________________________

Approver (Engineering Owner): ______________ Date: __________ Recorded in: ______________

Status line updated in commit: ______________

---

## After approval

1. Record each decision in the sign-off block above and in the Owner Decision Register.
2. Commit the status change of **one document per commit** (`docs(adr): accept ...`), never together with code.
3. Implement S0-05 domain work only after the specification and the register are approved.
4. After implementation and the final commits, confirm the PR head SHA and trigger one `@codex review` for it.
5. Stop for independent architecture acceptance; no automatic merge is authorised.
