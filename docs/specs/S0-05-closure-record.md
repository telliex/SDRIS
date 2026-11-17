# S0-05 — Closure Record (DRAFT)

**Status:** DRAFT — **CLOSURE PENDING.** This record separates what has happened from what has only been recommended. It
closes nothing and records no Owner decision that the Owner has not made.

**Milestone:** S0-05 — Investigation Aggregate Foundation  
**Evidence:** [S0-05-architecture-acceptance.md](S0-05-architecture-acceptance.md)  
**Decisions:** [S0-05-final-owner-approval.md](S0-05-final-owner-approval.md) (v1.0)  
**ADR decisions:** [ADR-025 decision package](../adr/ADR-025-decision-package.md)

## 1. Status ladder

| Level                                          | State                               | Basis                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTATION MERGED                          | **YES**                             | PR #6 merged 2026-11-16T08:52:03Z, merge commit `f8bb094`, final implementation `2c11d93`; `main` tree equals the PR head                                               |
| Merge authorised by the Engineering Owner      | **YES**                             | Established fact, not re-examined by this record; the merge was performed by account `telliex`                                                                          |
| TECHNICAL ACCEPTANCE RECOMMENDED               | **YES, with one NOT VERIFIED item** | Implementation engineer's recommendation, based on executed commands on a fresh clone and the final-head Codex review; OPEN-1 (release state of `0002`) is NOT VERIFIED |
| ARCHITECTURE ACCEPTANCE PENDING OWNER SIGN-OFF | **YES, pending**                    | The sign-off block of the acceptance record is empty; only the Engineering Owner can complete it                                                                        |
| CLOSURE PENDING                                | **YES, pending**                    | See the closure conditions in section 4                                                                                                                                 |

## 2. What was delivered

UUT, TestAttempt, InvestigationCase (aggregate root owning its links) and CaseTestAttemptLink in the Investigation context,
persisted in the `investigation` schema by migration `0002`; `linkAttempt` with a mandatory `expectedVersion`; an injected
application clock; FailureObservation removed after its proofs were re-expressed on links; the architecture rules A1 to A4
as executable checks; a compiled-runtime smoke test; the specification, decision register, persistence policy and removal
plan aligned to the Owner's final approval.

## 3. Technical acceptance evidence (summary)

- Fresh clone of `2c11d93`: `install --frozen-lockfile`, `check:structure`, `check:architecture` (17 packages, 10 public type
  surfaces, 0 notes), `lint`, `format:check`, `typecheck`, `build`, `test` (root 261, shared-kernel 60, database 31,
  investigation 38, api 1) all exit 0; `pnpm db:test` against PostgreSQL 16.14: database 53/53, API 43/43, compiled runtime
  4/4. Five repeated API runs: 43/43.
- Migration checksums: `0001` `c9add3b0…` (unchanged, equals `main`); `0002` `b4914ddb…`.
- Final-head Codex review (`2c11d93`): no major issues. Earlier findings were fixed (`ce44e01` for the last one).
- The technical report cited here raised **no BLOCKER and no MAJOR finding about the code or architecture**. That statement does not cover OPEN-1, which is NOT VERIFIED and is a separate matter.

### Known MINOR findings (four)

| ID      | Finding                                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MINOR-1 | A concurrency test has an unbounded test-side retry loop (`investigation-links.integration.test.ts:757`); the service has no retry                                                 |
| MINOR-2 | Three concurrency tests (lines 680, 735, 750) are not lock-gated: they assert only invariants that must hold for any interleaving, but which interleaving occurs is not controlled |
| MINOR-3 | `expectedVersion` is not runtime type-validated; a non-integer yields `concurrency_conflict` (safe, no dedicated error)                                                            |
| MINOR-4 | `save` re-reads stored links to find the new one; passing the link explicitly would remove a query                                                                                 |

Informational items (naming of `externalExecutionReference`, the composition-level clock option, local-only results, the
published `0001` comment) and the NOT VERIFIED item are in the acceptance record, section 11.

### NOT VERIFIED

| ID     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPEN-1 | Release state of migration `0002`. **Accepting the risk is a different decision from completing the verification; neither is implied by signing the acceptance record (G1).** The repository shows `0002` was not on `main` before PR #6 merged, but **no deployment or migration history of any shared, staging or production environment was available or checked**, which final approval section 4 asks to be verified and recorded. NOT VERIFIED. |

