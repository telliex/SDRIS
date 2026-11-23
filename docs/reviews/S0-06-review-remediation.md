# S0-06 — Finding Traceability Matrix (v3, DRAFT)

**Status:** DRAFT. Traces the **13 findings** of two independent Codex architecture reviews to the revised S0-06 documents. It approves nothing and changes no decision. **S0-06 is NOT STARTED.**

- **Date:** 2026-11-23. **Verified against:** branch `docs/s0-06-contract-design` at `8ccbc48`. Every `file:line` below is a line of that HEAD; if the documents are edited the lines shift, so re-verify before relying on them.
- **Reviewed baseline (pinned):** `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21`.
- **Source reports (read in full; not committed):** `Pasted text(20261123-064613).txt` = **Review 1**, "S0-06 independent architecture review", reviewed HEAD `24b73c8`, recommendation REVISE. `Pasted text(20261123-070655).txt` = **Review 2**, "S0-06 remediation verification", reviewed HEAD `87a17bf`, recommendation REVISE.
- **Not yet independently reviewed:** the documents changed **after** Review 2 (specification v0.4, register v0.5, review v0.3, plan closure additions, commits `f087d5e` to `8ccbc48`). Review 2's reassessments therefore describe the earlier text; my own line-level check of the current text is recorded separately.

## 1. Conventions

**IDs.** R1-01 to R1-08 are the eight numbered findings of Review 1, in its order (1 BLOCKER, 5 MAJOR, 2 MINOR). R2-01 to R2-05 are the five new findings of Review 2, in its order (4 MAJOR, 1 MINOR). Review 1's INFORMATIONAL row (status and follow-up tracking) is **not** counted; it is checked in section 5. The earlier task-keyed IDs of matrix v2 (R1-T1 to R1-T9, R2-2 to R2-10) are retired; section 6 maps them.

**Resolution status.** The four statuses requested, applied to the **documentation only**:

| Status         | Meaning                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**   | Every requirement of the finding is present in the current text (my line-level check) **and** the latest independent assessment did not contradict it.                                   |
| **PARTIAL**    | At least one requirement is missing or contradicted in the current text (a gap I found), or the reviewer's partial assessment still stands. The gap is named.                            |
| **UNVERIFIED** | The current text appears to meet every requirement on my check, but the latest independent assessment was PARTIAL (or the finding is new) and the revision has **not** been re-reviewed. |
| **OPEN**       | Not addressed. (No finding is OPEN.)                                                                                                                                                     |

**Two kinds of verification are kept apart.** _Documentation verification_ is reading the current text against the requirement; it is what these statuses record, and the author of the revision cannot make it independent. _Implementation verification_ is running tests against code. **None exists: S0-06 is NOT STARTED, so every implementation check below is NOT_RUN.** No status here asserts that any behaviour works. A formal Owner approval is a third, separate thing and is also pending for every decision.

## 2. Summary

| ID    | Sev.    | Finding (short)                                                         | Review 2 reassessment of Review 1 | Documentation status                 | Implementation |
| ----- | ------- | ----------------------------------------------------------------------- | --------------------------------- | ------------------------------------ | -------------- |
| R1-01 | BLOCKER | D2 prerequisite and FU-3 ordering; D1 baseline; D9 timing               | RESOLVED                          | **PARTIAL** (one contradiction, G-1) | NOT_RUN        |
| R1-02 | MAJOR   | Actor trust contract                                                    | PARTIALLY RESOLVED                | **UNVERIFIED**                       | NOT_RUN        |
| R1-03 | MAJOR   | Synthetic deployment, caller boundaries, reads                          | PARTIALLY RESOLVED                | **PARTIAL** (G-9)                    | NOT_RUN        |
| R1-04 | MAJOR   | Audit adapter on the wrong persistence interface                        | RESOLVED                          | **VERIFIED** (documentation)         | NOT_RUN        |
| R1-05 | MAJOR   | Rollback could resume unaudited writes                                  | PARTIALLY RESOLVED                | **UNVERIFIED**                       | NOT_RUN        |
| R1-06 | MAJOR   | Audit record and denial-log integrity                                   | PARTIALLY RESOLVED                | **PARTIAL** (G-4)                    | NOT_RUN        |
| R1-07 | MINOR   | Acceptance criteria and commit boundaries                               | PARTIALLY RESOLVED                | **PARTIAL** (G-5)                    | NOT_RUN        |
| R1-08 | MINOR   | Governance references                                                   | PARTIALLY RESOLVED                | **PARTIAL** (G-1, G-2, G-3)          | NOT_RUN        |
| R2-01 | MAJOR   | Authenticated read contract has no error channel                        | new                               | **PARTIAL** (G-9)                    | NOT_RUN        |
| R2-02 | MAJOR   | Denial contract and synthetic startup path                              | new                               | **PARTIAL** (G-4)                    | NOT_RUN        |
| R2-03 | MAJOR   | A trace id is insufficient evidence for a create retry; cutover fencing | new                               | **UNVERIFIED**                       | NOT_RUN        |
| R2-04 | MAJOR   | Wrong existing `concurrency_conflict` payload; FU-3 contract and tests  | new                               | **PARTIAL** (G-6, G-7)               | NOT_RUN        |
| R2-05 | MINOR   | Transaction-token validity versus provenance                            | new                               | **PARTIAL** (G-8)                    | NOT_RUN        |

