# S0-06 — Finding Traceability Matrix (v5, DRAFT)

**Status:** DRAFT. Traces the findings of three independent Codex architecture reviews to the revised S0-06 documents, after the Owner-authorized revisions that applied gaps G-1 to G-9 and the three findings of the third review. It approves nothing and records no decision as approved. **S0-06 is NOT STARTED.** **Completion target: READY FOR FOCUSED CODEX RE-REVIEW**, not implementation authorization.

- **Date:** 2026-11-23. **Verified against:** branch `docs/s0-06-contract-design` at `011a9bd`. Every `file:line` below is a line of that commit; the commit that adds this matrix changes only this file, so the lines of the other documents are unchanged by it. If a document is edited later the lines shift: re-verify.
- **Reviewed baseline (pinned):** `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21`. This is **not** the integration SHA: each package is cut from an Owner-approved integration SHA ([register:166](../specs/S0-06-owner-decision-register.md)).
- **Source reports (read in full; none committed):** Review 1 `Pasted text(20261123-064613).txt` (reviewed HEAD `24b73c8`, REVISE); Review 2 `Pasted text(20261123-070655).txt` (reviewed HEAD `87a17bf`, REVISE); Review 3 `docs/reviews/Pasted%20markdown(20261123-090236).md` (reviewed HEAD `769810b`, REVISE; two MAJOR and one MINOR finding). Review 3 is untracked reference material in the working tree and is **not** committed.
- **Not independently reviewed:** every document change made after Review 3 (commits `429bc82`, `63383c6`, `011a9bd`). Review 3's reassessments describe `769810b`.

## 1. Conventions

**IDs.** R1-01 to R1-08: the eight numbered findings of Review 1 (1 BLOCKER, 5 MAJOR, 2 MINOR). R2-01 to R2-05: the five new findings of Review 2 (4 MAJOR, 1 MINOR). **R3-01 to R3-03: the three findings of Review 3, section 4 (2 MAJOR, 1 MINOR).** Review 3 reports them against already numbered findings, so each R3 row names the earlier findings it reopens (R3-01 reopens R1-05 and R2-03; R3-02 reopens R2-03; R3-03 reopens R1-07 and G-9). Review 1's INFORMATIONAL row is not counted (section 6).

**Documentation status** (the only status these rows carry):

| Status         | Meaning                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**   | The latest independent assessment of the finding was RESOLVED (or RESOLVED WITH CONDITIONS whose conditions are Owner decisions, not document defects), **and** my line-level check of the current text, including any later change, finds nothing that weakens or contradicts it. |
| **PARTIAL**    | A requirement is missing or contradicted in the current text.                                                                                                                                                                                                                      |
| **UNVERIFIED** | The current text appears to meet every requirement on my check, but the latest independent assessment was PARTIAL, carried a condition that I addressed in text, or the finding is new, and the revised text has **not** been re-reviewed.                                         |
| **OPEN**       | Not addressed.                                                                                                                                                                                                                                                                     |

**No finding is marked RESOLVED by me.** That determination belongs to Codex. Where this matrix shows "RESOLVED" it quotes Codex's own disposition in Review 3. **Implementation verification** is separate and is **NOT_RUN for every finding**: S0-06 is NOT STARTED, so no code or test exists. A formal Owner approval is a third, separate thing and is also pending for every decision (the D1 to D9 approval entries remain unrecorded: [register:126-140](../specs/S0-06-owner-decision-register.md)).

## 2. Summary

