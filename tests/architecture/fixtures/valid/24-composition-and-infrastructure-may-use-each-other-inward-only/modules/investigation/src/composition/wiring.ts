import { DrizzleRepo } from '../infrastructure/persistence/adapter';
export const repo = (): DrizzleRepo => new DrizzleRepo();
