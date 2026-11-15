/**
 * PostgreSQL schema ownership map. One schema per bounded context (AGENTS.md section 4); `system`
 * holds cross-cutting infrastructure (migration tracking now; audit, outbox/inbox and durable jobs
 * in later tasks). A table belongs to exactly one schema, and only its owning context writes it.
 *
 * Retrieval is a dedicated read-side capability with its own persistence (AGENTS.md section 4). Its
 * schema is intentionally NOT created here: no committed document assigns one (pending Owner decision).
 */
export const SCHEMA_OWNERSHIP = {
  investigation: 'Investigation context: cases, failure observations, hypotheses',
  evidence: 'Evidence context: raw artifacts, parsing, normalized records, evidence anchors',
  diagnostics: 'Diagnostics context: AI analysis, recommendations, diagnostic execution',
  workflow: 'Workflow context: work items, dependencies, workflow coordination',
  verification: 'Verification context: repair interventions, retests, effectiveness assessments',
  knowledge: 'Knowledge context: knowledge cases, claims, diagnostic patterns',
  platform: 'Platform context: platform profiles, component identity, configuration drift',
  governance: 'Governance context: policies, readiness, review and release governance',
  integration: 'Integration context: external system adapters and integration state',
  system:
    'Cross-cutting infrastructure: migration tracking, later audit, outbox/inbox, durable jobs',
} as const;

export type SchemaName = keyof typeof SCHEMA_OWNERSHIP;
export const SCHEMA_NAMES = Object.keys(SCHEMA_OWNERSHIP) as SchemaName[];
