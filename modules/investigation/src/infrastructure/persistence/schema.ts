import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle table definitions for the Investigation context. They mirror migration
 * 0002_create_investigation_case_tables.sql, which stays the authoritative schema definition.
 * ORM models are an internal detail of this adapter and never become domain entities.
 */
const investigation = pgSchema('investigation');

export const investigationCase = investigation.table('investigation_case', {
  id: uuid('id').primaryKey(),
  uutId: uuid('uut_id').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }).notNull(),
  version: integer('version').notNull().default(1),
});

export const failureObservation = investigation.table('failure_observation', {
  id: uuid('id').primaryKey(),
  caseId: uuid('case_id').notNull(),
  uutId: uuid('uut_id').notNull(),
  description: text('description').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
});
