import { existsSync } from 'node:fs';
import path from 'node:path';

/** Synthetic local-development credentials, identical to deploy/local/docker-compose.yml. */
export const DEFAULT_LOCAL_DATABASE_URL =
  'postgresql://sdris_local:sdris_local@localhost:5432/sdris_local';

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL?.trim();
  return value ? value : DEFAULT_LOCAL_DATABASE_URL;
}

/** Loads `<root>/.env.local` (never committed) without overriding variables already set. */
export function loadLocalEnvFile(root: string): void {
  const file = path.join(root, '.env.local');
  if (existsSync(file)) process.loadEnvFile(file);
}
