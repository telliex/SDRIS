# ADR-025 and Amendments A1 to A4 — Decision Package for the Engineering Owner (DRAFT)

**Status of this package:** a recommendation document. **It changes no ADR status.** ADR-025, A1, A2, A3 and A4 are all
**PROPOSED** and stay so until the Engineering Owner records an approval for each one separately in
[the approval checklist](ADR-025-approval-checklist.md); the status change is then made in its own commit
([ADR conventions](README.md)). Approval of one record does not approve another, and the S0-05 domain approval approves no ADR.

**Evidence baseline:** fresh clone of `2c11d93` (merged as `f8bb094`): `check:architecture` 17 packages, 78 files, 10 public
type surfaces, 0 notes; 33 valid and 133 invalid fixtures; 30 type-surface tests; `pnpm test` exit 0; `pnpm db:test` against
PostgreSQL 16.14: database 53/53, API 43/43, compiled runtime 4/4. Local results; no CI until S0-10. The evidence table in the
approval checklist was refreshed to this baseline and committed (`a99699c`).

## 1. Summary of recommendations

| Record  | Recommendation                                            | One-line reason                                                                                                                               |
| ------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-025 | **ACCEPT**                                                | Nine decisions are ACCEPT, one is DEFER (9) and one CONDITIONAL (5); all are evidenced. **Decision 5 stays CONDITIONAL until A2 is ACCEPTED** |
| A1      | **ACCEPT** (editorial corrections applied)                | The rules are implemented and tested; the two outdated statements were corrected without changing any rule (section 4)                        |
| A2      | **ACCEPT** (editorial corrections applied; only after A1) | The rules are implemented and tested; the outdated statements were corrected without changing any rule; it must be read with A1               |
| A3      | **ACCEPT**                                                | Small, enforced, evidenced; one documented limitation                                                                                         |
| A4      | **ACCEPT**                                                | Required by the S0-05 acceptance criteria; verified by a plain-Node test; the `./testing` clarification is applied                            |

### 1.1 Effective-order rules (one rule set, used everywhere in this package)

1. **Each record is approved separately** and takes effect only from its own recorded approval and its own status commit.
   Accepting one record never accepts another (final approval, section 6). A recommendation here is not an approval.
2. **ADR-025 may be ACCEPTED first, and its text is then never edited in place** (ADR README). Decision 5 stays exactly as
   written, **CONDITIONAL**: its condition (validation against a real repository, S0-05) is _evaluated_ in A2.6 but not
   _satisfied_ until A2 is ACCEPTED. ADR-025 therefore does not rely on a PROPOSED amendment.
3. **A2 takes effect only after A1 is ACCEPTED**, because A2 revises A1 Rule 3 and cannot revise a rule that is not in force.
   If A1 is revised in substance, A2 is re-based before it is decided. **ADR-025 is not modified when A2 is accepted.** A2's own
   approval and effective-policy record states that A2.6 satisfies Decision 5's condition, so the link is traceable through the
   amendment. If the Owner instead wants ADR-025's text changed, that needs an explicit prior governance decision on a permitted
   method (for example a superseding ADR), not an edit.
4. **A3 and A4 are independent of A1 and A2 and of each other** for acceptance purposes. A4 also lifts a limitation that A2.5
   states; that sentence is corrected editorially (section 5) whichever order is chosen.
5. If a record is **rejected**, the records that depend on it (rule 3, and ADR-025 Decisions 4 to 6 for A1 and A2) are
   re-opened and the checker work built on it is reworked (section 2).
6. The order in section 9 is the suggested **reading and approval order**; only rules 2 and 3 are real dependencies between records (the phase prerequisites of the checklist workflow come on top).

The editorial corrections recommended earlier ("REVISE (editorial)") **have been applied** in the pre-approval documentation-correction commit: only sentences describing the state of the implementation were corrected and **no rule changed**.

