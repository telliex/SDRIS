import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Result } from '@sdris/shared-kernel';
export type Outcome = Result<number, string>;
export const connect = () => drizzle(new Pool());