**Counts (documentation):** VERIFIED 1, UNVERIFIED 3, PARTIAL 9, OPEN 0. **Severity check:** Review 1 = 1 BLOCKER + 5 MAJOR + 2 MINOR = 8; Review 2 = 4 MAJOR + 1 MINOR = 5; total 13, as stated by the Owner.

The gaps G-1 to G-9 are defined in section 4. Each is a small, local text correction; none needs a new design decision except where marked.

## 3. Finding detail

### Review 1

#### R1-01 — BLOCKER — D2 cannot open the implementation gate as written

- **Original requirement.** Either accept S0-05 conditional closure **for implementation** with a precise FU-3 ordering rule, or authorise FU-3 separately before S0-06 starts. The plan allowed WP-02 and WP-04 before WP-01; Review 1 later accepts that they are independently testable once D2 is settled and WP-05 depends on FU-3, authorization and audit persistence. D1: record the authoritative baseline or reconcile with the Blueprint. D9: decide the verification criteria **before** the packages they govern; record final evidence at WP-06. Readiness prerequisite reference.
- **Remediation tasks.** Matrix v2 R1-T1, R2-9. Review 2 reassessment: **RESOLVED** (design level); Owner approval of D1/D2 pending.
- **Current evidence.**
  - D2 accepts the conditional closure as an **implementation** prerequisite; FU-3 = WP-01 completed and reviewed before dependent integration; WP-02, WP-04 independent; FU-1/2/4 tracked separately; OBL-SEC-1 a production obligation: [register:52-63](../specs/S0-06-owner-decision-register.md).
  - D1 baseline as the proposed authoritative alternative, subject to approval: [register:45-51](../specs/S0-06-owner-decision-register.md).
  - Package dependencies: independent WP-02/WP-04; blocked by WP-01: WP-03, WP-05, WP-06: [plan:14-25](../plans/S0-06-implementation-plan.md); [plan:41-52](../plans/S0-06-implementation-plan.md) (WP-01).
  - D9 sequence (criteria approved before, evidence during, consolidated in WP-06): [register:110](../specs/S0-06-owner-decision-register.md); [plan:27-38](../plans/S0-06-implementation-plan.md); [spec:491-493](../specs/S0-06-authentication-audit-foundation.md).
  - Readiness-summary prerequisite: [S0-06-readiness-summary.md:63](../specs/S0-06-readiness-summary.md) still says the Owner decision is "not yet recorded"; it carries a dated snapshot note and is not a status, so it is not a defect.
- **Gap.** **G-1:** [register:111](../specs/S0-06-owner-decision-register.md) says D9 "Blocks implementation: **no** for starting WP-01 to WP-05", which contradicts the register's own gate ([register:160](../specs/S0-06-owner-decision-register.md): "D9's requirements are approved") and the plan ([plan:12](../plans/S0-06-implementation-plan.md), [plan:27](../plans/S0-06-implementation-plan.md)). The core requirement (D2 and the FU-3 ordering rule) is met; only the D9 clause is contradicted.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D1, D2, D9 (all unrecorded: [register:123-137](../specs/S0-06-owner-decision-register.md)).
- **Verification requirement.** Documentation: correct G-1 and have the reviewer re-read register D9 and section 8. Implementation: none for this finding (a governance finding); the ordering is enforced by the authorization gate, not by a test.

#### R1-02 — MAJOR — Actor verification: incomplete runtime trust contract

- **Original requirement.** An opaque handle backed by issuer-private canonical claims; a trusted clock and expiry rule; the permitted reuse of a verified handle (replay policy); behaviour for another issuer's handles; protection of nested values (a frozen wrapper does not make a `Set` immutable); Human/System, Actor UUIDv7 and permissions derived from fixture data; authentication and authorization **before** opening a transaction, including direct calls.
- **Remediation tasks.** Matrix v2 R1-T2, R2-3. Review 2: **PARTIALLY RESOLVED** (the resolver result cannot carry denial reasons; the two precedence descriptions disagree).
- **Current evidence.**
  - Opaque member-less handle in an issuer-private `WeakMap`: [spec:48-51](../specs/S0-06-authentication-audit-foundation.md).
  - Canonical claims, flat frozen sorted permission array (no `Set`), fixed UUIDv7 actor id, kind from the principal table: [spec:52-64](../specs/S0-06-authentication-audit-foundation.md); fresh deep-frozen copy per resolve: [spec:73](../specs/S0-06-authentication-audit-foundation.md).
  - Typed internal resolver outcome (`valid`, `missing`, `invalid`, `expired`, `revoked`), trusted injected clock, 15-minute TTL, expiry at `now >= expiresAt`, permanent revocation, reuse and no sliding window, foreign-issuer indistinguishable from forged: [spec:65-93](../specs/S0-06-authentication-audit-foundation.md).
  - One canonical order (Authentication → Correlation Validation → Authorization → Domain Validation → Transaction), checked before the transaction, applied to direct calls: [spec:102-120](../specs/S0-06-authentication-audit-foundation.md). The same order is quoted at [plan:68](../plans/S0-06-implementation-plan.md), [register:71](../specs/S0-06-owner-decision-register.md) and [review:200](S0-06-contract-design-review.md), and [review:123](S0-06-contract-design-review.md) agrees; I found no document that states a different order.
  - Human/System: [spec:94-96](../specs/S0-06-authentication-audit-foundation.md).