**One workflow for every record** is defined once, in "Approval workflow" at the end of the
[approval checklist](ADR-025-approval-checklist.md), in phases: (0) G-1, resolved by the Owner (Option A, 2026-11-17) and recorded in the ADR README; (1) record all
five Owner decisions, branching on APPROVED, APPROVED WITH CHANGES and REJECTED; (2) apply any required changes; (3) for each
accepted record, in its own commits: its effective policy, then its Status line (and mirrors), then a bookkeeping commit with the
status commit's SHA. The exact wording is in section 10.

## 2. A risk to weigh before deciding

The merged S0-05 implementation, the architecture checker and its fixtures already encode A1 to A4. If the Owner approves
them as written, nothing changes. If the Owner **rejects or substantively revises** a rule, the corresponding checker rules,
fixtures, `dependency-matrix.json` entries and some Investigation code must be reworked, and the work already merged to `main`
would have been built on a rule that was never in force. The dependencies are:

- A1 and A2: the checker's boundary and dependency rules, the Investigation adapter and composition layout.
- A3: the `testOnlyEntrypoints` policy and `@sdris/database/testing`.
- A4: the `dist` build, the `exports` conditions and the compiled-runtime smoke test.

This is a governance risk, not a defect: the Owner authorised implementation ahead of ADR approval.

## 3. ADR-025 — PostgreSQL Persistence Architecture and Migration Governance

1. **Proposed rule.** Drizzle ORM with SQL-first, checksummed, immutable, ordered migrations (Decisions 1, 2); a ten-schema
   baseline with ownership rules (3); a controlled infrastructure dependency policy (4); the transaction abstraction stays
   infrastructure-owned **conditionally** (5); context-owned repository adapters (6); atomic domain, audit and outbox
   persistence as a requirement with implementation deferred (7); database-enforced optimistic concurrency and idempotency
   (8); `drizzle-kit` deferred (9); real PostgreSQL tests as mandatory evidence, CI in S0-10 (10); strict reset protection (11).
2. **Why it is needed.** S0-04 introduced PostgreSQL persistence; without a decision, each context could pick its own library,
   migration discipline and transaction model, and persistence could leak into the domain.
3. **Evidence.** Migration runner with advisory lock, per-script transaction, checksum, order and missing-file errors, and a
   transaction-control scanner proved against real PostgreSQL (database suite 53/53); schema ownership in `0001` (unchanged,
   same checksum on `main`); the checker rules and fixtures; `UnitOfWork` unchanged and sufficient in S0-05 (A2.6); the S0-05
   version predicate, idempotency and rollback tests; reset guard tests. Decision 7 is shown only with test-only tables, as
   intended.
4. **Trade-offs and risks.** Decision 5 stays **CONDITIONAL until A2 is ACCEPTED** (rule 2 and 3 of section 1.1); Decision 7 defers audit, outbox,
   inbox and job table ownership, which S0-06 will need (section 8); Decision 10 has no CI gate yet; 22 existing dependency
   audit findings in `apps/api` and `apps/web` are acknowledged, not waived. Decision 8's wording "where required" for stale
   versus missing is now concrete: the S0-05 service reports `case_not_found` before it compares versions.
5. **Recommendation: ACCEPT, with Decision 5 recorded as still CONDITIONAL.** Suggested wording on acceptance: Decision 5's
   condition was evaluated in S0-05 and the evaluation is reported in A2.6 (keep `UnitOfWork` infrastructure-owned, keep a
   context-owned application port, revisit when a second context needs the same shape); it is closed only when A2 is ACCEPTED.
6. **Interactions.** A1 and A2 refine Decisions 4 and 5 and 6; A4 and A3 add enforcement and packaging for Decisions 6 and 10. If
   A1 or A2 is rejected, Decision 4's "approved infrastructure-layer imports" and Decision 6's adapter location become
   undefined again.

### 3.1 The 22 dependency audit findings of ADR-025 section 14 (as of 2026-11-17)

