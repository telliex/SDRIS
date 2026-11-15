/** Deterministic synthetic fixtures for Shared Kernel tests. Not part of the public API. */
import { createEntityIdGenerator, type EntityId } from './entity-id';

export const FIXED_NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z
export const FIXED_TIMESTAMP = '2023-11-14T22:13:20.000Z';

export function fixedGenerator(fill = 0xab, now = FIXED_NOW_MS) {
  return createEntityIdGenerator({
    now: () => now,
    randomBytes: (length) => new Uint8Array(length).fill(fill),
  });
}

/** Valid UUIDv7 literals for use as inputs. */
export const UUID_A = '01890a5d-ac96-774b-bcce-b302099a8057';
export const UUID_B = '01890a5d-ac96-774b-8cce-b302099a8058';

export const uutId = (): EntityId<'UUT'> => UUID_A as EntityId<'UUT'>;
export const caseId = (): EntityId<'InvestigationCase'> => UUID_B as EntityId<'InvestigationCase'>;
