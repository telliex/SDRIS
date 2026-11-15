import { parseCorrelationId, type CorrelationId } from './correlation-id';
import { isErrorCode } from './error';
import { parseEntityId, type EntityId } from './entity-id';
import { parseEntityRef, type EntityRef } from './entity-ref';
import { err, isErr, ok, type Result } from './result';
import { isRecord, kernelError, type KernelError } from './kernel-error';
import { parseTimestamp, type Timestamp } from './timestamp';

/**
 * Where and how a record was produced. Framework-independent and free-form by design; it is
 * diagnostic context, not a business field.
 */
export interface ExecutionContext {
  /** Emitting component, e.g. `api`, `worker`. */
  readonly source: string;
  readonly environment?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

interface CommonMetadata {
  /** Version of the payload/metadata schema this record conforms to. */
  readonly schemaVersion: number;
  /** When the thing happened in the domain. Set by the producer; never by the processing system. */
  readonly occurredAt: Timestamp;
  /**
   * When the system recorded or processed it. Optional because it is typically assigned later
   * (outbox, ingestion). It is NOT required to be >= occurredAt, since clocks may skew.
   */
  readonly recordedAt?: Timestamp;
  readonly correlationId: CorrelationId;
  /** Identifier of the event or command that directly caused this record. */
  readonly causationId?: EntityId;
  readonly executionContext?: ExecutionContext;
}

export interface EventMetadata<TType extends string = string> extends CommonMetadata {
  readonly eventId: EntityId<'DomainEvent'>;
  /** Dotted lower-case name owned by the emitting context, e.g. `investigation.case_opened`. */
  readonly eventType: TType;
  readonly aggregate: EntityRef;
  readonly actor?: EntityRef;
}

export interface AuditMetadata extends CommonMetadata {
  readonly auditId: EntityId<'AuditRecord'>;
  /** Dotted lower-case action name owned by the emitting context. */
  readonly action: string;
  readonly actor: EntityRef;
  /** The entity the action was performed on. */
  readonly subject: EntityRef;
}

/** Event metadata plus a context-owned payload. The kernel does not define payload contents. */
export interface DomainEventEnvelope<TType extends string = string, TPayload = unknown> {
  readonly metadata: EventMetadata<TType>;
  readonly payload: TPayload;
}

const CONTEXT_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_ATTRIBUTES = 32;
const MAX_ATTRIBUTE_VALUE = 256;

function bad(reason: string, field: string): Result<never, KernelError> {
  return err(kernelError('shared_kernel.invalid_metadata', reason, field));
}

function parseExecutionContext(
  input: unknown,
  field: string,
): Result<ExecutionContext, KernelError> {
  if (!isRecord(input)) return bad('must be an object', field);
  const { source, environment, attributes } = input;
  if (typeof source !== 'string' || !CONTEXT_TOKEN_PATTERN.test(source)) {
    return bad('must be 1-128 characters of [A-Za-z0-9._:/-]', `${field}.source`);
  }
  if (
    environment !== undefined &&
    (typeof environment !== 'string' || !CONTEXT_TOKEN_PATTERN.test(environment))
  ) {
    return bad('must be 1-128 characters of [A-Za-z0-9._:/-]', `${field}.environment`);
  }
  let copied: Record<string, string> | undefined;
  if (attributes !== undefined) {
    if (!isRecord(attributes)) return bad('must be an object', `${field}.attributes`);
    const entries = Object.entries(attributes);
    if (entries.length > MAX_ATTRIBUTES) {
      return bad(`must have at most ${MAX_ATTRIBUTES} entries`, `${field}.attributes`);
    }
    copied = {};
    for (const [key, value] of entries) {
      if (!CONTEXT_TOKEN_PATTERN.test(key)) {
        return bad('key must match [A-Za-z0-9._:/-]', `${field}.attributes`);
      }
      if (typeof value !== 'string' || value.length > MAX_ATTRIBUTE_VALUE) {
        return bad(
          `value must be a string of at most ${MAX_ATTRIBUTE_VALUE} characters`,
          `${field}.attributes.${key}`,
        );
      }
      copied[key] = value;
    }
    Object.freeze(copied);
  }
  return ok(
    Object.freeze({
      source,
      ...(environment !== undefined ? { environment } : {}),
      ...(copied !== undefined ? { attributes: copied } : {}),
    }),
  );
}

function parseCommon(input: Record<string, unknown>): Result<CommonMetadata, KernelError> {
  const { schemaVersion } = input;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1
  ) {
    return bad('must be a positive safe integer', 'schemaVersion');
  }
  const occurredAt = parseTimestamp(input.occurredAt, 'occurredAt');
  if (isErr(occurredAt)) return occurredAt;
  let recordedAt: Timestamp | undefined;
  if (input.recordedAt !== undefined) {
    const parsed = parseTimestamp(input.recordedAt, 'recordedAt');
    if (isErr(parsed)) return parsed;
    recordedAt = parsed.value;
  }
  const correlationId = parseCorrelationId(input.correlationId, 'correlationId');
  if (isErr(correlationId)) return correlationId;
  let causationId: EntityId | undefined;
  if (input.causationId !== undefined) {
    const parsed = parseEntityId(input.causationId, 'causationId');
    if (isErr(parsed)) return parsed;
    causationId = parsed.value;
  }
  let executionContext: ExecutionContext | undefined;
  if (input.executionContext !== undefined) {
    const parsed = parseExecutionContext(input.executionContext, 'executionContext');
    if (isErr(parsed)) return parsed;
    executionContext = parsed.value;
  }
  return ok({
    schemaVersion,
    occurredAt: occurredAt.value,
    ...(recordedAt !== undefined ? { recordedAt } : {}),
    correlationId: correlationId.value,
    ...(causationId !== undefined ? { causationId } : {}),
    ...(executionContext !== undefined ? { executionContext } : {}),
  });
}

