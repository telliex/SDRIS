# Architecture Decision Records

ADRs record durable architectural decisions. A decision binds the project only when its status is **ACCEPTED**,
which requires explicit approval by the SDRIS Engineering Owner (see [AGENTS.md](../../AGENTS.md) section 15).
Implementers must not treat a `PROPOSED` ADR as approved.

## Index

| ADR                                                       | Title                                                      | Status   | Scope         |
| --------------------------------------------------------- | ---------------------------------------------------------- | -------- | ------------- |
| [ADR-024](ADR-024-sprint-0-execution.md)                  | Sprint 0 Execution Blueprint                               | PROPOSED | Sprint 0      |
| [ADR-025](ADR-025-postgresql-persistence-architecture.md) | PostgreSQL Persistence Architecture & Migration Governance | PROPOSED | S0-04 (PR #5) |

## Not in the repository

AGENTS.md notes that the project planning history covers ADR-001 to ADR-024. Only the ADRs listed above are
committed. The others are not available here and are intentionally not listed or summarised, because their contents
must not be invented. Missing references should be reported, not assumed.

## Conventions

- File name: `ADR-NNN-short-title.md`.
- Header states Status, Date, Decision Owner, Scope and Related documents.
- Status values: `PROPOSED`, `ACCEPTED`, `SUPERSEDED`. Only the Engineering Owner changes `PROPOSED` to `ACCEPTED`.
- Do not edit an accepted ADR in place; supersede it with a new ADR.
- Changing a dependency boundary requires executable architecture tests (`pnpm check:architecture`).
