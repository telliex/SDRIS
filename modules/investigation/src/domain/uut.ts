import type { EntityId, EntityRef, Timestamp } from '@sdris/shared-kernel';

/**
 * The unit under test (the server being tested). Investigation owns it in S0-05 (Owner decision Q2).
 *
 * Serial number and hostname are optional EXTERNAL attributes. They are stored exactly as supplied: no trimming,
 * no case conversion, no normalisation, no uniqueness. Neither is ever an identity; the internal UUIDv7 is.
 * A UUT is immutable after creation in S0-05.
 */
export type UutId = EntityId<'UUT'>;
export type UutRef = EntityRef<'UUT'>;

export interface Uut {
  readonly id: UutId;
  readonly serialNumber?: string;
  readonly hostname?: string;
  /** When SDRIS created the record. Not a statement about the physical unit. */
  readonly createdAt: Timestamp;
}

export function createUut(input: {
  readonly id: UutId;
  readonly serialNumber?: string;
  readonly hostname?: string;
  readonly createdAt: Timestamp;
}): Uut {
  return Object.freeze({
    id: input.id,
    ...(input.serialNumber === undefined ? {} : { serialNumber: input.serialNumber }),
    ...(input.hostname === undefined ? {} : { hostname: input.hostname }),
    createdAt: input.createdAt,
  });
}
