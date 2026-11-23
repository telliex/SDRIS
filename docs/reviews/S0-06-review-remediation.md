# S0-06 — Finding Traceability Matrix (v4, DRAFT)

**Status:** DRAFT. Traces the **13 findings** of two independent Codex architecture reviews to the revised S0-06 documents, after the Owner-authorized revision that applied gaps G-1 to G-9. It approves nothing and records no decision as approved. **S0-06 is NOT STARTED.** **Completion target: READY FOR INDEPENDENT RE-REVIEW**, not implementation authorization.

- **Date:** 2026-11-23. **Verified against:** branch `docs/s0-06-contract-design` at `c85ad3a`. Every `file:line` below is a line of that commit; the commit that adds this matrix changes only this file, so the lines of the other documents are unchanged by it. If a document is edited later the lines shift: re-verify.
- **Reviewed baseline (pinned):** `ae7dc51b94b589c33ae8a1218b4d72d036e9fa21`. This is **not** the integration SHA: each package is cut from an Owner-approved integration SHA ([register:166](../specs/S0-06-owner-decision-register.md)).
- **Source reports (read in full; not committed):** `Pasted text(20261123-064613).txt` = **Review 1** (reviewed HEAD `24b73c8`, REVISE); `Pasted text(20261123-070655).txt` = **Review 2** (reviewed HEAD `87a17bf`, REVISE).
- **Not independently reviewed:** every document change made after Review 2 (commits `f087d5e` to `c85ad3a`). Review 2's reassessments describe the earlier text.

## 1. Conventions

**IDs.** R1-01 to R1-08 are the eight numbered findings of Review 1 (1 BLOCKER, 5 MAJOR, 2 MINOR). R2-01 to R2-05 are the five new findings of Review 2 (4 MAJOR, 1 MINOR). Review 1's INFORMATIONAL row is not counted (section 5).

**Documentation status** (the only status these rows carry):

| Status         | Meaning                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**   | Every requirement is present in the current text (my line-level check) **and** the latest independent assessment of the finding was RESOLVED.                                                |
| **PARTIAL**    | A requirement is missing or contradicted in the current text.                                                                                                                                |
| **UNVERIFIED** | The current text appears to meet every requirement on my check, but the latest independent assessment was PARTIAL, or the finding is new, and the revised text has **not** been re-reviewed. |
| **OPEN**       | Not addressed.                                                                                                                                                                               |