Source: `pnpm audit --prod` run on 2026-11-17 against the merged lockfile (204 production dependencies): **22 advisories, 10 high,
10 moderate, 2 low, 0 critical**, matching the count in ADR-025. None is in a persistence package (`@sdris/database`,
Drizzle, the PostgreSQL driver).

| Package        | Advisories | Severity                  | Brought in by                                                        | Patched from |
| -------------- | ---------- | ------------------------- | -------------------------------------------------------------------- | ------------ |
| `multer`       | 9          | 7 high, 1 moderate, 1 low | `apps/api` > `@nestjs/platform-express@10.4.22` > `multer@2.0.2`     | `>=2.5.0`    |
| `qs`           | 4          | 4 moderate                | `apps/api` > `platform-express` > `body-parser@1.20.4` > `qs@6.14.3` | `>=6.16.1`   |
| `postcss`      | 4          | 2 high, 2 moderate        | `apps/web` > `next@15.5.29` > `postcss@8.4.31`                       | `>=8.5.23`   |
| `body-parser`  | 2          | 1 high, 1 low             | `apps/api` > `platform-express` > `body-parser@1.20.4`               | `>=1.20.9`   |
| `file-type`    | 2          | 2 moderate                | `apps/api` > `@nestjs/common@10.4.22` > `file-type@20.4.1`           | `>=21.3.2`   |
| `@nestjs/core` | 1          | 1 moderate                | `apps/api` > `@nestjs/core@10.4.22`                                  | `>=11.1.18`  |

- **Classification (ADR-025 section 14):** outside the persistence scope; require separate security triage; **not accepted as
  safe and not waived**. Nothing in this package, in ADR-025 or in A1 to A4 grants an exemption.
- **Enforcement today:** none automated. No `audit` script in any `package.json`, no CI workflow (S0-10), and the audit exits
  non-zero when run by hand. Section 14 asks for the triage "before production deployment".
- **Observations, not a reachability determination:** the repository sources contain no upload, multipart or `file-type` code;
  `apps/api` has only a health controller and the Investigation composition root.
- **Remediation facts:** every affected package is pinned by its parent (`@nestjs/platform-express@10`, `@nestjs/common@10`,
  `next@15.5.29`), so a fix needs a parent upgrade or an override, which this package has not evaluated. The `@nestjs/core`
  fix is in a **major version above 10.x**; `CLAUDE.md` section 4 forbids major framework upgrades without approval.
- **Outstanding obligation OBL-SEC-1 (recorded in the checklist):** the triage of these 22 advisories must be completed **before
  any production deployment**: reachability, patched versions and compatibility (parent upgrade or override), remediation or an
  explicit Owner risk acceptance, and a re-run of the audit. **Accepting an ADR is not security acceptance** (ADR-025 section
  14). No exemption is granted here, and no framework upgrade has been performed or is proposed.
- **Acceptance implications:** none of ADR-025, A1 to A4 or the closure of S0-05 needs a decision about the advisories, and
  none of them is gated on the triage. An Owner decision is needed only when the Owner wants to (a) schedule the triage as a
  named task before a named event, (b) approve a major-version upgrade or dependency overrides, or (c) record a risk
  acceptance before any deployment.

## 4. Amendment A1 — Persistence dependency policy

1. **Proposed rule.** Persistence libraries (`drizzle-orm`, `@sdris/database`) may be imported only from a context's
   `src/infrastructure/**` and only if listed in one central allowlist; domain, application and public code stay independent of
   them; dependencies point inward (only infrastructure imports infrastructure, **Rule 3, revised by A2**); Global
   Infrastructure does not import business modules; cross-context restrictions unchanged; `@sdris/database` only through its
   published entrypoint.
2. **Why needed.** S0-04's checker forbade every module import of `@sdris/database`, which made a context-owned adapter
   impossible; broadly allowing it would have destroyed the boundary (ADR-025 Decision 5, "important implementation condition").
