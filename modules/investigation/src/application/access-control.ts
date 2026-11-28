import {
  createError,
  err,
  ok,
  type CorrelationId,
  type Result,
  type SdrisError,
  type Timestamp,
} from '@sdris/shared-kernel';
import type { ActorHandle, ActorResolver, VerifiedActor } from './ports/actor-resolver';

/**
 * Authentication, correlation validation and authorization for every Investigation command and read
 * (S0-06 specification 2.6 to 2.9, 3.1 and 4.7). The service calls `authorize` first, before it opens a transaction
 * or touches the repository, so a refusal writes nothing and queries nothing.
 */

/** The first argument of every command and read (specification 2.6). */
export interface RequestContext {
  readonly actor: ActorHandle;
  /** A label, not an authority claim: validated against a strict form and never trusted to identify anyone. */
  readonly correlationId: CorrelationId;
}

/**
 * Why a call was refused before any business processing. `unauthenticated` never says which part failed;
 * `permission_denied` names only the permission that was required (specification 2.9).
 */
export type AccessError =
  | SdrisError<'investigation.unauthenticated', undefined>
  | SdrisError<
      'investigation.invalid_request_context',
      { readonly field: 'context' | 'correlationId' }
    >
  | SdrisError<'investigation.permission_denied', { readonly requiredPermission: string }>;

/** The closed permission vocabulary the service checks (specification 3.1). Flat grants, no hierarchy. */
export const REQUIRED_PERMISSION = {
  registerUut: 'investigation.uut.register',
  registerTestAttempt: 'investigation.attempt.register',
  openCase: 'investigation.case.open',
  linkAttempt: 'investigation.case.link_attempt',
  getUut: 'investigation.read',
  getTestAttempt: 'investigation.read',
  getCase: 'investigation.read',
} as const;

export type GuardedCommand = keyof typeof REQUIRED_PERMISSION;

/**
 * Security Log events (specification 4.7): fixed fields only, built by this module and never by spreading a caller
 * object. They never contain a credential, a handle, a claim, a payload value or caller-controlled text.
 * `correlationId` only when it passed validation; `actorId` and `requiredPermission` only after the actor was
 * verified.
 */
export type SecurityEvent =
  | {
      readonly event: 'security.unauthenticated';
      readonly at: Timestamp;
      readonly command: GuardedCommand;
      readonly reason: 'missing_handle' | 'invalid_handle' | 'revoked_handle' | 'expired_handle';
    }
  | {
      readonly event: 'security.invalid_request_context';
      readonly at: Timestamp;
      readonly command: GuardedCommand;
      readonly reason: 'invalid_context' | 'invalid_correlation';
      readonly actorId: string;
    }
  | {
      readonly event: 'security.permission_denied';
      readonly at: Timestamp;
      readonly command: GuardedCommand;
      readonly reason: 'permission_missing';
      readonly correlationId: string;
      readonly actorId: string;
      readonly requiredPermission: string;
    };

/**
 * Internal port implemented by a logger adapter that the composition root injects. The adapter owns failure
 * containment: a failing sink never changes a result (specification 4.7, "Sink failure").
 */
export interface SecurityLog {
  record(event: SecurityEvent): void;
}

/** What a successful authorization hands to the command: the verified actor and the validated label. */
export interface Authorized {
  readonly actor: VerifiedActor;
  readonly correlationId: string;
}

/** The strict correlation form of specification 4.6: a lowercase canonical UUID, exactly 36 characters. */
const STRICT_CORRELATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const unauthenticated = (): Result<never, AccessError> =>
  err(
    createError<'investigation.unauthenticated', undefined>({
      code: 'investigation.unauthenticated',
      message: 'The request is not authenticated.',
    }),
  );

export interface AccessGuard {
  authorize(context: unknown, command: GuardedCommand): Result<Authorized, AccessError>;
}

