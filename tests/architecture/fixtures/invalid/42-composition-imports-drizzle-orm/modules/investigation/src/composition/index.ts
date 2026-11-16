import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
export const e = eq;
export type D = PgDatabase<never>;
