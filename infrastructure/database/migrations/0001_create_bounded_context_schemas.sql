-- S0-04 baseline: one PostgreSQL schema per bounded context, plus `system` for cross-cutting
-- infrastructure. Schemas only: no business tables (those belong to later tasks and owning contexts).
-- Idempotent by construction; the runner also records this file so it is applied once.

create schema if not exists investigation;
comment on schema investigation is 'Investigation context: cases, failure observations, hypotheses';

create schema if not exists evidence;
comment on schema evidence is 'Evidence context: raw artifacts, parsing, normalized records, evidence anchors';

create schema if not exists diagnostics;
comment on schema diagnostics is 'Diagnostics context: AI analysis, recommendations, diagnostic execution';

create schema if not exists workflow;
comment on schema workflow is 'Workflow context: work items, dependencies, workflow coordination';

create schema if not exists verification;
comment on schema verification is 'Verification context: repair interventions, retests, effectiveness assessments';

create schema if not exists knowledge;
comment on schema knowledge is 'Knowledge context: knowledge cases, claims, diagnostic patterns';

create schema if not exists platform;
comment on schema platform is 'Platform context: platform profiles, component identity, configuration drift';

create schema if not exists governance;
comment on schema governance is 'Governance context: policies, readiness, review and release governance';

create schema if not exists integration;
comment on schema integration is 'Integration context: external system adapters and integration state';

create schema if not exists system;
comment on schema system is 'Cross-cutting infrastructure: migration tracking, later audit, outbox/inbox, durable jobs';
