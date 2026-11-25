/**
 * Thrown when the synthetic identity capability is requested outside a positively matched local or test
 * environment (specification 3.2). Callers assert on `code`, never on the message. The message is fixed text: it
 * never contains an environment value, a database URL or any other caller- or environment-controlled text.
 */
export class SyntheticIdentityForbiddenError extends Error {
  readonly code = 'SYNTHETIC_IDENTITY_FORBIDDEN' as const;
  constructor() {
    super(
      'The synthetic identity issuer is permitted only in a positively matched local or test environment.',
    );
    this.name = 'SyntheticIdentityForbiddenError';
  }
}