3. **Evidence.** Fixtures 23 to 28e, 27 to 27g, 29 to 29g, 31 to 32c and 51 to 51f; rules `dependency/forbidden-external`,
   `dependency/direction`, `dependency/manifest`, `boundary/infrastructure-inversion`; mutation checks (path restriction,
   allowlist lookup, inversion rule, case handling, manifest check); Codex findings on barrel and same-package bypasses fixed and
   confirmed. `dependency-matrix.json` lists only Investigation.
4. **Trade-offs and risks.** Directory names under `src/` become architecture (A1.5); intra-module layering beyond Rule 3 is not
   covered; a new context needing persistence needs a reviewed allowlist entry (deliberate friction).
5. **Recommendation: ACCEPT.** Corrections **applied** (no rule changed): (a) the header line "Implementation reference: branch
   `feat/s0-05-persistence-dependency-policy` (checker, fixtures and tests only; no repository adapter is implemented)" (ADR-025
   line 498) was outdated (corrected): PR #6 implemented the adapter; (b) A1.3 "The default committed allowlist is empty. The Investigation
   entry above is an example ... It is not added by this amendment" (line 557) was outdated (corrected): the committed policy lists
   Investigation.
6. **Interactions.** **A2 revises Rule 3 of A1** (see section 9). A1 depends on nothing; A2 and A3 build on its policy file.

## 5. Amendment A2 — Dedicated composition entry point (revises A1 Rule 3)

1. **Proposed rule.** A separate `src/composition/**` zone; same-context infrastructure may be imported from
   `src/infrastructure/**` **and** `src/composition/**`; only composition may import the composition zone; exactly one extra
   entrypoint `@sdris/<context>/composition`; only listed roots may import it (initially `apps/api/src/composition/**` for
   Investigation, not `apps/worker`); composition may import the database contract only as a type and never Drizzle; the
   entrypoint exposes factories and contracts, never adapters; factories have explicit return types; `PersistenceHandle` is
   opaque; public type surfaces name no persistence type. A2.6 reports that `UnitOfWork` sufficed and recommends a
   context-owned `TransactionScope`.
2. **Why needed.** The application composition root needs a legitimate way to obtain a working module, but the public entrypoint
   may not import infrastructure (the composition gap found while applying A1).
3. **Evidence.** Fixtures V1 to V5, I2 to I12, C1, 40 to 48e; fixtures 29f and 29g still fail as required; type-surface checks
   with the compiler and a real `.d.ts` (30 tests); a non-opaque handle is detected; mutation checks on zone permissions, root
   lookup, type-only database dependency, adapter exposure, entrypoint location and type-surface walking; one documented
   equivalent mutant; the S0-05 chain `apps/api` to PostgreSQL passes (43 tests) and compiled (4 tests).
4. **Trade-offs and risks.** Type surfaces verify declared types, not behaviour; each context will own a small copy of the
   transaction port; the zone name `composition` becomes architecture; `InvestigationModuleOptions.now` is a clock override that
   only approved roots can reach.
5. **Recommendation: ACCEPT (only after A1).** Corrections **applied** (no rule changed): (a) A2.5 "The API has no workspace build step yet, so a
   compiled `dist` ... is not addressed by this amendment" (line 686) was superseded by A4 (corrected); (b) A2.7 "Whether the runtime
   composition needs a package build step" (line 705) is decided by A4 (corrected); (c) A2.7 "the S0-05 specification is not committed; the
   minimal aggregate ... is only a vehicle" (line 707) was false (corrected): the specification is committed and the aggregate is the approved
   model; (d) "Implementation reference: PR #6" now notes it is merged (`f8bb094`). Two clarifications were added to A2 itself: it takes effect only after A1 is accepted, and ADR-025 Decision 5 stays CONDITIONAL until A2 is accepted, with A2's own record satisfying it.
6. **Interactions.** **Revises A1 Rule 3 and must be read with A1.** A4 resolves a limitation A2 states. A2.6 feeds ADR-025
   Decision 5. A2's `package/entrypoint-location` rule and A4's `package/exports-condition` rule act on the same `exports`
   field and must agree (they do in the checker: fixtures 40 and 70 to 70i).

