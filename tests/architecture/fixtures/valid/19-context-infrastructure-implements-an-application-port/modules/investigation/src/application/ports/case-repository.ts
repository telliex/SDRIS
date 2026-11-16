import { model } from '../../domain/model';
export interface CaseRepository {
  find(id: string): Promise<typeof model | undefined>;
}
