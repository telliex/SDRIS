// Stand-in for @sdris/database: one approved opaque contract and one contract that is NOT approved.
declare const brand: unique symbol;
export interface PersistenceHandle {
  readonly [brand]: 'persistence';
}
export interface UnitOfWork {
  run(): void;
}
