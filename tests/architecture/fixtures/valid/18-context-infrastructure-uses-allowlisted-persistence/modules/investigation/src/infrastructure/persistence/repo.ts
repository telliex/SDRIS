import { eq } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { createDatabase } from '@sdris/database';
export const cases = pgSchema('investigation').table('probe', { id: text('id') });
export const open = () => [createDatabase, eq];
