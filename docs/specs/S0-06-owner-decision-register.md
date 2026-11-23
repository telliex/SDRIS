# S0-06 — Owner Decision Register (v0.5, DRAFT — Owner Approval Candidate)

**Status:** DRAFT for Engineering Owner review, revised after two independent architecture reviews (first: REVISE, 1 BLOCKER, 5 MAJOR, 2 MINOR; second remediation verification: REVISE). The review reports themselves are not in the repository; see the remediation matrix. **No decision in this register is formally approved.** S0-06 implementation is **NOT STARTED** and is not authorised by this document.

- **Date:** 2026-11-22.
- **Reviewed baseline (pinned):** `main` at `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21`; the documents were reviewed at branch HEAD `24b73c8`. The reviewed SHA is **not** the integration SHA: each package is cut from an integration SHA that the Owner approves in the written authorization (section 8, item 4; specification front matter); drift is reported, never assumed absent.
- **Related:** [specification v0.4](S0-06-authentication-audit-foundation.md), [contract design review](../reviews/S0-06-contract-design-review.md), [remediation matrix](../reviews/S0-06-review-remediation.md), [implementation plan](../plans/S0-06-implementation-plan.md), [proposed Amendment A5](../adr/ADR-025-postgresql-persistence-architecture.md), [readiness summary](S0-06-readiness-summary.md), [S0-05 closure record](S0-05-closure-record.md), [follow-up register](S0-05-minor-follow-up.md).
- **History:** v0.3 (commit `b081641`) was the first committed version; no earlier committed register exists. v0.4 and v0.5 supersede earlier versions in place (v0.4: `3499d98`); the changes are listed in the remediation matrix.

## 1. Purpose

Record the design directions the Engineering Owner has communicated for S0-06, every decision that still needs a formal Owner decision before implementation, and the gate that keeps implementation blocked until those decisions are recorded in the repository (CLAUDE.md section 1: chat history is not a substitute for committed specifications).

## 2. Status vocabulary

| Label                       | Meaning                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Direction Confirmed**     | The Owner stated this direction for planning in a task message. It is not yet an approved, committed decision. |
| **Proposed**                | Claude Code's proposal. The Owner has not confirmed it.                                                        |
| **Pending Formal Approval** | Needs a recorded Owner decision (section 6) before it can govern implementation.                               |
| **Formally Approved**       | Recorded by the Owner in a committed document. **Nothing in this register has this status.**                   |

Evidence note: C1 to C10 come from the Owner's task message of 2026-11-22; C11 from the closure task that followed; C13 and C14 (and C12, added with the FU-3 revision) from the Owner's authorization of 2026-11-23 to apply findings G-1 to G-9. None is recorded in a committed approval file.

## 3. Confirmed design directions