## 6. Amendment A3 — Test-only entrypoints

1. **Proposed rule.** The central policy lists `testOnlyEntrypoints` (initially `@sdris/database` `./testing`); only recognised
   test files (`*.test.*`, `*.spec.*`, `__tests__/`) and listed `approvedPaths` (none) may import them; the protection covers the
   entrypoint and the directory behind it, for package-name, subpath, alias, re-export, dynamic import, `require`, type-only,
   relative and self-reference imports.
2. **Why needed.** `@sdris/database/testing` was exported from a production package with nothing preventing production code from
   importing it (found in review, confirmed by experiment). It is also an S0-05 acceptance criterion (8).
3. **Evidence.** Valid fixtures 30 to 30f and invalid fixtures 60 to 60p; `dependency/test-only-entrypoint`; a malformed policy
   exits 2; the real tests in `apps/api` and `infrastructure/database` use the entrypoint legitimately and pass.
4. **Trade-offs and risks.** "Recognised test file" is a naming convention: a production file named `*.test.ts` would pass; the
   helper still ships in the package's `dist` as a published entrypoint.
5. **Recommendation: ACCEPT.** The limitation is stated in the amendment and is the usual one for naming-based test detection.
6. **Interactions.** Shares the policy file with A1 and A2 (separate key). With A4 the testing entrypoint also builds into `dist`
   (the compiled-runtime test uses it). A4 says "test-only spike helpers are not shipped"; the testing helper is shipped as an
   entrypoint. The Owner may want one sentence making that distinction explicit (see section 9).

## 7. Amendment A4 — Compiled runtime packaging

1. **Proposed rule.** `shared-kernel`, `database` and `investigation` build independently with `tsc` into `dist/`; every
   published entrypoint is `{ "sdris-source", "types", "default" }`; repository tooling uses the `sdris-source` condition,
   plain Node and outside consumers use `default` and `types`; `main`, `types`, `typesVersions` and the entrypoint set are
   unchanged; the checker requires `types` and `default` to be the exact dist mirror of the source target.
2. **Why needed.** The composed API could run only under `tsx`; the S0-05 specification (section 8) and acceptance criterion 7
   require compiled composition code to run under supported Node without tsx.
3. **Evidence.** `pnpm test:runtime`: builds from a clean state and runs the compiled `apps/api` composition root in a plain
   `node` process (no tsx, no flags, no custom conditions) against real PostgreSQL, asserting that no TypeScript or tsx module
   was loaded; 4/4; fixtures 40 and 70 to 70i; the `pnpm build` and `typecheck` chain.
4. **Trade-offs and risks.** Each package needs a build before it can run outside `tsx`; the `sdris-source` condition must be
   passed wherever source resolution is wanted; the API itself is still started by `tsx` in development; no bundling or publish
   pipeline; the smoke test needs PostgreSQL and is not in CI until S0-10.
5. **Recommendation: ACCEPT.**
6. **Interactions.** Resolves a limitation recorded in A2.5. Constrains every future workspace package that composition uses.

## 8. Interaction and conflict matrix

| Pair                        | Interaction                                                                                                                                                                                                             | Conflict?                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1 vs A2                    | **A2 revises A1 Rule 3**: infrastructure imports widen from `src/infrastructure/**` to that plus `src/composition/**`. Every other A1 rule stands; fixtures 29f and 29g (full-path restriction) still fail as required. | No conflict, but A1's Rule 3 text must carry the revision note (it already does) and A2 must not be accepted without A1 |
| A2 vs A4                    | A2.5 says compiled `dist` is not addressed; A4 addresses it. Both govern package `exports`                                                                                                                              | Stale sentence in A2 (section 5, correction b and c)                                                                    |
| A3 vs A4                    | `./testing` is restricted (A3) and also built to `dist` (A4); **clarified in both texts**: A3 restricts imports and does not govern physical inclusion in `dist`                                                        | Wording only: A4's "spike helpers are not shipped"                                                                      |
| A1 vs A3                    | Both add keys to `dependency-matrix.json`                                                                                                                                                                               | None                                                                                                                    |
| A2 vs ADR-025 Decision 5    | A2.6 is the S0-05 evaluation of Decision 5's condition; **the condition is satisfied only when A2 is ACCEPTED, by A2's own record; ADR-025 is not edited**                                                              | Accepting ADR-025 without A2 leaves Decision 5 open                                                                     |
| ADR-025 Decision 7 vs S0-06 | Audit atomicity is required, ownership deferred                                                                                                                                                                         | Not a conflict; an upcoming decision (see the S0-06 summary)                                                            |