| ID    | Sev.    | Finding (short)                                                 | Codex, Review 3                                          | Documentation status                 | Implementation |
| ----- | ------- | --------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ | -------------- |
| R1-01 | BLOCKER | D2 prerequisite, FU-3 ordering, D1 baseline, D9 timing          | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R1-02 | MAJOR   | Actor trust contract                                            | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R1-03 | MAJOR   | Synthetic deployment, caller boundaries, reads                  | RESOLVED WITH CONDITIONS                                 | **UNVERIFIED** (condition addressed) | NOT_RUN        |
| R1-04 | MAJOR   | Audit adapter on the wrong persistence interface                | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R1-05 | MAJOR   | Rollback could resume unaudited writes                          | PARTIALLY RESOLVED                                       | **UNVERIFIED** (see R3-01)           | NOT_RUN        |
| R1-06 | MAJOR   | Audit record and denial-log integrity                           | RESOLVED WITH CONDITIONS (Owner decisions D7, OBL-AUD-1) | **VERIFIED**                         | NOT_RUN        |
| R1-07 | MINOR   | Acceptance criteria and commit boundaries                       | PARTIALLY RESOLVED                                       | **UNVERIFIED** (see R3-03)           | NOT_RUN        |
| R1-08 | MINOR   | Governance references                                           | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R2-01 | MAJOR   | Authenticated read contract has no error channel                | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R2-02 | MAJOR   | Denial contract and synthetic startup path                      | RESOLVED WITH CONDITIONS                                 | **UNVERIFIED** (condition addressed) | NOT_RUN        |
| R2-03 | MAJOR   | Trace id insufficient for a create retry; cutover fencing       | PARTIALLY RESOLVED                                       | **UNVERIFIED** (see R3-01, R3-02)    | NOT_RUN        |
| R2-04 | MAJOR   | `concurrency_conflict` payloads; FU-3 contract and tests        | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R2-05 | MINOR   | Transaction-token validity versus provenance                    | RESOLVED                                                 | **VERIFIED**                         | NOT_RUN        |
| R3-01 | MAJOR   | Old writers can reconnect after a clean cutover check           | new in Review 3                                          | **UNVERIFIED**                       | NOT_RUN        |
| R3-02 | MAJOR   | A unique candidate can be a different create                    | new in Review 3                                          | **UNVERIFIED**                       | NOT_RUN        |
| R3-03 | MINOR   | Evidence gates not executable for both stages and read policies | new in Review 3                                          | **UNVERIFIED**                       | NOT_RUN        |

**Counts (documentation), 16 rows:** VERIFIED 8, UNVERIFIED 8, PARTIAL 0, OPEN 0. The 13 numbered findings of Reviews 1 and 2 are R1-01 to R2-05 (severity check: 1 BLOCKER, 5 + 4 MAJOR, 2 + 1 MINOR); R3-01 to R3-03 are the three findings of Review 3 (2 MAJOR, 1 MINOR).

**Why 8 are UNVERIFIED and not VERIFIED.** The revised text now meets every stated requirement on my check, but Codex last judged these PARTIAL or conditional, or has not seen them, and I am the author of the revision. Moving any of them to RESOLVED belongs to Codex.

## 3. The three findings of Review 3

#### R3-01 — MAJOR — Old writers can reconnect after a clean cutover check (reopens R1-05, R2-03)

- **Original requirement (Review 3, finding 1).** "The cutover can detect an old writer that is connected during inspection, but it does not prevent one from reconnecting." Make the fence persistent across reconnects: define how the operator disables old-writer launch paths and prevents them from regaining access throughout and after cutover; if that cannot be demonstrated, **hold writes**; add a test that attempts an old-writer **reconnect after the checks pass**; `application_name` is optional and only session identification; treat timestamp-based completeness as detection within its defined scope, since a caller-generated timestamp need not match commit time. (Owner task adds: cover process restarts, reconnections, overlapping deployments, scheduled jobs and workers; require evidence that old writers cannot commit after cutover.)
- **Current evidence.**
  - Why inspection is not a fence; `application_name` is an observability aid and never a security boundary: [spec:376](../specs/S0-06-authentication-audit-foundation.md).
  - Mechanism F1 (dedicated writer role, legacy credentials revoked and set `NOLOGIN`, sessions ended, non-login table owner as a precondition, runbook as a WP-05 deliverable): [spec:378-383](../specs/S0-06-authentication-audit-foundation.md). Optional F2 (deferred triggers requiring an audit row; not proposed unless the Owner asks): [spec:385](../specs/S0-06-authentication-audit-foundation.md).
  - Coverage of restarts, reconnects, overlapping deployments, scheduled jobs, workers and administrative paths: [spec:387-394](../specs/S0-06-authentication-audit-foundation.md).
  - Procedure, including the **negative check repeated after the other checks pass** (6(b)) and **"if any evidence cannot be produced, hold writes"** (7): [spec:396-405](../specs/S0-06-authentication-audit-foundation.md).
  - Completeness query **by id and subject, not timestamp**, detection and not proof, with its stated limits: [spec:407](../specs/S0-06-authentication-audit-foundation.md).
  - Recovery never lifts the fence silently: [spec:409-417](../specs/S0-06-authentication-audit-foundation.md).
  - Tests: fence evidence, **old-writer reconnect after the first clean verification** for a restart, a reconnect, an overlapping deployment, a scheduled job and a worker, `application_name` is not a boundary, writes held when the fence cannot be shown, detection scope of the completeness query: [spec:434-438](../specs/S0-06-authentication-audit-foundation.md). AC-12: [spec:578](../specs/S0-06-authentication-audit-foundation.md).
  - Register D6: [register:95](../specs/S0-06-owner-decision-register.md); plan WP-05: [plan:91](../plans/S0-06-implementation-plan.md), [plan:94](../plans/S0-06-implementation-plan.md).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6: the fence mechanism (F1 required; F2 optional), the split of table ownership in the local setup (a precondition and part of OBL-AUD-1), and whether to add the `application_name` observability instrumentation.