- **Gap.** None found on my check. Both Review 2 residuals are addressed in the text, but Review 2 has not seen it.
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D3 (handle TTL 15 minutes, revocation policy).
- **Verification requirement.** Documentation: reviewer re-reads spec 2.4 and 2.7. Implementation (WP-02, WP-03): AC-1 and AC-2 (every resolver outcome, expiry at `expiresAt - 1 ms` and `expiresAt`, forged and foreign handles, no transaction on rejection, direct-call parity, order tests per command).

#### R1-03 — MAJOR — Synthetic deployment and caller boundaries

- **Original requirement.** A trusted configuration source; fail-closed behaviour for missing or invalid configuration; a production startup or packaging test; fixture tokens usable only in a controlled synthetic environment and kept out of logs; how authorised tests obtain contexts **without widening issuer imports**; the allowlist supplies no issuer-specific rule and `apps/worker` is outside the Investigation composition roots; reads need an explicit Owner disposition and exposure boundary.
- **Remediation tasks.** Matrix v2 R1-T3, R2-4. Review 2: **PARTIALLY RESOLVED** (the API entrypoint does not compose Investigation; startup wiring and fixture-free build path unspecified).
- **Current evidence.**
  - Verified composition facts (`main.ts` does not call composition; `composeInvestigation` is the approved entrypoint): [spec:141](../specs/S0-06-authentication-audit-foundation.md). Check against code: `apps/api/src/main.ts` and `apps/api/src/composition/investigation.composition.ts`.
  - Trusted configuration source, positive-match fail-closed rule, production refusal with `SYNTHETIC_IDENTITY_FORBIDDEN`, no credential strings, fixtures excluded from the build through `apps/api/tsconfig.build.json`, authorised fixture access, issuer import restrictions without allowlist change, worker limitation: [spec:143-152](../specs/S0-06-authentication-audit-foundation.md); [plan:57](../plans/S0-06-implementation-plan.md).
  - Paired positive and negative compiled tests and the packaging scan: [spec:154-160](../specs/S0-06-authentication-audit-foundation.md).
  - Credentials and logs: no credential strings in Phase 1 ([spec:148](../specs/S0-06-authentication-audit-foundation.md)); redaction row ([spec:312](../specs/S0-06-authentication-audit-foundation.md)).
  - The static-token recommendation of the contract review is withdrawn at [review:65](S0-06-contract-design-review.md); no other live recommendation remains (checked by search).
- **Gap.** **G-9** (shared with R2-01): the alternative in which the Owner **defers** read authentication has no defined exposure rule. [spec:162-197](../specs/S0-06-authentication-audit-foundation.md) compares only Result-based, exception-based and silent-`undefined` options; the sentence on exposure ([spec:197](../specs/S0-06-authentication-audit-foundation.md), "reachable only through the service object returned by the approved composition root") does not say who may receive that object after creation, which Review 2 asks to be defined if read authentication is deferred.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D3 (fixture exclusion, whether to wire `main.ts`, reads), C11.
- **Verification requirement.** Documentation: close G-9. Implementation: AC-1 startup tests at the composition entrypoint (unit in WP-02, compiled in WP-06), the `dist` packaging scan, AC-9 (no allowlist diff), AC-13.

#### R1-04 — MAJOR — Audit adapter described against the wrong persistence interface

- **Original requirement.** Use the same `PersistenceHandle` and active transaction token through the existing adapter boundary (`executorOf(handle, tx)`), with runtime rejection of missing or invalid tokens on audit writes (a missing token would select the pool executor); keep adapter and ORM types inside Investigation infrastructure.
- **Remediation tasks.** Matrix v2 R1-T4. Review 2: **RESOLVED**.
- **Current evidence.** [spec:224-241](../specs/S0-06-authentication-audit-foundation.md) (handle, `executorOf`, missing-token guard `AuditTransactionRequiredError`, infrastructure rejection of unknown and ended tokens, ORM types stay in infrastructure; the pool fallback is explained); [plan:75-84](../plans/S0-06-implementation-plan.md) (WP-04); [register:88-95](../specs/S0-06-owner-decision-register.md) (D6); AC-4: [spec:500](../specs/S0-06-authentication-audit-foundation.md). Code facts re-checked: `infrastructure/database/src/persistence-handle.ts` (`executorOf` delegates to `executorFor(db, tx)`) and `unit-of-work.ts` (`executorFor` returns `db` when `tx` is undefined).
- **Gap.** None for this finding. (Test-case completeness for the token is tracked at R2-05.)
- **Status: VERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6 (same-unit, fail-closed contract and its availability cost).
- **Verification requirement.** Documentation: none further. Implementation (WP-04, WP-05): AC-4 on real PostgreSQL.

#### R1-05 — MAJOR — Rollback could silently resume unaudited writes