## 9. Suggested order and housekeeping

1. The two governance questions in the checklist are already answered by the final approval (section 6): amendments are
   **preserved as independently traceable records**, with the effective policy documented for each approved amendment, and
   **approval of ADR-025 does not approve A1 to A4**.
2. **Done:** all editorial corrections and the A3/A4 clarification were committed together in one documentation-only commit
   (`07f1068`) that changes no Status line and no rule.
3. Suggested approval order: ADR-025, A1, A2 (after A1), A3, A4. Only two dependencies between records are binding: ADR-025 may go first with
   Decision 5 still CONDITIONAL, and A2 only after A1.
4. Follow the **approval workflow** at the end of the checklist: Phase 0 G-1 (resolved: Option A, recorded in the ADR README); Phase 1
   record all five Owner decisions (branching on APPROVED, APPROVED WITH CHANGES, REJECTED); Phase 2 apply any required changes;
   Phase 3 for each accepted record, in its own commits: effective policy, then Status line (and its mirrors), then the SHA
   bookkeeping. Section 10 gives the exact wording.
5. OBL-SEC-1 (the 22 advisories) stays an open obligation in every step; no step grants an exemption.

**Not done by this package:** no status was changed, no ADR decision text was edited after the editorial commit, and nothing
was marked ACCEPTED.

## 10. Exact proposed wording (to be used only when the record is approved)

**10.1 Entry for `docs/adr/ADR-025-effective-policy.md` when A2 is approved.** The file is a **traceability summary, not an ADR**:
its header states the document type, Decision Owner, Scope and Related documents and it has **no Status of its own**; each section
takes effect only with the Status commit of the record it summarises (so different sections legitimately have different effective
dates). The entry is added by step 2 and is in force only from step 3:

```text
## A2 — Dedicated composition entry point

In force from: the Status commit `docs(adr): accept A2` (not before). Precondition: A1 was ACCEPTED before it.
Source: ADR-025, "Proposed Amendment A2". This entry adds traceability, not rules; the ADR text prevails.

Effect: A1 Rule 3 is widened as A2.2 Rule 2 states: same-context infrastructure may be imported from
src/infrastructure/** and src/composition/**, and from no other path. All other A1 rules stand.

ADR-025 Decision 5 (historical wording, unchanged in ADR-025): "CONDITIONAL - Retain the current
infrastructure-owned transaction abstraction until its application-facing contract is validated in S0-05."
Evaluation: A2.6. Satisfaction: with this entry in force the condition is satisfied. The infrastructure-owned
UnitOfWork is retained, the application-facing port is the Investigation-owned TransactionScope in
src/application/ports, nothing was moved into the Shared Kernel, and the question is revisited when a second
context needs the same shape. ADR-025 is not rewritten.
```

**10.2 Entry when ADR-025 itself is approved:**

```text
## ADR-025 - PostgreSQL persistence architecture and migration governance

In force from: the Status commit `docs(adr): accept ADR-025` (not before).
Decision 5 remains CONDITIONAL, as written, until A2 is in force (see the A2 entry).
Dependency security: 22 production advisories (10 high, 10 moderate, 2 low, 0 critical; 2026-11-17) remain an open obligation
(OBL-SEC-1) to be triaged before any production deployment. Accepting ADR-025 is not security acceptance and grants no exemption.
```

