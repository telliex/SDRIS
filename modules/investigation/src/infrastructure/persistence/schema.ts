import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle table definitions for the Investigation context. They mirror migration
 * 0002_create_investigation_case_tables.sql, which stays the authoritative schema definition.
 * ORM models are an internal detail of this adapter and never become domain entities.
 */
const investigation = pgSchema('investigation');

export const uut = investigation.table('uut', {
  id: uuid('id').primaryKey(),
  serialNumber: text('serial_number'),
  hostname: text('hostname'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const testAttempt = investigation.table('test_attempt', {
  id: uuid('id').primaryKey(),
  uutId: uuid('uut_id').notNull(),
  stage: text('stage').notNull(),
  externalExecutionReference: text('external_execution_reference'),
  registeredAt: timestamp('registered_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const investigationCase = investigation.table('investigation_case', {
  id: uuid('id').primaryKey(),
  uutId: uuid('uut_id').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }).notNull(),
  version: integer('version').notNull().default(1),
});

export const caseTestAttemptLink = investigation.table('case_test_attempt_link', {
  caseId: uuid('case_id').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  uutId: uuid('uut_id').notNull(),
  role: text('role').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** TRANSITIONAL (Owner decision Q8): removed once the link-based tests replace the observation-based ones. */
export const failureObservation = investigation.table('failure_observation', {
  id: uuid('id').primaryKey(),
  caseId: uuid('case_id').notNull(),
  uutId: uuid('uut_id').notNull(),
  description: text('description').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
});