- **Original requirement.** An activation point after migration and schema verification; if auditing fails after activation, hold writes or restore a working audit-capable build; deployment order; schema-failure recovery; forward repair for applied migrations; for a lost commit acknowledgment, reconcile the outcome before replaying a create. (Review 1's WP-05 test section also asks for fresh and `0002` upgrade runs, unchanged prior checksums and inspection through a separate connection.)
- **Remediation tasks.** Matrix v2 R1-T5, R2-5. Review 2: **PARTIALLY RESOLVED** (older writers can still run during cutover; a trace lookup does not settle a create).
- **Current evidence.** Cutover procedure with the activation point, draining and fencing, verification, completeness query and fail-closed rule: [spec:341-350](../specs/S0-06-authentication-audit-foundation.md); recovery that never restores unaudited writes and forward repair: [spec:352-359](../specs/S0-06-authentication-audit-foundation.md); unknown outcomes: [spec:361-369](../specs/S0-06-authentication-audit-foundation.md); six verification tests: [spec:371-378](../specs/S0-06-authentication-audit-foundation.md); AC-12: [spec:508](../specs/S0-06-authentication-audit-foundation.md); plan: [plan:86-96](../plans/S0-06-implementation-plan.md). Fresh and `0002` runs and unchanged checksums: AC-10 [spec:506](../specs/S0-06-authentication-audit-foundation.md). Fact check: the database connection sets no `application_name` today (`infrastructure/database/src/connection.ts` builds a `Pool` with `max` only), so the fence of [spec:347](../specs/S0-06-authentication-audit-foundation.md) needs a small change; the text states this and leaves it as an Owner decision ([spec:347](../specs/S0-06-authentication-audit-foundation.md)).
- **Gap.** None in the requirements. The separate-connection inspection is not stated for the service-level atomicity tests (included in G-8).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6: availability cost, cutover rule; add `application_name` to the connection or accept an operational-only fence.
- **Verification requirement.** Documentation: reviewer re-reads spec 6. Implementation (WP-05): the six tests of 6.5, AC-12.

#### R1-06 — MAJOR — Audit record and denial log need concrete integrity guarantees

- **Original requirement.** Investigation-specific `details` validation, per-action subject relationships, restriction to the persisted Phase 1 subset; the `case_id` contract (including whether `case_opened` is case history and the FK's effect on deletion); source and correlation provenance; per-action allowlist; trusted database roles and how `TRUNCATE`, DDL and privileged access are controlled or excluded; for security logs a redacted field list, access and retention policy and sink-failure behaviour; **cover credential failures at the provider even when no service call occurs**.
- **Remediation tasks.** Matrix v2 R1-T6, R2-8. Review 2: **PARTIALLY RESOLVED** (gaps around caller-provided trace fields and issuance failures); Review 2 also asks for an explicit persisted allowlist for `source`, `causationId` and correlation, and a controlled source vocabulary.
- **Current evidence.** Audit columns: [spec:242-258](../specs/S0-06-authentication-audit-foundation.md); actions, subjects, details allowlist, timestamp equality per action: [spec:260-271](../specs/S0-06-authentication-audit-foundation.md); `case_id` rule and `NO ACTION` foreign key and the reject-not-cascade deletion policy: [spec:273-276](../specs/S0-06-authentication-audit-foundation.md); provenance and allowlists for `source` (closed set), `correlationId` (strict UUID, replaced if not conforming), `causationId` (null in Phase 1), `details`: [spec:278-295](../specs/S0-06-authentication-audit-foundation.md); trigger limits, `TRUNCATE`, DDL, roles, OBL-AUD-1: [spec:297-304](../specs/S0-06-authentication-audit-foundation.md); logging layer, event and reason sets, redaction, retention, sink failure: [spec:305-316](../specs/S0-06-authentication-audit-foundation.md).
- **Gap.** **G-4:** every Security Log event is emitted by the **service** ([spec:305](../specs/S0-06-authentication-audit-foundation.md)). A refusal that happens **in the issuer before any handle or service call exists** (an unknown principal key, a forbidden synthetic issuance, a bad credential once HTTP exists) has no event, no reason code and no test. Review 1 asked for provider-level credential failures; Review 2 repeats it for "invalid principal-key requests before a handle exists". Proposed correction: an issuer-side event `security.issuance_refused` with closed reasons (`unknown_principal`, `synthetic_forbidden`, `invalid_credential`) through the same `SecurityLog` port, one per refusal, with the same redaction rules, and a test in WP-02.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D5, D7 (non-authoritative denial records, retention), OBL-AUD-1, the strict correlation format.
- **Verification requirement.** Documentation: add G-4. Implementation: AC-3 (row content and timestamp equality), AC-2 (log content), migration check constraints in AC-10; OBL-AUD-1 checks (effective grants; non-owner `DROP TRIGGER`, `DISABLE TRIGGER`, `TRUNCATE` all fail) before any production deployment.

#### R1-07 — MINOR — Acceptance criteria and commit boundaries disagree

- **Original requirement.** AC-9 allowed audit code only under Investigation while the SQL migration lives in global infrastructure; AC-11 limited changes to actor and FU-3 cases although WP-04 must update migration inventories and compiled-runtime expectations; WP-02 and WP-06 both claimed the identity checker work. Put checker enforcement and fixtures with the issuer boundary in WP-02, migration-inventory updates with `0003`, the integrated regression run in WP-06; specify which persisted timestamp AC-3 compares for each action.
- **Remediation tasks.** Matrix v2 R1-T9, R2-9. Review 2: **PARTIALLY RESOLVED** (AC-9 vs AC-10, AC-11 still inconsistent).
- **Current evidence.** Assignments are correct: checker rules in WP-02 [plan:53-62](../plans/S0-06-implementation-plan.md), inventory in WP-04 [plan:75-84](../plans/S0-06-implementation-plan.md), integrated verification only in WP-06 [plan:98-106](../plans/S0-06-implementation-plan.md); per-action timestamp equality [spec:260-271](../specs/S0-06-authentication-audit-foundation.md) and AC-3 [spec:499](../specs/S0-06-authentication-audit-foundation.md); AC-10 names the real migration path and the inventory tests [spec:506](../specs/S0-06-authentication-audit-foundation.md).
- **Gap.** **G-5:** [spec:505](../specs/S0-06-authentication-audit-foundation.md) (AC-9) still reads "audit code exists only under `modules/investigation`" with no carve-out for the migration that AC-10 places in `infrastructure/database/migrations`; [spec:507](../specs/S0-06-authentication-audit-foundation.md) (AC-11) still says changes to existing tests are "limited to the FU-3 cases (WP-01) and the `context` argument (WP-03)", which contradicts WP-04's required updates to `migrations.integration.test.ts`, `migrations.spec.ts` and the compiled-runtime child ([plan:75-84](../plans/S0-06-implementation-plan.md)).
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D9 (approve the corrected criteria before execution).
- **Verification requirement.** Documentation: correct AC-9 and AC-11 and re-read them against the plan's scopes. Implementation: the AC evidence per package, consolidated in WP-06.

#### R1-08 — MINOR — Two governance references

- **Original requirement.** D6's description of Decision 5 as conditional until A2 takes effect is stale (the condition is satisfied in the effective policy); pin the reviewed base by SHA and require explicit verification of the **integration** base before cutting implementation branches. Review 2 adds: record the **approved integration SHA** as the branch point; do not say "current main"; the matrix and register must agree that D9 requirements are approved before any package starts.
- **Remediation tasks.** Matrix v2 R1-T9, R2-9. Review 2: **PARTIALLY RESOLVED**.
- **Current evidence.** Decision 5 corrected: [register:93](../specs/S0-06-owner-decision-register.md); effective-policy basis `docs/adr/ADR-025-effective-policy.md:190-196` (A2 section, "satisfaction of the condition"); pinned base and the integration-base verification procedure: [spec:6](../specs/S0-06-authentication-audit-foundation.md), [register:6](../specs/S0-06-owner-decision-register.md), [plan:5-6](../plans/S0-06-implementation-plan.md).
- **Gap.** **G-1** (D9 "Blocks implementation: no", [register:111](../specs/S0-06-owner-decision-register.md)). **G-2:** the start gate still says a branch is cut "from the then-current `main`" and compared with `ae7dc51` ([register:163](../specs/S0-06-owner-decision-register.md), [plan:12](../plans/S0-06-implementation-plan.md)), instead of recording an **Owner-approved integration SHA** in the authorization. **G-3:** [register:162](../specs/S0-06-owner-decision-register.md) allows "A5 (or the Owner's recorded alternative for D5)" while [plan:12](../plans/S0-06-implementation-plan.md) and A5's own approval sequence require A5 **ACCEPTED**; the alternative is unspecified.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D9; D5 (whether any alternative to A5 exists).
- **Verification requirement.** Documentation: correct G-1, G-2, G-3. Implementation: at each package start the recorded integration SHA, the ancestry check against `ae7dc51` and the file-drift diff (spec front matter, plan integration-base rule).

### Review 2 (new findings)

#### R2-01 — MAJOR — Authenticated read contract cannot keep its return types and also promise explicit denials

- **Original requirement.** Define a `Result` or another explicit failure contract; update the compatibility inventory and tests; map `composeInvestigation` callers and direct factory callers, including the API integration tests and the compiled child; **if the Owner defers read authentication, define who may receive the service object** (an import allowlist does not constrain where an already-created object goes).
- **Remediation tasks.** Matrix v2 R2-2 (the Owner's C11 direction).
- **Current evidence.** Three options compared and Result-based recommended, exact signatures, `AccessError`, absence kept as `ok(undefined)`: [spec:162-197](../specs/S0-06-authentication-audit-foundation.md); caller inventory (service spec, two integration tests, compiled child, `composeInvestigation`, `createInvestigationModule`, type-surface test): [spec:199-211](../specs/S0-06-authentication-audit-foundation.md) and [spec:476-485](../specs/S0-06-authentication-audit-foundation.md) (7.6); AC-13: [spec:509](../specs/S0-06-authentication-audit-foundation.md); register C11 and D3: [register:70](../specs/S0-06-owner-decision-register.md). Caller sites re-checked by search of the repository: `investigation-service.spec.ts` (8), `investigation-links.integration.test.ts` (30), `investigation.integration.test.ts` (3), `compiled-runtime.child.cjs` (8).
- **Gap.** **G-9:** the deferral alternative and the "who may receive the service object" rule are not defined (see R1-03).
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** C11 confirmation (breaking Stage 2 read contract); D3, D8.
- **Verification requirement.** Documentation: close G-9. Implementation (WP-03): AC-13; every caller in the inventory updated; Stage 1 reads unchanged (AC-11).

#### R2-02 — MAJOR — Denial contract and synthetic startup path underspecified

- **Original requirement.** A resolver returning only claims or `undefined` cannot communicate `expired_handle` or `revoked_handle`: define an internal typed outcome or assign emission to one trusted layer; test **one event per rejection, including invalid principal-key requests before a handle exists**; specify the expiry boundary (`now >= expiresAt`); align the precedence table with the service text on whether invalid correlation or missing permission wins; choose the bootstrap or composition entrypoint that performs environment refusal and test that an otherwise valid local startup works so an unrelated failure cannot satisfy the production test; clarify fixture access consistently across the specification and WP-02; retire the static-token recommendation.
- **Remediation tasks.** Matrix v2 R2-3, R2-4.
- **Current evidence.** Typed outcome and one trusted emitting layer (the service) and `now >= expiresAt`: [spec:65-93](../specs/S0-06-authentication-audit-foundation.md); single order, correlation before authorization: [spec:102-115](../specs/S0-06-authentication-audit-foundation.md); entrypoint `composeInvestigation`, paired positive and negative startup tests with a specific error code: [spec:141](../specs/S0-06-authentication-audit-foundation.md), [spec:154-160](../specs/S0-06-authentication-audit-foundation.md); fixture access consistent in [spec:149-150](../specs/S0-06-authentication-audit-foundation.md) and [plan:57](../plans/S0-06-implementation-plan.md); static tokens withdrawn: [review:65](S0-06-contract-design-review.md); AC-1: [spec:497](../specs/S0-06-authentication-audit-foundation.md).
- **Gap.** **G-4:** "invalid principal-key requests before a handle exists" are not covered by any event or test (same gap as R1-06). Everything else in the requirement is addressed in the text.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D3 (TTL; wiring `main.ts` is out of scope unless asked), D7.
- **Verification requirement.** Documentation: add G-4. Implementation: AC-1 (including the one-event-per-rejection test and the issuance-refusal test once G-4 is added) in WP-02 and the compiled pair in WP-06.

#### R2-03 — MAJOR — A trace id is insufficient evidence for a create retry; cutover must fence old writers

- **Original requirement.** Treat correlation as a search aid; require positive identification of the operation and a settled outcome before a new create; if unavailable, keep the unknown outcome for operator reconciliation; at cutover drain or fence pre-activation writers, including overlapping builds; verify **both** in WP-05 and AC-12.
- **Remediation tasks.** Matrix v2 R2-5.
- **Current evidence.** Correlation as search aid, specific-operation identification, UNKNOWN preserved, no automatic retry on a missing audit row: [spec:361-369](../specs/S0-06-authentication-audit-foundation.md) (line 367 for the search-aid rule); stop, drain or fence and verify no old writer: [spec:341-350](../specs/S0-06-authentication-audit-foundation.md); verification of overlapping builds and settling unknown creates: [spec:371-378](../specs/S0-06-authentication-audit-foundation.md); AC-12: [spec:508](../specs/S0-06-authentication-audit-foundation.md); WP-05: [plan:86-96](../plans/S0-06-implementation-plan.md). The text names the weakest case (`uut_registered` has no details).
- **Gap.** None found on my check. The fence depends on an Owner decision about `application_name`.
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6 (`application_name` change or an operational-only fence with accepted residual risk); a client-supplied operation identifier is deferred with Decision 7's idempotency middleware.
- **Verification requirement.** Documentation: reviewer re-reads spec 6.2, 6.4, 6.5. Implementation (WP-05): all six tests of 6.5.

#### R2-04 — MAJOR — Wrong existing `concurrency_conflict` payload; FU-3 contract and tests

- **Original requirement.** Preserve both existing payloads (service: `expectedVersion` and `actualVersion`; repository compare-and-save: `expectedVersion` only) and test them separately; keep the stated precedence and PostgreSQL `integer`; **decide whether to omit finite raw invalid inputs**, as Review 1 recommended ("omit the raw input from error details"); specify the Stage 1 union widening as compile-visible and approve the breaking Stage 2 separately; test `MAX - 1` → `MAX`, matching duplicates and different-role links at `MAX`, stale duplicates, and each earlier failure paired with an invalid version. Review 1 adds: amend the **public contract comments**; cover omitted, `undefined`, `null`, strings, boxed numbers, bigint, **booleans**, objects, `NaN`, infinities, fractions, zero, negatives, `MAX + 1` and unsafe integers.
- **Remediation tasks.** Matrix v2 R1-T7, R2-6.
- **Current evidence.** Both payload shapes, verified in code (`investigation-service.ts` service comparison; `drizzle-investigation-repository.ts` `save`): [spec:411-425](../specs/S0-06-authentication-audit-foundation.md) (7.4.1); `invalid_expected_version` and `version_exhausted` as separate contracts: [spec:427-461](../specs/S0-06-authentication-audit-foundation.md); stages: [spec:382-386](../specs/S0-06-authentication-audit-foundation.md); precedence: [spec:388-405](../specs/S0-06-authentication-audit-foundation.md); tests: [spec:463-474](../specs/S0-06-authentication-audit-foundation.md); compatibility inventory: [spec:476-485](../specs/S0-06-authentication-audit-foundation.md); `integer` unchanged: [spec:487-489](../specs/S0-06-authentication-audit-foundation.md); plan WP-01: [plan:41-52](../plans/S0-06-implementation-plan.md).
- **Gaps.** **G-6:** (a) [spec:445](../specs/S0-06-authentication-audit-foundation.md) (`actual?: number`) **echoes finite numeric input**, which departs from Review 1's "omit the raw input" and Review 2 asks for an explicit decision; the text records the choice but not the decision or its reason; (b) the value list of [spec:409](../specs/S0-06-authentication-audit-foundation.md) (7.3) omits **booleans** and an **omitted** property; (c) [spec:463-474](../specs/S0-06-authentication-audit-foundation.md) (7.5) has no explicit **different-role link at `MAX`** and no sequential `MAX - 1` → `MAX` success case (the boundary race covers it only partly). **G-7:** no document assigns the update of the **public contract comments** in `investigation-service.ts` (Review 1's FU-3 section) to WP-01.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D8 (exact payloads, including whether to echo finite numbers; Stage 1 additive and Stage 2 breaking approved separately).
- **Verification requirement.** Documentation: close G-6 and G-7. Implementation (WP-01): the eight test groups of 7.5, once extended, on real PostgreSQL for the races; AC-5 to AC-8.

#### R2-05 — MINOR — Transaction-token validity and provenance are distinct

- **Original requirement.** Document that the port is internal and that only the current callback's token may be passed; **do not claim handle-to-token binding** from the existing registry; PostgreSQL verification of an omitted token, an **unknown** token, an ended token, a real audit-insert failure after the link and version writes, and a failure after a successful audit insert but before commit; verify **both tables** after rollback.
- **Remediation tasks.** Matrix v2 R2-7.
- **Current evidence.** Internal port, callback token only, infrastructure rejects unknown and ended tokens, **provenance not enforced and not claimed**: [spec:226-233](../specs/S0-06-authentication-audit-foundation.md); rollback verifications (insertion failure, failure after insert before commit including a commit-time deferred constraint, missing token, ended token): [spec:236-241](../specs/S0-06-authentication-audit-foundation.md); AC-4: [spec:500](../specs/S0-06-authentication-audit-foundation.md); code facts: `unit-of-work.ts` `executorFor` throws for unknown and ended contexts and returns the pool for `undefined`; the registry is keyed by context only.
- **Gap.** **G-8:** the verification list has **no unknown-token case** (a hand-made object), and the **separate-connection inspection** that Review 1 requires after transaction completion is stated only for the missing-token case ([spec:239](../specs/S0-06-authentication-audit-foundation.md)), not for the rollback cases.
- **Status: PARTIAL** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6.
- **Verification requirement.** Documentation: close G-8. Implementation (WP-04 adapter, WP-05 service): AC-4 on real PostgreSQL, inspecting both tables through a separate connection.

## 4. Gaps and contradictions found (documentation corrections needed)

None of these is applied by this commit; the matrix records the state at `8ccbc48`. Each is a local text change. **A design decision is needed only for G-6(a).**

| ID  | Gap or contradiction                                                                                                                                        | Where                                            | Correction proposed                                                                                              | Findings     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------ |
| G-1 | D9 "Blocks implementation: no" contradicts the gate (D9 requirements approved before any package)                                                           | register:111 vs register:160, plan:12, plan:27   | Change to "yes: requirements approved before any package starts; final evidence consolidated in WP-06"           | R1-01, R1-08 |
| G-2 | Gate and plan say "then-current `main`" instead of an Owner-approved integration SHA                                                                        | register:163, plan:12                            | Require the authorization to record the integration SHA, the ancestry check against `ae7dc51` and the drift diff | R1-08        |
| G-3 | Register allows "A5 (or the Owner's recorded alternative for D5)"; plan and A5 require A5 ACCEPTED; the alternative is undefined                            | register:162 vs plan:12, ADR-025:771-787         | Make both say A5 ACCEPTED, or specify the alternative                                                            | R1-08        |
| G-4 | No security event or test for refusals in the issuer before any handle or service call exists                                                               | spec:305-316, spec:121-123, spec:497, plan:53-62 | Issuer-side `security.issuance_refused` with closed reasons, one per refusal, same redaction, test in WP-02      | R1-06, R2-02 |
| G-5 | AC-9 lacks the migration carve-out; AC-11 forbids test changes that WP-04 requires                                                                          | spec:505, spec:507 vs plan:75-84                 | Carve out the `0003` migration in AC-9; allow the inventory and compiled-runtime child updates in AC-11 (WP-04)  | R1-07        |
| G-6 | Finite numeric input echoed (vs Review 1); 7.3 omits booleans and an omitted property; 7.5 lacks different-role at `MAX` and a sequential `MAX - 1` → `MAX` | spec:445, spec:409, spec:463-474                 | Owner decides (a); add the missing values and cases                                                              | R2-04        |
| G-7 | Update of the public contract comments not assigned                                                                                                         | plan:41-52                                       | Add it to WP-01 scope                                                                                            | R2-04        |
| G-8 | Unknown-token case and separate-connection inspection missing from the token verification list                                                              | spec:236-241                                     | Add both                                                                                                         | R2-05        |
| G-9 | No exposure rule for the alternative in which read authentication is deferred                                                                               | spec:162-197                                     | Define who may receive the service object, or drop the alternative                                               | R1-03, R2-01 |

## 5. Informational finding and supporting sections (not counted)

- **INFORMATIONAL (Review 1): status and follow-up tracking intact.** Checked: C1 to C10 are directions only and every D1 to D9 approval entry is unrecorded ([register:25-39](../specs/S0-06-owner-decision-register.md), [register:123-137](../specs/S0-06-owner-decision-register.md)); S0-05 ACCEPTED WITH CONDITIONS and CLOSED WITH CONDITIONS; FU-1 to FU-4 open and unscheduled; OBL-SEC-1 open. Status: **VERIFIED** (documentation). The branch changes no ADR Status line outside the new A5.
- **ADR-025 Decision 7 and A5 (Review 1 section; Review 2 section "Amendment A5").** Review 2: "passes governance review as a draft". A5 is at [ADR-025:771-787](../adr/ADR-025-postgresql-persistence-architecture.md), Status PROPOSED, Decision 7 unchanged, other deferrals listed, no allowlist change. Approval sequence (checklist, effective-policy section, separate Status commit) is the Owner's. Residual: G-3. A5 itself needed no change.
- **Owner decision table of Review 1.** D1 to D9 dispositions are reflected in the register's section 4; none is recorded as decided.
- **FU-3 section of Review 1.** Mapped to R2-04 (precedence, runtime validation, payloads, compatibility, tests). Its "amend the public contract comments" item is G-7.
- **Audit atomicity and plan section of Review 1.** Mapped to R1-04, R1-05, R2-05 (one correctly attributed row per successful command, zero rows for non-mutation outcomes, no partial commits, real SQL insert failure after the link and version bump, `0003` on fresh and `0002` databases, unchanged checksums, compiled-runtime verification, architecture checker, full regression). The package independence it states (WP-01, WP-02, WP-04 independent once D2 is settled; WP-03 after WP-02; WP-05 after FU-3, authorization and audit persistence; WP-06 consolidates) matches [plan:14-25](../plans/S0-06-implementation-plan.md).

## 6. Mapping from the retired matrix v2

| Retired ID | Now                                                          |
| ---------- | ------------------------------------------------------------ |
| R1-T1      | R1-01, R1-08 (D1, D2, D9)                                    |
| R1-T2      | R1-02                                                        |
| R1-T3      | R1-03                                                        |
| R1-T4      | R1-04                                                        |
| R1-T5      | R1-05                                                        |
| R1-T6      | R1-06                                                        |
| R1-T7      | R2-04 (FU-3 contract; Review 1 had no numbered FU-3 finding) |
| R1-T8      | A5 (section 5; not a numbered finding)                       |
| R1-T9      | R1-07, R1-08                                                 |
| R2-2       | R2-01                                                        |
| R2-3, R2-4 | R2-02 (and R1-02)                                            |
| R2-5       | R2-03 (and R1-05)                                            |
| R2-6       | R2-04                                                        |
| R2-7       | R2-05                                                        |
| R2-8       | R1-06                                                        |
| R2-9       | R1-07, R1-08                                                 |
| R2-10      | closed by this version                                       |

## 7. Corrections of earlier statements (unchanged from v2)

- Register v0.3 D6 "Decision 5 CONDITIONAL until A2 is effective" was stale; withdrawn.
- Register v0.3 D2 "for planning and documentation only" left the gate undefined; replaced.
- Specification v0.2 `executorFor(db, tx)`; v0.3 one-shape `concurrency_conflict` and "compiled API exits non-zero" were wrong; corrected in v0.4.
- Review v0.2 static-token recommendation; withdrawn at [review:65](S0-06-contract-design-review.md).
- Specification v0.3 Security Log reason `unknown_handle` is now `invalid_handle`.

## 8. Remaining Owner decisions

| #   | Decision                                                                                                                                            | Findings            | Recommendation                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| 1   | D1: designate the specification as the baseline, or supply the Blueprint section                                                                    | R1-01               | Designate                              |
| 2   | D2: accept CLOSED WITH CONDITIONS as the implementation prerequisite; FU-3 = WP-01                                                                  | R1-01               | Accept                                 |
| 3   | C11, D3, D8: confirm authenticated reads (Result-based) and the breaking Stage 2 contract; approve Stage 1 additive and Stage 2 breaking separately | R2-01, R2-04        | Confirm                                |
| 4   | D3: handle TTL (15 minutes), revocation policy, fixture exclusion from the build, whether to wire `main.ts`                                         | R1-02, R1-03, R2-02 | As specified; do not wire in S0-06     |
| 5   | D5: decide Amendment A5 through the ADR workflow; state whether any alternative exists                                                              | R1-06, R1-08        | Accept A5; no alternative              |
| 6   | D6: fail-closed audit cost, cutover rule, `application_name` or an operational-only fence                                                           | R1-04, R1-05, R2-03 | Add `application_name`                 |
| 7   | D7: Security Log for rejected operations (including issuer-side refusals), production retention, strict correlation format                          | R1-06, R2-02        | Accept; retention open                 |
| 8   | D8: whether finite numeric input is echoed in `invalid_expected_version`                                                                            | R2-04               | Omit it (Review 1's recommendation)    |
| 9   | D4, D9: audited commands; acceptance criteria; review cadence                                                                                       | R1-01, R1-07        | Accept after G-1 and G-5 are corrected |
| 10  | OBL-AUD-1 as a production-deployment obligation                                                                                                     | R1-06               | Record; not a gate                     |

## 9. Owner Approval Readiness Summary

**Recommendation: NOT READY FOR OWNER APPROVAL REVIEW. REVISE once more, then re-review. Implementation authorization stays closed. S0-06 is NOT STARTED.**

- **What stands.** The design directions and the two substantive repairs (persistence through `PersistenceHandle`/`executorOf`; the audit cutover and unknown-outcome procedure) are in the documents. Review 2 itself found the BLOCKER and the persistence finding resolved at the design level, and the A5 draft passes governance review.
- **Documentation statuses (13 findings):** VERIFIED 1 (R1-04); UNVERIFIED 3 (R1-02, R1-05, R2-03: my check passes, but the reviewer has not re-read the revised text); PARTIAL 9; OPEN 0. **Nothing is RESOLVED**, because that needs the reviewer or the Owner.
- **Implementation verification:** NOT_RUN for all 13. No test could have run; no code exists.
- **Blockers to Owner approval review (all documentation, all small):** G-1 to G-9 (section 4). Eight are local corrections; **one needs an Owner choice: G-6(a)**, whether finite numeric input is echoed. G-1 and G-3 are internal contradictions that I introduced, one of which (G-1) sits in the register the Owner would approve.
- **Next gate.** (1) Apply G-1 to G-9 in one focused revision; (2) have Review 2's reviewer re-verify the revised text against this matrix; (3) then the Owner records D1 to D9 and decides A5 through the ADR workflow; (4) only then does the implementation authorization gate in register section 8 open, with an Owner-approved integration SHA. **None of that is done or authorised by this document.**
