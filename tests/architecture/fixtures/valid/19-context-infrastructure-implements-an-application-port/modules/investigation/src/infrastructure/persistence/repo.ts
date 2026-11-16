import { eq } from 'drizzle-orm';
import type { CaseRepository } from '../../application/ports/case-repository';
import { model } from '../../domain/model';
export const repo: CaseRepository = {
  async find() {
    return eq && model;
  },
};
