# ADR-025 — Effective Policy (traceability summary)

- **Document type:** effective-policy summary (derived). **This is not an ADR and has no Status of its own.**
- **Date:** 2026-11-17
- **Decision Owner:** SDRIS Engineering Owner
- **Scope:** ADR-025 (PostgreSQL persistence architecture and migration governance) and its Amendments A1 to A4
- **Related:** [ADR-025](ADR-025-postgresql-persistence-architecture.md), [approval checklist](ADR-025-approval-checklist.md),
  [decision package](ADR-025-decision-package.md), [ADR README](README.md) (conventions "Amendments within one ADR file",
  "Effective-policy records" and "Status statements")

## How to read this file

- **Append-only.** One section per record, added after the Owner's decision is recorded in the approval checklist and before the
  record's Status commit. An earlier section is never edited.
- **In force only from the Status commit of the record a section summarises** (the commit whose subject is
  `docs(adr): accept <record>`), and **not in force before it.** Sections of different records therefore have different effective
  dates. This file states no current status; each record's own Status line is authoritative.
- **It adds traceability, never a rule.** It names the Owner decision, the rules that apply (by their source in the ADR-025
  file), the activation conditions, the exact Status transition and the open limitations. If it ever disagrees with the ADR text,
  **the ADR text prevails.**
- ADR-025 and A1 to A4 are independently governed records. Approving one does not approve another.

---

## ADR-025 — PostgreSQL persistence architecture and migration governance

**In force from:** the Status commit `docs(adr): accept ADR-025` (not before it).

### Owner decision

**APPROVED WITH CONDITIONS**, decided by the Engineering Owner on 2026-11-17 and recorded in the approval checklist, section 1
(commit `431e48f`). No change to the record's text was required. The conditions: Decision 5 remains CONDITIONAL until A2 becomes
effective; Decision 7 remains deferred; OBL-SEC-1 remains open and is not waived.

### Applicable rules

Source: the ADR-025 file, sections 3 to 14 and 18 (the decision text prevails). The decisions, in the ADR's own words:

| #   | Decision (section)                              | Wording in ADR-025                                                                                                                                       |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PostgreSQL and persistence technology (3)       | "ACCEPT Drizzle ORM with SQL-first migrations as the S0-04 persistence baseline"                                                                         |
| 2   | SQL migration governance (4)                    | "ACCEPT version-controlled SQL-first migrations."                                                                                                        |
| 3   | Database schema ownership (5)                   | "ACCEPT the initial ten-schema baseline."                                                                                                                |
| 4   | Infrastructure dependency policy (6)            | "ACCEPT a controlled infrastructure dependency policy."                                                                                                  |
| 5   | UnitOfWork and TransactionContext (7)           | "CONDITIONAL — Retain the current infrastructure-owned transaction abstraction until its application-facing contract is validated in S0-05." (see below) |
| 6   | Module-owned repository adapters (8)            | "ACCEPT controlled database access through context-owned infrastructure adapters."                                                                       |
| 7   | Audit, outbox and transactional consistency (9) | "ACCEPT atomic persistence as an architectural requirement; defer concrete table ownership and workflow implementation." (see below)                     |
| 8   | Optimistic concurrency and idempotency (10)     | "ACCEPT database-enforced concurrency and uniqueness controls."                                                                                          |
| 9   | drizzle-kit (11)                                | "DEFER."                                                                                                                                                 |
| 10  | Database testing and CI (12)                    | "ACCEPT real PostgreSQL integration tests as mandatory evidence for persistence changes."                                                                |
| 11  | Database reset safety (13)                      | "ACCEPT strict local/test reset protection."                                                                                                             |

Also applicable: section 14 (security and dependency governance) and section 18 (acceptance and change control).

### Dependencies and activation conditions

- **No dependency on another record.** ADR-025 may be accepted first (approval workflow, Phase 3).
- **It approves nothing else.** Its acceptance does not approve A1, A2, A3 or A4, which are decided and activated separately.
- **It takes effect with Decision 5 still CONDITIONAL and Decision 7 still deferred** (below), and with OBL-SEC-1 open.

### Status transition that activates this policy

The `Status` bullet in the header of the ADR-025 file changes from `PROPOSED — Pending Engineering Owner Approval` to `ACCEPTED`,
in the commit whose subject is `docs(adr): accept ADR-025`. That commit also changes only the mirrors of the same value: the
ADR-025 row of the ADR README index and ADR-025's "Current status" cell in the approval checklist. Nothing else changes.

### Decision 5 — historical wording preserved

