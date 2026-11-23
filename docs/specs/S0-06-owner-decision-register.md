# S0-06 — Owner Decision Register (v0.3, DRAFT)

**Status:** DRAFT for Engineering Owner review. **No decision in this register is formally approved.** S0-06 implementation is **NOT STARTED** and is not authorised by this document.

- **Date:** 2026-11-22
- **Baseline:** `main` at `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21` (verified: it is the current `origin/main` HEAD; no drift from the review reference).
- **Related:** [S0-06 specification draft](S0-06-authentication-audit-foundation.md), [contract design review](../reviews/S0-06-contract-design-review.md), [implementation plan](../plans/S0-06-implementation-plan.md), [readiness summary](S0-06-readiness-summary.md), [S0-05 closure record](S0-05-closure-record.md), [ADR-025](../adr/ADR-025-postgresql-persistence-architecture.md) and [effective policy](../adr/ADR-025-effective-policy.md).
- **History:** no earlier S0-06 decision register exists in the repository (checked). "v0.3" continues the numbering of the drafts the Engineering Owner reviewed outside the repository; those drafts are not committed, so this file is the first committed version and carries no earlier content.

## 1. Purpose

Record, in one place, (a) the design directions the Engineering Owner has communicated for S0-06, (b) every decision that still needs a formal Owner decision before implementation, and (c) the gate that keeps implementation blocked until those decisions are recorded in the repository (CLAUDE.md section 1: chat history is not a substitute for committed specifications).

## 2. Status vocabulary

| Label                       | Meaning                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direction Confirmed**     | The Owner stated this direction for planning in the task message that requested these documents. It is not yet an approved, committed decision. |
| **Proposed**                | Claude Code's proposal. The Owner has not confirmed it.                                                                                         |
| **Pending Formal Approval** | Needs a recorded Owner decision (approval block in section 6) before it can govern implementation.                                              |
| **Formally Approved**       | Recorded by the Owner in a committed document. **Nothing in this register has this status.**                                                    |

Evidence note: the ten directions below come from the Owner's task message of 2026-11-22 (pasted into the session). They are not recorded in any committed file at `ae7dc51`. Until the Owner records them (section 6), they are directions, not approvals.

## 3. Confirmed design directions

| #   | Direction                                                                                                                                                     | Status              | Decision register item |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------- |
| C1  | Phase 1 Audit scope is Investigation-only                                                                                                                     | Direction Confirmed | D4                     |
| C2  | Investigation owns the Audit Writer, Persistence Contract and Audit Table                                                                                     | Direction Confirmed | D5                     |
| C3  | The Audit Table belongs in PostgreSQL schema `investigation`                                                                                                  | Direction Confirmed | D5                     |
| C4  | Authentication uses an isolated, trusted Synthetic Identity Provider for MVP/testing                                                                          | Direction Confirmed | D3                     |
| C5  | Authoritative State-change Audit records only successfully committed mutations                                                                                | Direction Confirmed | D7                     |
| C6  | Duplicate no-op, validation failure, concurrency conflict, unauthorized operation and rolled-back transactions create no successful State-change Audit record | Direction Confirmed | D7                     |
| C7  | FU-3 uses Option B: validate `expectedVersion` at the existing comparison position, preserving prior error precedence                                         | Direction Confirmed | D8                     |
| C8  | `expectedVersion` is a native JavaScript number, a safe integer, between 1 and 2147483647, with no implicit coercion                                          | Direction Confirmed | D8                     |
| C9  | Version exhaustion has an explicit error contract and the PostgreSQL `integer` column is not changed                                                          | Direction Confirmed | D8                     |
| C10 | S0-06 implementation remains NOT STARTED                                                                                                                      | Direction Confirmed | D9                     |

## 4. Decisions

Each item gives the question, the verified evidence, the proposed resolution and what blocks it. "Blocks implementation" means no work package that depends on it may start before the decision is recorded.

### D1 — Specification baseline

- **Question:** What is the authoritative S0-06 specification? The approved Sprint 0 Blueprint, which CLAUDE.md section 3 names as the authority for task scope, is not in the repository (readiness summary section 1). The only in-repository S0-06 statement is the title "Authentication and Audit Foundation".
- **Status:** Pending Formal Approval. **Blocks implementation: yes.**
- **Proposed resolution:** the Owner designates [the specification draft](S0-06-authentication-audit-foundation.md), after revision, as the S0-06 baseline. If the Blueprint section exists, the Owner commits it and the draft is reconciled against it; Claude Code does not infer its content.
- **Risk:** the directions C1 to C9 may not match Blueprint acceptance criteria that this repository cannot show.

### D2 — S0-05 conditional closure as the S0-06 prerequisite