/** Validates untrusted input as EventMetadata and returns a frozen copy. */
export function parseEventMetadata<TType extends string = string>(
  input: unknown,
  expectedType?: TType,
): Result<EventMetadata<TType>, KernelError> {
  if (!isRecord(input)) return bad('must be an object', 'metadata');
  const eventId = parseEntityId<'DomainEvent'>(input.eventId, 'eventId');
  if (isErr(eventId)) return eventId;
  const { eventType } = input;
  if (!isErrorCode(eventType) || (expectedType !== undefined && eventType !== expectedType)) {
    return bad(
      expectedType === undefined
        ? 'must be a dotted lower-case name'
        : `must be the dotted lower-case name "${expectedType}"`,
      'eventType',
    );
  }
  const aggregate = parseEntityRef(input.aggregate, undefined, 'aggregate');
  if (isErr(aggregate)) return aggregate;
  let actor: EntityRef | undefined;
  if (input.actor !== undefined) {
    const parsed = parseEntityRef(input.actor, undefined, 'actor');
    if (isErr(parsed)) return parsed;
    actor = parsed.value;
  }
  const common = parseCommon(input);
  if (isErr(common)) return common;
  return ok(
    Object.freeze({
      eventId: eventId.value,
      eventType: eventType as TType,
      aggregate: aggregate.value,
      ...(actor !== undefined ? { actor } : {}),
      ...common.value,
    }),
  );
}

/** Validates untrusted input as AuditMetadata and returns a frozen copy. */
export function parseAuditMetadata(input: unknown): Result<AuditMetadata, KernelError> {
  if (!isRecord(input)) return bad('must be an object', 'metadata');
  const auditId = parseEntityId<'AuditRecord'>(input.auditId, 'auditId');
  if (isErr(auditId)) return auditId;
  const { action } = input;
  if (!isErrorCode(action)) return bad('must be a dotted lower-case name', 'action');
  const actor = parseEntityRef(input.actor, undefined, 'actor');
  if (isErr(actor)) return actor;
  const subject = parseEntityRef(input.subject, undefined, 'subject');
  if (isErr(subject)) return subject;
  const common = parseCommon(input);
  if (isErr(common)) return common;
  return ok(
    Object.freeze({
      auditId: auditId.value,
      action,
      actor: actor.value,
      subject: subject.value,
      ...common.value,
    }),
  );
}