| #   | Direction                                                                                                                                                                                              | Status                                  | Item          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------- |
| C1  | Phase 1 Audit scope is Investigation-only                                                                                                                                                              | Direction Confirmed                     | D4            |
| C2  | Investigation owns the Audit Writer, Persistence Contract and Audit Table                                                                                                                              | Direction Confirmed                     | D5            |
| C3  | The Audit Table belongs in PostgreSQL schema `investigation`                                                                                                                                           | Direction Confirmed                     | D5            |
| C4  | Authentication uses an isolated, trusted Synthetic Identity Provider for MVP/testing                                                                                                                   | Direction Confirmed                     | D3            |
| C5  | Authoritative State-change Audit records only successfully committed mutations                                                                                                                         | Direction Confirmed                     | D7            |
| C6  | Duplicate no-op, validation failure, concurrency conflict, unauthorized operation and rolled-back transactions create no successful State-change Audit record                                          | Direction Confirmed                     | D7            |
| C7  | FU-3 uses Option B: validate `expectedVersion` at the existing comparison position, preserving prior error precedence                                                                                  | Direction Confirmed                     | D8            |
| C8  | `expectedVersion` is a native JavaScript number, a safe integer, between 1 and 2147483647, with no implicit coercion                                                                                   | Direction Confirmed                     | D8            |
| C9  | Version exhaustion has an explicit error contract and the PostgreSQL `integer` column is not changed                                                                                                   | Direction Confirmed                     | D8            |
| C10 | S0-06 implementation remains NOT STARTED                                                                                                                                                               | Direction Confirmed                     | D9            |
| C11 | Investigation reads require authentication in S0-06 Stage 2 (the Owner's **proposed** direction, stated in the closure task; the resulting breaking read contract is **not approved** until confirmed) | Owner-proposed; Pending Formal Approval | D3, D8        |
| C12 | `invalid_expected_version` error details never contain the raw `expectedVersion` input, including finite numbers; deterministic reason codes only                                                      | Direction Confirmed                     | D8            |
| C13 | There is no alternative to Amendment A5: it must be ACCEPTED through the existing ADR workflow before the dependent packages (WP-04, WP-05)                                                            | Direction Confirmed                     | D5            |
| C14 | Implementation starts only from an integration SHA that the Owner approves in the written authorization (the reviewed SHA is not the default)                                                          | Direction Confirmed                     | D9, section 8 |

## 4. Decisions

"Blocks implementation" means no work package that depends on the decision may start before it is recorded.

### D1 — Specification baseline

- **Question:** What is the authoritative S0-06 specification? The approved Sprint 0 Blueprint (CLAUDE.md section 3) is not in the repository; the only in-repository statement is the title.
- **Status:** Pending Formal Approval. **Blocks implementation: yes (all packages).**
- **Proposed resolution:** the Owner designates [specification v0.4](S0-06-authentication-audit-foundation.md), after any revision the Owner requires, as **the authoritative alternative baseline** in place of the missing Blueprint section, **subject to Owner approval**. If the Blueprint section exists, the Owner commits it and the specification is reconciled against it; Claude Code does not infer its content. Until the Owner approves, the specification is a proposal and nothing in it is a requirement.
- **Resolves the planning contradiction:** the earlier plan treated the specification as both a baseline and an unapproved draft. From v0.4: the specification is the **proposed** baseline; it becomes the baseline only on the Owner's recorded D1 decision; every work package states that dependency (plan section 2).

### D2 — S0-05 conditional closure as an implementation prerequisite

- **Question:** the readiness summary lists "S0-05 closed" as a prerequisite and records that it is undecided whether CLOSED WITH CONDITIONS satisfies it and whether FU-3 must be resolved first.
- **Evidence:** S0-05 is CLOSED WITH CONDITIONS and ACCEPTED WITH CONDITIONS; FU-1 to FU-4 are Open and unscheduled; OBL-SEC-1 is open and not a gate.
- **Status:** Pending Formal Approval. **Blocks implementation: yes.**
- **Proposed resolution (subject to Owner approval):**
  1. Accept **S0-05 CLOSED WITH CONDITIONS as an implementation prerequisite** for S0-06 (previously "for planning and documentation only"; the earlier wording is withdrawn because it left the implementation gate undefined).
  2. **FU-3 is WP-01.** Its contract and verification (specification 7, stage 1) must be **completed and reviewed before any dependent mutation or audit integration** (WP-03, WP-05 and the `linkAttempt` part of WP-06).
  3. **FU-1, FU-2 and FU-4 stay separately tracked** in the follow-up register, unscheduled. FU-2 is an input to the WP-06 concurrency tests, not a dependency of any package.
  4. **OBL-SEC-1 stays a production-deployment obligation**; it is not a gate for S0-06, and S0-06 adds no dependency.
  5. A new production-deployment obligation **OBL-AUD-1** is proposed for the audit table: database privilege separation, DDL restrictions and an Owner decision on tamper-evidence, each with a stated verification (specification 4.7). It is not a gate and stays Pending Formal Approval.
- **Which packages may proceed independently of WP-01:** WP-02 (identity), WP-04 (audit schema and adapter) and the D5 amendment decision. **Blocked by WP-01:** WP-03 (it changes `linkAttempt`'s signature and must start from the finished FU-3 contract), WP-05 and WP-06.

### D3 — Authentication, actor identity, production isolation and reads

- **Direction:** C4. **Status:** direction Confirmed; the design is **Proposed**, Pending Formal Approval. **Blocks implementation: yes** (WP-02, WP-03, WP-05).
- **Proposed design (specification 2 and 3):** a trusted issuer under `apps/api/src/composition/identity/**` (an existing approved composition-root path; no allowlist change) mints an **opaque, frozen, member-less `ActorHandle`** registered in an issuer-private `WeakMap`; claims (actor `EntityRef` with a fixed UUIDv7, `actorKind`, a frozen flat permission array, `issuedAt`, `expiresAt`) never leave the issuer; the service resolves the handle through an injected `ActorResolver` port and receives a fresh deep-frozen copy; expiry uses the issuer's trusted injected clock; handles are reusable until expiry, revocable, process-local; a foreign-issuer or forged handle is `unauthenticated`; authentication and authorization run **before** the transaction is created, inside the service, so direct calls are covered.
- **Production isolation (specification 3.2):** positive-match configuration (`SDRIS_ENV` exactly `local` or `test`, `NODE_ENV` not `production`, disposable local database), fail closed on missing or invalid values, no credential strings in Phase 1, per-process random credentials when HTTP arrives, production startup rejection tested at unit and compiled-runtime level, fixture principals excluded from the build output (recommended), issuer and fixture import restrictions as checker rules in WP-02, **no allowlist widening**, and `apps/worker` is not a composition root and gets no actor capability.
- **Reads (C11):** the Owner's proposed direction is that reads require authentication in Stage 2. Proposed contract (specification 3.3): **Result-based** reads returning `Promise<Result<X | undefined, AccessError>>` with a leading `RequestContext`, permission `investigation.read`, absence kept as `ok(undefined)`, no audit record, rejections to the Security Log. The exception-based alternative and a silent-`undefined` alternative are rejected with reasons in 3.3. **This is a breaking contract change and is not approved** until the Owner confirms it; Stage 1 (FU-3) leaves the reads unchanged. Caller inventory: specification 3.3 and 7.6. If the Owner **defers** read authentication instead, the exposure boundary of specification 3.3 applies (read-only facade, no network exposure, no controller or provider injection, two tests); that alternative is not recommended.
- **Resolver, TTL and order (specification 2.4, 2.7):** a typed resolver outcome (`valid`, `missing`, `invalid`, `expired`, `revoked`) kept internal; handle TTL **15 minutes** (proposed value) with expiry at `now >= expiresAt`; revocation permanent and checked per command; exactly one Security Log event per rejected call; one canonical order for every document: **Authentication → Correlation Validation → Authorization → Domain Validation → Transaction**.
- **Startup entrypoint (specification 3.2):** the actual approved composition entrypoint is `composeInvestigation` in `apps/api/src/composition/investigation.composition.ts`. `apps/api/src/main.ts` does not call it today, so the refusal is verified at that entrypoint (paired positive and negative tests that fail specifically with `SYNTHETIC_IDENTITY_FORBIDDEN`); a process exit is claimed only if `main.ts` is wired, which is not in scope unless the Owner asks. Fixture principals are excluded from the production build; the earlier static-token recommendation is withdrawn.
- **Risk:** an environment variable is not a boundary against a hostile operator; TypeScript brands do not stop in-process forgery, the registry and the import rules do.

### D4 — Investigation-only Audit scope

- **Direction:** C1. **Status:** Direction Confirmed; the command list is **Proposed**: `registerUut`, `registerTestAttempt`, `openCase`, `linkAttempt`. Reads are not audited in Phase 1.
- **Blocks implementation:** yes (WP-04, WP-05). **Risk:** other contexts will need audit; no shared audit package is introduced.

### D5 — Investigation-owned Audit and schema (ADR-025 Decision 7)

- **Direction:** C2, C3.
- **Conflict:** ADR-025 Decision 7 (accepted) defers concrete audit table ownership ("Those belong to subsequent approved tasks"). C2 and C3 decide it for Investigation.
- **Proposed resolution:** the **narrow proposed Amendment A5** drafted in the ADR-025 file (Status **PROPOSED**) records Investigation-only audit ownership, the `investigation` schema, committed-state-change semantics and same-transaction persistence, and lists what stays deferred. Decision 7's wording is preserved and not edited. The Owner decides A5 through the ADR approval workflow; Claude Code does not change any Status, the effective-policy file or any mirror. There is **no alternative** to A5 (C13). Until A5 is accepted, WP-04 and WP-05 must not start.
- **Status:** Direction Confirmed; the record is **Pending Formal Approval**. **Blocks implementation: yes** (WP-04, WP-05).
- **Allowlist check (verified):** `@sdris/investigation` infrastructure is already allowed `@sdris/database` and `drizzle-orm`; no allowlist change is needed. The S0-05 constraint against a cross-context transaction framework is not triggered (single context).

### D6 — Transaction boundary and audit persistence contract

- **Status:** **Proposed**; Pending Formal Approval. **Blocks implementation: yes** (WP-04, WP-05).
- **Correction of v0.3:** the earlier text integrated the audit adapter through `executorFor(db, tx)`. The Investigation module never holds a database object. The actual, compatible design is `PersistenceHandle` + `executorOf(handle, tx)` + the existing `TransactionScope` (`PersistenceTransactionScope` over `unitOfWorkOf(handle).run`). The audit adapter **requires** an active transaction token and throws explicitly when it is missing, because `executorOf(handle)` without a token returns the pool; unknown or ended tokens already throw `TransactionContextError` and must propagate (specification 4.2). Drizzle and ORM types stay inside `src/infrastructure/**`.
- **Token contract (specification 4.2):** `AuditWriter` is an internal port; it requires the token of the current `transactions.run` callback; missing tokens are rejected by the adapter, unknown and ended tokens by the existing infrastructure; **the infrastructure does not enforce handle-to-token provenance** and this is not claimed (guaranteed by construction and tests). **Cutover and recovery (specification 6):** apply and verify the schema; stop, drain or fence every pre-activation writer; verify that no old writer can commit (an allowlist check on `pg_stat_activity` by `application_name`, plus a completeness query that is never back-filled); activate; verify mandatory audit before accepting writes; fail closed afterwards. Recovery is a working audit-capable build or held writes; restoring an unaudited build needs fencing, a written Owner decision, an incident record and reconciliation. **Unknown create outcomes:** the correlation id is only a search aid, the specific operation must be identified, and without proof the outcome stays UNKNOWN for an operator, with no automatic retry. Setting `application_name` needs a small database-package change; without it the fence is operational only and the Owner must accept the residual risk (an open question).
- **Decision 5 wording:** ADR-025 Decision 5 stays **CONDITIONAL in its own text for good**. Its condition is **satisfied through the A2 section of the effective-policy file** (A2 is accepted; A2.6 is the evaluation). v0.3's phrase "CONDITIONAL until A2 is effective" is withdrawn as stale: this work is a second use of the Investigation-owned `TransactionScope` and does not reopen Decision 5.
- **Risk:** a missing or broken audit table makes every mutation fail; this is intended and needs the Owner's confirmation.

### D7 — Successful State-change Audit semantics and rejected operations

- **Direction:** C5, C6. **Status:** Direction Confirmed; the outcome table (specification 5) is **Proposed**. **Blocks implementation: yes** (WP-05).
- **Gap and proposal:** C6 does not say where rejected operations are recorded. Proposed: a **Security Log** (structured log through an Investigation port, not a database table) with the contract in specification 4.7: closed event and reason sets, redaction, credential-failure logging as a reason code only, operator-only access, retention left open, and **sink failure never changes the command result**. A security-event table is **not** proposed and would need separate approval. The Owner decides whether non-authoritative denial records are acceptable (AGENTS.md says SDRIS owns its audit trail). Responsible layers (specification 4.7, 2.10): the Investigation application service, through an injected `SecurityLog` port, for calls without a valid handle; the **issuer**, through an injected event sink, for refusals before any handle exists (unknown principal key, forbidden synthetic issuance, bad credential), exactly one `security.issuance_refused` event per refusal. Metadata provenance (`source` fixed by the composition root, `correlationId` strict UUID form, `causationId` null in Phase 1, `details` from validated ids only): specification 4.6.

### D8 — FU-3 runtime validation, version exhaustion and public contract

- **Direction:** C7, C8, C9. **Status:** Direction Confirmed; the exact contracts are **Proposed** (specification 7). **Blocks implementation: yes** (WP-01).
- **Contents:** codes `investigation.invalid_expected_version` and `investigation.version_exhausted` with deterministic `details` that **never contain the raw `expectedVersion` input, including finite numbers** (C12); the precedence Authentication → Correlation Validation → Authorization → Role (Domain Validation) → Transaction → Case → Attempt → Same-UUT → Runtime Version Validation → Version Comparison → Duplicate Detection → Version Exhaustion → Save → Audit; both shapes of the existing `concurrency_conflict` payload preserved (service: `expectedVersion` and `actualVersion`; repository race: `expectedVersion` only); **stage 1** (existing service plus FU-3, additive) distinguished from **stage 2** (authenticated integration, breaking); the compatibility inventory for `InvestigationServiceError`, direct callers, factory callers, exhaustive handlers (none found in the repository) and compiled-runtime consumers.
- **Owner approval needed as a public-contract change** (CLAUDE.md section 12): stage 1 additive, stage 2 breaking.

### D9 — Verification and acceptance gates

- **Status:** **Proposed**; Pending Formal Approval. The **requirements are defined before implementation** (below); **final evidence is collected in WP-06**.
- **Sequence:** the acceptance criteria are **approved by the Owner before implementation**; the evidence for each is **produced during implementation** in the package named in specification 8 and **consolidated in WP-06**; the reviewed SHA is not automatically the integration SHA. **Requirements, fixed before implementation:** acceptance criteria AC-1 to AC-13 (AC-13 only if C11 is confirmed) (specification 8); all persistence evidence on real PostgreSQL; `pnpm check:structure`, `lint`, `format:check`, `typecheck`, `test`, `build`, `check:architecture`, `db:test` and the compiled-runtime test pass; no allowlist widening; `0001` and `0002` checksums unchanged; S0-05 regression green; each package records the integration base SHA (front matter rule) and reports actual command results, never an unexecuted pass; one Codex review of the final head per package group (cadence is the Owner's choice). CI for the PostgreSQL tests is still S0-10, so all results are local.
- **Blocks implementation: yes.** The D9 requirements must be approved by the Owner before **any** package starts (section 8, item 1); this is the same condition as the start gate. What is deferred is only the **evidence**: it is produced during implementation and consolidated in WP-06, and WP-06 cannot close without it.

## 5. Dependencies and parallelism

```text
D1, D2 ──> every package            D5 (A5 accepted) ──> WP-04, WP-05
WP-01 (FU-3 stage 1) ──────────────> WP-03, WP-05, WP-06
WP-02 (identity)  ──> WP-03 ──────> WP-05 ──> WP-06
WP-04 (audit schema) ─────────────> WP-05
Independent of WP-01: WP-02, WP-04.   Blocked by WP-01: WP-03, WP-05, WP-06.
```

## 6. Owner approval requirements

Each item needs one block recorded in a committed file. Claude Code cannot fill it in.

| Item | Decision (APPROVED / APPROVED WITH CHANGES / REJECTED / DEFER)  | Owner | Date | Notes |
| ---- | --------------------------------------------------------------- | ----- | ---- | ----- |
| D1   | _unrecorded_                                                    |       |      |       |
| D2   | _unrecorded_                                                    |       |      |       |
| D3   | _unrecorded_ (including reads and the fixture-exclusion choice) |       |      |       |
| D4   | _unrecorded_                                                    |       |      |       |
| D5   | _unrecorded_ (A5 through the ADR workflow)                      |       |      |       |
| D6   | _unrecorded_                                                    |       |      |       |
| D7   | _unrecorded_                                                    |       |      |       |
| D8   | _unrecorded_                                                    |       |      |       |
| D9   | _unrecorded_                                                    |       |      |       |

## 7. Architecture risks

| Risk                                                                   | Where | Mitigation proposed                                                                                 |
| ---------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| ADR-025 Decision 7 defers audit ownership; C2/C3 decide it             | D5    | Proposed Amendment A5, decided by the Owner before WP-04                                            |
| Error codes extend the exported union; stage 2 changes signatures      | D8    | Owner approval as a public-contract change; stage 1 and 2 never mixed                               |
| Audit adapter silently using the pool when no transaction is given     | D6    | Explicit `AuditTransactionRequiredError`; tests with missing and ended tokens                       |
| Fail-closed audit makes the audit table a hard availability dependency | D6    | Owner confirmation; startup readiness check; recovery rules                                         |
| Rollback to an unaudited build                                         | D6    | Declared not a recovery path                                                                        |
| Forged actor context from in-process code                              | D3    | Opaque handle, issuer registry, import rules, no claims on the handle                               |
| Synthetic issuer in a production package                               | D3    | Positive-match fail-closed configuration; startup rejection tests; fixtures excluded from the build |
| Denied operations leave no authoritative record                        | D7    | Security Log contract; Owner decision                                                               |
| Audit mutated by a privileged role or trigger bypass                   | D5    | Triggers incl. TRUNCATE for bugs; OBL-AUD-1 for roles, DDL, tamper-evidence                         |
| Migration `0003` touches table lists in existing tests                 | WP-04 | Update `migrations.integration.test.ts` and `migrations.spec.ts` in WP-04; `0001`/`0002` untouched  |
| Audit and domain timestamps diverge                                    | D6    | One clock reading per command; per-operation persisted-timestamp equality tests                     |
| Version column cannot grow past 2147483647                             | D8    | Explicit `version_exhausted`; column unchanged                                                      |

## 8. Implementation authorization gate

Implementation of any S0-06 work package may start only when **all** hold in the repository:

1. The Owner decisions D1 to D8 are APPROVED or APPROVED WITH CHANGES, and D9's requirements are approved.
2. The Owner has authorised implementation of S0-06 or of a named package, in writing.
3. For WP-04 and WP-05: Amendment A5 is **ACCEPTED** through the existing ADR workflow (approval-checklist decision, effective-policy section, separate Status commit) **before** either package starts or depends on it. **There is no alternative to A5** (C13). D1 and D2 remain subject to Owner approval and are not implied by any other item.
4. The written authorization names the **integration SHA approved by the Owner** (C14). The reviewed baseline `ae7dc51` is not that SHA by default. Before the branch is cut, the implementer verifies that `ae7dc51` is an ancestor of the approved SHA, that the approved SHA is an ancestor of or equal to the current `origin/main` tip, and diffs the files named in the specification front matter between `ae7dc51` and the approved SHA. Any difference, and any movement of `origin/main` since the approval, goes to the Owner for re-approval or written confirmation. The branch is cut **from the approved SHA, not from "the current main"**, and the working tree is clean.

**Gate state at the date of this register: CLOSED.** None of 1 to 4 is satisfied. S0-06 is NOT STARTED.
