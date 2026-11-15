/**
 * Guards for destructive local operations (reset, seed, test-database lifecycle).
 *
 * A target is acceptable only when ALL hold: not production, the host is the local machine, and the
 * database name is on the SDRIS local/test allow-list. The host check is on the parsed URL; query
 * parameters that could redirect the connection (`host`, `hostaddr`, `service`) are rejected.
 */
export class UnsafeDatabaseTargetError extends Error {
  readonly code = 'UNSAFE_DATABASE_TARGET';
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseTargetError';
  }
}

export interface DatabaseTarget {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly user: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** `sdris_local`, `sdris_test`, `sdris_test_ab12cd34`, ... Never `sdris_prod`, `postgres`, etc. */
export const DISPOSABLE_DATABASE_NAME = /^sdris_(local|test)(_[a-z0-9]+)*$/;
const REDIRECTING_PARAMS = ['host', 'hostaddr', 'service'];

/** Describes a connection URL without its password. Throws if the URL cannot be parsed. */
export function describeTarget(databaseUrl: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new UnsafeDatabaseTargetError('DATABASE_URL is not a valid URL; refusing to continue.');
  }
  return {
    host: url.hostname,
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
  };
}

export function assertDisposableLocalTarget(
  databaseUrl: string,
  action: string,
  env: { NODE_ENV?: string | undefined } = process.env,
): DatabaseTarget {
  const refuse = (reason: string): never => {
    throw new UnsafeDatabaseTargetError(
      `Refusing to ${action}: ${reason} Only a local development or test database ` +
        `(host localhost/127.0.0.1/::1, database name matching ${DISPOSABLE_DATABASE_NAME}) is allowed.`,
    );
  };
  if (env.NODE_ENV === 'production') refuse('NODE_ENV is "production".');

  const target = describeTarget(databaseUrl);
  const url = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) refuse(`unsupported protocol "${url.protocol}".`);
  for (const param of REDIRECTING_PARAMS) {
    if (url.searchParams.has(param)) refuse(`the URL contains a "${param}" parameter.`);
  }
  if (!LOCAL_HOSTS.has(target.host)) {
    refuse(`host "${target.host || '(empty)'}" is not a local host.`);
  }
  if (!DISPOSABLE_DATABASE_NAME.test(target.database)) {
    refuse(`database "${target.database}" is not on the local/test allow-list.`);
  }
  return target;
}
