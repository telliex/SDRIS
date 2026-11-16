import { pgSchema, text } from 'drizzle-orm/pg-core';
export const cases = pgSchema('investigation').table('probe', { id: text('id') });
