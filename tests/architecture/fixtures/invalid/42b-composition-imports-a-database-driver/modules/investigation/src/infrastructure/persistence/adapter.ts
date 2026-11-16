import { eq } from 'drizzle-orm';
import type { Repo } from '../../application/ports/repo';
export class DrizzleRepo implements Repo {
  get(): string {
    return String(eq);
  }
}