- **Verification requirement.** Documentation: Codex re-reads spec 6.2 to 6.5. Implementation (WP-05): the five fence tests of 6.5 on real PostgreSQL with the legacy and writer roles; the runbook evidence attached to the cutover record.
- **Remaining limit stated in the text.** The fence does not bind the table owner, superusers or administrative paths (`db:seed`, `db:reset`, migrations); those are outside the audit guarantee and fall under OBL-AUD-1 ([spec:394](../specs/S0-06-authentication-audit-foundation.md), [spec:328-348](../specs/S0-06-authentication-audit-foundation.md)).

#### R3-02 — MAJOR — A unique candidate can be a different create (reopens R2-03)

- **Original requirement (Review 3, finding 2).** "One row matching action, actor, a time window, and available details can still belong to a different create", most visibly `registerUut` (no details). Keep a uniquely matching candidate **UNKNOWN** unless independent evidence ties it to that request; require a settled outcome before resubmission; test the case where exactly one candidate belongs to another operation; carry the rule into WP-05 instead of describing `correlation_id` as the reconciliation mechanism; no new idempotency subsystem. (Owner task adds: correlation id is a search aid, not an idempotency key; COMMITTED only with operation-specific affirmative evidence; no automatic retry or resubmission while UNKNOWN; operator reconciliation with documented evidence; tests for another operation's matching record and for an absent record that does not prove non-commit.)
- **Current evidence.**
  - Rule: correlation id is a search aid and not an idempotency key ([spec:424](../specs/S0-06-authentication-audit-foundation.md)); a uniquely matching record is not proof ([spec:425](../specs/S0-06-authentication-audit-foundation.md)); classification COMMITTED only with operation-specific affirmative evidence, otherwise UNKNOWN, with no "not committed" state for a lost acknowledgment ([spec:426](../specs/S0-06-authentication-audit-foundation.md)); what counts and what never counts as evidence ([spec:427](../specs/S0-06-authentication-audit-foundation.md)); no automatic retry or resubmission while UNKNOWN ([spec:428](../specs/S0-06-authentication-audit-foundation.md)); operator reconciliation record and the three decisions, the third an explicit operator-accepted resubmission ([spec:429](../specs/S0-06-authentication-audit-foundation.md)); no new idempotency subsystem ([spec:430](../specs/S0-06-authentication-audit-foundation.md)).
  - Tests: a unique candidate belonging to another operation stays UNKNOWN (also for `registerUut` and `openCase`), an absent record does not prove non-commit (wrong search, in-flight transaction, no "not committed" outcome), affirmative evidence settles only COMMITTED, no automatic retry or resubmission, read-only tooling: [spec:442-446](../specs/S0-06-authentication-audit-foundation.md). AC-12: [spec:578](../specs/S0-06-authentication-audit-foundation.md).
  - WP-05 no longer says creates are reconciled by `correlation_id`: [plan:94](../plans/S0-06-implementation-plan.md); register: [register:95](../specs/S0-06-owner-decision-register.md).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6 (the unknown-outcome rule and the operator-accepted resubmission); the deferred client-supplied operation identifier remains an open question, not a requirement.
- **Verification requirement.** Documentation: Codex re-reads spec 6.4 and 6.5 items 9 to 13. Implementation (WP-05): those five tests on real PostgreSQL.

#### R3-03 — MINOR — Evidence gates not executable for both stages and read policies (reopens R1-07, G-9)

- **Original requirement (Review 3, finding 3).** Split AC-6 into WP-01 concurrency evidence and WP-05 concurrency-plus-audit evidence; apply AC-13 in either read-policy branch and have WP-06 consolidate it; distinguish valid resolver outcomes from rejected outcomes in AC-1. Review 3's gap table also asks to clarify the AC-9 external-artifact exception for the compiled audit round trip and any approved connection instrumentation (G-5), to have D9 require the deferred-read tests under AC-13 (G-9), and, for the R1-03 and R2-02 conditions, to construct the deferred-read facade explicitly (a `Pick` does not remove runtime methods) and to count one emission attempt per refusal and one observed event with a functioning sink.
- **Current evidence.** AC-1 distinguishes the `valid` outcome from the four rejected outcomes and counts one emission attempt and one observed event: [spec:566](../specs/S0-06-authentication-audit-foundation.md); AC-5 states what WP-01 proves without audit: [spec:570](../specs/S0-06-authentication-audit-foundation.md); **AC-6a (WP-01) and AC-6b (WP-05)**: [spec:571-572](../specs/S0-06-authentication-audit-foundation.md); AC-9 lists the only audit-related artifacts outside the module (migration `0003`, inventory updates, the compiled-runtime audit round trip, the approved connection instrumentation, the runbook): [spec:575](../specs/S0-06-authentication-audit-foundation.md); AC-13 is **required in either branch** (13a authenticated reads, 13b deferred reads) with WP-06 consolidating the approved branch: [spec:579](../specs/S0-06-authentication-audit-foundation.md); the facade is an explicitly constructed object with a prototype-and-keys check: [spec:220](../specs/S0-06-authentication-audit-foundation.md), [spec:225](../specs/S0-06-authentication-audit-foundation.md); emission-attempt wording: [spec:92](../specs/S0-06-authentication-audit-foundation.md), [spec:132](../specs/S0-06-authentication-audit-foundation.md), [spec:137-139](../specs/S0-06-authentication-audit-foundation.md). D9: [register:113](../specs/S0-06-owner-decision-register.md); plan: [plan:31](../plans/S0-06-implementation-plan.md), WP-06 [plan:102](../plans/S0-06-implementation-plan.md).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D9 (approve the corrected criteria before any package); C11 (which read-policy branch applies).
- **Verification requirement.** Documentation: Codex re-reads AC-1, AC-5, AC-6a/6b, AC-9, AC-12, AC-13 and D9. Implementation: the evidence per package, consolidated in WP-06 for the approved read policy.

## 4. Findings of Reviews 1 and 2

#### R1-01 — BLOCKER — D2 cannot open the implementation gate as written

- **Requirement.** Conditional closure as an implementation prerequisite with a precise FU-3 ordering rule; WP-02 and WP-04 independent, WP-05 after FU-3, authorization and audit persistence; D1 baseline; D9 criteria before the packages they govern, final evidence at WP-06.
- **Evidence.** D2: [register:55-66](../specs/S0-06-owner-decision-register.md); D1: [register:48-54](../specs/S0-06-owner-decision-register.md); package dependencies: [plan:14-25](../plans/S0-06-implementation-plan.md); D9 blocks implementation and defers only the evidence, now stating the AC-6 split and AC-13 in either branch: [register:113-114](../specs/S0-06-owner-decision-register.md); gate item 1: [register:163](../specs/S0-06-owner-decision-register.md); plan: [plan:12](../plans/S0-06-implementation-plan.md), [plan:27-38](../plans/S0-06-implementation-plan.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED. **Owner decision:** D1, D2, D9. **Verification:** implementation none (a governance finding).

#### R1-02 — MAJOR — Actor verification: incomplete runtime trust contract

- **Requirement.** Opaque handle over issuer-private claims; trusted clock and expiry; reuse; foreign issuers; nested values; derivation from fixture data; checks before the transaction, including direct calls.
- **Evidence.** [spec:48-51](../specs/S0-06-authentication-audit-foundation.md), [spec:52-64](../specs/S0-06-authentication-audit-foundation.md), [spec:65-93](../specs/S0-06-authentication-audit-foundation.md) (typed outcome, `now >= expiresAt`, one emission attempt per rejection), [spec:94-97](../specs/S0-06-authentication-audit-foundation.md), [spec:102-120](../specs/S0-06-authentication-audit-foundation.md) (canonical order), quoted at [plan:69](../plans/S0-06-implementation-plan.md), [register:74](../specs/S0-06-owner-decision-register.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED. **Owner decision:** D3 (the 15-minute TTL). **Verification (implementation):** AC-1 and AC-2 in WP-02 and WP-03 ([spec:566-567](../specs/S0-06-authentication-audit-foundation.md)).

#### R1-03 — MAJOR — Synthetic deployment and caller boundaries

- **Requirement.** Trusted configuration source, fail-closed, production startup or packaging test, fixture access without widening issuer imports, `apps/worker` limits, reads with an Owner disposition and an exposure boundary. Review 3 condition: if the deferred-read facade is chosen, construct it explicitly from three methods, because `Pick` alone does not remove runtime methods.
- **Evidence.** [spec:158-172](../specs/S0-06-authentication-audit-foundation.md), paired tests [spec:173-179](../specs/S0-06-authentication-audit-foundation.md), authenticated reads [spec:181-217](../specs/S0-06-authentication-audit-foundation.md), **explicitly constructed facade and its tests** [spec:218-226](../specs/S0-06-authentication-audit-foundation.md), caller inventory [spec:227-240](../specs/S0-06-authentication-audit-foundation.md); register [register:73](../specs/S0-06-owner-decision-register.md).
- **Status: UNVERIFIED** (condition addressed in text; Codex: RESOLVED WITH CONDITIONS). **Owner decision:** D3, C11. **Verification:** AC-1 startup tests, `dist` packaging scan, AC-9, AC-13a or AC-13b ([spec:566](../specs/S0-06-authentication-audit-foundation.md), [spec:575](../specs/S0-06-authentication-audit-foundation.md), [spec:579](../specs/S0-06-authentication-audit-foundation.md)). Limit stated: Phase 1's `main.ts` still starts only the health app, so the proof is at `composeInvestigation` ([spec:160](../specs/S0-06-authentication-audit-foundation.md)).

#### R1-04 — MAJOR — Audit adapter described against the wrong persistence interface

- **Requirement.** Same `PersistenceHandle` and active token via `executorOf(handle, tx)`; reject a missing token before the pool fallback; ORM types stay in infrastructure.
- **Evidence.** [spec:252-262](../specs/S0-06-authentication-audit-foundation.md), verification [spec:263-272](../specs/S0-06-authentication-audit-foundation.md), [register:91-98](../specs/S0-06-owner-decision-register.md), [plan:76-86](../plans/S0-06-implementation-plan.md), AC-4 [spec:569](../specs/S0-06-authentication-audit-foundation.md). Code facts: `persistence-handle.ts` and `unit-of-work.ts` (`executorFor` returns `db` when `tx` is undefined).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED. **Owner decision:** D6. **Verification:** AC-4 on real PostgreSQL in WP-04 and WP-05.

#### R1-05 — MAJOR — Rollback could silently resume unaudited writes

- **Requirement.** Activation point after schema verification; hold writes or restore an audit-capable build; forward repair; reconcile a lost acknowledgment before replaying a create; separate-connection inspection. Review 3: still needs a way to prevent a stopped writer from returning (now R3-01).
- **Evidence.** Cutover and fence: [spec:372-408](../specs/S0-06-authentication-audit-foundation.md); recovery: [spec:409-417](../specs/S0-06-authentication-audit-foundation.md); unknown outcomes: [spec:418-431](../specs/S0-06-authentication-audit-foundation.md); tests: [spec:432-447](../specs/S0-06-authentication-audit-foundation.md); AC-12: [spec:578](../specs/S0-06-authentication-audit-foundation.md); separate-connection inspection: [spec:271](../specs/S0-06-authentication-audit-foundation.md); plan: [plan:87-98](../plans/S0-06-implementation-plan.md).
- **Status: UNVERIFIED.** Codex (Review 3): PARTIALLY RESOLVED. **Owner decision:** D6. **Verification:** the fence and unknown-outcome tests of 6.5 (WP-05).

#### R1-06 — MAJOR — Audit record and denial log integrity

- **Requirement.** Investigation-specific validation, per-action data, `case_id` and FK, provenance, allowlists, database roles and `TRUNCATE`/DDL limits, security log redaction, retention and sink failure, and issuer-level credential failures.
- **Evidence.** [spec:273-290](../specs/S0-06-authentication-audit-foundation.md), [spec:291-303](../specs/S0-06-authentication-audit-foundation.md), [spec:304-308](../specs/S0-06-authentication-audit-foundation.md), [spec:309-327](../specs/S0-06-authentication-audit-foundation.md), [spec:328-348](../specs/S0-06-authentication-audit-foundation.md), issuer refusals [spec:125-143](../specs/S0-06-authentication-audit-foundation.md); [register:102](../specs/S0-06-owner-decision-register.md); [plan:59](../plans/S0-06-implementation-plan.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED WITH CONDITIONS; the conditions are Owner decisions, not document defects: D7 must accept the best-effort sink and set retention, and OBL-AUD-1 must be recorded and discharged before an applicable production deployment. **Verification:** AC-3, AC-10, AC-2, AC-1; OBL-AUD-1 checks before production.

#### R1-07 — MINOR — Acceptance criteria and commit boundaries disagree

- **Requirement.** AC-9 versus the migration, AC-11 versus WP-04 updates, checker ownership, inventory with `0003`, integrated regression in WP-06, timestamps per action. Review 3: AC-6 assigned an audit expectation to unaudited WP-01, and AC-13 was excluded when C11 is deferred (now R3-03).
- **Evidence.** [spec:575-577](../specs/S0-06-authentication-audit-foundation.md), AC-6a/6b [spec:571-572](../specs/S0-06-authentication-audit-foundation.md), AC-13 [spec:579](../specs/S0-06-authentication-audit-foundation.md); [plan:53-64](../plans/S0-06-implementation-plan.md), [plan:76-86](../plans/S0-06-implementation-plan.md), [plan:99-107](../plans/S0-06-implementation-plan.md); timestamps [spec:291-303](../specs/S0-06-authentication-audit-foundation.md).
- **Status: UNVERIFIED.** Codex (Review 3): PARTIALLY RESOLVED. **Owner decision:** D9.

#### R1-08 — MINOR — Governance references

- **Requirement.** Decision 5 correction; pinned base; Owner-approved integration SHA; one A5 gate; D9 before any package.
- **Evidence.** [register:96](../specs/S0-06-owner-decision-register.md) with `docs/adr/ADR-025-effective-policy.md:190-196`; [spec:6](../specs/S0-06-authentication-audit-foundation.md), [register:6](../specs/S0-06-owner-decision-register.md), [register:41-42](../specs/S0-06-owner-decision-register.md), [register:165-166](../specs/S0-06-owner-decision-register.md), [plan:6](../plans/S0-06-implementation-plan.md), [plan:12](../plans/S0-06-implementation-plan.md); A5 stays PROPOSED at [ADR-025:771-787](../adr/ADR-025-postgresql-persistence-architecture.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED. **Owner decision:** D9, A5 (C13), the integration SHA (C14).

#### R2-01 — MAJOR — Authenticated read contract has no error channel

- **Requirement.** An explicit failure channel; inventory of direct, factory and compiled-runtime callers; exposure rule if read authentication is deferred.
- **Evidence.** [spec:181-217](../specs/S0-06-authentication-audit-foundation.md), [spec:218-226](../specs/S0-06-authentication-audit-foundation.md), [spec:227-240](../specs/S0-06-authentication-audit-foundation.md), [spec:545-555](../specs/S0-06-authentication-audit-foundation.md), AC-13 [spec:579](../specs/S0-06-authentication-audit-foundation.md), [register:39](../specs/S0-06-owner-decision-register.md), [register:73](../specs/S0-06-owner-decision-register.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED; C11 remains Owner-proposed and pending. **Verification:** AC-13 in WP-03, consolidated in WP-06.

#### R2-02 — MAJOR — Denial contract and synthetic startup path

- **Requirement.** Typed outcomes, one emitting layer, issuer refusal events, one precedence, paired startup tests. Review 3 condition: count **one emission attempt per refusal and one observed event with a functioning sink**; `main.ts` stays outside the proof.
- **Evidence.** [spec:65-93](../specs/S0-06-authentication-audit-foundation.md), [spec:102-116](../specs/S0-06-authentication-audit-foundation.md), [spec:125-143](../specs/S0-06-authentication-audit-foundation.md) (emission-attempt wording at lines 132 and 137-139), [spec:160](../specs/S0-06-authentication-audit-foundation.md), [spec:173-179](../specs/S0-06-authentication-audit-foundation.md), AC-1 [spec:566](../specs/S0-06-authentication-audit-foundation.md).
- **Status: UNVERIFIED** (condition addressed in text; Codex: RESOLVED WITH CONDITIONS). **Owner decision:** D3, D7.

#### R2-03 — MAJOR — A trace id is insufficient evidence for a create retry

- **Requirement.** Correlation as a search aid; operation-specific identification and a settled outcome before resubmission; fence old writers; verify both. Review 3: a unique candidate can still be another create and there is no durable reconnect fence (now R3-01, R3-02).
- **Evidence.** [spec:418-431](../specs/S0-06-authentication-audit-foundation.md), [spec:372-408](../specs/S0-06-authentication-audit-foundation.md), [spec:432-447](../specs/S0-06-authentication-audit-foundation.md), AC-12 [spec:578](../specs/S0-06-authentication-audit-foundation.md), [plan:87-98](../plans/S0-06-implementation-plan.md).
- **Status: UNVERIFIED.** Codex (Review 3): PARTIALLY RESOLVED. **Owner decision:** D6.

#### R2-04 — MAJOR — `concurrency_conflict` payloads; FU-3 contract and tests

- **Requirement.** Both existing payloads, no raw input in error details, malformed and boundary tests, Stage 1 additive and Stage 2 breaking, contract comments in WP-01.
- **Evidence.** [spec:450-456](../specs/S0-06-authentication-audit-foundation.md), [spec:476-479](../specs/S0-06-authentication-audit-foundation.md), [spec:482-492](../specs/S0-06-authentication-audit-foundation.md), [spec:493-519](../specs/S0-06-authentication-audit-foundation.md), [spec:520-530](../specs/S0-06-authentication-audit-foundation.md), [spec:531-544](../specs/S0-06-authentication-audit-foundation.md), [spec:545-555](../specs/S0-06-authentication-audit-foundation.md), [register:40](../specs/S0-06-owner-decision-register.md), [register:107](../specs/S0-06-owner-decision-register.md), [plan:44](../plans/S0-06-implementation-plan.md), [plan:51](../plans/S0-06-implementation-plan.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED. **Owner decision:** D8 (C12 is a direction, not an approval). **Verification:** AC-5, AC-6a, AC-7, AC-8 in WP-01.

#### R2-05 — MINOR — Transaction-token validity and provenance

- **Requirement.** Internal port, callback token only, no handle-to-token claim, unknown-token and separate-connection tests.
- **Evidence.** [spec:254-262](../specs/S0-06-authentication-audit-foundation.md), [spec:263-272](../specs/S0-06-authentication-audit-foundation.md), AC-4 [spec:569](../specs/S0-06-authentication-audit-foundation.md), [plan:80](../plans/S0-06-implementation-plan.md), [plan:91](../plans/S0-06-implementation-plan.md).
- **Status: VERIFIED.** Codex (Review 3): RESOLVED. **Owner decision:** D6.

## 5. The nine gaps G-1 to G-9 (Review 3's verification and the follow-up)

| Gap                          | Codex, Review 3                                                                                 | Follow-up in this round                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| G-1 D9 start gate            | Verified; AC-13 conflict remained under R1-07                                                   | D9 now states AC-6 split and AC-13 in either branch: register:113                       |
| G-2 integration SHA          | Verified                                                                                        | none needed                                                                             |
| G-3 A5 gate                  | Verified                                                                                        | none needed                                                                             |
| G-4 issuer refusals          | Verified at contract level                                                                      | emission-attempt wording: spec:132, spec:137-139                                        |
| G-5 AC-9 to AC-11            | Verified; clarify the AC-9 exception for the compiled round trip and connection instrumentation | AC-9 lists the allowed artifacts: spec:575                                              |
| G-6 FU-3 coverage            | Verified                                                                                        | none needed                                                                             |
| G-7 contract comments        | Verified                                                                                        | none needed                                                                             |
| G-8 token and rollback tests | Verified as specified                                                                           | none needed                                                                             |
| G-9 deferred read exposure   | Partially verified: D9 must require the deferred tests, WP-06 must include AC-13 either way     | AC-13 in either branch, D9 and WP-06 updated: spec:579, register:113, plan:31, plan:102 |

## 6. Informational finding and supporting sections (not counted)

- **INFORMATIONAL (Review 1): status and follow-up tracking intact.** C1 to C14 are directions only; every D1 to D9 approval entry is unrecorded ([register:126-140](../specs/S0-06-owner-decision-register.md)); S0-05 ACCEPTED and CLOSED WITH CONDITIONS; FU-1 to FU-4 open; OBL-SEC-1 open. This branch changes no ADR Status line; A5 remains PROPOSED. Codex (Review 3) confirms A5 passes governance review as a proposal. **VERIFIED** (documentation).
- **Review 3, section 5 (public contracts and audit safety):** Stage 1 and Stage 2 contracts, audit atomicity, security and production isolation are confirmed as sufficiently specified for the synthetic phase, with the cutover caveat that the atomicity guarantee applies to the audited path and "cutover must establish that every permitted writer uses that path" (R3-01).

## 7. Remaining contradictions and known limits

I found **no** remaining contradiction among the S0-06 documents by search and re-read after this round (checked: D9 and AC-13 across the register, plan and specification; the AC-6 split; the two `correlation_id` reconciliation phrases; `application_name` as an observability aid in the register, plan and specification; "Exactly one event" wording). Items that are **not** contradictions but stay open:

1. [S0-06-readiness-summary.md:63](../specs/S0-06-readiness-summary.md) still says the Owner decision on the S0-05 prerequisite is "not yet recorded"; it carries a dated snapshot note and states no status.
2. The S0-05 specification and closure records still document the S0-05 error contracts; WP-01 does not edit them unless the Owner asks.
3. The local database has one owning role, so the fence's precondition (a non-login table owner and a dedicated writer role) is not met today; until the Owner decides D6 and the split is done, the text keeps writes held rather than assume it.
4. The fence does not bind the table owner or superusers; that is OBL-AUD-1.
5. The documents are reviewed by their author only; Codex's focused re-review is the next step.

## 8. Retired identifiers (matrix v2)

R1-T1 → R1-01, R1-08; R1-T2 → R1-02; R1-T3 → R1-03; R1-T4 → R1-04; R1-T5 → R1-05; R1-T6 → R1-06; R1-T7 → R2-04; R1-T8 → A5 (section 6); R1-T9 → R1-07, R1-08; R2-2 → R2-01; R2-3 and R2-4 → R2-02; R2-5 → R2-03; R2-6 → R2-04; R2-7 → R2-05; R2-8 → R1-06; R2-9 → R1-07, R1-08.

## 9. Remaining Owner decisions

| #   | Decision                                                                                                                                                                                                                                                 | Findings                          | Recommendation                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| 1   | D1: designate the specification as the baseline, or supply the Blueprint section                                                                                                                                                                         | R1-01                             | Designate                                                                       |
| 2   | D2: accept CLOSED WITH CONDITIONS as the implementation prerequisite; FU-3 = WP-01                                                                                                                                                                       | R1-01                             | Accept                                                                          |
| 3   | C11, D3, D8: confirm authenticated reads (Result-based) or defer reads under the explicitly constructed facade; approve Stage 1 additive and Stage 2 breaking separately                                                                                 | R1-03, R2-01, R3-03               | Confirm authenticated reads                                                     |
| 4   | D3: handle TTL (15 minutes), revocation, fixture exclusion, whether to wire `main.ts`                                                                                                                                                                    | R1-02, R1-03, R2-02               | As specified; do not wire in S0-06                                              |
| 5   | D5: decide Amendment A5 through the ADR workflow (no alternative, C13)                                                                                                                                                                                   | R1-06, R1-08                      | Accept A5                                                                       |
| 6   | **D6: the write fence (F1 required, F2 optional), the split of table ownership and writer role in the local setup, the `application_name` observability instrumentation, the unknown-outcome rule and operator-accepted resubmission, fail-closed cost** | R1-04, R1-05, R2-03, R3-01, R3-02 | Accept F1; decide F2 separately; add the instrumentation for observability only |
| 7   | D7: Security Log (including issuer-side refusals), retention, strict correlation format                                                                                                                                                                  | R1-06, R2-02                      | Accept; retention open                                                          |
| 8   | D8: exact FU-3 payloads (no raw input, C12); Stage 1 additive and Stage 2 breaking                                                                                                                                                                       | R2-04                             | Approve                                                                         |
| 9   | D4, D9: audited commands; acceptance criteria including AC-6a/6b and AC-13 in either branch; review cadence                                                                                                                                              | R1-01, R1-07, R3-03               | Accept                                                                          |
| 10  | OBL-AUD-1 as a production-deployment obligation                                                                                                                                                                                                          | R1-06                             | Record; not a gate                                                              |
| 11  | C14: the integration SHA, named in the written authorization                                                                                                                                                                                             | R1-08                             | Name it at authorization                                                        |

## 10. Readiness summary

**READY FOR FOCUSED CODEX RE-REVIEW. NOT ready for implementation authorization, and not approved.**

- Documentation status of the 16 rows: **VERIFIED 8, UNVERIFIED 8, PARTIAL 0, OPEN 0.** Nothing is marked RESOLVED by me; that determination belongs to Codex. Implementation verification is NOT_RUN for all rows because S0-06 is NOT STARTED.
- The three Review 3 findings (R3-01, R3-02, R3-03) and the conditions of R1-03 and R2-02 are addressed in the text; the rows that depend on them (R1-05, R1-07, R2-03) are UNVERIFIED until Codex re-reads them.
- **Next gate.** (1) Codex's focused re-review of spec 6.2 to 6.5, section 8 and D9. (2) The Owner records D1 to D9 and decides A5 through the ADR workflow. (3) Only then can the authorization gate ([register:159-169](../specs/S0-06-owner-decision-register.md)) open, with an Owner-approved integration SHA. None of that is done or authorized by this document.
