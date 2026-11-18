# Architecture Decision Records

ADRs record durable architectural decisions. A decision binds the project only when its status is **ACCEPTED**,
which requires explicit approval by the SDRIS Engineering Owner (see [AGENTS.md](../../AGENTS.md) section 15).
Implementers must not treat a `PROPOSED` ADR as approved.

## Index

| ADR                                                       | Title                                                      | Status   | Scope         |
| --------------------------------------------------------- | ---------------------------------------------------------- | -------- | ------------- |
| [ADR-024](ADR-024-sprint-0-execution.md)                  | Sprint 0 Execution Blueprint                               | PROPOSED | Sprint 0      |
| [ADR-025](ADR-025-postgresql-persistence-architecture.md) | PostgreSQL Persistence Architecture & Migration Governance | PROPOSED | S0-04 (PR #5) |

Approval of ADR-025 and its amendments, and of the S0-05 specification, is tracked in the
[approval checklist](ADR-025-approval-checklist.md). It approves nothing by itself.

## Not in the repository

AGENTS.md notes that the project planning history covers ADR-001 to ADR-024. Only the ADRs listed above are
committed. The others are not available here and are intentionally not listed or summarised, because their contents
must not be invented. Missing references should be reported, not assumed.

## Conventions

- File name: `ADR-NNN-short-title.md`.
- Header states Status, Date, Decision Owner, Scope and Related documents.
- Status values: `PROPOSED`, `ACCEPTED`, `SUPERSEDED`. Only the Engineering Owner changes `PROPOSED` to `ACCEPTED`.
- Do not edit an accepted ADR in place; supersede it with a new ADR. The one permitted lifecycle transition is described in the next bullet.
- **Amendments within one ADR file.** An ADR file may contain amendments (for example ADR-025 and Amendments A1 to A4). The ADR and
  each amendment are **independently governed records**: each has its own Status line and is approved separately. Changing an
  individual amendment's Status line, and the mirrors of that same value, is a **permitted lifecycle transition, even after the
  parent ADR is accepted.** This exception does **not** permit editing any previously accepted architectural rule, rationale,
  constraint or decision text; a substantive change requires a new amendment or a superseding ADR. An amendment's text is frozen
  once any Status in its file changes. (Decision G-1, Option A, approved by the Engineering Owner on 2026-11-17.)
- **Effective-policy records.** Each accepted ADR or amendment gets a section in `docs/adr/ADR-NNN-effective-policy.md`, added
  after the Owner's decision is recorded in the approval checklist and before the Status commit, append-only, never contradicting
  the ADR text. That file is a traceability summary, not an ADR: it has no Status of its own, and each section is in force only
  from the Status commit of the record it summarises.
- **Status statements.** Apart from each record's own Status line and the two designated mirrors (the index row above and the
  record's "Current status" cell in the approval checklist), every statement about a status is a dated snapshot and is not
  updated by status commits.
- Changing a dependency boundary requires executable architecture tests (`pnpm check:architecture`).
