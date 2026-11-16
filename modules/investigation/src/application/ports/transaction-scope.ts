/**
 * Application-facing transaction port, owned by this context. It mentions no ORM or driver type.
 *
 * `run` commits when `work` resolves and rolls everything back when it rejects. A token is only valid
 * inside the `run` that issued it. (ADR-025 Decision 5 leaves the final home of a shared transaction
 * contract open; this context-owned port is the S0-05 evaluation of the alternative to a shared one.)
 */
declare const transactionTokenBrand: unique symbol;
export interface TransactionToken {
  readonly [transactionTokenBrand]: 'investigation-transaction';
}

export interface TransactionScope {
  run<T>(work: (tx: TransactionToken) => Promise<T>): Promise<T>;
}
