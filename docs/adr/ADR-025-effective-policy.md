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
