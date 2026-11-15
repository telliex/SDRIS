import { DrizzleRepo } from '../../infrastructure/persistence/adapter';
export interface Exposed {
  readonly repo: DrizzleRepo;
}