**No finding is marked RESOLVED.** That needs the independent reviewer (or the Owner's acceptance), not the author. **Implementation verification** is separate and is **NOT_RUN for every finding**: S0-06 is NOT STARTED, so no code or test exists. A formal Owner approval is a third, separate thing and is also pending for every decision (the D1 to D9 approval entries remain unrecorded: [register:126-140](../specs/S0-06-owner-decision-register.md)).

## 2. Summary

| ID    | Sev.    | Finding (short)                                                | Review 2 on Review 1 | Gaps closed here  | Documentation status | Implementation |
| ----- | ------- | -------------------------------------------------------------- | -------------------- | ----------------- | -------------------- | -------------- |
| R1-01 | BLOCKER | D2 prerequisite, FU-3 ordering, D1 baseline, D9 timing         | RESOLVED             | G-1               | **VERIFIED**         | NOT_RUN        |
| R1-02 | MAJOR   | Actor trust contract                                           | PARTIALLY RESOLVED   | none needed       | **UNVERIFIED**       | NOT_RUN        |
| R1-03 | MAJOR   | Synthetic deployment, caller boundaries, reads                 | PARTIALLY RESOLVED   | G-9               | **UNVERIFIED**       | NOT_RUN        |
| R1-04 | MAJOR   | Audit adapter on the wrong persistence interface               | RESOLVED             | G-8 (strengthens) | **VERIFIED**         | NOT_RUN        |
| R1-05 | MAJOR   | Rollback could resume unaudited writes                         | PARTIALLY RESOLVED   | G-8 (test method) | **UNVERIFIED**       | NOT_RUN        |
| R1-06 | MAJOR   | Audit record and denial-log integrity                          | PARTIALLY RESOLVED   | G-4               | **UNVERIFIED**       | NOT_RUN        |
| R1-07 | MINOR   | Acceptance criteria and commit boundaries                      | PARTIALLY RESOLVED   | G-5               | **UNVERIFIED**       | NOT_RUN        |
| R1-08 | MINOR   | Governance references                                          | PARTIALLY RESOLVED   | G-1, G-2, G-3     | **UNVERIFIED**       | NOT_RUN        |
| R2-01 | MAJOR   | Authenticated read contract has no error channel               | new                  | G-9               | **UNVERIFIED**       | NOT_RUN        |
| R2-02 | MAJOR   | Denial contract and synthetic startup path                     | new                  | G-4               | **UNVERIFIED**       | NOT_RUN        |
| R2-03 | MAJOR   | A trace id is insufficient for a create retry; cutover fencing | new                  | none needed       | **UNVERIFIED**       | NOT_RUN        |
| R2-04 | MAJOR   | Wrong `concurrency_conflict` payload; FU-3 contract and tests  | new                  | G-6, G-7          | **UNVERIFIED**       | NOT_RUN        |
| R2-05 | MINOR   | Transaction-token validity versus provenance                   | new                  | G-8               | **UNVERIFIED**       | NOT_RUN        |

**Counts (documentation):** VERIFIED 2, UNVERIFIED 11, PARTIAL 0, OPEN 0. Severity check: Review 1 = 1 + 5 + 2 = 8; Review 2 = 4 + 1 = 5 (the second review's four MAJOR and one MINOR); total 13.

**Why 11 are UNVERIFIED and not VERIFIED.** The revised text now meets every stated requirement on my check, but the reviewer last judged these findings PARTIAL (or has not seen them), and I am the author of the revision. Moving any of them to RESOLVED needs the independent re-review.

## 3. Finding detail

### Review 1

#### R1-01 — BLOCKER — D2 cannot open the implementation gate as written

- **Original requirement.** Settle conditional closure for **implementation** with a precise FU-3 ordering rule (or authorise FU-3 separately); keep WP-02 and WP-04 independently testable once D2 is settled, with WP-05 after FU-3, authorization and audit persistence; D1: record the authoritative baseline or reconcile with the Blueprint; D9: decide the verification criteria **before** the packages they govern and record final evidence at WP-06.
- **Current evidence.** D2 (implementation prerequisite; FU-3 = WP-01 completed and reviewed before dependent integration; WP-02, WP-04 independent; FU-1/2/4 tracked; OBL-SEC-1 production obligation): [register:55-66](../specs/S0-06-owner-decision-register.md). D1: [register:48-54](../specs/S0-06-owner-decision-register.md). Package dependencies: [plan:14-25](../plans/S0-06-implementation-plan.md). **D9 now agrees with the gate**: "Blocks implementation: yes ... requirements approved before any package starts; what is deferred is only the evidence": [register:114](../specs/S0-06-owner-decision-register.md); gate item 1: [register:163](../specs/S0-06-owner-decision-register.md); plan: [plan:12](../plans/S0-06-implementation-plan.md), [plan:27-38](../plans/S0-06-implementation-plan.md); the review's table: [review:174](S0-06-contract-design-review.md). Evidence consolidated in WP-06: [register:113](../specs/S0-06-owner-decision-register.md), [spec:523-527](../specs/S0-06-authentication-audit-foundation.md).
- **Gaps closed.** G-1 (commit `3672ef2`).
- **Status: VERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D1, D2, D9.
- **Verification requirement.** Documentation: the reviewer re-reads register D9 and section 8. Implementation: none (a governance finding enforced by the authorization gate).

#### R1-02 — MAJOR — Actor verification: incomplete runtime trust contract

- **Original requirement.** Opaque handle over issuer-private canonical claims; trusted clock and expiry; permitted reuse; another issuer's handles; nested values protected (a frozen wrapper does not make a `Set` immutable); Human/System, Actor UUIDv7 and permissions derived from fixture data; authentication and authorization before a transaction opens, including direct calls.
- **Current evidence.** Handle and issuer-private registry: [spec:48-51](../specs/S0-06-authentication-audit-foundation.md). Canonical claims, flat frozen sorted permission array (no `Set`), fixed UUIDv7 actor id, kind from the principal table: [spec:52-64](../specs/S0-06-authentication-audit-foundation.md). Typed resolver outcome, injected clock, 15-minute TTL, expiry at `now >= expiresAt`, permanent revocation, reuse, foreign-issuer handles: [spec:65-93](../specs/S0-06-authentication-audit-foundation.md). Human/System: [spec:94-97](../specs/S0-06-authentication-audit-foundation.md). One canonical order, checks before the transaction, direct calls: [spec:102-120](../specs/S0-06-authentication-audit-foundation.md); the same order is quoted at [plan:69](../plans/S0-06-implementation-plan.md), [register:74](../specs/S0-06-owner-decision-register.md), [review:200](S0-06-contract-design-review.md). No document states a different order (checked by search).
- **Gaps closed.** None needed.
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D3 (TTL, revocation).
- **Verification requirement.** Documentation: reviewer re-reads spec 2.4 and 2.7. Implementation (WP-02, WP-03): AC-1 and AC-2 ([spec:529-530](../specs/S0-06-authentication-audit-foundation.md)).

#### R1-03 — MAJOR — Synthetic deployment and caller boundaries

- **Original requirement.** Trusted configuration source; fail-closed behaviour; production startup or packaging test; fixture tokens only in a controlled environment and out of logs; how authorised tests obtain contexts without widening issuer imports; `apps/worker` outside the composition roots; reads need an explicit Owner disposition **and an exposure boundary**.
- **Current evidence.** Verified composition facts, configuration source, fail-closed rule, production refusal, no credential strings, fixture exclusion, authorised fixture access, import restrictions, worker: [spec:158-172](../specs/S0-06-authentication-audit-foundation.md); paired startup tests and packaging scan: [spec:173-179](../specs/S0-06-authentication-audit-foundation.md); redaction: [spec:328-348](../specs/S0-06-authentication-audit-foundation.md); static tokens withdrawn: [review:65](S0-06-contract-design-review.md). **Reads:** the authenticated-read proposal ([spec:181-217](../specs/S0-06-authentication-audit-foundation.md)) and, **if the Owner defers read authentication, an exposure boundary** (read-only facade, who may receive it, what enforces it, accepted limit, two tests): [spec:218-226](../specs/S0-06-authentication-audit-foundation.md); register: [register:73](../specs/S0-06-owner-decision-register.md); plan: [plan:69](../plans/S0-06-implementation-plan.md).
- **Gaps closed.** G-9 (commit `84dfe7e`).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D3 (fixture exclusion; whether to wire `main.ts`; reads), C11.
- **Verification requirement.** Documentation: reviewer re-reads spec 3.2 and 3.3. Implementation: AC-1 startup tests (unit in WP-02, compiled in WP-06), the `dist` packaging scan, AC-9, AC-13 ([spec:529](../specs/S0-06-authentication-audit-foundation.md), [spec:537](../specs/S0-06-authentication-audit-foundation.md), [spec:541](../specs/S0-06-authentication-audit-foundation.md)).

#### R1-04 — MAJOR — Audit adapter described against the wrong persistence interface

- **Original requirement.** Same `PersistenceHandle` and active transaction token through the existing adapter boundary (`executorOf(handle, tx)`); runtime rejection of missing or invalid tokens on audit writes (a missing token would select the pool executor); adapter and ORM types stay in Investigation infrastructure.
- **Current evidence.** [spec:252-262](../specs/S0-06-authentication-audit-foundation.md) (handle, `executorOf`, missing-token guard, infrastructure rejection of unknown and ended tokens, ORM types in infrastructure, pool-fallback explanation); verification: [spec:263-272](../specs/S0-06-authentication-audit-foundation.md); [register:91-98](../specs/S0-06-owner-decision-register.md) (D6); [plan:76-86](../plans/S0-06-implementation-plan.md) (WP-04); AC-4: [spec:532](../specs/S0-06-authentication-audit-foundation.md). Code facts: `infrastructure/database/src/persistence-handle.ts` (`executorOf` delegates to `executorFor`) and `unit-of-work.ts` (`executorFor` returns `db` when `tx` is undefined).
- **Gaps closed.** None for this finding; G-8 adds the unknown-token and separate-connection cases.
- **Status: VERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6.
- **Verification requirement.** Implementation (WP-04, WP-05): AC-4 on real PostgreSQL.

#### R1-05 — MAJOR — Rollback could silently resume unaudited writes

- **Original requirement.** Activation point after migration and schema verification; on audit failure after activation hold writes or restore an audit-capable build; deployment order; schema-failure recovery; forward repair of applied migrations; for a lost commit acknowledgment reconcile before replaying a create. Test method: real PostgreSQL, fresh and `0002` runs, unchanged checksums, inspection through a **separate connection**, compiled-runtime verification.
- **Current evidence.** Cutover with the activation point, draining and fencing, verification, completeness query, fail-closed: [spec:372-382](../specs/S0-06-authentication-audit-foundation.md); recovery and forward repair: [spec:383-391](../specs/S0-06-authentication-audit-foundation.md); unknown outcomes: [spec:392-401](../specs/S0-06-authentication-audit-foundation.md); six verification tests: [spec:402-410](../specs/S0-06-authentication-audit-foundation.md); AC-12: [spec:540](../specs/S0-06-authentication-audit-foundation.md); plan: [plan:87-98](../plans/S0-06-implementation-plan.md). Separate-connection inspection: [spec:271](../specs/S0-06-authentication-audit-foundation.md). Fresh and `0002` runs, checksums: AC-10 ([spec:538](../specs/S0-06-authentication-audit-foundation.md)). Fact check: `infrastructure/database/src/connection.ts` builds a `Pool` with `max` only, so `application_name` is not set today; the text says the fence needs that change or an accepted operational-only fence.
- **Gaps closed.** G-8 (test method).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6 (availability cost; `application_name` or operational-only fence).
- **Verification requirement.** Documentation: reviewer re-reads spec 6. Implementation (WP-05): the six tests of 6.5; AC-12.

#### R1-06 — MAJOR — Audit record and denial log integrity

- **Original requirement.** Investigation-specific `details` validation, per-action subjects, persisted subset; `case_id` contract and FK deletion effect; source and correlation provenance; per-action allowlist; trusted database roles and `TRUNCATE`, DDL and privileged access; security log redaction, access, retention, sink failure; **credential failures at the provider even when no service call occurs**. Review 2 adds explicit allowlists for `source`, `causationId` and correlation.
- **Current evidence.** Audit record: [spec:273-290](../specs/S0-06-authentication-audit-foundation.md); actions, subjects, details, timestamps per action: [spec:291-303](../specs/S0-06-authentication-audit-foundation.md); `case_id` and the `NO ACTION` foreign key, reject-not-cascade: [spec:304-308](../specs/S0-06-authentication-audit-foundation.md); provenance and allowlists: [spec:309-327](../specs/S0-06-authentication-audit-foundation.md); triggers, `TRUNCATE`, DDL, roles, OBL-AUD-1, logging layers, events, redaction, retention, sink failure: [spec:328-348](../specs/S0-06-authentication-audit-foundation.md). **Issuer-level refusals** (typed outcome, `security.issuance_refused` with `unknown_principal`, `invalid_credential`, `synthetic_forbidden`, exactly one event per refusal, injected sink, no key text, six tests): [spec:125-143](../specs/S0-06-authentication-audit-foundation.md); the service-versus-issuer logging split: [spec:328-348](../specs/S0-06-authentication-audit-foundation.md); register: [register:102](../specs/S0-06-owner-decision-register.md); plan: [plan:59](../plans/S0-06-implementation-plan.md); AC-1: [spec:529](../specs/S0-06-authentication-audit-foundation.md).
- **Gaps closed.** G-4 (commit `84dfe7e`).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D5, D7 (non-authoritative denial records, retention), OBL-AUD-1, strict correlation format.
- **Verification requirement.** Implementation: AC-3 and AC-10 (rows, constraints), AC-2 and AC-1 (log content, one event per rejection and per refusal); OBL-AUD-1 checks before any production deployment.

#### R1-07 — MINOR — Acceptance criteria and commit boundaries disagree

- **Original requirement.** AC-9 versus the SQL migration in global infrastructure; AC-11 versus WP-04's inventory and compiled-runtime updates; identity checker work in WP-02 and not also WP-06; migration inventory with `0003`; integrated regression in WP-06; the persisted timestamp each action compares.
- **Current evidence.** AC-9 now covers audit **application, domain and adapter code** under the module and names the **only** artifacts outside it (migration `0003` and the inventory updates): [spec:537](../specs/S0-06-authentication-audit-foundation.md). AC-10 puts the inventory and runtime-child table list and the migration test re-runs **in WP-04**: [spec:538](../specs/S0-06-authentication-audit-foundation.md). AC-11 allows exactly the FU-3 cases (WP-01), the `0003` inventory updates (WP-04) and the `context` argument (WP-03): [spec:539](../specs/S0-06-authentication-audit-foundation.md). Assignments: [plan:53-64](../plans/S0-06-implementation-plan.md) (checker in WP-02), [plan:76-86](../plans/S0-06-implementation-plan.md) (inventory and WP-04 verification in WP-04), [plan:99-107](../plans/S0-06-implementation-plan.md) (integrated verification only in WP-06). Per-action timestamp equality: [spec:291-303](../specs/S0-06-authentication-audit-foundation.md), AC-3 [spec:531](../specs/S0-06-authentication-audit-foundation.md).
- **Gaps closed.** G-5 (commit `156ec27`).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D9 (approve the corrected criteria before any package).
- **Verification requirement.** Documentation: reviewer re-reads AC-9 to AC-11 against the plan's package scopes. Implementation: AC evidence per package, consolidated in WP-06.

#### R1-08 — MINOR — Governance references

- **Original requirement.** Decision 5 is no longer conditional in effective policy; pin the reviewed base by SHA and verify the **integration** base; Review 2 adds an Owner-approved integration SHA as the branch point (not "current main"), one A5 gate with no unspecified alternative, and D9 approval before any package.
- **Current evidence.** Decision 5: [register:96](../specs/S0-06-owner-decision-register.md); `docs/adr/ADR-025-effective-policy.md:190-196`. Pinned baseline and the **Owner-approved integration SHA** rule (ancestry, drift diff, re-approval if `origin/main` moved): [spec:6](../specs/S0-06-authentication-audit-foundation.md), [register:6](../specs/S0-06-owner-decision-register.md), [register:166](../specs/S0-06-owner-decision-register.md), [plan:6](../plans/S0-06-implementation-plan.md), [plan:12](../plans/S0-06-implementation-plan.md). **A5 gate without an alternative:** [register:41](../specs/S0-06-owner-decision-register.md) (C13), [register:165](../specs/S0-06-owner-decision-register.md), [plan:12](../plans/S0-06-implementation-plan.md); A5 is Status PROPOSED at [ADR-025:771-787](../adr/ADR-025-postgresql-persistence-architecture.md) (not changed). D9: R1-01. Gate-state sentence covers items 1 to 4: [register:168](../specs/S0-06-owner-decision-register.md).
- **Gaps closed.** G-1, G-2, G-3 (commit `3672ef2`) and the gate-state sentence (`c85ad3a`).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D9; A5 through the ADR workflow (C13); the integration SHA (C14).
- **Verification requirement.** Documentation: reviewer re-reads register section 8 and plan section 1. Implementation: at each package start the recorded Owner-approved SHA, the ancestry check and the drift diff.

### Review 2 (new findings)

#### R2-01 — MAJOR — Authenticated read contract has no error channel

- **Original requirement.** An explicit failure contract (`Result` or another); updated compatibility inventory and tests; map `composeInvestigation` callers and direct factory callers (API integration tests, compiled child); **if read authentication is deferred, define who may receive the service object**.
- **Current evidence.** Options compared, Result-based recommended, exact signatures, `AccessError`, absence as `ok(undefined)`: [spec:181-217](../specs/S0-06-authentication-audit-foundation.md). **Deferral boundary** (read-only facade, recipients, enforcement, limit, tests): [spec:218-226](../specs/S0-06-authentication-audit-foundation.md). Caller inventory: [spec:227-240](../specs/S0-06-authentication-audit-foundation.md) and [spec:508-518](../specs/S0-06-authentication-audit-foundation.md) (7.6). AC-13 (both paths): [spec:541](../specs/S0-06-authentication-audit-foundation.md). Register: C11 [register:39](../specs/S0-06-owner-decision-register.md) and D3 [register:73](../specs/S0-06-owner-decision-register.md). Caller sites re-checked by search: `investigation-service.spec.ts` (8), `investigation-links.integration.test.ts` (30), `investigation.integration.test.ts` (3), `compiled-runtime.child.cjs` (8).
- **Gaps closed.** G-9.
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** C11 (the breaking Stage 2 read contract is **proposed**, not approved), D3, D8.
- **Verification requirement.** Implementation (WP-03): AC-13, every inventoried caller updated, Stage 1 reads unchanged (AC-11).

#### R2-02 — MAJOR — Denial contract and synthetic startup path

- **Original requirement.** Typed resolver outcome or one trusted emitting layer; one event per rejection **including invalid principal-key requests before a handle exists**; expiry boundary `now >= expiresAt`; one precedence for correlation versus permission; the entrypoint that performs the environment refusal, with a positive control so an unrelated failure cannot satisfy the production test; consistent fixture access; static-token recommendation retired.
- **Current evidence.** Typed outcome and `now >= expiresAt`: [spec:65-93](../specs/S0-06-authentication-audit-foundation.md); single order (correlation before authorization): [spec:102-116](../specs/S0-06-authentication-audit-foundation.md); **issuer refusals and one event per refusal, with tests**: [spec:125-143](../specs/S0-06-authentication-audit-foundation.md); entrypoint `composeInvestigation` and paired positive and negative tests with a specific error code: [spec:160](../specs/S0-06-authentication-audit-foundation.md), [spec:173-179](../specs/S0-06-authentication-audit-foundation.md); fixture access: [spec:162-172](../specs/S0-06-authentication-audit-foundation.md), [plan:57](../plans/S0-06-implementation-plan.md); static tokens withdrawn: [review:65](S0-06-contract-design-review.md); AC-1: [spec:529](../specs/S0-06-authentication-audit-foundation.md).
- **Gaps closed.** G-4.
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D3 (TTL; `main.ts` stays unwired unless asked), D7.
- **Verification requirement.** Implementation: AC-1 including the one-event-per-rejection and issuance-refusal tests (WP-02) and the compiled pair (WP-06).

#### R2-03 — MAJOR — A trace id is insufficient evidence for a create retry

- **Original requirement.** Correlation is a search aid; positive identification of the operation and a settled outcome before a new create; otherwise keep UNKNOWN for operator reconciliation; fence or drain pre-activation writers including overlapping builds; verify both in WP-05 and AC-12.
- **Current evidence.** [spec:392-401](../specs/S0-06-authentication-audit-foundation.md) (search aid, specific-operation identification, UNKNOWN, no automatic retry; the weakest case `uut_registered` is named); fencing: [spec:372-382](../specs/S0-06-authentication-audit-foundation.md); tests: [spec:402-410](../specs/S0-06-authentication-audit-foundation.md); AC-12: [spec:540](../specs/S0-06-authentication-audit-foundation.md); WP-05: [plan:87-98](../plans/S0-06-implementation-plan.md).
- **Gaps closed.** None needed.
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6 (`application_name` or operational-only fence); a client-supplied operation identifier is deferred with Decision 7's idempotency middleware.
- **Verification requirement.** Implementation (WP-05): all six tests of 6.5.

#### R2-04 — MAJOR — Wrong existing `concurrency_conflict` payload; FU-3 contract and tests

- **Original requirement.** Preserve both payloads (service: `expectedVersion` and `actualVersion`; repository race: `expectedVersion` only) and test them separately; keep the precedence and `integer`; **decide the echo of raw input** (Review 1: omit it); Stage 1 additive and Stage 2 breaking approved separately; test `MAX - 1` → `MAX`, matching duplicates and **different-role links at `MAX`**, stale duplicates, each earlier failure paired with an invalid version; cover omitted, `undefined`, `null`, strings, boxed numbers, bigint, **booleans**, objects, `NaN`, infinities, fractions, zero, negatives, `MAX + 1`, unsafe integers; **amend the public contract comments**.
- **Current evidence.** Both payloads, verified in code: [spec:445-455](../specs/S0-06-authentication-audit-foundation.md); value classes **including booleans and the omitted property**: [spec:439-442](../specs/S0-06-authentication-audit-foundation.md); `invalid_expected_version` **without any raw value, including finite numbers** (exactly the keys `reason`, `minimum`, `maximum`, `actualType`; Owner direction C12): [spec:456-482](../specs/S0-06-authentication-audit-foundation.md), [register:40](../specs/S0-06-owner-decision-register.md), [register:107](../specs/S0-06-owner-decision-register.md); `version_exhausted`: [spec:483-493](../specs/S0-06-authentication-audit-foundation.md); stages and **public contract comments assigned to WP-01**: [spec:413-419](../specs/S0-06-authentication-audit-foundation.md), [plan:44](../plans/S0-06-implementation-plan.md), [plan:51](../plans/S0-06-implementation-plan.md); tests including the omitted property, the exact key set, **a different-role link at `MAX`** and the sequential `MAX - 1` → `MAX` case: [spec:494-507](../specs/S0-06-authentication-audit-foundation.md); compatibility inventory: [spec:508-518](../specs/S0-06-authentication-audit-foundation.md); `integer` unchanged: [spec:519-522](../specs/S0-06-authentication-audit-foundation.md).
- **Gaps closed.** G-6, G-7 (commit `da7924b`).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D8 (exact payloads; the no-echo direction C12 is recorded as a direction, not an approval; Stage 1 additive and Stage 2 breaking approved separately).
- **Verification requirement.** Implementation (WP-01): the eight test groups of 7.5, races on real PostgreSQL; AC-5 to AC-8 ([spec:533-536](../specs/S0-06-authentication-audit-foundation.md)).

#### R2-05 — MINOR — Transaction-token validity and provenance

- **Original requirement.** Internal port and only the current callback's token; **do not claim handle-to-token binding**; PostgreSQL verification of an omitted token, an **unknown** token, an ended token, a real audit-insert failure after the link and version writes, and a failure after a successful audit insert but before commit; verify **both tables** after rollback.
- **Current evidence.** Internal port, callback token only, infrastructure rejects unknown and ended tokens, provenance not enforced and not claimed: [spec:254-262](../specs/S0-06-authentication-audit-foundation.md); the **five** verifications (real SQL failure after the link and version writes; failure after a successful audit insert including a commit-time failure; missing; **unknown**; ended) and the **separate-connection** inspection of both the domain tables and `audit_record`: [spec:263-272](../specs/S0-06-authentication-audit-foundation.md); AC-4: [spec:532](../specs/S0-06-authentication-audit-foundation.md); plan: [plan:80](../plans/S0-06-implementation-plan.md), [plan:91](../plans/S0-06-implementation-plan.md).
- **Gaps closed.** G-8 (commit `156ec27`).
- **Status: UNVERIFIED** (documentation). Implementation: NOT_RUN.
- **Owner decision required.** D6.
- **Verification requirement.** Implementation (WP-04 adapter, WP-05 service): AC-4 on real PostgreSQL.

## 4. The nine gaps and where each was closed

| ID  | Gap                                                             | Closed in | Where now                                             |
| --- | --------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| G-1 | D9 "Blocks implementation: no"                                  | `3672ef2` | register:114                                          |
| G-2 | "then-current `main`" instead of an approved integration SHA    | `3672ef2` | register:166, plan:6, plan:12, spec:6                 |
| G-3 | Unspecified alternative to A5                                   | `3672ef2` | register:41, register:165, plan:12                    |
| G-4 | No event or test for issuer-level refusals                      | `84dfe7e` | spec:125-143, spec:328-348, plan:59                   |
| G-5 | AC-9 and AC-11 contradicted WP-04 and the migration             | `156ec27` | spec:537-539                                          |
| G-6 | Raw input echoed; incomplete malformed-input and `MAX` coverage | `da7924b` | spec:439-442, spec:456-482, spec:494-507, register:40 |
| G-7 | Contract comments not assigned                                  | `da7924b` | spec:413-419, plan:44, plan:51                        |
| G-8 | Unknown token and separate-connection cases missing             | `156ec27` | spec:263-272, plan:80, plan:91                        |
| G-9 | No exposure boundary if read authentication is deferred         | `84dfe7e` | spec:218-226                                          |

## 5. Informational finding and supporting sections (not counted)

- **INFORMATIONAL (Review 1): status and follow-up tracking intact.** Re-checked: C1 to C14 are directions only; every D1 to D9 approval entry is unrecorded ([register:126-140](../specs/S0-06-owner-decision-register.md)); S0-05 is ACCEPTED and CLOSED WITH CONDITIONS; FU-1 to FU-4 open; OBL-SEC-1 open. **VERIFIED** (documentation). This branch changes no ADR Status line; A5 remains PROPOSED.
- **ADR-025 Decision 7 and A5.** Review 2: "passes governance review as a draft". A5 ([ADR-025:771-787](../adr/ADR-025-postgresql-persistence-architecture.md)) was not edited in this round and needed no change. It stays PROPOSED; the approval sequence (checklist, effective-policy section, separate Status commit) is the Owner's, and no alternative exists (C13).
- **FU-3 section of Review 1** is traced at R2-04; **audit atomicity and plan section** at R1-04, R1-05, R2-05; the package independence it states matches [plan:14-25](../plans/S0-06-implementation-plan.md).

## 6. Remaining contradictions and known limits

I found **no** remaining contradiction among the S0-06 documents by search and re-read (checked: D9 versus the gate; "then-current main"; the A5 alternative; echoed input; the order of checks; static tokens; the count of rollback verifications). Known items that are **not** contradictions but stay open:

1. [S0-06-readiness-summary.md:63](../specs/S0-06-readiness-summary.md) still says the Owner decision on the S0-05 prerequisite is "not yet recorded". It carries a dated snapshot note and states no status, so it is left unchanged.
2. The S0-05 specification and closure records still document the S0-05 error contracts; WP-01 does not edit them unless the Owner asks ([spec:413-419](../specs/S0-06-authentication-audit-foundation.md)).
3. `application_name` is not set by the database package today; the fence in 6.2 needs that change or an accepted operational-only fence (D6).
4. The documents are reviewed by their author only; independent re-review is the next step.

## 7. Retired identifiers (matrix v2)

R1-T1 → R1-01, R1-08; R1-T2 → R1-02; R1-T3 → R1-03; R1-T4 → R1-04; R1-T5 → R1-05; R1-T6 → R1-06; R1-T7 → R2-04; R1-T8 → A5 (section 5); R1-T9 → R1-07, R1-08; R2-2 → R2-01; R2-3 and R2-4 → R2-02; R2-5 → R2-03; R2-6 → R2-04; R2-7 → R2-05; R2-8 → R1-06; R2-9 → R1-07, R1-08.

## 8. Remaining Owner decisions

| #   | Decision                                                                                                                              | Findings            | Recommendation                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- |
| 1   | D1: designate the specification as the baseline, or supply the Blueprint section                                                      | R1-01               | Designate                          |
| 2   | D2: accept CLOSED WITH CONDITIONS as the implementation prerequisite; FU-3 = WP-01                                                    | R1-01               | Accept                             |
| 3   | C11, D3, D8: confirm authenticated reads (Result-based) and the breaking Stage 2 contract, or defer reads under the exposure boundary | R1-03, R2-01        | Confirm authenticated reads        |
| 4   | D3: handle TTL (15 minutes), revocation policy, fixture exclusion, whether to wire `main.ts`                                          | R1-02, R1-03, R2-02 | As specified; do not wire in S0-06 |
| 5   | D5: decide Amendment A5 through the ADR workflow (no alternative, C13)                                                                | R1-06, R1-08        | Accept A5                          |
| 6   | D6: fail-closed cost, cutover rule, `application_name` or an operational-only fence                                                   | R1-04, R1-05, R2-03 | Add `application_name`             |
| 7   | D7: Security Log (including issuer-side refusals), retention, strict correlation format                                               | R1-06, R2-02        | Accept; retention open             |
| 8   | D8: exact FU-3 payloads (no raw input, C12); Stage 1 additive and Stage 2 breaking                                                    | R2-04               | Approve                            |
| 9   | D4, D9: audited commands; acceptance criteria; review cadence                                                                         | R1-01, R1-07        | Accept                             |
| 10  | OBL-AUD-1 as a production-deployment obligation                                                                                       | R1-06               | Record; not a gate                 |
| 11  | C14: the integration SHA, named in the written authorization                                                                          | R1-08               | Name it at authorization           |

## 9. Readiness summary

**READY FOR INDEPENDENT RE-REVIEW. NOT ready for implementation authorization, and not approved.**

- All 13 findings are addressed in the documents; **no finding is RESOLVED** and **none is OPEN or PARTIAL**: 2 VERIFIED, 11 UNVERIFIED (awaiting the reviewer). Implementation verification is NOT_RUN for all, because S0-06 is NOT STARTED.
- **Next gate.** (1) Independent re-review of the revised documents against this matrix. (2) The Owner records D1 to D9 and decides A5 through the ADR workflow. (3) Only then can the authorization gate ([register:159-169](../specs/S0-06-owner-decision-register.md)) open, with an Owner-approved integration SHA. None of that is done or authorized by this document.
