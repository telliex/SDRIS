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

/** A UUT that has not been stored yet. It carries no timestamp: PostgreSQL generates `created_at` on insert. */
export interface NewUut {
  readonly id: UutId;
  readonly serialNumber?: string;
  readonly hostname?: string;
}

/** A stored UUT. */
export interface Uut extends NewUut {
  /** When SDRIS recorded the UUT (database clock, UTC). Not a statement about the physical unit. */
  readonly createdAt: Timestamp;
}

export function createUut(input: {
  readonly id: UutId;
  readonly serialNumber?: string;
  readonly hostname?: string;
}): NewUut {
  return Object.freeze({
    id: input.id,
    ...(input.serialNumber === undefined ? {} : { serialNumber: input.serialNumber }),
    ...(input.hostname === undefined ? {} : { hostname: input.hostname }),
  });
}
