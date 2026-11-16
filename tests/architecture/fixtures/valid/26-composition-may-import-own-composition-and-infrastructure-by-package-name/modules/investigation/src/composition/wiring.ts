import { DrizzleRepo } from '@sdris/investigation/src/infrastructure/persistence/adapter';
export const w = (): DrizzleRepo => new DrizzleRepo();
