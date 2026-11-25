# Architecture Decision Records

ADRs record durable architectural decisions. A decision binds the project only when its status is **ACCEPTED**,
which requires explicit approval by the SDRIS Engineering Owner (see [AGENTS.md](../../AGENTS.md) section 15).
Implementers must not treat a `PROPOSED` ADR as approved.

## Index

| ADR                                                       | Title                                                      | Status   | Scope         |
| --------------------------------------------------------- | ---------------------------------------------------------- | -------- | ------------- |
| [ADR-024](ADR-024-sprint-0-execution.md)                  | Sprint 0 Execution Blueprint                               | PROPOSED | Sprint 0      |
| [ADR-025](ADR-025-postgresql-persistence-architecture.md) | PostgreSQL Persistence Architecture & Migration Governance | ACCEPTED | S0-04 (PR #5) |

Approval of ADR-025 and its amendments, and of the S0-05 specification, is tracked in the
[approval checklist](ADR-025-approval-checklist.md). It approves nothing by itself.

## Not in the repository

AGENTS.md notes that the project planning history covers ADR-001 to ADR-024. Only the ADRs listed above are
committed. The others are not available here and are intentionally not listed or summarised, because their contents
must not be invented. Missing references should be reported, not assumed.

## Conventions

- File name: `ADR-NNN-short-title.md`.
- Header states Status, Date, Decision Owner, Scope and Related documents.
- Status values: `PROPOSED`, `ACCEPTED`, `SUPERSEDED`. Only the Engineering Owner changes `PROPOSED` to `ACCEPTED` (decision authority); execution of the mechanical step may be delegated only under ADR governance G-2 below.
- Do not edit an accepted ADR in place; supersede it with a new ADR. The one permitted lifecycle transition is described in the next bullet.
- **Amendments within one ADR file.** An ADR file may contain amendments (for example ADR-025 and Amendments A1 to A4). The ADR and
  each amendment are **independently governed records**: each has its own Status line and is approved separately. Changing an
  individual amendment's Status line, and the mirrors of that same value, is a **permitted lifecycle transition, even after the
  parent ADR is accepted.** This exception does **not** permit editing any previously accepted architectural rule, rationale,
  constraint or decision text; a substantive change requires a new amendment or a superseding ADR. An amendment's text is frozen
  once any Status in its file changes. (Decision G-1, Option A, approved by the Engineering Owner on 2026-11-17.)
- **ADR governance G-2: Owner-authorized delegated execution** (decided by the Engineering Owner on 2026-11-24, adopted by the
  same mechanism as G-1; named "ADR governance G-2" to distinguish it from the S0-06 review gap identifiers G-1 to G-9). The record
  of the decision, its adoption basis and its authorization is in the approval checklist, "Phase 0 - ADR governance G-2". The
  Engineering Owner decides; mechanical execution may be delegated. The ten principles:
  1. **G2-01 Owner authority.** The Engineering Owner retains exclusive authority over architecture decisions, ADR acceptance,
     governance changes and implementation authorization. An agent never infers or manufactures approval.
  2. **G2-02 Delegated execution.** An explicitly authorized agent may perform the mechanical operations of an approved lifecycle:
     recording the Owner decision and updating the approval checklist, appending the effective-policy section, the authorized
     Status transition, the SHA backfill and the corresponding documentation commits. Delegation transfers execution only.
  3. **G2-03 Explicit authorization.** A valid authorization, recorded in the existing sign-off and traceability mechanisms (no new
     system, database, workflow engine or standalone template), states: (1) the Owner decision and authorization statement;
     (2) the target record or task; (3) the authorized executor; (4) a closed list of permitted operations; (5) the reviewed
     content SHA and the execution-start HEAD; (6) explicit exclusions; (7) completion conditions and the required verification.
  4. **G2-04 Scope.** One authorization may cover a complete bounded workflow; operations it already covers need no repeated
     confirmation; operations outside it need separate authorization.
  5. **G2-05 Baseline binding.** Authorization is bound to the reviewed content and the execution-start baseline. Authorized
     editorial changes, status records and SHA references need no renewed substantive approval; a material change to an
     architecture rule, technical contract, acceptance criterion, schema or code needs a separate Owner disposition.
  6. **G2-06 Attribution.** Each delegated record states the decision authority, the actual execution actor, the execution mode,
     the authorization reference, the reviewed and execution baselines and the verification status. An agent-executed operation is
     never presented as personally executed by the Owner; Git author identity alone is not evidence of Owner approval; the
     applicable co-author trailer is kept.
  7. **G2-07 Independent verification.** One consolidated independent verification per material bounded governance transaction
     covers authorization, scope, lifecycle ordering, traceability, content equivalence and remaining gates. The executing agent's
     own checks are not independent verification. Resolved architecture findings are not reopened without a material regression.
  8. **G2-08 Stop conditions.** The agent stops when authorization is absent or materially ambiguous, the scope would be exceeded,
     governing rules conflict, material baseline or contract drift is found, or a new Owner decision is required.
  9. **G2-09 Policy precedence.** G-2 governs **execution authority only**. By the Owner's decision it supersedes earlier
     procedural requirements that reserve the execution of ADR lifecycle operations to the Owner personally or exclude an agent
     (for example the sentence "Claude Code does not perform these steps" in A5). It edits no ADR text, changes no architectural
     decision, rule, constraint, rationale, technical contract or approved scope, and is not a general authority to override other
     governance or security requirements. Historical ADR wording stays as written.
  10. **G2-10 Historical remediation.** G-2 is prospective and legitimizes no earlier operation. A historical procedural deviation
      needs its own explicit, bounded Owner decision naming the operations and commits (A5: approval checklist, section 5A).

  **Always prohibited:** manufacturing or inferring Owner approval; fabricating authorization or verification evidence;
  misrepresenting the execution actor; exceeding the authorized scope; silently altering accepted architecture rules; bypassing
  governance gates. **Separate applicable authorization is required** (and is not prohibited by G-2) for governance changes,
  architecture contract changes, implementation, merge and deployment.

- **Effective-policy records.** Each accepted ADR or amendment gets a section in `docs/adr/ADR-NNN-effective-policy.md`, added
  after the Owner's decision is recorded in the approval checklist and before the Status commit, append-only, never contradicting
  the ADR text. That file is a traceability summary, not an ADR: it has no Status of its own, and each section is in force only
  from the Status commit of the record it summarises.
- **Status statements.** Apart from each record's own Status line and the two designated mirrors (the index row above and the
  record's "Current status" cell in the approval checklist), every statement about a status is a dated snapshot and is not
  updated by status commits.
- Changing a dependency boundary requires executable architecture tests (`pnpm check:architecture`).
