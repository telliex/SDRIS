# S0-05 — Closure Record (DRAFT)

> **Status snapshot note (added 2026-11-17).** Statements in this document that ADR-025 and Amendments A1 to A4 are `PROPOSED` (or not yet accepted) describe the state when the document was written, **before** the status transitions of commits `bec7381` to `93baa76` (2026-11-17). They are dated snapshots and are not updated by status commits. **The current status of each record is its own `Status` line in `docs/adr/ADR-025-postgresql-persistence-architecture.md`** (ADR-025 also in the ADR README index). This note changes no other content and does not change this document's own status.

**Status:** DRAFT — **CLOSURE PENDING.** This record separates what has happened from what has only been recommended. It
closes nothing and records no Owner decision that the Owner has not made.

**Milestone:** S0-05 — Investigation Aggregate Foundation  
**Evidence:** [S0-05-architecture-acceptance.md](S0-05-architecture-acceptance.md)  
**Decisions:** [S0-05-final-owner-approval.md](S0-05-final-owner-approval.md) (v1.0)  
**ADR decisions:** [ADR-025 decision package](../adr/ADR-025-decision-package.md)

> **Update (2026-11-17):** PR #7 merged the approval checklist to `main` at `fec9c18`. The Engineering Owner agreed to G1–G4 as closure gates and to architecture acceptance with conditions. G4 was checked against the merged ADR Status lines and index. The four MINOR findings are deferred in [S0-05 MINOR follow-up](S0-05-minor-follow-up.md), with Claude Code as executor when requested and the Engineering Owner as reviewer; dates remain unscheduled. G2 is satisfied by the recorded disposition; closure remains pending the separate Owner closure decision. The table below preserves the earlier snapshot.

## 1. Status ladder

| Level                                          | State            | Basis                                                                                                                                                                        |
| ---------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTATION MERGED                          | **YES**          | PR #6 merged 2026-11-16T08:52:03Z, merge commit `f8bb094`, final implementation `2c11d93`; `main` tree equals the PR head                                                    |
| Merge authorised by the Engineering Owner      | **YES**          | Established fact, not re-examined by this record; the merge was performed by account `telliex`                                                                               |
| TECHNICAL ACCEPTANCE RECOMMENDED               | **YES**          | Implementation engineer's recommendation, based on executed commands on a fresh clone and the final-head Codex review; OPEN-1 is resolved by Owner confirmation (2026-11-17) |
| ARCHITECTURE ACCEPTANCE PENDING OWNER SIGN-OFF | **YES, pending** | The sign-off block of the acceptance record is empty; only the Engineering Owner can complete it                                                                             |
| CLOSURE PENDING                                | **YES, pending** | See the closure conditions in section 4                                                                                                                                      |

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
- The technical report cited here raised **no BLOCKER and no MAJOR finding about the code or architecture**. OPEN-1 (release state of `0002`) was a separate matter and is resolved by Owner confirmation (2026-11-17).

### Known MINOR findings (four)

| ID      | Finding                                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MINOR-1 | A concurrency test has an unbounded test-side retry loop (`investigation-links.integration.test.ts:757`); the service has no retry                                                 |
| MINOR-2 | Three concurrency tests (lines 680, 735, 750) are not lock-gated: they assert only invariants that must hold for any interleaving, but which interleaving occurs is not controlled |
| MINOR-3 | `expectedVersion` is not runtime type-validated; a non-integer yields `concurrency_conflict` (safe, no dedicated error)                                                            |
| MINOR-4 | `save` re-reads stored links to find the new one; passing the link explicitly would remove a query                                                                                 |

Informational items (naming of `externalExecutionReference`, the composition-level clock option, local-only results, the
published `0001` comment) are in the acceptance record, section 11.

### OPEN-1 (resolved)

| ID     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPEN-1 | **OPEN-1: RESOLVED — OWNER CONFIRMED (2026-11-17)**. Release state of migration `0002`: the Engineering Owner confirmed that SDRIS has used only personal local development databases and that no non-personal database environment applied `0002` (decision S0-05-OPEN-1). The merged `0002` (`b4914ddb…`) is retained; no corrective migration, reset or database modification is authorised. Scope: deployment history through 2026-11-17; reopen and reassess if contradictory evidence appears. This is not an Architecture Acceptance signature and does not close S0-05. |

## 4. Closure gates

**Owner-confirmed classification:** G1–G4 are the closure gates. The table below preserves the earlier snapshot; the current gate assessment follows it.

### 4.1 Proposed closure gates (all must be satisfied to close S0-05)

