/**
 * Test support, published as `@sdris/database/testing`. Only tests may use it: it creates and drops
 * throw-away `sdris_test_*` databases and refuses anything else.
 */
export type { IsolatedDatabase } from './isolated-database';
export { createIsolatedDatabase } from './isolated-database';