- **Question:** The readiness summary lists "S0-05 closed" as a prerequisite and records that it is not decided whether CLOSED WITH CONDITIONS satisfies it, and whether FU-3 must be resolved first.
- **Evidence:** the closure record and acceptance record state CLOSED / ACCEPTED WITH CONDITIONS; FU-1 to FU-4 are Open and unscheduled ([minor follow-up](S0-05-minor-follow-up.md)); OBL-SEC-1 is open and is not a gate.
- **Status:** Pending Formal Approval. **Blocks implementation: yes.**
- **Proposed resolution:** treat the conditional closure as satisfying the prerequisite **for planning and documentation only**, and make FU-3 the first S0-06 work package (WP-01), so that the `expectedVersion` contract is settled before any audit code touches `linkAttempt`. C7 to C9 already choose the FU-3 design, which makes this ordering natural. FU-1, FU-2 and FU-4 stay deferred and unscheduled unless the Owner says otherwise (FU-2 is relevant to the WP-06 concurrency tests and is listed there as an input, not a dependency).
- **Risk:** executing FU-3 inside S0-06 changes the S0-05 public contract (new error codes, section D8). It needs the Owner's approval as a public-contract change (CLAUDE.md section 12).

### D3 — Authentication and actor identity

- **Direction:** C4.
- **Verified state:** `apps/api/src` has no authentication or request-identity code; no Investigation command takes an actor; no `Actor` or `Principal` type exists in any package. `AuditMetadata.actor` is a required `EntityRef`, which needs an `entityType` and a UUIDv7 `id`.
- **Status:** direction Confirmed; the design is **Proposed** and Pending Formal Approval. **Blocks implementation: yes** (WP-02, WP-03, WP-05).
- **Open questions (see contract review section 3):** where the provider and credential verifier live; the Actor Context shape; how a Human and a System actor are represented; how a principal maps to an `EntityRef`; how test and production are isolated; the failure contract.
- **Proposed resolution:** a trusted issuer in the application layer (`apps/api`) verifies a synthetic credential and mints an opaque, issuer-registered Actor Context that Investigation commands require. Investigation never verifies credentials. The synthetic provider is refused outside local/test environments.
- **Risk:** TypeScript brands do not stop in-process forgery; the control is the issuer registry plus the composition boundary (contract review section 9).

### D4 — Investigation-only Audit scope

- **Direction:** C1. **Status:** Direction Confirmed; the concrete command list is **Proposed**: `registerUut`, `registerTestAttempt`, `openCase`, `linkAttempt`. Reads (`getUut`, `getTestAttempt`, `getCase`) are **not** audited in Phase 1 (proposal; see D6 of the review for read authorisation).
- **Blocks implementation:** yes, for WP-04 and WP-05, until the Owner confirms the list.
- **Risk:** other contexts (Retrieval and later contexts) will need audit; the Investigation-only design must not become a shared Audit Context by accident. The proposal introduces no shared audit package.

### D5 — Investigation-owned Audit and schema

- **Direction:** C2, C3.
- **Conflict to resolve first:** ADR-025 Decision 7 (accepted) requires atomic domain state plus audit but **defers concrete audit table ownership** ("Those belong to subsequent approved tasks"), and section 17 lists "Decide Audit/Outbox/Inbox/Jobs ownership" as a future governance task. The effective-policy file preserves this deferral. C2 and C3 decide ownership for the Investigation audit table. **Proposed resolution:** the Owner records that decision explicitly, either as the approval of the S0-06 specification (if it is declared to be the "subsequent approved task") or, preferably, as a short new ADR or an ADR-025 amendment so that the architecture record states it. Claude Code does not edit an ADR or an ADR Status.
- **Status:** Direction Confirmed; **Pending Formal Approval** for the record. **Blocks implementation: yes** (WP-04).
- **Allowlist check (verified):** `scripts/architecture/dependency-matrix.json` already allows `@sdris/investigation` infrastructure to use `@sdris/database` and `drizzle-orm`. A new audit adapter inside `modules/investigation/src/infrastructure/**` needs **no** allowlist change. A new composition root or a new module would.
- **Constraint (verified):** the S0-05 final approval forbids a cross-context transaction framework without separate approval. An Investigation-owned audit table written through the Investigation `TransactionScope` is **not** cross-context, so the constraint is not triggered.

### D6 — Transaction boundary

- **Status:** **Proposed**; Pending Formal Approval. **Blocks implementation: yes** (WP-05).
- **Verified state:** the application owns the boundary through `TransactionScope.run` (`modules/investigation/src/application/ports/transaction-scope.ts`), implemented over the infrastructure `UnitOfWork` (`infrastructure/database/src/unit-of-work.ts`). The service's private `transactional()` helper rolls back by throwing `Rollback` for any `err` result.
- **Proposed resolution:** add an Investigation-owned `AuditWriter` port that takes the same `TransactionToken`. The service calls it inside the same `transactional()` unit, after the domain write succeeds and only for a created state change. If the audit write throws, the whole unit rolls back (fail closed). No new transaction abstraction and nothing shared. This also gives ADR-025 Decision 5 (CONDITIONAL until A2 is effective; A2.6) a second real use.
- **Risk:** an unavailable audit table makes every mutation fail. That is intended, and the Owner should confirm it.

### D7 — Successful State-change Audit semantics