ADR-025 Decision 5 stays **CONDITIONAL** in ADR-025 for good, exactly as written: "Retain the current infrastructure-owned
transaction abstraction until its application-facing contract is validated in S0-05." Amendment A2.6 provides the evaluation.
**The condition is satisfied only after A2 becomes effective, through the A2 section of this file.** ADR-025 is not rewritten.

### Decision 7 — deferred, preserved

Atomic persistence of domain state, audit record and outbox event is accepted as a requirement; the following remain **deferred**
and are not decided here: final audit table schemas; outbox and inbox message schemas; worker retry policies; event publishing
infrastructure; full command idempotency middleware ("Those belong to subsequent approved tasks").

### Limitations and deferred obligations

- Decision 9 (`drizzle-kit`) is deferred. Decision 10: the CI job belongs to S0-10; until then every result is a local result.
- The follow-ups of section 17 remain open: audit, outbox, inbox and jobs ownership; the Retrieval persistence and schema;
  PostgreSQL integration tests in CI (S0-10); dependency-vulnerability triage.
- **OBL-SEC-1 — open, not waived.** The 22 production dependency advisories (10 high, 10 moderate, 2 low, 0 critical, per the
  2026-11-17 audit) must be triaged before any production deployment: reachability, patched versions and compatibility,
  remediation or an explicit Owner risk disposition, and a re-run of the audit. Accepting ADR-025 is not security acceptance
  (ADR-025 section 14) and grants no exemption; any major-version upgrade needs separate Owner approval.

---

## A1 — Persistence dependency policy for S0-05

**In force from:** the Status commit `docs(adr): accept A1` (not before it).

### Owner decision

**APPROVED**, decided by the Engineering Owner on 2026-11-17 and recorded in the approval checklist, section 2 (commit
`79428db`): accept the persistence dependency policy and the context infrastructure allowlist. No change to the record's text was
required.

### Applicable rules

Source: the ADR-025 file, "Proposed Amendment A1", sections A1.1 to A1.4 (the amendment text prevails).

- **Rule 1.** Persistence libraries are usable only from Context Infrastructure (`drizzle-orm` and `@sdris/database` only from
  `modules/<context>/src/infrastructure/**`, and only when allowlisted for that context).
- **Rule 2.** Domain, Application and Public code stay independent of database infrastructure.
- **Rule 3.** Dependencies point inward: only a module's `src/infrastructure/**` may import that same module's
  `src/infrastructure/**`. **As written in A1; A2 widens it only from A2's own activation (see the A2 section).**
- **Rule 4.** Global Infrastructure does not import business modules by default, with no exception mechanism.
- **Rule 5.** Access is restricted by source path and by one centralised allowlist (`scripts/architecture/dependency-matrix.json`).
- **Rule 6.** Cross-context restrictions are unchanged.
- **Rule 7.** `@sdris/database` is used only through its published entrypoint.
- **Allowlist (A1.3).** `contextInfrastructure` lists, per module, the Global Infrastructure packages and persistence libraries
  its Context Infrastructure may use; everything not listed is denied, and a malformed entry makes the checker exit with code 2.
- **Enforcement (A1.4).** `dependency/forbidden-external`, `dependency/direction`, `dependency/manifest`,
  `boundary/infrastructure-inversion`, `boundary/private-import`, `boundary/package-specifier-required`.

### Dependencies and activation conditions

- **No dependency on another record.** A1 may be accepted independently of ADR-025's activation order, but **A2 can take effect
  only after A1 is accepted.**
- Activation is the Status transition below; nothing else activates it.

### Status transition that activates this policy