export function createAccessGuard(deps: {
  readonly actorResolver: ActorResolver;
  readonly securityLog: SecurityLog;
  readonly now: () => Timestamp;
}): AccessGuard {
  if (typeof deps?.actorResolver?.resolve !== 'function') {
    throw new TypeError(
      'An actorResolver is required: the service never runs without authentication.',
    );
  }
  if (typeof deps.securityLog?.record !== 'function') {
    throw new TypeError('A securityLog is required: every rejection is recorded.');
  }
  const { actorResolver, securityLog, now } = deps;

  // The one place an event leaves this module. A log that throws never changes the refusal; a log that returns a
  // promise gets no handler here because the adapter, not the service, owns counting and reporting.
  const emit = (build: () => SecurityEvent): void => {
    try {
      securityLog.record(build());
    } catch {
      // the rejection stands
    }
  };

  return {
    authorize(context, command) {
      // Each property of the caller's object is read once; an accessor cannot answer differently later.
      let handle: unknown;
      let readable = true;
      try {
        handle =
          context === undefined || context === null
            ? undefined
            : (context as { actor?: unknown }).actor;
      } catch {
        readable = false;
      }

      // A1 authentication. A throwing resolver or context is refused as an invalid handle (fail closed).
      let status: 'valid' | 'missing' | 'invalid' | 'expired' | 'revoked' = 'invalid';
      let resolved: VerifiedActor | undefined;
      if (readable) {
        try {
          const resolution = actorResolver.resolve(handle);
          status = resolution.status;
          if (resolution.status === 'valid') resolved = resolution.actor;
        } catch {
          status = 'invalid';
        }
      }
      if (status !== 'valid' || resolved === undefined) {
        const reason =
          status === 'missing'
            ? 'missing_handle'
            : status === 'revoked'
              ? 'revoked_handle'
              : status === 'expired'
                ? 'expired_handle'
                : 'invalid_handle';
        emit(() => ({
          event: 'security.unauthenticated',
          at: now(),
          command,
          reason,
        }));
        return unauthenticated();
      }
      const actor = resolved;

      // A2 correlation validation: the context shape, then the label.
      const invalidContext = (field: 'context' | 'correlationId'): Result<never, AccessError> => {
        emit(() => ({
          event: 'security.invalid_request_context',
          at: now(),
          command,
          reason: field === 'context' ? 'invalid_context' : 'invalid_correlation',
          actorId: actor.actor.id,
        }));
        return err(
          createError({
            code: 'investigation.invalid_request_context' as const,
            message: 'The request context is not valid.',
            details: { field },
          }),
        );
      };
      // One exception boundary for exactly the two inspections of the caller's object: its shape and its label. A
      // context that cannot be inspected (a revoked proxy, a throwing accessor) is an invalid context, returned as a
      // value like any other A2 failure; it is never allowed to escape as a TypeError. Nothing else is caught here.
      let correlation: unknown;
      let inspectable = true;
      try {
        if (typeof context !== 'object' || context === null || Array.isArray(context)) {
          inspectable = false;
        } else {
          correlation = (context as { correlationId?: unknown }).correlationId;
        }
      } catch {
        inspectable = false;
      }
      if (!inspectable) return invalidContext('context');
      if (typeof correlation !== 'string' || !STRICT_CORRELATION.test(correlation)) {
        return invalidContext('correlationId');
      }

      // A3 authorization: authentication does not imply authorization.
      const required = REQUIRED_PERMISSION[command];
      if (!actor.permissions.includes(required)) {
        emit(() => ({
          event: 'security.permission_denied',
          at: now(),
          command,
          reason: 'permission_missing',
          correlationId: correlation as string,
          actorId: actor.actor.id,
          requiredPermission: required,
        }));
        return err(
          createError({
            code: 'investigation.permission_denied' as const,
            message: 'The actor does not hold the required permission.',
            details: { requiredPermission: required },
          }),
        );
      }
      return ok({ actor, correlationId: correlation });
    },
  };
}