| #   | Gate                                                                                                                                                                                                                                                                                             | State                                                                                                                                                                                                                                                                                        | Owner            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| G1  | The Engineering Owner completes the sign-off block (section 12) of the [Architecture Acceptance record](S0-05-architecture-acceptance.md)                                                                                                                                                        | open                                                                                                                                                                                                                                                                                         | ☐                |
| G2  | The Owner decides what to do with the four MINOR findings: fix now, defer to a named task, or accept as is                                                                                                                                                                                       | open                                                                                                                                                                                                                                                                                         | ☐                |
| G3  | OPEN-1 is closed with evidence or by a separate waiver decision that amends final approval section 4 (see 4.3). A general acceptance sign-off (G1) does not satisfy G3. **Outcome: satisfied by the Owner's environment confirmation of 2026-11-17 (decision S0-05-OPEN-1); no waiver was used** | **done** (Owner confirmation, 2026-11-17)                                                                                                                                                                                                                                                    | ☑ (S0-05-OPEN-1) |
| G4  | The ADR-025 approval checklist reflects the merged state and current evidence                                                                                                                                                                                                                    | **content done**: refreshed in `a99699c`, OPEN-1 synchronised in the OPEN-1 resolution commit. **Not yet complete as a gate:** the documents are on the local branch `docs/s0-05-acceptance-closure` only (not pushed, no PR, not on `main`), and the Owner has not reviewed or confirmed G4 | ☐                |

**Current gate assessment (2026-11-17, on this local branch):**

| Gate | Assessment | Evidence |
| --- | --- | --- |
| G1 | Satisfied locally | Engineering Owner accepted with conditions in [architecture acceptance section 12](S0-05-architecture-acceptance.md). |
| G2 | Satisfied locally | The Owner deferred all four findings to the named tasks in [MINOR follow-up](S0-05-minor-follow-up.md). The tasks remain open and unscheduled. |
| G3 | Satisfied | OPEN-1 was resolved by the Owner's environment confirmation; reopen if contradictory evidence appears. |
| G4 | Satisfied | PR #7 merged the checklist to `main` at `fec9c18`; its current-status cells agree with the individual ADR Status lines and index. The Owner agreed to the gate after that check. |

The G1 and G2 records are currently on a local branch, not yet merged. The closure decision remains separate and has not been recorded.

### 4.2 Tracked separately, not proposed as closure gates

| #   | Item                                                                                                                                                      | Why it is not a gate                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | ADR-025 and Amendments A1 to A4 are decided **independently**, each by its own recorded approval ([decision package](../adr/ADR-025-decision-package.md)) | The final approval keeps them independent: S0-05 closure neither accepts nor requires them. The merged implementation does depend on the PROPOSED rules, which is a risk the Owner should weigh |
| T2  | The six outdated review threads on PR #6 (each finding fixed) are resolved or left                                                                        | Review housekeeping; the Codex result on the final head is already recorded                                                                                                                     |
| T3  | The sprint tracker or Blueprint, which is not in the repository, is updated by its owner                                                                  | Outside the repository                                                                                                                                                                          |
| T4  | CI for the PostgreSQL tests                                                                                                                               | Deferred to S0-10 by decision                                                                                                                                                                   |
| T5  | **OBL-SEC-1 — Dependency Security Triage** (section 4.4): the 22 production dependency advisories of the 2026-11-17 audit                                 | A separate obligation due before production deployment; not a gate for ADR approval, S0-05 closure or S0-06 implementation                                                                      |

If the Owner decides that T1 (or any other item) is also a gate, this table is the only place to change.

### 4.3 Waiver template for G3 option b (not used: OPEN-1 was resolved by Owner confirmation)

A waiver changes the condition set by final approval section 4 ("verify the deployment and migration history, confirm no shared
environment depends on the existing checksum, record the evidence"). It is therefore recorded as its **own decision**, not as
part of the acceptance sign-off, and states all of the following. This draft fills in none of it.

| Item                                                                                         | Owner entry |
| -------------------------------------------------------------------------------------------- | ----------- |
| Unverified scope (which environments, which dates, what could not be checked)                |             |
| Disposition (for example: proceed, or verify later by a named person before a named event)   |             |
| Limitations and compensating controls (for example: no shared environment is known to exist) |             |
| Decision, approver (Engineering Owner), date, where recorded                                 |             |

### 4.4 OBL-SEC-1 — Dependency Security Triage

An outstanding obligation, **tracked separately from the closure gates** and not a gate for them.

| Item              | Record                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finding           | **22 advisories** reported by the 2026-11-17 production dependency audit (`pnpm audit --prod`): 10 high, 10 moderate, 2 low, 0 critical; none in a persistence package. Detail: [decision package](../adr/ADR-025-decision-package.md) section 3.1 |
| Disposition today | **No security risk acceptance or waiver has been granted.** The advisories are neither accepted as safe nor exempted; no framework upgrade has been performed                                                                                      |
| Requirement       | Security triage is **required before production deployment** (ADR-025 section 14): reachability, patched versions and compatibility, remediation or an explicit Owner risk disposition, and a re-run of the audit                                  |
| Relation to gates | **Not a gate** for ADR approval, S0-05 closure or S0-06 implementation; approving an ADR or closing S0-05 is not security acceptance                                                                                                               |
| Tracking          | Remediation or an explicit risk disposition is tracked separately (approval checklist, "Outstanding obligations", `OBL-SEC-1`); any major-version upgrade needs separate Owner approval (`CLAUDE.md` section 4)                                    |
| State             | **Open**                                                                                                                                                                                                                                           |

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
