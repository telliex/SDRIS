import type { Repo } from '../../application/ports/repo';
import { cases } from './tables';
export class DrizzleRepo implements Repo {
  readonly table = cases;
  get(): string {
    return 'x';
  }
}
export const makeAdapter = (): DrizzleRepo => new DrizzleRepo();