- **Direction:** C5, C6. **Status:** Direction Confirmed; the per-case outcome table in specification section 5 is **Proposed**.
- **Blocks implementation:** yes (WP-05).
- **Open gap, reported not filled:** C6 says unauthorized operations create no **State-change** audit record. It does not say whether denied operations and authentication failures are recorded anywhere. The proposal is a separate, non-authoritative security log (structured application log, not in the audit table) and **no** denial table in Phase 1. The Owner must decide whether this is acceptable, because AGENTS.md says SDRIS owns its audit trail and denial evidence is usually expected of one.

### D8 — FU-3 runtime validation and version exhaustion

- **Direction:** C7, C8, C9. **Status:** Direction Confirmed; the error codes, details and precedence are **Proposed** (specification section 7). **Blocks implementation: yes** (WP-01).
- **Verified state:** `linkAttempt` receives `expectedVersion: number` and compares it with `current.version`; there is no runtime validation. The domain version has no upper bound; the column is `integer` with `check (version >= 1)`, so PostgreSQL error 22003 would occur on the update past 2147483647. `save` increments in the UPDATE (`version + 1`).
- **Proposed codes:** `investigation.invalid_expected_version`, `investigation.version_exhausted`.
- **Public-contract note:** both codes extend the `InvestigationServiceError` union that `@sdris/investigation` exports. A consumer with an exhaustive `switch` would stop compiling, so this is an additive but compile-visible change. Owner approval is requested under CLAUDE.md section 12.

### D9 — Verification and acceptance gates

- **Status:** **Proposed**; Pending Formal Approval. **Blocks implementation: no** (it defines the gates) but the Owner must approve it before WP-06 closes.
- **Proposed gates:** the acceptance criteria AC-1 to AC-11 in specification section 8, all run on real PostgreSQL; `pnpm check:structure`, `lint`, `format:check`, `typecheck`, `test`, `build`, `db:test` and the compiled-runtime test pass; architecture checker passes with no allowlist loosening; the S0-05 integration suite (43 tests in the api suite at `ae7dc51`) still passes unchanged except for the deliberate FU-3 test additions; one Codex review of the final head per work package group (the Owner decides the cadence). CI for the PostgreSQL tests is still S0-10, so every result is local.

## 5. Dependencies

```text
D1 ─┬─> D3 ─> WP-02 ─> WP-03 ─┐
    ├─> D5 ─> WP-04 ──────────┼─> WP-05 ─> WP-06
D2 ─┴─> D8 ─> WP-01 ──────────┘
D6, D7 gate WP-05. D4 gates WP-04 and WP-05. D9 gates WP-06 closure.
```

## 6. Owner approval requirements

Each item needs one block recorded in a committed file (this register or a successor). Claude Code cannot fill it in.

| Item | Decision (APPROVED / APPROVED WITH CHANGES / REJECTED / DEFER) | Owner | Date | Notes |
| ---- | -------------------------------------------------------------- | ----- | ---- | ----- |
| D1   | _unrecorded_                                                   |       |      |       |
| D2   | _unrecorded_                                                   |       |      |       |
| D3   | _unrecorded_                                                   |       |      |       |
| D4   | _unrecorded_                                                   |       |      |       |
| D5   | _unrecorded_                                                   |       |      |       |
| D6   | _unrecorded_                                                   |       |      |       |
| D7   | _unrecorded_                                                   |       |      |       |
| D8   | _unrecorded_                                                   |       |      |       |
| D9   | _unrecorded_                                                   |       |      |       |

## 7. Architecture risks

| Risk                                                                                              | Where | Mitigation proposed                                                           |
| ------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| ADR-025 Decision 7 defers audit ownership; C2/C3 decide it                                        | D5    | Record the decision in an ADR or amendment before WP-04                       |
| Additive error codes change the exported error union                                              | D8    | Owner approval as a public-contract change                                    |
| Fail-closed audit makes the audit table a hard availability dependency                            | D6    | Owner confirmation; integration test of rollback                              |
| Forged actor context from in-process code                                                         | D3    | Issuer registry, composition-root restriction, architecture check             |
| Denied operations leave no authoritative record                                                   | D7    | Owner decision on a separate security log                                     |
| Mutation of an audit row after the fact                                                           | D5    | Append-only triggers on update and delete, like the existing immutable rows   |
| Migration `0003` touches table lists in `migrations.integration.test.ts` and `migrations.spec.ts` | WP-04 | Update those tests in the same work package; `0001` and `0002` stay unchanged |
| Version column cannot grow past 2147483647                                                        | D8    | Explicit `version_exhausted`; the column is not changed (C9)                  |
| Audit and domain timestamps could diverge if the clock is read twice                              | D6    | Read the injected clock once per command and reuse it (specification 4.4)     |

## 8. Implementation authorization gate

Implementation of any S0-06 work package may start only when **all** of the following are recorded in the repository:

1. The Owner decisions D1 to D8 in section 6 are APPROVED or APPROVED WITH CHANGES (D9 before WP-06 closes).
2. The Owner has authorised implementation of S0-06 or of a named work package, in writing.
3. The record required by D5 (ADR or amendment, or the Owner's explicit statement that the approved specification serves as that record) exists.
4. A branch for the work package is cut from the then-current `main`, and the working tree is clean.

**Gate state at the date of this register: CLOSED.** None of 1 to 3 is satisfied. S0-06 is NOT STARTED.