The `Status` bullet of "Proposed Amendment A1" in the ADR-025 file changes from
`PROPOSED — Pending Engineering Owner Approval` to `ACCEPTED`, in the commit whose subject is `docs(adr): accept A1`. Per the ADR
README convention, an individual amendment's Status change is a permitted lifecycle transition. The commit changes only that
Status line and the mirrors of the same value (A1's "Current status" cell in the approval checklist).

### Limitations and deferred obligations

- A1.5: directory names under `src/` become architecture; a new context needing persistence needs a reviewed allowlist entry;
  intra-module layering beyond Rule 3 is not addressed.
- A1.6, not decided here: where `UnitOfWork` / `TransactionContext` finally live (governed by ADR-025 Decision 5); whether Global
  Infrastructure may ever import a business module's public contract; audit, outbox, inbox and job table ownership; the Retrieval
  schema; role-per-context and row-level security.
- **Transitional fact, stated for traceability:** the architecture checker as merged already enforces Rule 3 as revised by A2
  (composition is allowed to import same-context infrastructure). Between the Status commits of A1 and A2 the documented A1 Rule
  3 is therefore narrower than the checker's behaviour; the A2 section states when the widening takes effect.

---

## A2 — Dedicated composition entry point (revises A1 Rule 3)

**In force from:** the Status commit `docs(adr): accept A2` (not before it). **Precondition: A1 was ACCEPTED before it.**

### Owner decision

**APPROVED WITH CONDITIONS**, decided by the Engineering Owner on 2026-11-17 and recorded in the approval checklist, section 3
(commit `0a0577f`): accept the dedicated composition entry point and the revision to A1 Rule 3. Conditions: A2 becomes effective
only after A1 is accepted; A2.6 supplies the evaluation satisfying ADR-025 Decision 5 once A2 becomes effective. No change to the
record's text was required.

### Applicable rules

Source: the ADR-025 file, "Proposed Amendment A2", sections A2.1 to A2.4 (the amendment text prevails).

- **Revision of A1 Rule 3.** Same-context infrastructure may be imported from `src/infrastructure/**` **and**
  `src/composition/**`, and from no other path. Every other path stays forbidden, so the full-path restriction exercised by
  fixtures 29f and 29g is unchanged. All other A1 rules stand.
- **A2.2 rules.** (1) `src/composition/**` is a separate module zone. (2) Same-context infrastructure only from
  `src/infrastructure/**` and `src/composition/**`. (3) Only `src/composition/**` may import the composition zone. (4) Exactly one
  extra entrypoint `@sdris/<context>/composition`; `.` and `main` stay under `src/public/**`. (5) Only roots listed in
  `compositionRoots` may import that subpath (initially `apps/api/src/composition/**` for Investigation). (6) The composition zone
  may import the database contract only as a type, never Drizzle or a driver. (7) The entrypoint exposes factories and contracts,
  never adapters. (8) `src/public/**` stays independent of composition and infrastructure. (9) Cross-context restrictions are
  unchanged.
- **A2.3 factory contract.** Explicit return types that are public contracts; a factory's reachable type surface names no adapter,
  no infrastructure type, no Drizzle or driver type, and no `@sdris/database` symbol other than the opaque `PersistenceHandle`.
- **A2.4 enforcement.** `boundary/composition-inversion`, `boundary/infrastructure-inversion`, `dependency/composition-access`,
  `dependency/direction`, `dependency/forbidden-external`, `composition/adapter-exposure`, `package/entrypoint-location`,
  `composition/explicit-return-type`, and the type-surface and declaration-leak rules.

### Dependencies and activation conditions

- **A1 must be ACCEPTED before A2's Status commit.** A2 revises a rule of A1 and cannot revise a rule that is not in force. If A1
  is revised in substance, A2 is re-based before it is activated.
- The ordering is enforced by the order of the Phase 3 Status commits; nothing else activates A2.
- From A2's Status commit, A1 Rule 3 is read as revised above. Before it, A1 Rule 3 stands as written in A1.

### Status transition that activates this policy

The `Status` bullet of "Proposed Amendment A2" in the ADR-025 file changes from
`PROPOSED — Pending Engineering Owner Approval` to `ACCEPTED`, in the commit whose subject is `docs(adr): accept A2`, made after
A1's Status commit. The commit changes only that Status line and the mirrors of the same value (A2's "Current status" cell in the
approval checklist).

### ADR-025 Decision 5 — satisfaction of the condition

ADR-025 Decision 5 (historical wording, unchanged in ADR-025): "CONDITIONAL — Retain the current infrastructure-owned transaction
abstraction until its application-facing contract is validated in S0-05." **Evaluation:** A2.6. **Satisfaction:** with this
section in force the condition is satisfied. The infrastructure-owned `UnitOfWork` is retained, the application-facing port is the
Investigation-owned `TransactionScope` in `src/application/ports`, nothing was moved into the Shared Kernel, and the question is
revisited when a second context needs the same shape. **Before this section is in force the condition is not satisfied. ADR-025
is not rewritten.**

### Limitations and deferred obligations

- A2.5: type surfaces verify declared types, not behaviour; one documented equivalent mutant (the composition-root package check
  is implied by the path check); adapter tests must live under `src/infrastructure/**`.
- A2.7, not decided here: whether `apps/worker` becomes a composition root (it is not authorised); compiled runtime packaging
  (addressed by A4); the final home of a shared transaction contract; the Investigation aggregate itself (defined by the approved
  S0-05 specification, not by this amendment).