## 4. Closure gates

**Proposed classification: the Engineering Owner confirms which items are gates.** None of them is performed by this draft.

### 4.1 Proposed closure gates (all must be satisfied to close S0-05)

| #   | Gate                                                                                                                                                                                                                                                                                                                                                                                                                                   | State | Owner |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| G1  | The Engineering Owner completes the sign-off block (section 12) of the [Architecture Acceptance record](S0-05-architecture-acceptance.md)                                                                                                                                                                                                                                                                                              | open  | ☐     |
| G2  | The Owner decides what to do with the four MINOR findings: fix now, defer to a named task, or accept as is                                                                                                                                                                                                                                                                                                                             | open  | ☐     |
| G3  | OPEN-1 is closed in **one of two ways, each recorded explicitly**: (a) the Owner supplies the deployment and migration history showing that no shared or production environment applied an earlier `0002`, and the evidence is recorded; or (b) the Owner records a **separate waiver decision that expressly amends the condition of final approval section 4** (see 4.3). A general acceptance sign-off (G1) does **not** satisfy G3 | open  | ☐     |
| G4  | The ADR-025 approval checklist reflects the merged state and current evidence (refreshed in this branch, pending review and an authorised commit)                                                                                                                                                                                                                                                                                      | open  | ☐     |

### 4.2 Tracked separately, not proposed as closure gates

| #   | Item                                                                                                                                                      | Why it is not a gate                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | ADR-025 and Amendments A1 to A4 are decided **independently**, each by its own recorded approval ([decision package](../adr/ADR-025-decision-package.md)) | The final approval keeps them independent: S0-05 closure neither accepts nor requires them. The merged implementation does depend on the PROPOSED rules, which is a risk the Owner should weigh |
| T2  | The six outdated review threads on PR #6 (each finding fixed) are resolved or left                                                                        | Review housekeeping; the Codex result on the final head is already recorded                                                                                                                     |
| T3  | The sprint tracker or Blueprint, which is not in the repository, is updated by its owner                                                                  | Outside the repository                                                                                                                                                                          |
| T4  | CI for the PostgreSQL tests                                                                                                                               | Deferred to S0-10 by decision                                                                                                                                                                   |

If the Owner decides that T1 (or any other item) is also a gate, this table is the only place to change.

### 4.3 If the Owner chooses to waive the verification (G3 option b)

A waiver changes the condition set by final approval section 4 ("verify the deployment and migration history, confirm no shared
environment depends on the existing checksum, record the evidence"). It is therefore recorded as its **own decision**, not as
part of the acceptance sign-off, and states all of the following. This draft fills in none of it.

| Item                                                                                         | Owner entry |
| -------------------------------------------------------------------------------------------- | ----------- |
| Unverified scope (which environments, which dates, what could not be checked)                |             |
| Disposition (for example: proceed, or verify later by a named person before a named event)   |             |
| Limitations and compensating controls (for example: no shared environment is known to exist) |             |
| Decision, approver (Engineering Owner), date, where recorded                                 |             |

## 5. Explicitly deferred or out of scope

- **CI** for PostgreSQL integration tests remains deferred to **S0-10**; every result here is local.
- **S0-06 is not started and is not planned for start by this record.** Audit trail and authentication (S0-06); API contracts (S0-07); fixtures and golden harness (S0-08, S0-09).
- FailureObservation, Evidence, Diagnostics, Repair, RCA and AI workflows.
- Case lifecycle states, authoritative test results, automatic UUT matching, cross-context transactions.
- HTTP controllers for the Investigation context; HTTP mapping of the error codes.

## 6. Operational notes

- A developer database created from an earlier `0002` draft reports `modified`; run `pnpm db:reset` on the local, disposable
  database. Never reset a shared or production database.
- The Codex review is available only through the PR comment `@codex review`; its result may arrive as a PR comment
  (receipt) rather than a PR review.

## 7. Sign-off

Closure decision: ☐ CLOSED ☐ CLOSED WITH CONDITIONS ☐ NOT CLOSED

Conditions: ______________________________________________

Engineering Owner: ______________ Date: __________ Recorded in (link or commit): ______________