**10.3 Addition to the ADR README conventions (approved as G-1 Option A and recorded in the ADR README by the G-1 commit; the README wording is authoritative):**

```text
- An amendment may live inside its parent ADR file with its own Status line. Changing that Status line, and the mirrors of the
  same value, is a lifecycle event and not an edit of an accepted ADR; the amendment's text is frozen once any Status in the file
  changes.
- Each accepted ADR or amendment gets a section in `docs/adr/ADR-NNN-effective-policy.md`, added after the Owner's decision is
  recorded in the approval checklist and before the Status commit, append-only, never contradicting the ADR text. That file is a
  traceability summary, not an ADR: it has no Status of its own, and each section is in force only from the Status commit of the
  record it summarises.
- Apart from each record's own Status line and the two designated mirrors (the ADR README index row, and the record's "Current
  status" cell in the approval checklist), every statement about a status is a dated snapshot and is not updated by status
  commits.
```

**10.4 Snapshot wording (applied in the governance-consistency commit; no Status line is touched):**

```text
ADR-025 header, the "Proposed amendments" line, now ends:
  "All are below. Each has its own Status line, which is authoritative; this header line does not state a status."

Approval checklist, opening paragraph, now reads:
  "Each document's own Status line is authoritative; statements about status in this checklist are dated snapshots (at the
   last refresh no document below was marked ACCEPTED)."
```

## 11. Governance question G-1 (RESOLVED)

**G-1 — ADR README versus amendments inside the ADR-025 file.** The README said "Do not edit an accepted ADR in place; supersede
it with a new ADR." A1 to A4 sit in the ADR-025 file, so changing an amendment's Status line after ADR-025 is accepted edits that
file.

**Resolution: Option A, approved by the Engineering Owner on 2026-11-17.** An individual amendment's Status change (and its
mirrors) is a permitted lifecycle transition, even after ADR-025 is accepted; it does not permit editing previously accepted
rules, rationale, constraints or decision text; a substantive change requires a new amendment or a superseding ADR. The
conventions of 10.3 are recorded in the ADR README by the commit `docs(adr): record G-1 amendment lifecycle interpretation`.
Phase 0 of the workflow is therefore complete.

| Option | What it meant                                                                                                                                                     | Outcome                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **A**  | Confirm that a Status-line change of an amendment (and its mirrors) is a permitted lifecycle event, not an in-place edit; add the sentences of 10.3 to the README | **Chosen and recorded**                                                                             |
| B      | Before any Status change, move A1 to A4 into their own files, so ADR-025's file is never touched after its acceptance                                             | Not chosen (it would have moved about 250 lines and touched the 5 files that link the ADR-025 path) |

**Consequence of the Phase 1 prerequisite (for the Owner to weigh).** The rule "all five decisions are recorded before the first
Status commit" is an additional workflow prerequisite, not a repair of wording: it exists because the ADR-025 file is frozen after
its first Status commit, so a required change to any amendment's text must be known first. Its effect is that **a record the Owner
has not yet decided blocks the acceptance of the others.** The workflow defines no way around this; relaxing it would first
need a new rule in the authoritative workflow (the approval checklist), which this package does not propose.

**ADR README check of this workflow.** Status values are used as defined (PROPOSED, ACCEPTED, SUPERSEDED): consistent. Only the
Owner changes PROPOSED to ACCEPTED: consistent (step 1 records the Owner's decision; step 3 executes it). File naming
`ADR-NNN-short-title.md`: the effective-policy file `ADR-025-effective-policy.md` follows it. The required ADR header (with a Status)
does **not** apply to it: it is a traceability summary, not an ADR, with no Status of its own, under the summary-document
convention of 10.3 (now in the README).
Executable architecture tests for dependency-boundary changes: not applicable, no rule changes. "Do not edit an accepted ADR in
place": consistent through the G-1 resolution (Option A), recorded in the README.
