import { eq } from 'drizzle-orm';
import { createDatabase } from '@sdris/database';
export const r = [eq, createDatabase];
